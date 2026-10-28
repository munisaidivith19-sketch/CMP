import { useDispatch, useSelector } from 'react-redux';
import { ArrowLeft, Moon, Sun } from 'lucide-react';
import { Backdrop } from '../../components/layout/AppLayout';
import { Button } from '../../components/ui/primitives';
import { toggleTheme } from '../../features/uiSlice';
import { APP_NAME } from '../../utils/legal';

/**
 * Standalone page frame for the public legal pages (About, Terms, Privacy):
 * readable without signing in, with a way back to wherever the reader came
 * from — the profile when signed in, the acceptance screen while it is
 * pending, otherwise the sign-in page.
 */
export default function LegalLayout({ children }) {
  const dispatch = useDispatch();
  const theme = useSelector((s) => s.ui.theme);
  const user = useSelector((s) => s.auth.user);
  const back = !user
    ? { to: '/login', label: 'Back to sign in' }
    : { to: '/profile', label: 'Back to profile' };

  return (
    <div className="relative min-h-screen px-4 py-6 sm:py-10">
      <Backdrop />
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-5 flex items-center justify-between gap-3">
          <Button to={back.to} variant="ghost" size="sm" icon={ArrowLeft} className="-ml-2">
            {back.label}
          </Button>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm font-extrabold tracking-tight sm:inline">{APP_NAME}</span>
            <button
              type="button"
              onClick={() => dispatch(toggleTheme())}
              className="btn-icon btn-outline h-9 w-9 rounded-xl"
              aria-label="Toggle theme"
              title="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
