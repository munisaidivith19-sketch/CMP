import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { EyeOff, Users } from 'lucide-react';
import { useCreateComplaintMutation } from '../../services/api';
import { Modal } from '../../components/ui/Modal';
import { Button, cn } from '../../components/ui/primitives';
import { AttachmentInput, Select, Textarea } from '../../components/ui/form';
import { errMsg } from '../../utils/format';
import { ROLE_LABELS, COMPLAINT_CATEGORY_LABELS, COMPLAINT_SUBCATEGORY_OPTIONS, COMPLAINT_ESCALATE_TO_OPTIONS } from '../../utils/constants';

export default function ComplaintFormModal({ open, onClose }) {
  const [create, { isLoading }] = useCreateComplaintMutation();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    control,
    reset,
    formState: { errors },
  } = useForm({ defaultValues: { anonymous: false, category: 'academics', subCategory: '', escalateTo: '', description: '', attachments: [] } });

  const category = watch('category');
  const anonymous = watch('anonymous');
  const subOptions = COMPLAINT_SUBCATEGORY_OPTIONS[category] || [];
  const escalateOptions = COMPLAINT_ESCALATE_TO_OPTIONS[category] || [];

  useEffect(() => {
    if (!open) return;
    reset({ anonymous: false, category: 'academics', subCategory: '', escalateTo: '', description: '', attachments: [] });
  }, [open, reset]);

  // Reset dependent dropdowns whenever the category changes.
  useEffect(() => {
    setValue('subCategory', '');
    setValue('escalateTo', '');
  }, [category, setValue]);

  const onSubmit = async (v) => {
    try {
      await create({
        anonymous: v.anonymous,
        category: v.category,
        subCategory: v.subCategory || undefined,
        escalateTo: v.escalateTo,
        description: v.description,
        attachments: v.attachments,
      }).unwrap();
      toast.success('Complaint registered — the responsible authority has been notified');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Register a complaint"
      subtitle="Tell us what happened — we'll route it to the right authority."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isLoading} onClick={handleSubmit(onSubmit)}>
            Submit complaint
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <div>
          <p className="label">Choose how your complaint will be submitted.</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setValue('anonymous', true)}
              className={cn('card flex items-center justify-center gap-2 py-3 text-sm font-bold transition-all', anonymous && 'ring-2 ring-primary-500')}
            >
              <EyeOff className="h-4 w-4" /> Anonymous
            </button>
            <button
              type="button"
              onClick={() => setValue('anonymous', false)}
              className={cn('card flex items-center justify-center gap-2 py-3 text-sm font-bold transition-all', !anonymous && 'ring-2 ring-primary-500')}
            >
              <Users className="h-4 w-4" /> Visible
            </button>
          </div>
          <p className="mt-2 text-xs muted">
            {anonymous
              ? 'Your identity will be hidden from the authorities handling the complaint. Your identity can only be accessed by authorized Chairman/Admin accounts according to the system’s privacy rules.'
              : 'The responsible authority will be able to see your identity.'}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Complaint category"
            options={Object.entries(COMPLAINT_CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
            error={errors.category}
            {...register('category', { required: true })}
          />
          {subOptions.length > 0 ? (
            <Select
              label={category === 'academics' ? 'Academic category' : 'Select category'}
              placeholder="Choose one"
              options={subOptions}
              error={errors.subCategory}
              {...register('subCategory', { required: 'Required' })}
            />
          ) : (
            <div className="hidden sm:block" />
          )}
          <Select
            label="Escalate to"
            placeholder="Choose authority"
            options={escalateOptions.map((r) => ({ value: r, label: ROLE_LABELS[r] || r }))}
            error={errors.escalateTo}
            {...register('escalateTo', { required: 'Required' })}
          />
        </div>

        <Textarea
          label="Complaint description"
          rows={5}
          maxLength={2000}
          error={errors.description}
          placeholder="Describe what happened in detail…"
          {...register('description', { required: 'Please describe the complaint', minLength: { value: 10, message: 'At least 10 characters' } })}
        />

        <Controller
          name="attachments"
          control={control}
          render={({ field }) => <AttachmentInput label="Upload supporting files" value={field.value} onChange={field.onChange} />}
        />
      </form>
    </Modal>
  );
}
