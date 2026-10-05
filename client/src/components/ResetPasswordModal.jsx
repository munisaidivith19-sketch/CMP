import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { useResetUserPasswordMutation } from '../services/api';
import { Button } from './ui/primitives';
import { Modal } from './ui/Modal';
import { Input } from './ui/form';
import { errMsg } from '../utils/format';

/** Letters + digits, no look-alike characters — the server enforces the real rules. */
export function suggestPassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const pick = (n, set) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => set[x % set.length]).join('');
  return `${pick(6, letters)}${pick(3, '23456789')}`;
}

const EMPTY = { newPassword: '', confirmPassword: '', reason: '' };

/**
 * Authorized password reset (Admin, or a Class In-Charge for their own
 * students). No current password: the server checks the caller may reset this
 * account, then signs the user out everywhere.
 */
export default function ResetPasswordModal({ user, onClose }) {
  const [v, setV] = useState(EMPTY);
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [reset, { isLoading }] = useResetUserPasswordMutation();

  useEffect(() => {
    setV(EMPTY);
    setErrors({});
    setShow(false);
  }, [user]);

  if (!user) return null;
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const mismatch = v.confirmPassword && v.newPassword !== v.confirmPassword;

  const submit = async (e) => {
    e.preventDefault();
    try {
      await reset({ id: user._id, ...v, reason: v.reason.trim() || undefined }).unwrap();
      toast.success(`Password reset for ${user.name}. They have been signed out and must use the new password.`, { duration: 6000 });
      onClose();
    } catch (err) {
      const list = err?.data?.errors;
      setErrors(Array.isArray(list) ? Object.fromEntries(list.map((x) => [x.field, x.message])) : {});
      toast.error(errMsg(err));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset password · ${user.name}`}
      subtitle="Sets a new password without the old one. The user is signed out on every device."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="reset-password-form" icon={KeyRound} loading={isLoading} disabled={!v.newPassword || !v.confirmPassword || mismatch}>
            Reset password
          </Button>
        </>
      }
    >
      <form id="reset-password-form" onSubmit={submit} className="grid gap-3" autoComplete="off">
        <div className="flex items-start gap-2">
          <Input
            label="New password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            hint="At least 8 characters with a letter and a number."
            className="min-w-0 flex-1"
            value={v.newPassword}
            onChange={set('newPassword')}
            error={errors.newPassword}
            required
          />
          <Button type="button" variant="ghost" className="mt-7" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="mt-7"
            onClick={() => {
              const p = suggestPassword();
              setV((s) => ({ ...s, newPassword: p, confirmPassword: p }));
              setShow(true);
            }}
          >
            Generate
          </Button>
        </div>
        <Input
          label="Confirm new password"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={v.confirmPassword}
          onChange={set('confirmPassword')}
          error={mismatch ? 'Passwords do not match' : errors.confirmPassword}
          required
        />
        <Input label="Reason (optional)" maxLength={200} placeholder="e.g. Student forgot password" value={v.reason} onChange={set('reason')} error={errors.reason} />
      </form>
    </Modal>
  );
}
