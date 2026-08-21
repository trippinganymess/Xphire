import { useState } from 'react';
import HeatmapBg from './components/HeatmapBg';
import SignupCard from './components/SignupCard';
import WorkflowFilters from './components/WorkflowFilters';
import './App.css';

type Page = 'signup' | 'workflow';

export default function App() {
  const [page, setPage] = useState<Page>('workflow');

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

        <div className="nav-bar__tabs">
          <button
            className={`nav-tab ${page === 'signup' ? 'nav-tab--active' : ''}`}
            onClick={() => setPage('signup')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3 14c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Signup
          </button>
          <button
            className={`nav-tab ${page === 'workflow' ? 'nav-tab--active' : ''}`}
            onClick={() => setPage('workflow')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
              <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
              <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
              <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            Workflow
          </button>
        </div>

        <div className="nav-bar__status">
          <span className="nav-status-dot" />
          <span className="type-caption" style={{ color: 'var(--neon-lime)' }}>Online</span>
        </div>
      </nav>

      {/* ── Page Content ── */}
      <main className="page-content">
        <div className="page-content__inner" key={page}>
          {page === 'signup' && <SignupCard />}
          {page === 'workflow' && <WorkflowFilters />}
        </div>
      </main>

      {/* ── Scanline overlay ── */}
      <div className="scanline" aria-hidden="true" />
    </>
  );
}
