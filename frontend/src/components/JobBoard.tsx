import { useEffect, useState } from 'react';
import './JobBoard.css';

interface Job {
  job_id: string;
  company?: string;
  title?: string;
  location?: string;
  experience?: string;
  salary?: string;
  source?: string;
  rating?: number;
  created_at?: string;
  scraped_at?: string;
  url?: string;
}

interface Filters {
  keyword: string;
  rating: string;
  experience: string;
  location: string;
  salary: string;
}

const RATING_OPTIONS = ['All', '5', '4', '3', '2', '1'];

function formatTimeAgo(dateStr?: string): string {
  if (!dateStr) return '—';
  const diffMs = Math.max(0, Date.now() - new Date(dateStr).getTime());
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

/** Reads newline-delimited JSON as it arrives and mounts each record immediately. */
async function readJobStream(
  filters: Filters,
  onJob: (job: Job) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/jobs/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify(filters),
    signal,
  });
  if (!response.ok) throw new Error(`Job stream failed (${response.status})`);
  if (!response.body) throw new Error('Job stream returned no readable body.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          onJob(JSON.parse(line) as Job);
        } catch (error) {
          console.warn('Skipping malformed job record:', error);
        }
      }
      if (done) break;
    }
    if (buffer.trim()) onJob(JSON.parse(buffer) as Job);
  } finally {
    reader.releaseLock();
  }
}

export default function JobBoard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filters, setFilters] = useState<Filters>({
    keyword: '', rating: 'All', experience: '', location: '', salary: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setJobs([]);
    setError(null);
    setLoading(true);

    readJobStream(filters, (job) => setJobs((current) => [...current, job]), controller.signal)
      .catch((reason: unknown) => {
        if ((reason as DOMException)?.name !== 'AbortError') {
          console.error('Error fetching jobs:', reason);
          setError('Unable to load opportunities right now.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [filters]);

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="job-board">
      <h2 className="job-board-heading">Latest Opportunities</h2>

      <div className="job-board-filter-bar">
        <input
          type="text"
          className="job-board-filter-input"
          placeholder="Search keyword ..."
          value={filters.keyword}
          onChange={(event) => updateFilter('keyword', event.target.value)}
          aria-label="Search jobs by keyword"
        />
        <select
          className="job-board-filter-select"
          value={filters.rating}
          onChange={(event) => updateFilter('rating', event.target.value)}
          aria-label="Minimum rating"
        >
          {RATING_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === 'All' ? 'All Ratings' : `${option} ★ & above`}
            </option>
          ))}
        </select>
        <label className="job-board-freshers-label">
          <input
            type="checkbox"
            checked={filters.experience === 'Fresher'}
            onChange={(event) => updateFilter('experience', event.target.checked ? 'Fresher' : '')}
          />
          Freshers Only
        </label>
        <input
          type="text"
          className="job-board-filter-input job-board-filter-input-small"
          placeholder="Location ..."
          value={filters.location}
          onChange={(event) => updateFilter('location', event.target.value)}
          aria-label="Filter by location"
        />
        <input
          type="text"
          className="job-board-filter-input job-board-filter-input-small"
          placeholder="Salary ..."
          value={filters.salary}
          onChange={(event) => updateFilter('salary', event.target.value)}
          aria-label="Filter by salary"
        />
      </div>

      {error && <div className="job-board-empty"><p>{error}</p></div>}
      {!error && !loading && jobs.length === 0 && (
        <div className="job-board-empty"><p>No jobs match your filters. Try different criteria.</p></div>
      )}

      <div id="job-grid" className="job-board-grid" aria-live="polite" aria-busy={loading}>
        {jobs.map((job) => {
          const rating = Math.max(0, Math.min(5, Number(job.rating) || 0));
          const stars = '★'.repeat(rating);
          const posted = formatTimeAgo(job.created_at || job.scraped_at);
          return (
            <article key={job.job_id} className="job-card">
              <div className="job-card-header">
                <span className="job-card-company">{job.company || 'Unknown company'}</span>
                <span className="job-card-rating" title={`Rating: ${rating}/5`}>{stars || '—'}</span>
              </div>
              <h3 className="job-card-title">{job.title || 'Untitled opportunity'}</h3>
              <div className="job-card-pills">
                {job.location && <span className="pill pill-location">{job.location}</span>}
                {job.experience && <span className="pill pill-experience">{job.experience}</span>}
                {job.salary && <span className="pill pill-salary">{job.salary}</span>}
              </div>
              <div className="job-card-footer">
                <span className="job-card-source">{job.source || 'Unknown'}</span>
                <span className="job-card-time">{posted}</span>
              </div>
              <a href={job.url || '#'} target="_blank" rel="noopener noreferrer" className="job-card-apply">
                APPLY NOW
              </a>
            </article>
          );
        })}
      </div>
    </div>
  );
}
