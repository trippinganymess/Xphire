import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import './JobBoard.css';

interface Job {
  job_id: string;
  company: string;
  title: string;
  url: string;
  location: string;
  experience: string;
  salary: string;
  source: string;
  rating: number;
  scraped_at: string;
}

export default function JobBoard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [minRating, setMinRating] = useState<number>(1);
  const [freshersOnly, setFreshersOnly] = useState(false);
  const [sourceFilter, setSourceFilter] = useState('All');

  useEffect(() => {
    fetchJobs();
    
    // Auto refresh every 60 seconds
    const interval = setInterval(() => {
      fetchJobs();
    }, 60000);
    
    return () => clearInterval(interval);
  }, []);

  const fetchJobs = async () => {
    try {
      // Fetch jobs from the last 6 hours
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      
      const { data, error } = await supabase
        .from('Seen_job')
        .select('*')
        .gte('scraped_at', sixHoursAgo)
        .order('scraped_at', { ascending: false })
        .limit(200);

      if (error) {
        console.error('Error fetching jobs:', error);
        return;
      }
      
      if (data) {
        setJobs(data as Job[]);
      }
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  const getTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins} min ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  const getRatingBadge = (rating: number) => {
    const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
    const colors: Record<number, string> = {
      1: "#DC2626", 2: "#EA580C", 3: "#D97706", 4: "#16A34A", 5: "#059669"
    };
    return (
      <span className="job-card__rating" style={{ color: colors[rating] || "#D97706" }}>
        {stars} ({rating}/5)
      </span>
    );
  };

  // Filter the jobs
  const filteredJobs = jobs.filter(job => {
    // Search Term (matches title or company)
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      if (!job.title?.toLowerCase().includes(term) && !job.company?.toLowerCase().includes(term)) {
        return false;
      }
    }
    
    // Min Rating
    if (minRating > 1 && (job.rating || 3) < minRating) {
      return false;
    }
    
    // Freshers Only - check text
    if (freshersOnly) {
      const isFresherTitle = job.title?.toLowerCase().match(/\b(intern|fresher|entry|junior|jr|trainee)\b/);
      const isFresherExp = job.experience?.toLowerCase().match(/\b(intern|fresher|0-1|0-2)\b/);
      if (!isFresherTitle && !isFresherExp) return false;
    }
    
    // Source
    if (sourceFilter !== 'All') {
      if (sourceFilter === 'JobSpy') {
        if (!job.source?.includes('LinkedIn') && !job.source?.includes('Indeed') && !job.source?.includes('Glassdoor') && !job.source?.includes('ZipRecruiter')) {
          return false;
        }
      } else if (!job.source?.includes(sourceFilter)) {
        return false;
      }
    }
    
    return true;
  });

  return (
    <div className="job-board">
      {/* Filters Bar */}
      <div className="job-board__filters">
        <input 
          type="text" 
          className="job-board__filter-input"
          placeholder="Search role or company..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        
        <select 
          className="job-board__filter-select"
          value={minRating}
          onChange={(e) => setMinRating(Number(e.target.value))}
        >
          <option value={1}>Any Rating</option>
          <option value={3}>3+ Stars ⭐</option>
          <option value={4}>4+ Stars ⭐</option>
          <option value={5}>5 Stars ⭐</option>
        </select>
        
        <select 
          className="job-board__filter-select"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
        >
          <option value="All">All Sources</option>
          <option value="Greenhouse">Greenhouse</option>
          <option value="Lever">Lever</option>
          <option value="Ashby">Ashby</option>
          <option value="SmartRecruiters">SmartRecruiters</option>
          <option value="JobSpy">JobSpy Boards</option>
        </select>
        
        <label className="job-board__filter-checkbox">
          <input 
            type="checkbox" 
            checked={freshersOnly}
            onChange={(e) => setFreshersOnly(e.target.checked)}
          />
          🎓 Freshers Only
        </label>
      </div>

      {/* Job List */}
      {loading ? (
        <div className="job-board__empty">
          <div className="job-board__empty-text">Loading jobs...</div>
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="job-board__empty">
          <div className="job-board__empty-text">No jobs found matching your criteria.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {filteredJobs.map((job) => (
            <div key={job.job_id} className="job-card">
              <div className="job-card__header">
                <span className="job-card__company">{job.company || 'UNKNOWN'}</span>
                {getRatingBadge(job.rating || 3)}
              </div>
              
              <div className="job-card__body">
                <h2 className="job-card__title">{job.title}</h2>
                
                <div className="job-card__pills">
                  <span className="job-card__pill">📍 {job.location || 'India'}</span>
                  <span className="job-card__pill">🕐 {job.experience || 'Not Specified'}</span>
                  <span className="job-card__pill job-card__pill--salary">💰 {job.salary || 'Not Disclosed'}</span>
                  <span className="job-card__pill job-card__pill--source">🔗 {job.source || 'Unknown'}</span>
                </div>
                
                <div className="job-card__footer">
                  <span className="job-card__time">Posted {getTimeAgo(job.scraped_at)}</span>
                  <a href={job.url} target="_blank" rel="noreferrer" className="job-card__apply">
                    APPLY_NOW →
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
