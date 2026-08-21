import { type FormEvent, useState } from 'react';
import NeonButton from './NeonButton';
import NeonInput from './NeonInput';
import './SignupCard.css';

interface SignupData {
  name: string;
  email: string;
  password: string;
  apiKey: string;
}

export default function SignupCard() {
  const [form, setForm] = useState<SignupData>({
    name: '',
    email: '',
    password: '',
    apiKey: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const update = (field: keyof SignupData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Mock submission
    setTimeout(() => {
      console.log('[Xphire] Signup payload:', form);
      setLoading(false);
      setSubmitted(true);
    }, 1800);
  };

  if (submitted) {
    return (
      <div className="signup-card signup-card--success">
        <div className="signup-card__icon">
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
            <circle cx="28" cy="28" r="27" stroke="var(--neon-lime)" strokeWidth="2" opacity="0.4" />
            <circle cx="28" cy="28" r="20" fill="rgba(0, 255, 102, 0.08)" />
            <path d="M18 28l7 7 13-14" stroke="var(--neon-lime)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="type-headline neon-text-lime">Welcome to Xphire</h2>
        <p className="type-body" style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
          Your account has been created. You can now run workflow scans.
        </p>
        <NeonButton
          variant="lime"
          onClick={() => { setSubmitted(false); setForm({ name: '', email: '', password: '', apiKey: '' }); }}
          style={{ marginTop: '24px' }}
        >
          Back to Signup
        </NeonButton>
      </div>
    );
  }

  return (
    <div className="signup-card">
      <div className="signup-card__header">
        <div className="signup-card__badge">
          <span className="type-mono" style={{ color: 'var(--neon-cyan)', fontSize: '0.75rem' }}>
            // NEW AGENT
          </span>
        </div>
        <h2 className="type-headline neon-text">Create Account</h2>
        <p className="type-body" style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
          Sign up to access the Xphire AI job scout pipeline
        </p>
      </div>

      <form className="signup-card__form" onSubmit={handleSubmit}>
        <NeonInput
          label="Full Name"
          type="text"
          value={form.name}
          onChange={update('name')}
          required
          autoComplete="name"
        />
        <NeonInput
          label="Email Address"
          type="email"
          value={form.email}
          onChange={update('email')}
          required
          accentColor="pink"
          autoComplete="email"
        />
        <NeonInput
          label="Password"
          type="password"
          value={form.password}
          onChange={update('password')}
          required
          minLength={8}
          autoComplete="new-password"
        />
        <NeonInput
          label="API Access Key"
          type="text"
          value={form.apiKey}
          onChange={update('apiKey')}
          required
          accentColor="lime"
          autoComplete="off"
        />

        <NeonButton
          type="submit"
          variant="cyan"
          size="lg"
          glowing
          loading={loading}
          style={{ width: '100%', marginTop: '8px' }}
        >
          Create Account
        </NeonButton>
      </form>

      <p className="signup-card__footer type-caption">
        By signing up you agree to the Xphire terms of service
      </p>
    </div>
  );
}
