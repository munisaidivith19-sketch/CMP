import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertOctagon, Flame, HeartPulse, HelpCircle, ShieldAlert, Users } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/primitives';
import { Textarea } from '../ui/form';
import { useCreateSOSAlertMutation } from '../../services/api';
import { errMsg } from '../../utils/format';

const SOS_TYPE_OPTIONS = [
  {
    type: 'medical',
    label: 'Medical emergency',
    desc: 'Injury, sudden illness, unconsciousness',
    icon: HeartPulse,
  },
  {
    type: 'security',
    label: 'Security threat',
    desc: 'Intruders, violence, theft, physical danger',
    icon: ShieldAlert,
  },
  {
    type: 'fire',
    label: 'Fire hazard',
    desc: 'Smoke, active fire, electrical spark',
    icon: Flame,
  },
  {
    type: 'ragging',
    label: 'Ragging / harassment',
    desc: 'Hostel or campus harassment or intimidation',
    icon: Users,
  },
  {
    type: 'other',
    label: 'Other immediate help',
    desc: 'Urgent situation requiring rapid response',
    icon: HelpCircle,
  },
];

export default function SOSModal({ open, onClose, onSubmitted }) {
  const [type, setType] = useState('medical');
  const [note, setNote] = useState('');
  const [location, setLocation] = useState(null);
  const [createSOS, { isLoading }] = useCreateSOSAlertMutation();

  useEffect(() => {
    if (!open) {
      setNote('');
      setType('medical');
      setLocation(null);
      return;
    }

    if (navigator?.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy),
          });
        },
        () => {
          setLocation(null);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 }
      );
    }
  }, [open]);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    try {
      const res = await createSOS({
        type,
        note: note.trim() || undefined,
        location: location || undefined,
      }).unwrap();
      toast.success('Emergency alert sent to campus responders!');
      setNote('');
      setType('medical');
      onClose?.();
      onSubmitted?.(res);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Campus SOS Emergency Alert"
      subtitle="This instantly alerts Campus Security, HODs, and the Principal. Use for genuine emergencies only."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            loading={isLoading}
            icon={AlertOctagon}
            className="!bg-gradient-to-r !from-rose-500 !to-red-600 !text-white shadow-lg hover:!from-rose-600 hover:!to-red-700"
          >
            Confirm & Send SOS
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label mb-2 block text-xs font-bold uppercase tracking-wider text-ink-soft dark:text-ink-muted">
            Emergency Type
          </label>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {SOS_TYPE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const selected = type === opt.type;
              return (
                <button
                  type="button"
                  key={opt.type}
                  onClick={() => setType(opt.type)}
                  className={`flex items-start gap-3 rounded-2xl border p-3 text-left transition-all ${
                    selected
                      ? 'border-rose-500 bg-rose-500/10 shadow-sm dark:border-rose-400 dark:bg-rose-500/20'
                      : 'border-slate-200/70 bg-white/40 hover:bg-white/80 dark:border-white/10 dark:bg-ink/30 dark:hover:bg-ink/50'
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors ${
                      selected
                        ? 'bg-rose-500 text-white shadow-sm'
                        : 'bg-slate-200/70 text-slate-700 dark:bg-white/10 dark:text-slate-300'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p
                      className={`text-xs font-bold leading-tight ${
                        selected
                          ? 'text-rose-700 dark:text-rose-300'
                          : 'text-ink dark:text-primary-50'
                      }`}
                    >
                      {opt.label}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-tight text-ink-soft dark:text-ink-muted">
                      {opt.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <Textarea
          label="Location or details (optional)"
          placeholder="e.g. 2nd floor library hallway, near lab 204"
          rows={3}
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {location ? (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-700 dark:bg-emerald-400 animate-pulse" />
            <span>● GPS Location captured (approx. ±{location.accuracy}m)</span>
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

