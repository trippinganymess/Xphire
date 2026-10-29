import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import './ConfirmEmailDialog.css';

interface ConfirmEmailDialogProps {
  open: boolean;
  question?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// Replaces the Splitting() CDN library: renders span.word > span.char with
// --char-index/--char-total so the CSS stagger animations work unchanged.
function SplitLabel({ text }: { text: string }) {
  const chars = Array.from(text);
  return (
    <span>
      <span className="word">
        {chars.map((char, index) => (
          <span
            key={`${char}-${index}`}
            className="char"
            data-char={char === ' ' ? '\u00A0' : char}
            style={{ '--char-index': index, '--char-total': chars.length } as CSSProperties}
          >
            {char === ' ' ? '\u00A0' : char}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * Confirm/decline gate from confirm_or_decline_email_code.md: hovering a
 * choice floods it with color, choosing one bursts a circle across the
 * overlay, and the paired callback fires once the burst completes so the
 * caller proceeds after the animation finishes.
 */
export default function ConfirmEmailDialog({
  open,
  question = 'Continue?',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmEmailDialogProps) {
  const [burst, setBurst] = useState<'confirm' | 'cancel' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const burstTimer = useRef<number | undefined>(undefined);
  const frames = useRef(0);
  const scale = useRef([0, 0]);
  const toggle = useRef([0, 0]);

  useEffect(() => () => {
    window.clearTimeout(burstTimer.current);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    // Oversized display dialog: hide the page behind it from screen readers
    // and freeze the paper underneath while the choice is being made.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    rootRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Ambient displacement-map animation from the reference implementation.
  useEffect(() => {
    if (!open) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const root = rootRef.current;
    if (!root) return undefined;
    const rad = Math.PI / 180;
    const turbulence = root.querySelectorAll<SVGFETurbulenceElement>('feTurbulence');
    const displace = root.querySelectorAll<SVGFEDisplacementMapElement>('feDisplacementMap');
    let frame = 0;
    const tick = () => {
      let bfx = 0.005;
      let bfy = 0.01;
      frames.current += 4;
      bfx += 0.001 * Math.cos(frames.current * rad);
      bfy += 0.005 * Math.sin(frames.current * rad);
      const baseFrequency = `${bfx} ${bfy}`;
      displace.forEach((node, index) => {
        if (scale.current[index] < 60 && toggle.current[index] === 1) scale.current[index] += 2;
        if (scale.current[index] > 0 && toggle.current[index] === 0) scale.current[index] -= 2;
        node.setAttributeNS(null, 'scale', String(scale.current[index]));
        turbulence[index]?.setAttributeNS(null, 'baseFrequency', baseFrequency);
      });
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  if (!open) return null;

  function decide(action: 'confirm' | 'cancel') {
    if (burst) return;
    setBurst(action);
    // The burst must complete before the caller proceeds, so the dialog
    // never clips its own explosion.
    burstTimer.current = window.setTimeout(() => {
      setBurst(null);
      if (action === 'confirm') onConfirm();
      else onCancel();
    }, 2000);
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') event.currentTarget.blur();
  };

  const classes = ['confirm-email-dialog']
    .concat(burst ? [`confirm-email-dialog--burst-${burst}`] : [])
    .join(' ');

  return (
    <div
      ref={rootRef}
      className={classes}
      role="dialog"
      aria-modal="true"
      aria-label="Confirm sending the access request email"
      tabIndex={-1}
      onKeyDown={onRootKeyDown}
    >
      <div className="confirm-email-dialog__container">
        <p className="confirm-email-dialog__question">{question}</p>
        <div className="confirm-email-dialog__buttons">
          <div className="confirm-email-dialog__btnwrap confirm-email-dialog__btnwrap--confirm">
            <button
              type="button"
              aria-label="Confirm"
              onMouseEnter={() => { toggle.current[0] = 1; }}
              onMouseLeave={() => { toggle.current[0] = 0; }}
              onClick={() => decide('confirm')}
            >
              Confirm
            </button>
            <div className="confirm-email-dialog__reveal">
              <SplitLabel text={confirmLabel} />
            </div>
          </div>
          <div className="confirm-email-dialog__btnwrap confirm-email-dialog__btnwrap--cancel">
            <button
              type="button"
              aria-label="Cancel"
              onMouseEnter={() => { toggle.current[1] = 1; }}
              onMouseLeave={() => { toggle.current[1] = 0; }}
              onClick={() => decide('cancel')}
            >
              Cancel
            </button>
            <div className="confirm-email-dialog__reveal">
              <SplitLabel text={cancelLabel} />
            </div>
          </div>
        </div>
      </div>

      {/* Displacement filters referenced by the reveal-text CSS. */}
      <svg className="confirm-email-dialog__filters" version="1.1" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
        <defs>
          <filter id="xphire-warp-left">
            <feTurbulence type="fractalNoise" baseFrequency="0.000 0.0" numOctaves="1" seed="13" result="noise" />
            <feDisplacementMap in2="noise" in="SourceGraphic" scale="46" />
          </filter>
          <filter id="xphire-warp-right">
            <feTurbulence type="fractalNoise" baseFrequency="0.000 0.0" numOctaves="1" seed="10" result="noise" />
            <feDisplacementMap in2="noise" in="SourceGraphic" scale="46" />
          </filter>
        </defs>
      </svg>
    </div>
  );
}
