import { useState } from 'react';
import HeatmapBg from './components/HeatmapBg';
import SignupCard, { type SignupData } from './components/SignupCard';
import WorkflowFilters from './components/WorkflowFilters';
import './App.css';

export default function App() {
  const [user, setUser] = useState<SignupData | null>(null);

  const handleSignupSuccess = (userData: SignupData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    setUser(null);
  };

  return (
    <>
      <HeatmapBg />

      {/* ── Nav Bar ── */}
      <nav className="nav-bar">
        <div className="nav-bar__brand">
          <svg className="nav-bar__logo" width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="rgba(var(--glow-cyan), 0.08)" stroke="rgba(var(--glow-cyan), 0.3)" strokeWidth="1" />
            <path d="M8 22l4-14h2l3 8 3-8h2l4 14h-2.5l-2.5-9-3 9h-2l-3-9-2.5 9H8z" fill="var(--neon-cyan)" />
          </svg>
          <span className="nav-bar__title neon-text">Xphire</span>
          <span className="nav-bar__subtitle type-mono">AI Job Scout</span>
        </div>

        <div className="nav-bar__right">
          {user ? (
            <div className="nav-user">
              <div className="nav-user__info">
                <span className="nav-user__name">{user.name}</span>
                <span className="nav-user__email type-mono">{user.email}</span>
              </div>
              <button
                className="nav-user__logout-btn"
                onClick={handleLogout}
                title="Sign out"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <div className="nav-bar__status">
              <span className="nav-status-dot" />
              <span className="type-caption" style={{ color: 'var(--neon-cyan)' }}>
                Authentication Required
              </span>
            </div>
          )}
        </div>
      </nav>

      {/* ── Page Content ── */}
      <main className="page-content">
        <div className="page-content__inner" key={user ? 'authenticated' : 'guest'}>
          {user ? (
            <WorkflowFilters userEmail={user.email} />
          ) : (
            <SignupCard onSignupSuccess={handleSignupSuccess} />
          )}
        </div>
      </main>

      {/* ── Scanline overlay ── */}
      <div className="scanline" aria-hidden="true" />
    </>
  );
}
