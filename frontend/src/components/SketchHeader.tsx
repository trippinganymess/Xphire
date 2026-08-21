import './SketchHeader.css';

export type SystemStatus = 'online' | 'running' | 'completed';

interface SketchHeaderProps {
  status: SystemStatus;
  userName?: string;
  userEmail?: string;
  avatarUrl?: string;
  onLogout?: () => void;
}

export default function SketchHeader({
  status,
  userName,
  userEmail,
  avatarUrl,
  onLogout,
}: SketchHeaderProps) {
  const isRunning = status === 'running';

  return (
    <header className="sketch-header">
      {/* ── Left Box: Logo ── */}
      <div className="sketch-header__box sketch-header__logo" title="Xphire">
        <svg width="32" height="32" viewBox="0 0 28 28" fill="none" stroke="#121214" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          {/* Hand-drawn X / Lightning bolt logo mark */}
          <path d="M4 4 L14 14 L24 4" />
          <path d="M4 24 L14 14 L24 24" />
          <circle cx="14" cy="14" r="3" fill="#121214" />
        </svg>
      </div>

      {/* ── Center: System Online + Light Bulb ── */}
      <div className="sketch-header__center">
        <span className="sketch-header__title">
          {isRunning ? 'System working...' : 'System online'}
        </span>
        
        {/* Sketchy Light Bulb Icon */}
        <div className={`sketch-bulb ${isRunning ? 'sketch-bulb--running' : 'sketch-bulb--online'}`} title={`System: ${status}`}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Bulb Glow Fill */}
            <path
              d="M9 18h6a1 1 0 0 0 1-1v-1a7 7 0 1 0-8 0v1a1 1 0 0 0 1 1z"
              className="sketch-bulb__glow-fill"
              fill={isRunning ? 'var(--bulb-yellow)' : 'var(--bulb-green)'}
            />
            {/* Bulb Outline (Hand-drawn style) */}
            <path
              d="M9 18h6m-5 3h4m-7-6a7 7 0 1 1 10 0v2H8v-2z"
              stroke="#121214"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Filament */}
            <path
              d="M10 10l2 2 2-2"
              stroke="#121214"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>

      {/* ── Right Box: PFP / Profile / Status ── */}
      <div
        className={`sketch-header__box sketch-header__pfp ${onLogout ? 'sketch-header__pfp--clickable' : ''}`}
        onClick={onLogout}
        title={userName ? `Logged in as ${userName} (${userEmail}) - Click to logout` : 'Guest Agent'}
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
      </div>
    </header>
  );
}
