import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import './JobBoard.css';

interface Job {
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

interface Filters {
  keyword: string;
  minRating: string;
  freshersOnly: boolean;
  source: string;
}

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
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filters, setFilters] = useState<Filters>({
    keyword: '',
    minRating: 'All',
    freshersOnly: false,
    source: 'All',
  });
  const [loading, setLoading] = useState(false);

  const fetchJobs = async () => {
    setLoading(true);
    // Calculate a cutoff time: only show jobs scraped in the last 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // [DEBUG] First, count total jobs in DB to understand the gap
    const { count: totalCount, error: countError } = await supabase
      .from('Seen_job')
      .select('*', { count: 'exact', head: true });
    console.log(`[DEBUG] Total jobs in Seen_job table: ${totalCount}`);

    // [DEBUG] Count jobs in the last 24h
    const { count: recentCount, error: recentCountError } = await supabase
      .from('Seen_job')
      .select('*', { count: 'exact', head: true })
      .gte('scraped_at', twentyFourHoursAgo);
    console.log(`[DEBUG] Jobs in last 24h: ${recentCount}`);

    let query = supabase
      .from('Seen_job')
      .select('*')
      .gte('scraped_at', twentyFourHoursAgo)
      .order('scraped_at', { ascending: false })
      .limit(1000);

    // Apply filters client‑side because Supabase‑js does not support all filter types natively
    // The full result set will be filtered after fetching.
    // We could push down some filters (e.g., source) to the server, but for simplicity we
    // keep it uniform and filter in JS.
    const { data, error } = await query;
    setLoading(false);

    if (error) {
      console.error('Error fetching jobs:', error);
      return;
    }

    setJobs(data as Job[]);
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 60_000); // auto‑refresh every 60s
    return () => clearInterval(interval);
  }, []);

  // Apply client‑side filters
  const filteredJobs = jobs.filter((job) => {
    // keyword search (case‑insensitive match against company, title, location)
    if (filters.keyword.trim()) {
      const kw = filters.keyword.toLowerCase();
      const matchCompany = job.company?.toLowerCase().includes(kw);
      const matchTitle = job.title?.toLowerCase().includes(kw);
      const matchLocation = job.location?.toLowerCase().includes(kw);
      if (!matchCompany && !matchTitle && !matchLocation) return false;
    }

    // rating filter
    if (filters.minRating && filters.minRating !== 'All') {
      const min = parseInt(filters.minRating, 10);
      if (isNaN(min)) return true;
      if ((job.rating ?? 0) < min) return false;
    }

    // freshers‑only toggle (logic: experience string contains "Fresher" or "0-1")
    if (filters.freshersOnly) {
      const exp = job.experience?.toLowerCase() || '';
      if (!exp.includes('fresher') && !exp.includes('0-1')) return false;
    }

    // source filter (still respected if source state is manipulated externally)
    if (filters.source && filters.source !== 'All') {
      if (job.source?.toLowerCase() !== filters.source.toLowerCase()) return false;
    }

    return true;
  });

  function renderFilterBar() {
    return (
      <div className="job-board-filter-bar">
        <input
          type="text"
          className="job-board-filter-input"
          placeholder="Search keyword ..."
          value={filters.keyword}
          onChange={(e) => setFilters((f) => ({ ...f, keyword: e.target.value }))}
        />

        <select
          className="job-board-filter-select"
          value={filters.minRating}
          onChange={(e) => setFilters((f) => ({ ...f, minRating: e.target.value }))}
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
            onChange={(e) => setFilters((f) => ({ ...f, freshersOnly: e.target.checked }))}
          />
          Freshers Only
        </label>
      </div>
    );
  }

  if (loading && jobs.length === 0) {
    return (
      <div className="job-board-empty">
        <p>System scanning for new jobs...</p>
      </div>
    );
  }

  return (
    <div className="job-board">
      <h2 className="job-board-heading">Latest Opportunities</h2>
      {renderFilterBar()}

      {filteredJobs.length === 0 && !loading && (
        <div className="job-board-empty">
          <p>No jobs match your filters. Try different criteria.</p>
        </div>
      )}

      <div className="job-board-grid">
        {filteredJobs.map((job) => {
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
