import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { JOB_PAGE_SIZE, type JobFilters } from '../lib/jobCatalog';
import { discoverPrivateJobs, usePrivateIdentity, usePrivateJobPage } from '../lib/privateJobBoard';
import { JobCards, JobFilterBar, JobPagination } from './JobBoardView';
import './JobBoard.css';
import './PrivateJobBoard.css';

function AuthenticatedBoard({ userId, authVersion }: { userId: string; authVersion: number }) {
  const [{ filters, page }, setQuery] = useState<{ filters: JobFilters; page: number }>({
    filters: { keyword: '', minRating: 'All', freshersOnly: false, source: 'All' }, page: 1,
  });
  const [jobTitle, setJobTitle] = useState('frontend developer');
  const [scan, setScan] = useState<{ busy: boolean; message: string; failed: boolean }>({ busy: false, message: '', failed: false });
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);
  const { data, access, loading, error, refresh } = usePrivateJobPage(userId, filters, page, authVersion);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / JOB_PAGE_SIZE));
  if (data && !loading && !error && page > pages) setQuery((current) => ({ ...current, page: pages }));
  // Server-checked quota is rendered against this effect-updated clock.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const nextAllowed = access?.next_allowed_at ? Date.parse(access.next_allowed_at) : 0;
  const limited = Number.isFinite(nextAllowed) && nextAllowed > now;
  const onPage = (next: number) => setQuery((current) => ({ ...current, page: next }));

  async function findJobs() {
    if (request.current || !access?.allowed || limited) return;
    const controller = new AbortController();
    request.current = controller;
    setScan({ busy: true, message: '', failed: false });
    const result = await discoverPrivateJobs(jobTitle.trim(), AbortSignal.any([controller.signal, AbortSignal.timeout(55_000)]));
    if (!controller.signal.aborted) {
      setScan({ busy: false, ...result });
      if (!result.failed) onPage(1);
      refresh();
    }
    request.current = null;
  }

  return <>
    {error && <div className="job-board-feedback" role="alert">
      <p>{error}</p><button type="button" onClick={refresh}>Retry</button>
    </div>}
    {loading && !data && <p role="status">Checking private access and loading your jobs...</p>}
    {access?.allowed === false && <div className="private-board-access" role="status">
      <h3>Active paid access required</h3>
      <p>Your administrator must grant access. Expired or revoked access cannot read private jobs.</p>
      <button type="button" onClick={refresh}>Check access again</button>
    </div>}
    {access?.allowed && <>
      <form className="private-board-discovery" onSubmit={(e) => { e.preventDefault(); void findJobs(); }}>
        <label htmlFor="private-job-title">Job title for your daily discovery</label>
        <div className="private-board-discovery-controls">
          <input id="private-job-title" value={jobTitle} maxLength={120} required
            onChange={(e) => setJobTitle(e.target.value)} disabled={scan.busy} />
          <button type="submit" disabled={scan.busy || loading || limited || !jobTitle.trim()}>
            {scan.busy ? 'FINDING YOUR JOBS...' : 'FIND MY JOBS'}
          </button>
          <button type="button" disabled={loading} onClick={refresh}>Reload board</button>
        </div>
        <p>One TheirStack request per 24 hours, on request. Failed attempts also use the allowance. Reloading saved jobs is free.</p>
        {limited && <p role="status">Next discovery: {new Date(nextAllowed).toLocaleString()}</p>}
        {access.last_query && <p>Last discovery query: {access.last_query}</p>}
      </form>
      {scan.message && <p className="job-board-feedback" role={scan.failed ? 'alert' : 'status'}>{scan.message}</p>}
      <JobFilterBar filters={filters} privateBoard onChange={(update) => {
        setQuery((current) => ({ filters: { ...current.filters, ...update }, page: 1 }));
      }} />
      <p className="private-board-note">Provider labels are not verified fresher eligibility. “Found” is discovery time, not posting time. Company ratings are not supplied.</p>
      {loading && data && <p role="status">Refreshing your saved jobs...</p>}
      {data && <JobPagination page={page} pages={pages} total={total} loading={loading}
        hasData privateBoard onPage={onPage} />}
      {data && data.jobs.length === 0 && !loading && <div className="job-board-empty">
        <p>No private jobs match your filters. Try another keyword or use your daily discovery.</p>
      </div>}
      <JobCards jobs={data?.jobs ?? []} privateBoard />
    </>}
  </>;
}

export default function PrivateJobBoard() {
  const identity = usePrivateIdentity();
  return <section className="job-board private-job-board" aria-label="Your Private Job Board">
    <div className="job-board-heading-row">
      <h2 className="job-board-heading">Private Job Board</h2>
      <Link to="/" className="private-board-back">Public Job Board</Link>
    </div>
    <p>Your personal TheirStack discoveries, visible only to you.</p>
    {!identity.ready ? <p role="status">Checking your session...</p> : !identity.userId
      ? <div className="private-board-access"><h3>Sign in to open PJobB</h3>
        <p>Private jobs are available only to signed-in users with active paid access.</p>
        <Link to="/terminal">Sign in through Terminal Access</Link>
      </div>
      : <AuthenticatedBoard key={identity.userId} userId={identity.userId} authVersion={identity.version} />}
  </section>;
}
