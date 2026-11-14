import { useDispatch, useSelector } from 'react-redux';
import { Moon, Sun } from 'lucide-react';
import { toggleTheme } from '../../features/uiSlice';

export default function AuthShell({ title, subtitle, children }) {
  const dispatch = useDispatch();
  const theme = useSelector((s) => s.ui.theme);

  return (
    <div className="fixed inset-0 overflow-y-auto overscroll-contain">
      <div
        className="auth-bg fixed inset-0"
        aria-hidden="true"
      />
      <div className="fixed inset-0 bg-slate-900/40 dark:bg-slate-950/65" aria-hidden="true" />
      <div className="relative mx-auto flex min-h-full items-center justify-center p-4">
      <div className="relative grid w-full max-w-lg overflow-hidden rounded-[36px] auth-glass animate-scale-in">
        <div className="relative p-7 sm:p-10">
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
          <div className="mb-6 flex items-center gap-3 pr-10">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white p-1 shadow-sm">
              <img src="/logo.jpeg" alt="Logo" className="h-full w-full object-contain" />
            </div>
            <span className="whitespace-nowrap text-[15px] font-extrabold leading-tight tracking-tight text-white">J.N.N INSTITUTE OF ENGINEERING</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white pr-10">{title}</h1>
          <p className="mt-1 text-sm font-semibold text-white/90">{subtitle}</p>
          <div className="mt-7">{children}</div>
        </div>
      </div>
      </div>
    </div>
  );
}

