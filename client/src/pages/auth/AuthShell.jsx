import { useDispatch, useSelector } from 'react-redux';
import { CalendarDays, MessagesSquare, Moon, Shapes, Sun } from 'lucide-react';
import { Backdrop } from '../../components/layout/AppLayout';
import { toggleTheme } from '../../features/uiSlice';

const FEATURES = [
  { icon: Shapes, title: 'Clubs & communities', text: 'Discover and join clubs that match your interests.' },
  { icon: CalendarDays, title: 'Campus events', text: 'Register in one tap and never miss a deadline.' },
  { icon: MessagesSquare, title: 'Discussions', text: 'Ask questions and share knowledge with peers.' },
];

export default function AuthShell({ title, subtitle, children }) {
  const dispatch = useDispatch();
  const theme = useSelector((s) => s.ui.theme);

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <Backdrop />
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[36px] lg:grid-cols-2 glass-strong animate-scale-in">
        <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-primary-700 via-primary-800 to-indigo-950 p-10 text-white lg:flex">
          <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-24 -left-10 h-72 w-72 rounded-full bg-sky-300/20 blur-3xl" />
          <div className="relative flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/20 backdrop-blur overflow-hidden">
              <img src="/logo.jpeg" alt="Logo" className="h-full w-full object-cover" />
            </div>
            <span className="text-lg font-extrabold tracking-tight">J.N.N INSTITUTE OF ENGINEERING</span>
          </div>
          <div className="relative">
            <h2 className="text-3xl font-extrabold leading-tight">
              Your whole campus,
              <br />
              in one place.
            </h2>
            <p className="mt-3 max-w-sm text-sm text-white/95">
              Announcements, clubs, events and conversations — connected for every student, club and faculty member.
            </p>
            <div className="mt-8 space-y-3">
              {FEATURES.map(({ icon: Icon, title: t, text }) => (
                <div key={t} className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 p-3 backdrop-blur-md">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{t}</p>
                    <p className="text-xs text-white/95">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="relative text-xs text-white/85">© {new Date().getFullYear()} CampusConnect</p>
        </div>

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
          <h1 className="text-2xl font-extrabold tracking-tight text-ink dark:text-primary-50 pr-10">{title}</h1>
          <p className="mt-1 text-sm text-ink-soft dark:text-ink-muted">{subtitle}</p>
          <div className="mt-7">{children}</div>
        </div>
      </div>
    </div>
  );
}

