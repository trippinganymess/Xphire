import { type InputHTMLAttributes, useState, useId } from 'react';
import './NeonInput.css';

interface NeonInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  accentColor?: 'cyan' | 'pink' | 'lime';
}

export default function NeonInput({
  label,
  error,
  accentColor = 'cyan',
  className = '',
  ...props
}: NeonInputProps) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const hasValue = Boolean(props.value || props.defaultValue);

  return (
    <div
      className={`neon-input neon-input--${accentColor} ${focused ? 'neon-input--focused' : ''} ${hasValue || focused ? 'neon-input--filled' : ''} ${error ? 'neon-input--error' : ''} ${className}`}
    >
      <input
        id={id}
        className="neon-input__field"
        onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
        {...props}
      />
      <label htmlFor={id} className="neon-input__label">
        {label}
      </label>
      <div className="neon-input__border" />
      {error && <span className="neon-input__error">{error}</span>}
    </div>
  );
}
