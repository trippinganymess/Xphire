import { useState } from 'react';
import { Link } from 'react-router-dom';
import FancyButton from './FancyButton';
import './SketchHeader.css';

export type SystemStatus = 'online' | 'running' | 'completed';

interface SketchHeaderProps {
  status: SystemStatus;
  userName?: string;
  userEmail?: string;
  avatarUrl?: string;
  onLogout?: () => void;
  isTerminalView?: boolean;
}

export default function SketchHeader({
  status,
  userName,
  userEmail,
  avatarUrl,
  onLogout,
  isTerminalView = true,
}: SketchHeaderProps) {
  const [showPfpDropdown, setShowPfpDropdown] = useState(false);
  const isRunning = status === 'running';

  const togglePfpDropdown = () => {
    if (onLogout) {
      setShowPfpDropdown((prev) => !prev);
    }
  };

  const handleSignOut = () => {
    setShowPfpDropdown(false);
    if (onLogout) onLogout();
  };

  return (
    <header className="sketch-header">
      {/* ── Left Box: Logo ── */}
      <Link to="/" className="sketch-header__box sketch-header__logo" title="Xphire Home" aria-label="Xphire Home">
        <svg
          className="sketch-logo-mark"
          viewBox="0 0 64 64"
          role="img"
          aria-hidden="true"
          focusable="false"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect x="2" y="2" width="60" height="60" rx="15" fill="#0c0d10" />
          <path
            d="M32 3 C 33.8 17.8, 46.2 30.2, 61 32 C 46.2 33.8, 33.8 46.2, 32 61 C 30.2 46.2, 17.8 33.8, 3 32 C 17.8 30.2, 30.2 17.8, 32 3 Z"
            fill="#C0392B"
          />
        </svg>
      </Link>

      {/* ── Center: Shortened Title + Light Bulb (Only in Terminal View) ── */}
      <div className="sketch-header__center">
        {isTerminalView ? (
          <>
            <span className="sketch-header__title">
              {isRunning ? 'Xphire' : 'Xphire'}
            </span>
            
            {/* Sketchy Light Bulb Icon */}
            <div className={`sketch-bulb ${isRunning ? 'sketch-bulb--running' : 'sketch-bulb--online'}`} title={`System: ${status}`}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M9 18h6a1 1 0 0 0 1-1v-1a7 7 0 1 0-8 0v1a1 1 0 0 0 1 1z"
                  className="sketch-bulb__glow-fill"
                  fill={isRunning ? 'var(--bulb-yellow)' : 'var(--bulb-green)'}
                />
                <path
                  d="M9 18h6m-5 3h4m-7-6a7 7 0 1 1 10 0v2H8v-2z"
                  stroke="#121214"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M10 10l2 2 2-2"
                  stroke="#121214"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </>
        ) : (
          <span className="sketch-header__title" style={{ color: 'var(--ink-muted)' }}>
            Xphire
          </span>
        )}
      </div>

      <div className="sketch-header__actions">
        {/* ── Right Box: Terminal Access Button ── */}
        {!isTerminalView && (
          <Link to="/terminal" className="sketch-header__box sketch-header__terminal-btn" title="Open Terminal">
            TERMINAL ACCESS
          </Link>
        )}

        {/* ── Right Box: PFP / Profile / Status ── */}
        <div
          className={`sketch-header__box sketch-header__pfp ${onLogout ? 'sketch-header__pfp--clickable' : ''} ${showPfpDropdown ? 'open' : ''}`}
          onClick={togglePfpDropdown}
          role={onLogout ? 'button' : undefined}
          tabIndex={onLogout ? 0 : undefined}
          aria-expanded={onLogout ? showPfpDropdown : undefined}
          aria-label={onLogout ? 'Account menu' : undefined}
          onKeyDown={(event) => {
            if (!onLogout || event.target !== event.currentTarget) return;
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); togglePfpDropdown(); }
            if (event.key === 'Escape') setShowPfpDropdown(false);
          }}
          title={userName ? `Logged in as ${userName} (${userEmail})${onLogout ? ' - Click for menu' : ''}` : 'Guest Agent'}
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={userName || 'Profile avatar'}
              className="sketch-pfp-img"
            />
          ) : userName ? (
            <span className="sketch-pfp-text">
              {userName.slice(0, 2).toUpperCase()}
            </span>
          ) : (
            <span className="sketch-pfp-text">pfp</span>
          )}

          {onLogout && (
            <div className="sketch-pfp-dropdown">
              <FancyButton compact className="sketch-pfp-dropdown-item" onClick={handleSignOut}>
                Sign Out
              </FancyButton>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
