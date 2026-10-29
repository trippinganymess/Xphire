import { useEffect, useRef, useState } from 'react';
import { usePrivateIdentity } from '../lib/privateJobBoard';
import { requestPrivateAccess } from '../lib/privateAccessRequest';
import FancyButton from './FancyButton';
import ConfirmEmailDialog from './ConfirmEmailDialog';
import './JobBoard.css';
import './PrivateJobBoard.css';

function AccessRequestForm({ email, initialName }: { email: string; initialName: string }) {
  const [name, setName] = useState(initialName.slice(0, 80));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
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
      if (!controller.signal.aborted) { setResult(next); setConfirming(false); }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : 'Unable to send your request. Please try later.');
        setConfirming(false);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      pending.current = null;
    }
  }

  function openConfirmation() {
    if (!busy && !result && !confirming) setConfirming(true);
  }

  return <>
    <ConfirmEmailDialog
      open={confirming}
      question="Continue?"
      confirmLabel="Confirm"
      cancelLabel="Cancel"
      onConfirm={() => { void submit(); }}
      onCancel={() => setConfirming(false)}
    />
    <form className="private-board-access private-access-form" aria-label="PJobB access request"
      aria-busy={busy} onSubmit={(event) => { event.preventDefault(); openConfirmation(); }}>
      <fieldset>
        <legend>Legend</legend>
        <div className="form-group">
          <label htmlFor="access-request-name">Your name</label>
          <input id="access-request-name" name="name" autoComplete="name" required maxLength={80}
            className="form-control" placeholder="Enter your name"
            value={name} onChange={(event) => setName(event.target.value)} disabled={busy || !!result} />
        </div>
        <div className="form-group row">
          <label htmlFor="staticEmail" className="col-sm-2 col-form-label">Email</label>
          <div className="col-sm-10">
            <input type="text" readOnly className="form-control-plaintext" id="staticEmail" value={email} />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="exampleInputEmail1">Email address</label>
          <input type="email" className="form-control" id="exampleInputEmail1" aria-describedby="emailHelp" placeholder="Enter email" />
          <small id="emailHelp" className="form-text text-muted">We'll never share your email with anyone else.</small>
        </div>
        <div className="form-group">
          <label htmlFor="exampleInputPassword1">Password</label>
          <input type="password" className="form-control" id="exampleInputPassword1" placeholder="Password" />
        </div>
        <div className="form-group">
          <label htmlFor="exampleSelect1">Example select</label>
          <select className="form-control" id="exampleSelect1">
            <option>1</option>
            <option>2</option>
            <option>3</option>
            <option>4</option>
            <option>5</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="exampleSelect2">Example multiple select</label>
          <select multiple className="form-control" id="exampleSelect2">
            <option>1</option>
            <option>2</option>
            <option>3</option>
            <option>4</option>
            <option>5</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="exampleTextarea">Example textarea</label>
          <textarea className="form-control" id="exampleTextarea" rows={3} maxLength={1000}
            value={message} onChange={(event) => setMessage(event.target.value)} disabled={busy || !!result} />
        </div>
        <div className="form-group">
          <label htmlFor="exampleInputFile">File input</label>
          <input type="file" className="form-control-file" id="exampleInputFile" aria-describedby="fileHelp" />
          <small id="fileHelp" className="form-text text-muted">This is some placeholder block-level help text for the above input. It's a bit lighter and easily wraps to a new line.</small>
        </div>
        <fieldset className="form-group">
          <legend>Radio buttons</legend>
          <div className="form-check">
            <label className="form-check-label">
              <input type="radio" className="form-check-input" name="optionsRadios" id="optionsRadios1" value="option1" defaultChecked />
              Option one is this and that—be sure to include why it's great
            </label>
          </div>
          <div className="form-check">
            <label className="form-check-label">
              <input type="radio" className="form-check-input" name="optionsRadios" id="optionsRadios2" value="option2" />
              Option two can be something else and selecting it will deselect option one
            </label>
          </div>
          <div className="form-check disabled">
            <label className="form-check-label">
              <input type="radio" className="form-check-input" name="optionsRadios" id="optionsRadios3" value="option3" disabled />
              Option three is disabled
            </label>
          </div>
        </fieldset>
        <fieldset className="form-group">
          <legend>Checkboxes</legend>
          <div className="form-check">
            <label className="form-check-label">
              <input className="form-check-input" type="checkbox" value="" defaultChecked />
              Option one is this and that—be sure to include why it's great
            </label>
          </div>
          <div className="form-check disabled">
            <label className="form-check-label">
              <input className="form-check-input" type="checkbox" value="" disabled />
              Option two is disabled
            </label>
          </div>
        </fieldset>
        <fieldset className="form-group">
          <legend>Sliders</legend>
          <label htmlFor="customRange1">Example range</label>
          <input type="range" className="custom-range" id="customRange1" />
        </fieldset>
        <button type="submit" className="btn btn-primary" disabled={busy || !!result || !name.trim()}>Submit</button>
      </fieldset>
    </form>
    {error && <p className="job-board-feedback" role="alert">{error}</p>}
    {result === 'queued' && <p className="job-board-feedback" role="status">
      Your request is queued for email delivery to recblackoff@gmail.com. Access will be enabled after approval.
    </p>}
    {result === 'already_allowed' && <p className="job-board-feedback" role="status">
      You already have active PJobB access. <FancyButton to="/private-jobs">Open your Private Job Board</FancyButton>
    </p>}
  </>;
}

export default function PrivateAccessRequest() {
  const identity = usePrivateIdentity();
  return <section className="job-board private-job-board private-access-request" aria-label="Request PJobB access">
    <div className="job-board-heading-row">
      <h2 className="job-board-heading">Request PJobB access</h2>
      <FancyButton to="/private-jobs" className="private-board-back">Back to PJobB</FancyButton>
    </div>
    <p>Send an access request to recblackoff@gmail.com for review. PJobB gives you a private board for your own job discoveries.</p>
    {!identity.ready ? <p role="status">Checking your session...</p> : !identity.userId
      ? <div className="private-board-access">
        <h3>Sign in to request access</h3>
        <p>Sign in with your Xphire account, then return here to send your request.</p>
        <FancyButton to="/terminal">Sign in through Terminal Access</FancyButton>
      </div>
      : <AccessRequestForm key={identity.userId} email={identity.email} initialName={identity.name} />}
  </section>;
}
