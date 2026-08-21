import { type FormEvent, useState } from 'react';
import NeonButton from './NeonButton';
import NeonInput from './NeonInput';
import './WorkflowFilters.css';

interface WorkflowInputs {
  jobTitle: string;
  recipientEmail: string;
  freshersOnly: boolean;
  minStars: number;
}

interface MockResult {
  status: 'queued' | 'running' | 'completed';
  runId: number;
  url: string;
  timestamp: string;
}

export default function WorkflowFilters() {
  const [form, setForm] = useState<WorkflowInputs>({
    jobTitle: '',
    recipientEmail: '',
    freshersOnly: false,
    minStars: 3,
  });
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<MockResult | null>(null);

  const updateField = (field: keyof WorkflowInputs) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setExecuting(true);
    setResult(null);

    // Mock execution stages
    setTimeout(() => {
      setResult({
        status: 'queued',
        runId: 100000000 + Math.floor(Math.random() * 99999999),
        url: `https://github.com/trippinganymess/xphire/actions`,
        timestamp: new Date().toISOString(),
      });
    }, 800);

    setTimeout(() => {
      setResult((prev) => prev ? { ...prev, status: 'running' } : null);
    }, 2200);

    setTimeout(() => {
      setResult((prev) => prev ? { ...prev, status: 'completed' } : null);
      setExecuting(false);
    }, 4500);
  };

  return (
    <div className="wf-card">
      {/* ── Header ── */}
      <div className="wf-card__header">
        <div className="wf-card__badge">
          <span className="type-mono" style={{ color: 'var(--neon-pink)', fontSize: '0.75rem' }}>
            // WORKFLOW_DISPATCH
          </span>
        </div>
        <h2 className="type-headline neon-text">Run Job Scout</h2>
        <p className="type-body" style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
          Configure and execute the Xphire AI pipeline
        </p>
      </div>

      <form className="wf-card__form" onSubmit={handleSubmit}>
        {/* ── Text Inputs ── */}
        <NeonInput
          label="Job Title"
          type="text"
          placeholder="e.g. Software Engineer"
          value={form.jobTitle}
          onChange={updateField('jobTitle')}
          required
          accentColor="pink"
        />
        <NeonInput
          label="Recipient Email"
          type="email"
          placeholder="you@example.com"
          value={form.recipientEmail}
          onChange={updateField('recipientEmail')}
          required
        />

        {/* ── Toggle: Freshers Only ── */}
        <div className="wf-toggle-row">
          <div className="wf-toggle-row__info">
            <span className="type-label" style={{ color: 'var(--text-primary)' }}>Freshers Only</span>
            <span className="type-caption">Filter for entry-level / intern roles</span>
          </div>
          <button
            type="button"
            className={`wf-toggle ${form.freshersOnly ? 'wf-toggle--on' : ''}`}
            onClick={() => setForm((p) => ({ ...p, freshersOnly: !p.freshersOnly }))}
            role="switch"
            aria-checked={form.freshersOnly}
          >
            <span className="wf-toggle__thumb" />
          </button>
        </div>

        {/* ── Star Rating ── */}
        <div className="wf-stars-row">
          <span className="type-label" style={{ color: 'var(--text-primary)' }}>Minimum Stars</span>
          <div className="wf-stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`wf-star ${n <= form.minStars ? 'wf-star--active' : ''}`}
                onClick={() => setForm((p) => ({ ...p, minStars: n }))}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                    fill={n <= form.minStars ? 'var(--neon-amber)' : 'transparent'}
                    stroke={n <= form.minStars ? 'var(--neon-amber)' : 'var(--text-muted)'}
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            ))}
            <span className="type-mono wf-stars__label" style={{ color: 'var(--neon-amber)' }}>
              {form.minStars}+
            </span>
          </div>
        </div>

        {/* ── Submit ── */}
        <NeonButton
          type="submit"
          variant="pink"
          size="lg"
          glowing
          loading={executing}
          style={{ width: '100%', marginTop: '8px' }}
        >
          {executing ? 'Dispatching...' : 'Run Workflow'}
        </NeonButton>
      </form>

      {/* ── Execution Status Panel ── */}
      {result && (
        <div className="wf-status">
          <div className="wf-status__header">
            <span className="type-mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              EXECUTION STATUS
            </span>
            <span className={`wf-status__badge wf-status__badge--${result.status}`}>
              {result.status.toUpperCase()}
            </span>
          </div>

          <div className="wf-status__payload">
            <div className="wf-status__line">
              <span className="wf-status__key">run_id</span>
              <span className="wf-status__val type-mono">{result.runId}</span>
            </div>
            <div className="wf-status__line">
              <span className="wf-status__key">job_title</span>
              <span className="wf-status__val type-mono">"{form.jobTitle}"</span>
            </div>
            <div className="wf-status__line">
              <span className="wf-status__key">recipient</span>
              <span className="wf-status__val type-mono">"{form.recipientEmail}"</span>
            </div>
            <div className="wf-status__line">
              <span className="wf-status__key">freshers_only</span>
              <span className="wf-status__val type-mono">{String(form.freshersOnly)}</span>
            </div>
            <div className="wf-status__line">
              <span className="wf-status__key">min_stars</span>
              <span className="wf-status__val type-mono">{form.minStars}</span>
            </div>
            <div className="wf-status__line">
              <span className="wf-status__key">dispatched_at</span>
              <span className="wf-status__val type-mono">{result.timestamp}</span>
            </div>
          </div>

          {result.status === 'completed' && (
            <div className="wf-status__complete">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 8l3 3 5-6" stroke="var(--neon-lime)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="type-label" style={{ color: 'var(--neon-lime)' }}>
                Pipeline dispatched successfully
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
