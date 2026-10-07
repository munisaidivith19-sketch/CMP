import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  Award,
  Calendar,
  Clock,
  FileText,
  Info,
  Paperclip,
  Send,
  Sparkles,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button, cn } from '../../components/ui/primitives';
import { Input, Select, Textarea } from '../../components/ui/form';
import { useCreateODLeaveRequestMutation, useUploadFileMutation } from '../../services/api';
import { errMsg, todayKey } from '../../utils/format';

const OD_CATEGORIES = [
  'Academic Conference / Seminar',
  'Paper Presentation',
  'Technical Symposium',
  'Sports Tournament / Meet',
  'Cultural Event / Fest',
  'Hackathon / Project Expo',
  'Industrial Visit / Workshop',
  'Official College Representation',
  'Other',
];

const LEAVE_CATEGORIES = [
  'Medical / Sick Leave',
  'Personal / Family Reason',
  'Out of Station',
  'Family Function / Event',
  'Emergency',
  'Other',
];

export default function ODLeaveModal({ open, onClose, onSuccess }) {
  const [requestType, setRequestType] = useState('od'); // 'od' | 'leave'
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [docFile, setDocFile] = useState(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const [createRequest, { isLoading: submitting }] = useCreateODLeaveRequestMutation();
  const [uploadFile] = useUploadFileMutation();

  // Reset form when modal closes or opens
  const resetForm = () => {
    setRequestType('od');
    setFromDate('');
    setToDate('');
    setCategory('');
    setDescription('');
    setDocFile(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Previous-day 5:00 PM cutoff calculation for visual warning
  const cutoffWarning = useMemo(() => {
    if (!fromDate) return null;
    const now = new Date();
    const [y, m, d] = fromDate.split('-').map(Number);
    const start = new Date(y, m - 1, d);
    start.setHours(0, 0, 0, 0);

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    // Difference in calendar days
    const diffDays = Math.round((start.getTime() - todayDate.getTime()) / 86400000);

    if (diffDays <= 0) {
      return {
        type: 'danger',
        message: 'Requests cannot be submitted for today or past dates. Requests must be applied at least 1 day in advance before 5:00 PM.',
      };
    }
    if (diffDays === 1) {
      const currentHour = now.getHours();
      if (currentHour >= 17) {
        return {
          type: 'danger',
          message: 'Cut-off time (5:00 PM) for tomorrow has passed. Requests for tomorrow must be submitted before 5:00 PM today.',
        };
      }
      return {
        type: 'warning',
        message: 'Tomorrow request: Must be submitted before today at 5:00 PM. Please ensure your submission is timely.',
      };
    }
    return null;
  }, [fromDate]);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size must be under 5 MB');
      return;
    }
    try {
      setUploadingDoc(true);
      const res = await uploadFile({ file, kind: 'document' }).unwrap();
      setDocFile({
        url: res.url,
        name: file.name,
        mimeType: res.mimeType || file.type,
        size: file.size,
      });
      toast.success('Document uploaded');
    } catch (err) {
      toast.error(errMsg(err, 'Could not upload the document'));
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!fromDate || !toDate) {
      toast.error('Please select start and end dates');
      return;
    }
    if (!category) {
      toast.error('Please select a category');
      return;
    }
    if (description.trim().length < 5) {
      toast.error('Description must be at least 5 characters');
      return;
    }
    if (requestType === 'od' && !docFile) {
      toast.error('Supporting document is compulsory to apply for On Duty (OD)');
      return;
    }
    if (cutoffWarning?.type === 'danger') {
      toast.error(cutoffWarning.message);
      return;
    }

    try {
      await createRequest({
        requestType,
        category,
        fromDate,
        toDate,
        description: description.trim(),
        document: docFile || undefined,
      }).unwrap();

      toast.success(`${requestType === 'od' ? 'On Duty (OD)' : 'Leave'} request submitted successfully!`);
      resetForm();
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const isOD = requestType === 'od';
  const categories = isOD ? OD_CATEGORIES : LEAVE_CATEGORIES;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isOD ? 'Apply for On Duty (OD)' : 'Apply for Leave'}
      subtitle="Follow the 3-stage approval process (Class In-Charge → HOD → Principal)"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={submitting || uploadingDoc}
            disabled={cutoffWarning?.type === 'danger'}
            icon={Send}
            onClick={handleSubmit}
          >
            Submit Request
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Segmented Type Toggle */}
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-ink-soft dark:text-ink-muted">
            Request Type
          </label>
          <div className="mt-1.5 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100/90 dark:bg-white/5 p-1 border border-slate-200/80 dark:border-white/10">
            <button
              type="button"
              onClick={() => {
                setRequestType('od');
                setCategory('');
              }}
              className={cn(
                'flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold transition-all duration-200',
                isOD
                  ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20 dark:bg-sky-500 dark:text-white'
                  : 'text-ink-soft dark:text-ink-muted hover:text-ink dark:hover:text-primary-50'
              )}
            >
              <Sparkles className="h-4 w-4" />
              <span>On Duty (OD)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setRequestType('leave');
                setCategory('');
              }}
              className={cn(
                'flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold transition-all duration-200',
                !isOD
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-500/20 dark:bg-amber-500 dark:text-white'
                  : 'text-ink-soft dark:text-ink-muted hover:text-ink dark:hover:text-primary-50'
              )}
            >
              <Calendar className="h-4 w-4" />
              <span>Leave Request</span>
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-muted dark:text-slate-400">
            {isOD
              ? '✦ Approved OD automatically awards 100% attendance credit (Present) across all periods.'
              : '✦ Approved Leave marks scheduled periods as Absent with an authorized Leave record.'}
          </p>
        </div>

        {/* 5:00 PM Deadline Banner / Cut-off Info */}
        <div className="flex items-start gap-2.5 rounded-2xl border border-sky-200/80 bg-sky-500/10 p-3 text-xs text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300">
          <Clock className="h-4 w-4 shrink-0 mt-0.5 text-sky-500" />
          <div>
            <span className="font-bold">Cut-off Rule: </span>
            Requests for tomorrow must be submitted before <span className="font-bold">5:00 PM</span> on the previous day. Late requests cannot be accepted.
          </div>
        </div>

        {/* Dynamic warning if cut-off is triggered */}
        {cutoffWarning && (
          <div
            className={cn(
              'flex items-start gap-2 rounded-2xl p-3 text-xs border',
              cutoffWarning.type === 'danger'
                ? 'border-rose-200/80 bg-rose-500/10 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300'
                : 'border-amber-200/80 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300'
            )}
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{cutoffWarning.message}</span>
          </div>
        )}

        {/* Date Pickers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-ink-soft dark:text-ink-muted">From Date *</label>
            <input
              type="date"
              required
              value={fromDate}
              min={todayKey()}
              onChange={(e) => {
                setFromDate(e.target.value);
                if (!toDate || toDate < e.target.value) {
                  setToDate(e.target.value);
                }
              }}
              className="input mt-1 w-full"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-ink-soft dark:text-ink-muted">To Date *</label>
            <input
              type="date"
              required
              value={toDate}
              min={fromDate || todayKey()}
              onChange={(e) => setToDate(e.target.value)}
              className="input mt-1 w-full"
            />
          </div>
        </div>

        {/* Category Dropdown */}
        <div>
          <label className="text-xs font-semibold text-ink-soft dark:text-ink-muted">Category *</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
            className="input mt-1 w-full"
          >
            <option value="">Select a category</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Description / Reason */}
        <div>
          <label className="text-xs font-semibold text-ink-soft dark:text-ink-muted">
            Purpose & Explanation *
          </label>
          <textarea
            rows={3}
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={
              isOD
                ? 'Detail the event, competition, venue, registration number or role...'
                : 'Explain the reason for requesting leave...'
            }
            className="input mt-1 w-full"
          />
          <p className="mt-1 text-[11px] text-ink-muted">
            Minimum 5 characters. This will be reviewed by your Class In-Charge, HOD, and Principal.
          </p>
        </div>

        {/* Supporting Document Upload */}
        <div>
          <label className="text-xs font-semibold text-ink-soft dark:text-ink-muted">
            {isOD ? (
              <span>
                Supporting Document <span className="text-rose-500 font-bold">*</span>
              </span>
            ) : (
              'Supporting Document (Optional)'
            )}
          </label>
          <div className="mt-1 flex items-center gap-3">
            <label className="btn btn-outline cursor-pointer text-xs py-2 px-3">
              <Upload className="h-3.5 w-3.5" />
              <span>{uploadingDoc ? 'Uploading...' : 'Choose File'}</span>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                onChange={handleFileChange}
                disabled={uploadingDoc}
                className="hidden"
              />
            </label>

            {docFile && (
              <div className="flex items-center gap-2 rounded-xl bg-white/70 dark:bg-white/10 px-3 py-1.5 text-xs border border-slate-200/80 dark:border-white/10">
                <Paperclip className="h-3.5 w-3.5 text-primary-500" />
                <span className="truncate max-w-[180px] font-medium text-ink dark:text-primary-100">
                  {docFile.name}
                </span>
                <button
                  type="button"
                  onClick={() => setDocFile(null)}
                  className="text-ink-muted hover:text-rose-500 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
          <p className="mt-1 text-[11px] text-ink-muted">
            {isOD
              ? 'Upload invitation letters, event brochure, or conference approval (PDF, JPG, PNG, max 5MB). Compulsory for OD approval.'
              : 'Upload medical certificate or supporting note (PDF, JPG, PNG, max 5MB). Optional.'}
          </p>
        </div>
      </form>
    </Modal>
  );
}

