import { useEffect, useRef, useState } from 'react';
import { JOB_PAGE_SIZE, useJobPage, type JobFilters } from '../lib/jobCatalog';
import { useJobRefresh } from '../lib/jobRefresh';
import { JobCards, JobFilterBar, JobPagination } from './JobBoardView';
import FancyButton from './FancyButton';
import './JobBoard.css';

type WashPhase = 'hidden' | 'enter' | 'rise' | 'out';

export default function JobBoard() {
  const [{ filters, page }, setQuery] = useState<{ filters: JobFilters; page: number }>({
    filters: { keyword: '', minRating: 'All', freshersOnly: false, source: 'All' }, page: 1,
  });
  const { data, loading, error, refresh } = useJobPage(filters, page);
  const scraper = useJobRefresh(refresh);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / JOB_PAGE_SIZE));
  if (data && !loading && !error && page > pages) setQuery((current) => ({ ...current, page: pages }));
  const onPage = (next: number) => setQuery((current) => ({ ...current, page: next }));
  const updateFilters = (update: Partial<JobFilters>) => {
    setQuery((current) => ({ filters: { ...current.filters, ...update }, page: 1 }));
  };

  // Success wash: the paper sweeps light green from the bottom up on REFRESH,
  // and returns to white once the dispatched action settles.
  const [wash, setWash] = useState<WashPhase>('hidden');
  const washTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(washTimer.current), []);

  function handleRefreshClick() {
    window.clearTimeout(washTimer.current);
    setWash('enter');
    void scraper.startRefresh();
  }

  useEffect(() => {
    if (wash !== 'enter') return;
    const id = window.setTimeout(() => setWash('rise'), 20);
    return () => window.clearTimeout(id);
  }, [wash]);

  const flowing = scraper.busy || scraper.running;
  useEffect(() => {
    if (wash !== 'rise' || flowing) return;
    const id = window.setTimeout(() => {
      setWash('out');
      washTimer.current = window.setTimeout(() => setWash('hidden'), 900);
    }, 350);
    return () => window.clearTimeout(id);
  }, [wash, flowing]);

  const washClass = ['refresh-wash']
    .concat(wash === 'rise' ? ['refresh-wash--rise'] : [])
    .concat(wash === 'out' ? ['refresh-wash--out'] : [])
    .join(' ');

  return (
    <div className="job-board" aria-busy={loading}>
      <div className={washClass} aria-hidden="true" />
      <div className="job-board-heading-row">
        <h2 className="job-board-heading">Latest Opportunities</h2>
        <FancyButton to="/private-jobs" className="job-board-private-link" title="Open your Private Job Board">
          PJobB
        </FancyButton>
      </div>
      <JobFilterBar filters={filters} onChange={updateFilters} />
      {error && <div className="job-board-feedback" role="alert">
        <p>{data ? 'Refresh failed. Showing previously loaded results.' : error}</p>
        <FancyButton onClick={refresh}>Retry</FancyButton>
        {page > 1 && <FancyButton onClick={() => onPage(1)}>First page</FancyButton>}
      </div>}
      {loading && !data && <div className="job-board-empty"><p>System scanning for new jobs...</p></div>}
      {loading && data && <p className="job-board-feedback">Refreshing jobs...</p>}
      <div className="job-board-actions">
        {(data || page > 1) && <JobPagination page={page} pages={pages} total={total} loading={loading}
          hasData={Boolean(data)} onPage={onPage} />}
        <FancyButton
          className="job-board-refresh"
          disabled={scraper.checking || scraper.busy || scraper.running}
          describedBy={scraper.message ? 'job-refresh-status' : undefined}
          onClick={handleRefreshClick}
        >
          {scraper.busy ? 'STARTING...' : scraper.running ? 'REFRESHING...' : scraper.checking ? 'CHECKING...' : 'REFRESH'}
        </FancyButton>
      </div>
      {scraper.message && <p id="job-refresh-status" className="job-board-refresh-status" role={scraper.error ? 'alert' : 'status'}>
        {scraper.message}
      </p>}
      {data && data.jobs.length === 0 && !loading && !error && <div className="job-board-empty">
        <p>No jobs match your filters. Try different criteria.</p>
      </div>}
      <JobCards jobs={data?.jobs ?? []} />
    </div>
  );
}
