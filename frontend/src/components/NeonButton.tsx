import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import './NeonButton.css';

type NeonVariant = 'cyan' | 'pink' | 'lime';

interface NeonButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: NeonVariant;
  size?: 'sm' | 'md' | 'lg';
  glowing?: boolean;
  loading?: boolean;
  children: ReactNode;
}

export default function NeonButton({
  variant = 'cyan',
  size = 'md',
  glowing = false,
  loading = false,
  children,
  className = '',
  disabled,
  ...props
}: NeonButtonProps) {
  const classes = [
    'neon-btn',
    `neon-btn--${variant}`,
    `neon-btn--${size}`,
    glowing && 'neon-btn--glow',
    loading && 'neon-btn--loading',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} disabled={disabled || loading} {...props}>
      {loading && <span className="neon-btn__spinner" />}
      <span className="neon-btn__label">{children}</span>
    </button>
  );
}
