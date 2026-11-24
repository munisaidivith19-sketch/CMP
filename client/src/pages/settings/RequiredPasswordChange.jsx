import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { Backdrop } from '../../components/layout/AppLayout';
import useSignOut from '../../components/layout/useSignOut';
import { ChangePasswordCard } from './Security';

/**
 * Shown instead of the whole app while an account still has a temporary
 * password (a new account, or a password reset by an administrator): only the
 * change-password card. Once it is changed the app opens as usual. The server
 * refuses everything else until then (passwordChangeGate).
 */
export default function RequiredPasswordChange() {
  const navigate = useNavigate();
  const signOut = useSignOut();
  return (
    <div className="relative min-h-screen">
      <Backdrop />
      <div className="relative mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-5 px-4 py-10">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white p-1 shadow-xs">
            <img src="/logo.jpeg" alt="Logo" className="h-full w-full object-contain" />
          </div>
          <span className="text-sm font-extrabold leading-tight tracking-tight text-ink dark:text-primary-50 sm:text-[17px]">J.N.N INSTITUTE OF ENGINEERING</span>
        </div>
        <div className="rounded-2xl border border-amber-400/50 bg-amber-500/10 p-4 text-sm">
          <p className="font-bold">Set your own password to continue</p>
          <p className="mt-1">
            You signed in with a temporary password. Enter it as the current password, then choose a new one.
            After changing your password you can enter the app and use everything as usual.
          </p>
        </div>
        <ChangePasswordCard onChanged={() => navigate('/', { replace: true })} />
        <button type="button" onClick={signOut} className="inline-flex items-center justify-center gap-2 self-center text-sm font-semibold text-ink-muted hover:text-ink hover:underline dark:hover:text-white">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </div>
  );
}
