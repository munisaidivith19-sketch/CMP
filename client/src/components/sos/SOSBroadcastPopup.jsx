import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { AlertOctagon, Flame, HeartPulse, ShieldAlert, Users, X } from 'lucide-react';
import { useSocketEvent } from '../../services/socket';
import { selectUser } from '../../features/authSlice';
import { SOS_RESPONDER_ROLES } from '../../utils/constants';

const TYPE_CONFIG = {
  medical: {
    title: 'MEDICAL EMERGENCY',
    label: 'Medical Emergency',
    badgeCls: 'bg-amber-500/20 text-amber-800 dark:text-amber-200 border-amber-500/30',
    iconCls: 'bg-amber-500 text-white',
    icon: HeartPulse,
  },
  security: {
    title: 'SECURITY ALERT',
    label: 'Security Alert',
    badgeCls: 'bg-orange-500/20 text-orange-800 dark:text-orange-200 border-orange-500/30',
    iconCls: 'bg-orange-500 text-white',
    icon: ShieldAlert,
  },
  ragging: {
    title: 'ANTI-RAGGING ALERT',
    label: 'Anti-Ragging Alert',
    badgeCls: 'bg-rose-500/20 text-rose-800 dark:text-rose-200 border-rose-500/30',
    iconCls: 'bg-rose-500 text-white',
    icon: Users,
  },
  other: {
    title: 'CAMPUS EMERGENCY',
    label: 'Campus Emergency',
    badgeCls: 'bg-primary-500/20 text-primary-800 dark:text-primary-200 border-primary-500/30',
    iconCls: 'bg-primary-500 text-white',
    icon: AlertOctagon,
  },
};

export default function SOSBroadcastPopup() {
  const user = useSelector(selectUser);
  const [fireAlert, setFireAlert] = useState(null);
  const isResponder = SOS_RESPONDER_ROLES.includes(user?.role);

  useSocketEvent('sos:new', (alert) => {
    if (!alert) return;

    if (alert.type === 'fire') {
      setFireAlert(alert);
      return;
    }

    const cfg = TYPE_CONFIG[alert.type] || TYPE_CONFIG.other;
    const Icon = cfg.icon;
    const alertId = alert.alertId || alert._id;
    const senderName = alert.triggeredBy?.name || alert.user?.name || 'Campus Member';
    const deptInfo = alert.department || 'Campus Area';
    const secInfo = alert.section ? ` · Sec ${alert.section}` : '';

    toast.custom(
      (t) => (
        <div
          className={`glass-strong relative flex w-[380px] max-w-full items-start gap-3 rounded-2xl border-2 border-rose-500/60 p-4 shadow-glass dark:shadow-glass-dark ${
            t.visible ? 'animate-scale-in' : 'opacity-0'
          }`}
        >
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${cfg.iconCls} shadow-sm animate-pulse`}>
            <Icon className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className={`inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${cfg.badgeCls}`}>
                {cfg.title}
              </span>
              <button
                type="button"
                onClick={() => toast.dismiss(t.id)}
                className="btn-icon btn-ghost -mr-1 -mt-1 h-6 w-6 p-0 text-ink-muted hover:text-ink dark:hover:text-white"
                aria-label="Dismiss alert toast"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-1 text-sm font-extrabold text-ink dark:text-primary-50">
              Alert in {deptInfo}{secInfo}
            </p>

            {alert.note ? (
              <p className="mt-0.5 line-clamp-2 text-xs italic text-ink-soft dark:text-ink-muted">
                "{alert.note}"
              </p>
            ) : null}

            <p className="mt-1 text-[11px] font-semibold text-ink-muted">
              By {senderName}
            </p>

            {isResponder ? (
              <Link
                to="/sos"
                onClick={() => toast.dismiss(t.id)}
                className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-rose-600 hover:text-rose-700 hover:underline dark:text-rose-400 dark:hover:text-rose-300"
              >
                View & respond →
              </Link>
            ) : null}
          </div>
        </div>
      ),
      { duration: 9000, id: `sos-${alertId}` }
    );
  });

  if (!fireAlert) return null;

  const senderName = fireAlert.triggeredBy?.name || fireAlert.user?.name || 'Campus Member';
  const deptInfo = fireAlert.department || 'Campus Area';
  const secInfo = fireAlert.section ? ` · Sec ${fireAlert.section}` : '';

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-up"
    >
      <div className="relative w-full max-w-lg rounded-3xl border-4 border-red-600 bg-gradient-to-b from-red-600 via-red-800 to-zinc-950 p-6 text-white shadow-2xl animate-scale-in sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-red-600 shadow-lg animate-pulse">
            <Flame className="h-7 w-7" />
          </div>
          <div>
            <span className="inline-block rounded-full bg-red-500/40 px-2.5 py-0.5 text-xs font-extrabold uppercase tracking-wider text-red-100 ring-1 ring-white/30">
              Urgent Evacuation Notice
            </span>
            <h2 className="mt-0.5 text-2xl font-black tracking-tight text-white sm:text-3xl">
              FIRE EMERGENCY
            </h2>
          </div>
        </div>

        <div className="mt-5 space-y-2 rounded-2xl bg-black/40 p-4 text-sm ring-1 ring-white/10">
          <div className="flex justify-between gap-2 border-b border-white/10 pb-2">
            <span className="text-xs font-medium text-red-200">Location / Department:</span>
            <span className="text-right font-bold text-white">{deptInfo}{secInfo}</span>
          </div>

          {fireAlert.note ? (
            <div className="flex justify-between gap-2 border-b border-white/10 pb-2">
              <span className="text-xs font-medium text-red-200">Details:</span>
              <span className="text-right font-medium italic text-white max-w-[70%]">{fireAlert.note}</span>
            </div>
          ) : null}

          <div className="flex justify-between gap-2">
            <span className="text-xs font-medium text-red-200">Reported by:</span>
            <span className="text-right font-semibold text-white">{senderName}</span>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-amber-400/50 bg-amber-500/20 p-3.5 text-xs font-semibold leading-relaxed text-amber-100">
          ⚠️ Follow evacuation procedure immediately. Stay calm, leave belongings, and proceed to the nearest emergency assembly area.
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setFireAlert(null)}
            className="rounded-xl border border-white/30 bg-white/10 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-white/20 active:scale-95"
          >
            I understand / Dismiss
          </button>
          {isResponder ? (
            <Link
              to="/sos"
              onClick={() => setFireAlert(null)}
              className="rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-red-700 shadow-lg transition hover:bg-red-50 active:scale-95"
            >
              Responder Console →
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

