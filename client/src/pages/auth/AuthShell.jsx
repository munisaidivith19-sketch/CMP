import { CalendarDays, GraduationCap, MessagesSquare, Shapes } from 'lucide-react';
import { Backdrop } from '../../components/layout/AppLayout';

const FEATURES = [
  { icon: Shapes, title: 'Clubs & communities', text: 'Discover and join clubs that match your interests.' },
  { icon: CalendarDays, title: 'Campus events', text: 'Register in one tap and never miss a deadline.' },
  { icon: MessagesSquare, title: 'Discussions', text: 'Ask questions and share knowledge with peers.' },
];

export default function AuthShell({ title, subtitle, children }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <Backdrop />
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[36px] lg:grid-cols-2 glass-strong animate-scale-in">
        <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-primary-400 via-primary-500 to-fuchsia-500 p-10 text-white lg:flex">
          <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/20 blur-3xl" />
          <div className="absolute -bottom-24 -left-10 h-72 w-72 rounded-full bg-sky-300/30 blur-3xl" />
          <div className="relative flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
              <GraduationCap className="h-6 w-6" />
            </div>
            <span className="text-lg font-extrabold tracking-tight">CampusConnect</span>
          </div>
          <div className="relative">
            <h2 className="text-3xl font-extrabold leading-tight">
              Your whole campus,
              <br />
              in one place.
            </h2>
            <p className="mt-3 max-w-sm text-sm text-white/80">
              Announcements, clubs, events and conversations — connected for every student, club and faculty member.
            </p>
            <div className="mt-8 space-y-3">
              {FEATURES.map(({ icon: Icon, title: t, text }) => (
                <div key={t} className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 p-3 backdrop-blur-md">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{t}</p>
                    <p className="text-xs text-white/75">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="relative text-xs text-white/60">© {new Date().getFullYear()} CampusConnect</p>
        </div>

        <div className="p-7 sm:p-10">
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm muted">{subtitle}</p>
          <div className="mt-7">{children}</div>
        </div>
      </div>
    </div>
  );
}
