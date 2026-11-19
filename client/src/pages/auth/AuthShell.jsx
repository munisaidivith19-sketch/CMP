import { useDispatch, useSelector } from 'react-redux';
import { Moon, Sun } from 'lucide-react';
import { Backdrop } from '../../components/layout/AppLayout';
import { toggleTheme } from '../../features/uiSlice';

export default function AuthShell({ title, subtitle, children }) {
  const dispatch = useDispatch();
  const theme = useSelector((s) => s.ui.theme);

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <Backdrop />
      <div className="w-full max-w-lg overflow-hidden rounded-[36px] glass-strong animate-scale-in">
        <div className="relative p-6 sm:p-8">
          <div className="absolute top-6 right-6">
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
          <div className="mb-6 flex items-center gap-3 pr-8">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white p-1 shadow-sm">
              <img src="/logo.jpeg" alt="Logo" className="h-full w-full object-contain" />
            </div>
            <span className="text-sm font-extrabold leading-tight tracking-tight text-ink dark:text-primary-50 sm:whitespace-nowrap sm:text-[17px]">J.N.N INSTITUTE OF ENGINEERING</span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink dark:text-primary-50 pr-10">{title}</h1>
          <p className="mt-1 text-sm text-ink-soft dark:text-ink-muted">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
