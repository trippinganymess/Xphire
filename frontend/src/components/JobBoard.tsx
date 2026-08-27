import { useState, useRef, useCallback, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
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
const JOB_TABLE = 'Seen_job';
const MAX_JOBS = 30;

function escapeIlike(value: string): string {
  return value.replace(/[%_,()]/g, (character) => `\\${character}`);
}

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

/** Pulls matching rows from the public Seen_job table in Supabase. */
async function fetchJobsFromSupabase(filters: Filters, signal: AbortSignal): Promise<Job[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let query = supabase
    .from(JOB_TABLE)
    .select('*')
    .gte('created_at', since)
    .order('rating', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(MAX_JOBS)
    .abortSignal(signal);

  const keyword = filters.keyword.trim();
  if (keyword) {
    const escaped = escapeIlike(keyword);
    query = query.or(
      `company.ilike.%${escaped}%,title.ilike.%${escaped}%,location.ilike.%${escaped}%`,
    );
  }

  const rating = Number(filters.rating);
  if (Number.isFinite(rating) && rating > 0) {
    query = query.gte('rating', Math.min(5, Math.max(1, rating)));
  }

  const experience = filters.experience.trim();
  if (experience) {
    query = query.ilike('experience', `%${escapeIlike(experience)}%`);
  }

  const location = filters.location.trim();
  if (location) {
    query = query.ilike('location', `%${escapeIlike(location)}%`);
  }

  const salary = filters.salary.trim();
  if (salary) {
    query = query.ilike('salary', `%${escapeIlike(salary)}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data as Job[]) ?? [];
}

export default function JobBoard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filters, setFilters] = useState<Filters>({
    keyword: '',
    rating: 'All',
    experience: '',
    location: '',
    salary: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchJobs = useCallback((queryFilters: Filters) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setHasSearched(true);
    setJobs([]);
    setError(null);
    setLoading(true);

    fetchJobsFromSupabase(queryFilters, controller.signal)
      .then((results) => {
        if (!controller.signal.aborted) {
          setJobs(results);
        }
      })
      .catch((reason: unknown) => {
        if ((reason as DOMException)?.name !== 'AbortError') {
          console.error('Error fetching jobs from Supabase:', reason);
          setError('Unable to load opportunities right now.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
  }, []);

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    fetchJobs(filters);
  };

  return (
    <div className="job-board">
      <h2 className="job-board-heading">Latest Opportunities</h2>

      <form className="job-board-filter-bar" onSubmit={handleSearch}>
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
        <button type="submit" className="job-board-search-btn" disabled={loading}>
          {loading ? 'SEARCHING' : 'SEARCH'}
        </button>
      </form>

      {hasSearched && loading && (
        <div className="job-board-empty">
          <p>Loading opportunities ...</p>
        </div>
      )}

      {hasSearched && error && !loading && (
        <div className="job-board-empty">
          <p>{error}</p>
        </div>
      )}

      {hasSearched && !error && !loading && jobs.length === 0 && (
        <div className="job-board-empty">
          <p>No opportunities found. Try adjusting your filters.</p>
        </div>
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
