import { useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  Calendar,
  CheckCircle2,
  Clock,
  DoorOpen,
  Info,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button, Card, cn } from '../../components/ui/primitives';
import { Input, Select, Textarea } from '../../components/ui/form';
import { useMassApproveGatePassMutation } from '../../services/api';
import { errMsg, todayKey } from '../../utils/format';

export default function MassOutpassModal({ open, onClose, hostelSummary }) {
  const [massApprove, { isLoading }] = useMassApproveGatePassMutation();

  const nowStr = new Date().toISOString().slice(0, 16);
  // Default to 3 days later
  const threeDaysLater = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 16);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    defaultValues: {
      fromDate: nowStr,
      toDate: threeDaysLater,
      regarding: 'home',
      area: 'Home / Native',
      district: 'Tamil Nadu',
      state: 'Tamil Nadu',
      description: '',
    },
  });

  const onSubmit = async (data) => {
    try {
      const res = await massApprove({
        fromDate: new Date(data.fromDate).toISOString(),
        toDate: new Date(data.toDate).toISOString(),
        regarding: data.regarding,
        description: data.description.trim(),
        destination: {
          area: data.area.trim(),
          district: data.district.trim(),
          state: data.state.trim(),
        },
      }).unwrap();

      toast.success(res.message || `Successfully authorized ${res.count} mass outpass(es)!`);
      reset();
      onClose();
    } catch (err) {
      toast.error(errMsg(err, 'Failed to authorize mass outpass'));
    }
  };

  if (!open) return null;

  const insideCount = hostelSummary?.inside ?? 0;
  const outsideCount = hostelSummary?.outside ?? 0;
  const totalCount = hostelSummary?.total ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-indigo-600 text-white shadow-soft">
            <DoorOpen className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-extrabold text-ink dark:text-primary-50">
              Institutional Mass Outpass Authorization
            </h3>
            <p className="text-xs text-ink-soft dark:text-ink-muted">
              Pre-approved gate passes for hostellers with zero student request required
            </p>
          </div>
        </div>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={CheckCircle2}
            loading={isLoading}
            onClick={handleSubmit(onSubmit)}
          >
            Authorize Mass Outpass ({insideCount} Eligible)
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Hosteller Live Census Overview */}
        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-primary-500/20 bg-primary-500/5 p-3 text-center">
          <div className="rounded-xl bg-white/60 p-2 dark:bg-white/5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Inside Campus</p>
            <p className="text-xl font-extrabold text-ink dark:text-primary-50">{insideCount}</p>
            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Eligible for pass</p>
          </div>
          <div className="rounded-xl bg-white/60 p-2 dark:bg-white/5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">Outside Campus</p>
            <p className="text-xl font-extrabold text-ink dark:text-primary-50">{outsideCount}</p>
            <p className="text-[10px] text-ink-muted">Already outside</p>
          </div>
          <div className="rounded-xl bg-white/60 p-2 dark:bg-white/5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Total Hostellers</p>
            <p className="text-xl font-extrabold text-ink dark:text-primary-50">{totalCount}</p>
            <p className="text-[10px] text-ink-muted">Campus register</p>
          </div>
        </div>

        {/* Date & Time Range */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            type="datetime-local"
            label="Departure Date & Time"
            error={errors.fromDate}
            {...register('fromDate', { required: 'Departure date & time is required' })}
          />
          <Input
            type="datetime-local"
            label="Return Due Date & Time"
            error={errors.toDate}
            {...register('toDate', { required: 'Return date & time is required' })}
          />
        </div>

        {/* Category & Destination */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Regarding"
            error={errors.regarding}
            options={[
              { value: 'home', label: 'Home / Vacation' },
              { value: 'outing', label: 'Outing / Event' },
            ]}
            {...register('regarding', { required: 'Required' })}
          />
          <Input
            label="Destination / Native Area"
            placeholder="Home / Native Place"
            error={errors.area}
            {...register('area', { required: 'Destination area is required' })}
          />
        </div>

        {/* Purpose / Description */}
        <Textarea
          label="Purpose / Announcement Description"
          placeholder="e.g., Pongal Festival Holidays, Semester End Vacation, Institutional Break..."
          rows={3}
          maxLength={500}
          error={errors.description}
          {...register('description', {
            required: 'Please provide a clear description / purpose',
            minLength: { value: 3, message: 'Minimum 3 characters required' },
          })}
        />

        {/* Security & Verification Guarantee Callout */}
        <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-800 dark:text-emerald-300">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="space-y-1">
            <p className="font-bold">Zero Duplication Security Guarantee</p>
            <p className="text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-400">
              Each student will immediately receive an approved pass with a <strong>unique 4-character code</strong> and active scannable QR code on their dashboard. No student request step is needed.
            </p>
          </div>
        </div>
      </form>
    </Modal>
  );
}

