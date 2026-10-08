import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ShieldAlert, X } from 'lucide-react';
import { Button, cn } from './ui/primitives';

/**
 * Dedicated Red Alert Popup Modal for login creation and editing restrictions:
 * - Duplicate Email Restriction
 * - Duplicate Register Number (Roll Number) Restriction
 * - Identical Student and Parent Mobile Numbers Restriction
 */
export default function RestrictionPopupModal({
  open,
  onClose,
  title = 'Registration Restricted',
  message,
  detail,
  type = 'general',
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const defaultTitles = {
    email: 'Email Already in Use',
    rollNo: 'Register Number Already in Use',
    mobile: 'Identical Mobile Numbers Restricted',
    general: 'Action Restricted',
  };

  const displayTitle = title || defaultTitles[type] || 'Action Restricted';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="restriction-popup-title"
    >
      {/* Backdrop with red ambient glow */}
      <div
        className="absolute inset-0 bg-[#16060c]/60 backdrop-blur-md animate-fade-up"
        onClick={onClose}
      />

      <div
        className={cn(
          'relative w-full max-w-md overflow-hidden rounded-[28px] border border-rose-500/40',
          'bg-gradient-to-b from-[#240e1b] via-[#1a0814] to-[#12050e] p-6 shadow-2xl shadow-rose-950/60',
          'animate-scale-in text-white'
        )}
      >
        {/* Subtle background red flare */}
        <div className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-rose-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -left-12 -bottom-12 h-36 w-36 rounded-full bg-rose-600/15 blur-3xl" />

        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full p-1.5 text-rose-300/70 hover:bg-rose-500/20 hover:text-white transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="relative flex flex-col items-center text-center">
          {/* Animated Glowing Warning Icon */}
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/20 ring-8 ring-rose-500/10 text-rose-400">
            <AlertTriangle className="h-8 w-8 animate-pulse text-rose-400" />
          </div>

          <h3
            id="restriction-popup-title"
            className="text-lg font-black tracking-tight text-rose-100 sm:text-xl"
          >
            {displayTitle}
          </h3>

          <p className="mt-1 text-xs text-rose-200/80">
            {type === 'mobile'
              ? 'Student and Parent contact policy violation'
              : 'Duplicate identity detection'}
          </p>

          {/* Red Alert Callout Card */}
          <div className="mt-4 w-full rounded-2xl border border-rose-500/30 bg-rose-950/50 p-4 text-left shadow-inner">
            <p className="text-xs leading-relaxed text-rose-100/95 font-medium">
              {message}
            </p>

            {detail && (
              <div className="mt-2.5 rounded-xl bg-black/40 p-2.5 text-[11px] font-mono text-rose-200/90 border border-rose-500/20 break-all">
                {detail}
              </div>
            )}
          </div>

          {/* Action Button */}
          <div className="mt-6 w-full">
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-2xl bg-gradient-to-r from-rose-600 to-rose-700 py-3 text-sm font-extrabold text-white shadow-lg shadow-rose-900/40 hover:from-rose-500 hover:to-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-400 active:scale-[0.98] transition-all"
            >
              Understood
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

