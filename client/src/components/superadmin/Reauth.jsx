import { useCallback, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/primitives';
import { Input } from '../ui/form';
import { errorMessage, needsReauth, useSuperReauthMutation } from '../../services/superAdmin';

/**
 * Sensitive Super Admin actions need the password re-entered (server-side
 * proof on the session, valid ~5 minutes). `guard(action)` runs the action;
 * if the server answers REAUTH_REQUIRED it asks for the password once and
 * retries. The password is sent only to /super-admin/reauth and never kept.
 */
export function useReauth() {
  const [open, setOpen] = useState(false);
  const pending = useRef(null);

  const guard = useCallback(async (action) => {
    try {
      return await action();
    } catch (err) {
      if (!needsReauth(err)) throw err;
      return new Promise((resolve, reject) => {
        pending.current = { action, resolve, reject };
        setOpen(true);
      });
    }
  }, []);

  const onDone = useCallback(async (ok) => {
    setOpen(false);
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    if (!ok) return p.reject(Object.assign(new Error('cancelled'), { cancelled: true }));
    try {
      p.resolve(await p.action());
    } catch (err) {
      p.reject(err);
    }
  }, []);

  const modal = <ReauthModal open={open} onDone={onDone} />;
  return { guard, modal };
}

function ReauthModal({ open, onDone }) {
  const [password, setPassword] = useState('');
  const [reauth, { isLoading }] = useSuperReauthMutation();
  const submit = async (e) => {
    e.preventDefault();
    try {
      await reauth(password).unwrap();
      setPassword('');
      onDone(true);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not confirm your password'));
    }
  };
  const cancel = () => {
    setPassword('');
    onDone(false);
  };
  return (
    <Modal open={open} onClose={cancel} size="sm" title="Confirm it's you" subtitle="Re-enter your password to continue with this sensitive action.">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Password" type="password" icon={Lock} autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={cancel}>Cancel</Button>
          <Button type="submit" loading={isLoading} disabled={!password}>Confirm</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Toast an error unless the user just cancelled the password prompt. */
export function reportError(err, fallback) {
  if (err?.cancelled) return;
  toast.error(errorMessage(err, fallback));
}
