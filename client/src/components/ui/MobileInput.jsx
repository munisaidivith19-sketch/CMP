import { Input } from './form';

/**
 * Student and parent mobile numbers: exactly 10 digits, and never the same
 * number. The server checks the same rules (constants.js studentMobileProblem).
 */
export const MOBILE_HINT = '10 digits';

/** Digits only, at most 10 (a pasted +91 / leading 0 is dropped first). */
export const toMobile = (raw) => {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  else if (d.length > 10 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
};

/** Empty, or exactly 10 digits. */
export const mobileOk = (v) => !v || /^\d{10}$/.test(v);

/** Same number written two ways (formatting ignored). */
export const sameMobile = (a, b) => {
  const x = toMobile(a);
  return x.length === 10 && x === toMobile(b);
};

/**
 * Mobile number field: only digits, never more than 10 — typed, pasted or
 * autofilled.
 */
// `onChange` is taken out so a caller's handler (or undefined) never replaces
// the digit-only one below — that left the field ignoring every key press.
export default function MobileInput({ value, onValue, onChange: _ignored, ...props }) {
  return (
    <Input
      {...props}
      type="tel"
      inputMode="numeric"
      autoComplete="off"
      maxLength={10}
      pattern="\d{10}"
      placeholder="10-digit mobile"
      value={value}
      onChange={(e) => onValue(toMobile(e.target.value))}
      onPaste={(e) => {
        e.preventDefault();
        onValue(toMobile(e.clipboardData.getData('text')));
      }}
    />
  );
}
