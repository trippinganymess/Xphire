import type { Job, JobFilters } from '../lib/jobCatalog';
import FancyButton from './FancyButton';

const RATING_OPTIONS = ['All', '5', '4', '3', '2', '1'];

function formatTimeAgo(dateStr: string): string {
  const then = Date.parse(dateStr);
  if (!Number.isFinite(then)) return '—';
  const minutes = Math.floor(Math.max(0, Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function applyUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function JobFilterBar({ filters, onChange, privateBoard = false }: {
  filters: JobFilters; onChange: (update: Partial<JobFilters>) => void; privateBoard?: boolean;
}) {
  return (
    <div className="job-board-filter-bar">
      <input type="text" className="job-board-filter-input" placeholder="Search keyword ..."
        value={filters.keyword} aria-label="Search jobs" onChange={(e) => onChange({ keyword: e.target.value })} />
      {!privateBoard && <select className="job-board-filter-select" value={filters.minRating}
        aria-label="Minimum rating" onChange={(e) => onChange({ minRating: e.target.value })}>
        {RATING_OPTIONS.map((option) => <option key={option} value={option}>
          {option === 'All' ? 'All Ratings' : `${option} ★ & above`}
        </option>)}
      </select>}
      <label className="job-board-freshers-label">
        <input type="checkbox" checked={filters.freshersOnly}
          onChange={(e) => onChange({ freshersOnly: e.target.checked })} />
        {privateBoard ? 'Junior / internship (provider label)' : 'Freshers Only'}
      </label>
    </div>
  );
}

export function JobPagination({ page, pages, total, loading, hasData, onPage, privateBoard = false }: {
  page: number; pages: number; total: number; loading: boolean; hasData: boolean;
  onPage: (page: number) => void; privateBoard?: boolean;
}) {
  return <nav className="job-board-pagination" aria-label={privateBoard ? 'Private job pages' : 'Job pages'}>
    <FancyButton compact disabled={page === 1 || loading} ariaLabel="Previous page" onClick={() => onPage(page - 1)}>←</FancyButton>
    <span role="status">{hasData ? `Page ${page} of ${pages} · ${total} jobs` : `Page ${page}`}</span>
    <FancyButton compact disabled={page >= pages || loading || !hasData} ariaLabel="Next page" onClick={() => onPage(page + 1)}>→</FancyButton>
  </nav>;
}

export function JobCards({ jobs, privateBoard = false }: { jobs: Job[]; privateBoard?: boolean }) {
  return <div className="job-board-grid">
    {jobs.map((job) => {
      const rating = typeof job.rating === 'number' && Number.isFinite(job.rating)
        ? Math.min(5, Math.max(0, Math.floor(job.rating))) : null;
      const url = applyUrl(job.url);
      return <article key={job.job_id} className="job-card">
        <div className="job-card-header">
          <span className="job-card-company">{job.company || 'Company not supplied'}</span>
          {rating !== null && <span className="job-card-rating" title={`Rating: ${rating}/5`}>{'★'.repeat(rating)}</span>}
        </div>
        <h3 className="job-card-title">{job.title}</h3>
        <div className="job-card-pills">
          {job.location && <span className="pill pill-location">{job.location}</span>}
          {job.experience && <span className="pill pill-experience">{job.experience}</span>}
          {job.salary && <span className="pill pill-salary">{job.salary}</span>}
        </div>
        {privateBoard && job.posted_date && <p className="private-job-posted">Posted {job.posted_date} · time not supplied</p>}
        <div className="job-card-footer">
          <span className="job-card-source">{job.source || 'Unknown'}</span>
          <span className="job-card-time">{privateBoard ? 'Found ' : ''}{job.scraped_at ? formatTimeAgo(job.scraped_at) : '—'}</span>
        </div>
        {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="job-card-apply">APPLY NOW</a>
          : <span className="job-card-link-unavailable">Apply link unavailable</span>}
      </article>;
    })}
  </div>;
}
