import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { supabase } from './supabase';

export interface Job {
  job_id: string;
  company: string;
  title: string;
  location: string;
  experience: string;
  salary: string;
  source: string;
  rating: number;
  scraped_at: string;
  url: string;
}

export interface JobFilters {
  keyword: string;
  minRating: string;
  freshersOnly: boolean;
  source: string;
}

export const JOB_PAGE_SIZE = 51;
const JOB_COLUMNS = 'job_id,company,title,location,experience,salary,source,rating,scraped_at,url';

interface JobPage {
  jobs: Job[];
  total: number;
}

// Quote PostgREST grammar characters and escape regular-expression syntax.
// IMATCH preserves literal substring search even for '*', which PostgREST
// treats as a wildcard alias in LIKE/ILIKE expressions.
function keywordPattern(keyword: string): string {
  return JSON.stringify(keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

async function fetchJobPage(filters: JobFilters, page: number): Promise<JobPage> {
  const now = Date.now();
  const cutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  let query = supabase.from('Seen_job')
    .select(JOB_COLUMNS, { count: 'exact' })
    .gte('scraped_at', cutoff)
    .lte('scraped_at', new Date(now).toISOString());

  const groups: string[] = [];
  if (filters.keyword.trim()) {
    const pattern = keywordPattern(filters.keyword);
    groups.push(`or(company.imatch.${pattern},title.imatch.${pattern},location.imatch.${pattern})`);
  }
  if (filters.freshersOnly) {
    // Compatibility only: ticket 08 replaces this legacy heuristic with
    // persisted evidence-based eligibility. Do not claim these are verified.
    groups.push('or(experience.ilike.%fresher%,experience.ilike.%0-1%)');
  }
  if (groups.length) query = query.or(`and(${groups.join(',')})`);
  if (filters.minRating !== 'All') query = query.gte('rating', Number(filters.minRating));
  if (filters.source !== 'All') query = query.ilike('source', filters.source);

  const offset = (page - 1) * JOB_PAGE_SIZE;
  const { data, count, error } = await query
    .order('scraped_at', { ascending: false })
    .order('job_id', { ascending: false })
    .range(offset, offset + JOB_PAGE_SIZE - 1)
    // This store owns scheduled/manual retries; avoid a second SDK retry loop.
    .retry(false)
    .abortSignal(AbortSignal.timeout(15_000));
  if (error) throw new Error(error.message);
  if (count === null) throw new Error('The catalog did not return a result count.');
  return { jobs: data ?? [], total: count };
}

interface PageState {
  data: JobPage | null;
  loading: boolean;
  error: string | null;
  updatedAt: number;
}

interface CacheEntry {
  snapshot: PageState;
  listeners: Set<() => void>;
  inFlight: Promise<void> | null;
  createdAt: number;
}

const FRESH_MS = 30_000;
const RETAIN_MS = 5 * 60_000;
const MAX_CACHED_PAGES = 20;
// Only the explicitly projected public job fields enter this in-memory cache.
// It is not persisted, and never caches profiles, auth, or terminal responses.
const pages = new Map<string, CacheEntry>();

function pruneCache(retain?: CacheEntry) {
  for (const [key, entry] of pages) {
    if (entry === retain || entry.listeners.size || entry.inFlight) continue;
    if (Date.now() - (entry.snapshot.updatedAt || entry.createdAt) >= RETAIN_MS || pages.size > MAX_CACHED_PAGES) {
      pages.delete(key);
    }
  }
}

function getEntry(key: string): CacheEntry {
  pruneCache();
  let entry = pages.get(key);
  if (!entry) {
    entry = {
      snapshot: { data: null, loading: false, error: null, updatedAt: 0 },
      listeners: new Set(), inFlight: null, createdAt: Date.now(),
    };
  }
  // Move the accessed page to the end for bounded least-recently-used eviction.
  pages.delete(key);
  pages.set(key, entry);
  pruneCache(entry);
  return entry;
}

function publish(entry: CacheEntry, snapshot: PageState) {
  entry.snapshot = snapshot;
  for (const listener of entry.listeners) listener();
}

function revalidate(entry: CacheEntry, filters: JobFilters, page: number, force = false): Promise<void> {
  if (entry.inFlight) return entry.inFlight;
  if (!force && entry.snapshot.data && Date.now() - entry.snapshot.updatedAt < FRESH_MS) {
    return Promise.resolve();
  }
  const retained = Date.now() - entry.snapshot.updatedAt < RETAIN_MS ? entry.snapshot.data : null;
  publish(entry, { ...entry.snapshot, data: retained, loading: true, error: null });
  entry.inFlight = fetchJobPage(filters, page).then((data) => {
    publish(entry, { data, loading: false, error: null, updatedAt: Date.now() });
  }).catch(() => {
    publish(entry, { ...entry.snapshot, loading: false, error: 'Unable to load jobs. Please retry.' });
  }).finally(() => {
    entry.inFlight = null;
    pruneCache();
  });
  return entry.inFlight;
}

export function useJobPage(filters: JobFilters, page: number) {
  const key = JSON.stringify([filters.keyword.trim(), filters.minRating, filters.freshersOnly, filters.source, page]);
  const entry = useMemo(() => getEntry(key), [key]);
  const subscribe = useCallback((listener: () => void) => {
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); pruneCache(); };
  }, [entry]);
  const getSnapshot = useCallback(() => entry.snapshot, [entry]);
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const refresh = useCallback(() => { void revalidate(entry, filters, page, true); }, [entry, filters, page]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    function schedule() {
      if (!active) return;
      window.clearTimeout(timer);
      const age = Date.now() - entry.snapshot.updatedAt;
      const delay = entry.snapshot.error || document.visibilityState !== 'visible'
        ? FRESH_MS : Math.max(1, FRESH_MS - age);
      timer = window.setTimeout(() => {
        if (document.visibilityState === 'visible') {
          void revalidate(entry, filters, page).finally(schedule);
        } else schedule();
      }, delay);
    }

    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        void revalidate(entry, filters, page).finally(schedule);
      }
    };
    // Shared in-flight requests survive route changes/StrictMode remounts. Only
    // the current page is observed; late results cannot replace another query.
    // Schedule from the response timestamp, not mount time: the first request
    // itself may have taken part of the 30-second freshness window.
    void revalidate(entry, filters, page).finally(schedule);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [entry, filters, page]);

  return { ...state, loading: state.loading || (!state.data && !state.error), refresh };
}
