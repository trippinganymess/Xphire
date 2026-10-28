import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePrivateIdentity } from '../lib/privateJobBoard';
import { requestPrivateAccess } from '../lib/privateAccessRequest';
import './JobBoard.css';
import './PrivateJobBoard.css';

function AccessRequestForm({ email, initialName }: { email: string; initialName: string }) {
  const [name, setName] = useState(initialName.slice(0, 80));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'queued' | 'already_allowed' | null>(null);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function submit() {
    if (pending.current || result) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    try {
      const next = await requestPrivateAccess(name.trim(), message.trim(),
        AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]));
      if (!controller.signal.aborted) setResult(next);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to send your request. Please try later.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      pending.current = null;
    }
  }

  return <>
    <form className="private-board-access private-access-form" aria-label="PJobB access request"
      aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label htmlFor="access-request-name">Your name</label>
      <input id="access-request-name" name="name" autoComplete="name" required maxLength={80}
        value={name} onChange={(event) => setName(event.target.value)} disabled={busy || !!result} />
      <label htmlFor="access-request-email">Account email</label>
      <input id="access-request-email" name="email" type="email" autoComplete="email" value={email} readOnly />
      <p className="private-board-note">We use your verified account email so access can be granted to the right account.</p>
      <label htmlFor="access-request-message">Message (optional)</label>
      <textarea id="access-request-message" name="message" rows={5} maxLength={1000}
        placeholder="Tell us which roles you are looking for."
        value={message} onChange={(event) => setMessage(event.target.value)} disabled={busy || !!result} />
      <button type="submit" disabled={busy || !!result || !name.trim()}>
        {busy ? 'SENDING REQUEST...' : result === 'queued' ? 'REQUEST SUBMITTED' : 'REQUEST ACCESS'}
      </button>
    </form>
    {error && <p className="job-board-feedback" role="alert">{error}</p>}
    {result === 'queued' && <p className="job-board-feedback" role="status">
      Your request is queued for email delivery to recblackoff@gmail.com. Access will be enabled after approval.
    </p>}
    {result === 'already_allowed' && <p className="job-board-feedback" role="status">
      You already have active PJobB access. <Link to="/private-jobs">Open your Private Job Board</Link>
    </p>}
  </>;
}

export default function PrivateAccessRequest() {
  const identity = usePrivateIdentity();
  return <section className="job-board private-job-board private-access-request" aria-label="Request PJobB access">
    <div className="job-board-heading-row">
      <h2 className="job-board-heading">Request PJobB access</h2>
      <Link to="/private-jobs" className="private-board-back">Back to PJobB</Link>
    </div>
    <p>Send an access request to recblackoff@gmail.com for review. PJobB gives you a private board for your own job discoveries.</p>
    {!identity.ready ? <p role="status">Checking your session...</p> : !identity.userId
      ? <div className="private-board-access">
        <h3>Sign in to request access</h3>
        <p>Sign in with your Xphire account, then return here to send your request.</p>
        <Link to="/terminal">Sign in through Terminal Access</Link>
      </div>
      : <AccessRequestForm key={identity.userId} email={identity.email} initialName={identity.name} />}
  </section>;
}
