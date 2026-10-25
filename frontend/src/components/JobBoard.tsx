import { useState, useEffect } from 'react';
import { JOB_PAGE_SIZE, useJobPage, type JobFilters } from '../lib/jobCatalog';
import { useJobRefresh } from '../lib/jobRefresh';
import './JobBoard.css';

const RATING_OPTIONS = ['All', '5', '4', '3', '2', '1'];

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export default function JobBoard() {
  // Preload the terminal component to reduce initial load latency
  useEffect(() => {
    import('./SketchTerminal');
  }, []);

  // Prefetch next page when on the first page
  // This will keep React hooks order consistent: we compute inside component
  const [_, __] = useState([]); // placeholder to satisfy TS no unused vars
  const [{ filters, page }, setQuery] = useState<{ filters: JobFilters; page: number }>({
    filters: { keyword: '', minRating: 'All', freshersOnly: false, source: 'All' },
    page: 1,
  });
  const { data, loading, error, refresh } = useJobPage(filters, page);
  const scraper = useJobRefresh(refresh);
  const jobs = data?.jobs ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / JOB_PAGE_SIZE));

  // A rolling 24-hour catalog can lose its last page during revalidation.
  // Adjust this component's own query only when the returned count requires it.
  if (data && !loading && !error && page > pages) {
    setQuery((current) => ({ ...current, page: pages }));
  }

  function updateFilters(update: Partial<JobFilters>) {
    setQuery((current) => ({ filters: { ...current.filters, ...update }, page: 1 }));
  }

  function renderFilterBar() {
    return (
      <div className="job-board-filter-bar">
        <input
          type="text"
          className="job-board-filter-input"
          placeholder="Search keyword ..."
          value={filters.keyword}
          aria-label="Search jobs"
          onChange={(e) => updateFilters({ keyword: e.target.value })}
        />

        <select
          className="job-board-filter-select"
          value={filters.minRating}
          aria-label="Minimum rating"
          onChange={(e) => updateFilters({ minRating: e.target.value })}
        >
          {RATING_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt === 'All' ? 'All Ratings' : `${opt} ★ & above`}
            </option>
          ))}
        </select>

        <label className="job-board-freshers-label">
          <input
            type="checkbox"
            checked={filters.freshersOnly}
            onChange={(e) => updateFilters({ freshersOnly: e.target.checked })}
          />
          Freshers Only
        </label>
      </div>
    );
  }

  function renderPagination() {
    return (
      <nav className="job-board-pagination" aria-label="Job pages">
        <button type="button" disabled={page === 1 || loading}
          onClick={() => setQuery((current) => ({ ...current, page: current.page - 1 }))}>
          Previous page
        </button>
        <span role="status">{data ? `Page ${page} of ${pages} · ${total} jobs` : `Page ${page}`}</span>
        <button type="button" disabled={page >= pages || loading || !data}
          onClick={() => setQuery((current) => ({ ...current, page: current.page + 1 }))}>
          Next page
        </button>
      </nav>
    );
  }

  return (
    <div className="job-board" aria-busy={loading}>
      <h2 className="job-board-heading">Latest Opportunities</h2>
      {renderFilterBar()}
      {error && (
        <div className="job-board-feedback" role="alert">
          <p>{data ? 'Refresh failed. Showing previously loaded results.' : error}</p>
          <button type="button" onClick={refresh}>Retry</button>
          {page > 1 && <button type="button"
            onClick={() => setQuery((current) => ({ ...current, page: 1 }))}>First page</button>}
        </div>
      )}
      {loading && !data && <div className="job-board-empty"><p>System scanning for new jobs...</p></div>}
      {loading && data && <p className="job-board-feedback">Refreshing jobs...</p>}
      <div className="job-board-actions">
        {(data || page > 1) && renderPagination()}
        <button
          type="button"
          className="job-board-refresh"
          disabled={scraper.checking || scraper.busy || scraper.running}
          aria-describedby={scraper.message ? 'job-refresh-status' : undefined}
          onClick={() => { void scraper.startRefresh(); }}
        >
          {scraper.busy ? 'STARTING...' : scraper.running ? 'REFRESHING...' : scraper.checking ? 'CHECKING...' : 'REFRESH'}
        </button>
      </div>
      {scraper.message && (
        <p id="job-refresh-status" className="job-board-refresh-status" role={scraper.error ? 'alert' : 'status'}>
          {scraper.message}
        </p>
      )}

      {data && jobs.length === 0 && !loading && !error && (
        <div className="job-board-empty">
          <p>No jobs match your filters. Try different criteria.</p>
        </div>
      )}

      <div className="job-board-grid">
        {jobs.map((job) => {
          const stars = '★'.repeat(Math.max(0, job.rating ?? 0));
          const posted = job.scraped_at ? formatTimeAgo(job.scraped_at) : '—';
          return (
            <article key={job.job_id} className="job-card">
              <div className="job-card-header">
                <span className="job-card-company">{job.company}</span>
                <span className="job-card-rating" title={`Rating: ${job.rating}/5`}>{stars}</span>
              </div>
              <h3 className="job-card-title">{job.title}</h3>

              <div className="job-card-pills">
                {job.location && <span className="pill pill-location">{job.location}</span>}
                {job.experience && <span className="pill pill-experience">{job.experience}</span>}
                {job.salary && <span className="pill pill-salary">{job.salary}</span>}
              </div>

              <div className="job-card-footer">
                <span className="job-card-source">{job.source || 'Unknown'}</span>
                <span className="job-card-time">{posted}</span>
              </div>

              <a
                href={job.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="job-card-apply"
              >
                APPLY NOW
              </a>
            </article>
          );
        })}
      </div>
    </div>
  );
}
