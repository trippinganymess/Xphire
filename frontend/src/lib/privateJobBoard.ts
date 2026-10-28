import { useCallback, useEffect, useReducer, useState } from 'react';
import { JOB_PAGE_SIZE, keywordPattern, type Job, type JobFilters } from './jobCatalog';
import { fetchWithSession, functionsUrl, supabase } from './supabase';

interface Identity { ready: boolean; userId: string | null; version: number }
interface Access { allowed: boolean; next_allowed_at: string | null; last_status: string | null; last_query: string | null }
interface Snapshot {
  key: string; loading: boolean; error: string | null; access: Access | null;
  data: { jobs: Job[]; total: number } | null;
}

export function usePrivateIdentity(): Identity {
  const [identity, setIdentity] = useState<Identity>({ ready: false, userId: null, version: 0 });
  useEffect(() => {
    let active = true;
    let version = 0;
    const apply = (userId: string | null) => {
      version++;
      if (active) setIdentity({ ready: true, userId, version });
    };
    const initialVersion = version;
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (active && version === initialVersion) apply(session?.user && !session.user.is_anonymous ? session.user.id : null);
    }).catch(() => { if (active && version === initialVersion) apply(null); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      apply(session?.user && !session.user.is_anonymous ? session.user.id : null);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  return identity;
}

// Component-owned state: no localStorage or shared private-job cache. The
// caller remounts on account changes; key checks also hide late query results.
export function usePrivateJobPage(userId: string, filters: JobFilters, page: number, authVersion: number) {
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);
  const key = JSON.stringify([userId, filters.keyword.trim(), filters.freshersOnly, page, authVersion]);
  const [snapshot, setSnapshot] = useState<Snapshot>({ key: '', loading: true, error: null, access: null, data: null });
  useEffect(() => {
    let active = true;
    let pending = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    function schedule() {
      if (!active) return;
      timer = window.setTimeout(() => {
        if (document.visibilityState === 'visible') void load();
        else schedule();
      }, 30_000);
    }
    async function load() {
      if (!active || pending) return;
      pending = true;
      controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
      setSnapshot((previous) => ({ key, loading: true, error: null,
        access: previous.key === key ? previous.access : null, data: previous.key === key ? previous.data : null }));
      try {
        const { data: access, error: accessError } = await supabase.rpc('private_job_board_access')
          .retry(false).abortSignal(signal);
        if (accessError || !access || typeof access.allowed !== 'boolean') throw new Error('Access check unavailable');
        if (!access.allowed) {
          if (active) setSnapshot({ key, loading: false, error: null, access, data: null });
          return;
        }
        let query = supabase.from('private_jobs')
          .select('job_id,company,title,location,experience,salary,source,rating,scraped_at,posted_date,url', { count: 'exact' })
          .eq('user_id', userId);
        const groups: string[] = [];
        if (filters.keyword.trim()) {
          const pattern = keywordPattern(filters.keyword);
          groups.push(`or(company.imatch.${pattern},title.imatch.${pattern},location.imatch.${pattern})`);
        }
        if (filters.freshersOnly) groups.push('or(experience.ilike.%junior%,experience.ilike.%intern%)');
        if (groups.length) query = query.or(`and(${groups.join(',')})`);
        const offset = (page - 1) * JOB_PAGE_SIZE;
        const { data, count, error } = await query.order('scraped_at', { ascending: false })
          .order('job_id', { ascending: false }).range(offset, offset + JOB_PAGE_SIZE - 1)
          .retry(false).abortSignal(signal);
        if (error || count === null) throw new Error('Private jobs unavailable');
        if (active) setSnapshot({ key, loading: false, error: null, access,
          data: { jobs: data ?? [], total: count } });
      } catch {
        // Fail closed: never retain private data when access cannot be checked.
        if (active) setSnapshot({ key, loading: false, error: 'Unable to load your private board. Please retry.', access: null, data: null });
      } finally {
        pending = false;
        if (active) schedule();
      }
    }
    const visible = () => {
      if (document.visibilityState === 'visible') { window.clearTimeout(timer); void load(); }
    };
    void load();
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false; controller?.abort(); window.clearTimeout(timer);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [key, userId, filters.keyword, filters.freshersOnly, page, authVersion, revision]);
  const retry = useCallback(() => refresh(), []);
  return { ...(snapshot.key === key ? snapshot : { key, loading: true, error: null, access: null, data: null }), refresh: retry };
}

const privateRequest = fetchWithSession(true);
export async function discoverPrivateJobs(query: string, signal: AbortSignal): Promise<{ message: string; failed: boolean }> {
  try {
    const response = await privateRequest(`${functionsUrl}/private-job-board`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal,
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: 'Please sign in again to discover private jobs.',
        403: 'Active paid access is required. Contact your administrator.',
        409: 'Your private discovery is already running. Reload the board shortly.',
        429: 'Your daily discovery allowance has been used. Your saved jobs remain available.',
        400: 'Enter a valid job title, up to 120 characters.',
      };
      return { message: messages[response.status] ?? 'Private discovery is temporarily unavailable. Please try later.', failed: true };
    }
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('status' in result) || result.status !== 'completed'
      || !('jobsSaved' in result) || typeof result.jobsSaved !== 'number' || !Number.isInteger(result.jobsSaved)
      || result.jobsSaved < 0 || result.jobsSaved > 10) throw new Error('Invalid discovery result');
    return { message: `Discovery complete: ${result.jobsSaved} jobs saved to your private board.`, failed: false };
  } catch {
    return { message: 'Unable to confirm discovery. Reload your board before trying again; the daily allowance may already be used.', failed: true };
  }
}
