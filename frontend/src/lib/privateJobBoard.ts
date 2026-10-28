import { useCallback, useEffect, useReducer, useState } from 'react';
import type { User } from '@supabase/auth-js';
import { JOB_PAGE_SIZE, keywordPattern, type Job, type JobFilters } from './jobCatalog';
import { fetchWithSession, functionsUrl, supabase } from './supabase';

interface Identity { ready: boolean; userId: string | null; email: string; name: string; version: number }
interface Access { allowed: boolean; next_allowed_at: string | null; last_status: string | null; last_query: string | null }
interface AccessState { identity: string; value: Access | null; loading: boolean; error: string | null; generation: number }
interface PageState { key: string; loading: boolean; error: string | null; data: { jobs: Job[]; total: number } | null }

export function usePrivateIdentity(): Identity {
  const [identity, setIdentity] = useState<Identity>({ ready: false, userId: null, email: '', name: '', version: 0 });
  useEffect(() => {
    let active = true;
    let version = 0;
    let lastIdentity: string | undefined;
    const apply = (authUser: User | null | undefined, token = '') => {
      const user = authUser && !authUser.is_anonymous ? authUser : null;
      const userId = user?.id ?? null;
      const current = JSON.stringify([userId, token]);
      if (!active || lastIdentity === current) return;
      lastIdentity = current;
      version++;
      const name: unknown = user?.user_metadata?.name ?? user?.user_metadata?.full_name;
      setIdentity({ ready: true, userId, email: user?.email ?? '', name: typeof name === 'string' ? name : '', version });
    };
    const initialVersion = version;
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (active && version === initialVersion) apply(session?.user, session?.access_token);
    }).catch(() => { if (active && version === initialVersion) apply(null); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Supabase may emit SIGNED_IN again on focus: unchanged identity/token
      // must not cancel queries or remount inputs. Real account/token changes do.
      apply(session?.user, session?.access_token);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  return identity;
}

// Access is independent of saved-job filters. Typing must not unmount the form.
// Account changes still hide everything immediately; failed rechecks fail closed.
export function usePrivateJobPage(userId: string, filters: JobFilters, page: number, authVersion: number) {
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);
  const identity = JSON.stringify([userId, authVersion]);
  const [accessState, setAccess] = useState<AccessState>({ identity: '', value: null, loading: true, error: null, generation: 0 });
  const [snapshot, setSnapshot] = useState<PageState>({ key: '', loading: true, error: null, data: null });
  useEffect(() => {
    let active = true;
    let pending = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    const schedule = () => {
      if (!active) return;
      timer = window.setTimeout(() => {
        if (document.visibilityState === 'visible') void load();
        else schedule();
      }, 30_000);
    };
    async function load() {
      if (!active || pending) return;
      pending = true;
      controller = new AbortController();
      setAccess((previous) => ({ ...previous, identity, loading: true, error: null,
        value: previous.identity === identity ? previous.value : null }));
      try {
        const { data, error } = await supabase.rpc('private_job_board_access').retry(false)
          .abortSignal(AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
        if (error || !data || typeof data.allowed !== 'boolean') throw new Error('Access check unavailable');
        if (active) {
          if (!data.allowed) setSnapshot({ key: '', loading: false, error: null, data: null });
          setAccess((previous) => ({ identity, value: data, loading: false, error: null, generation: previous.generation + 1 }));
        }
      } catch {
        if (active) {
          setSnapshot({ key: '', loading: false, error: null, data: null });
          setAccess((previous) => ({ identity, value: null, loading: false,
            error: 'Unable to load your private board. Please retry.', generation: previous.generation + 1 }));
        }
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
  }, [identity, revision]);

  const access = accessState.identity === identity ? accessState.value : null;
  const key = JSON.stringify([identity, filters.keyword.trim(), filters.freshersOnly, page]);
  const allowed = access?.allowed === true;
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    const controller = new AbortController();
    async function load() {
      setSnapshot((previous) => ({ key, loading: true, error: null, data: previous.key === key ? previous.data : null }));
      try {
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
          .retry(false).abortSignal(AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
        if (error || count === null) throw new Error('Private jobs unavailable');
        if (active) setSnapshot({ key, loading: false, error: null, data: { jobs: data ?? [], total: count } });
      } catch {
        if (active) setSnapshot({ key, loading: false, error: 'Unable to load your saved jobs. Please retry.', data: null });
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [key, allowed, userId, filters.keyword, filters.freshersOnly, page, accessState.generation]);
  const current = snapshot.key === key && allowed ? snapshot : { key, loading: allowed, error: null, data: null };
  const retry = useCallback(() => refresh(), []);
  return { data: current.data, loading: accessState.identity !== identity || accessState.loading || current.loading,
    error: accessState.error ?? current.error, access, refresh: retry };
}

const privateRequest = fetchWithSession(true);
export async function discoverPrivateJobs(query: string, signal: AbortSignal): Promise<{ message: string; failed: boolean }> {
  let response: Response;
  try {
    response = await privateRequest(`${functionsUrl}/private-job-board`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal,
    });
  } catch {
    return { message: 'Could not reach private discovery (network, CORS, or timeout). Check that the private-job-board Edge Function is deployed. Reload to check the daily allowance before retrying.', failed: true };
  }
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: 'Please sign in again to discover private jobs.',
      403: 'Active paid access is required. Contact your administrator.',
      404: 'Private discovery is not deployed. Ask your administrator to deploy the private-job-board Edge Function.',
      409: 'Your private discovery is already running. Reload the board shortly.',
      429: 'Your daily discovery allowance has been used. Your saved jobs remain available.',
      400: 'Choose one of the supported discovery presets.',
    };
    // Only interpret fixed server codes, never display arbitrary upstream text.
    const codes: Record<string, string> = {
      service_not_configured: 'Private discovery is not configured. Ask your administrator to set the TheirStack Edge Function secret.',
      authentication_unavailable: 'Private discovery could not verify your session. Please try later.',
      scan_claim_unavailable: 'Private discovery could not reserve your daily allowance. Ask your administrator to check migration 004 and its service-only functions.',
      provider_unavailable: 'TheirStack could not complete this discovery. Ask your administrator to check the provider key, subscription, and rate limits. The daily allowance may be used.',
      provider_response_invalid: 'TheirStack returned an unusable response. Nothing was saved; the daily allowance may be used.',
      private_save_unavailable: 'Discovery could not confirm saving your jobs. Reload the board; ask your administrator to check the private-job database functions.',
    };
    let codeMessage: string | undefined;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string'
        && Object.hasOwn(codes, body.code)) codeMessage = codes[body.code];
    } catch { /* HTTP status is still useful when a gateway returns non-JSON. */ }
    return { message: messages[response.status] ?? codeMessage ?? 'Private discovery is temporarily unavailable. Please try later.', failed: true };
  }
  try {
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('status' in result) || result.status !== 'completed'
      || !('jobsSaved' in result) || typeof result.jobsSaved !== 'number' || !Number.isInteger(result.jobsSaved)
      || result.jobsSaved < 0 || result.jobsSaved > 10) throw new Error('Invalid discovery result');
    return { message: result.jobsSaved === 0
      ? 'Discovery completed, but TheirStack returned no jobs for this preset today. No jobs were added; the daily allowance was used.'
      : `Discovery complete: ${result.jobsSaved} jobs saved to your private board.`, failed: false };
  } catch {
    return { message: 'Private discovery returned an unexpected response. Reload to check for saved jobs; ask your administrator to check the deployed Edge Function version.', failed: true };
  }
}
