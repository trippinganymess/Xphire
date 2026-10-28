import { useState } from 'react';
import { Link } from 'react-router-dom';
import { JOB_PAGE_SIZE, useJobPage, type JobFilters } from '../lib/jobCatalog';
import { useJobRefresh } from '../lib/jobRefresh';
import { JobCards, JobFilterBar, JobPagination } from './JobBoardView';
import './JobBoard.css';

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

  return (
    <div className="job-board" aria-busy={loading}>
      <div className="job-board-heading-row">
        <h2 className="job-board-heading">Latest Opportunities</h2>
        <Link to="/private-jobs" className="job-board-private-link" title="Open your Private Job Board">PJobB</Link>
      </div>
      <JobFilterBar filters={filters} onChange={updateFilters} />
      {error && <div className="job-board-feedback" role="alert">
        <p>{data ? 'Refresh failed. Showing previously loaded results.' : error}</p>
        <button type="button" onClick={refresh}>Retry</button>
        {page > 1 && <button type="button" onClick={() => onPage(1)}>First page</button>}
      </div>}
      {loading && !data && <div className="job-board-empty"><p>System scanning for new jobs...</p></div>}
      {loading && data && <p className="job-board-feedback">Refreshing jobs...</p>}
      <div className="job-board-actions">
        {(data || page > 1) && <JobPagination page={page} pages={pages} total={total} loading={loading}
          hasData={Boolean(data)} onPage={onPage} />}
        <button type="button" className="job-board-refresh" disabled={scraper.checking || scraper.busy || scraper.running}
          aria-describedby={scraper.message ? 'job-refresh-status' : undefined}
          onClick={() => { void scraper.startRefresh(); }}>
          {scraper.busy ? 'STARTING...' : scraper.running ? 'REFRESHING...' : scraper.checking ? 'CHECKING...' : 'REFRESH'}
        </button>
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
