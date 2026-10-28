import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import './FancyButton.css';

interface FancyButtonProps {
  children: ReactNode;
  /** SPA route; renders the control as a react-router link styled as a button. */
  to?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  title?: string;
  ariaLabel?: string;
  describedBy?: string;
  onClick?: () => void;
}

export default function FancyButton({
  children,
  to,
  type = 'button',
  disabled = false,
  compact = false,
  className = '',
  title,
  ariaLabel,
  describedBy,
  onClick,
}: FancyButtonProps) {
  const classes = ['fancy-btn', compact ? 'fancy-btn--compact' : '', className].filter(Boolean).join(' ');
  const inner = (
    <span className="fancy-btn__inner">
      <span className="fancy-btn__text">{children}</span>
    </span>
  );
  if (to) {
    return (
      <Link
        to={to}
        className={classes}
        title={title}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        onClick={onClick}
      >
        {inner}
      </Link>
    );
  }
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      onClick={onClick}
    >
      {inner}
    </button>
  );
}
