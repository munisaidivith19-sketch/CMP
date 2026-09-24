import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/primitives';
import { AttachmentInput, Input, Select, Textarea } from '../../components/ui/form';
import { useCreateAnnouncementMutation, useGetClubsQuery, useUpdateAnnouncementMutation } from '../../services/api';
import { selectIsModerator } from '../../features/authSlice';
import { DEPARTMENTS, PRIORITIES } from '../../utils/constants';
import { errMsg, toLocalInput } from '../../utils/format';

export default function AnnouncementForm({ open, onClose, announcement, defaultClub }) {
  const isMod = useSelector(selectIsModerator);
  const { data: clubs } = useGetClubsQuery({ mine: isMod ? undefined : 'true', limit: 50 }, { skip: !open });
  const clubOptions = (clubs?.items || []).filter((c) => isMod || c.isManager).map((c) => ({ value: c._id, label: c.name }));
  const [create, { isLoading: creating }] = useCreateAnnouncementMutation();
  const [update, { isLoading: updating }] = useUpdateAnnouncementMutation();

  const blank = {
    title: '',
    content: '',
    priority: 'normal',
    scope: defaultClub || !isMod ? 'club' : 'all',
    department: '',
    year: '',
    club: defaultClub || '',
    deadline: '',
    attachments: [],
  };
  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors },
  } = useForm({ defaultValues: blank });

  useEffect(() => {
    if (!open) return;
    reset(
      announcement
        ? {
            ...blank,
            title: announcement.title,
            content: announcement.content,
            priority: announcement.priority,
            scope: announcement.audience?.scope || 'all',
            department: announcement.audience?.department || '',
            year: announcement.audience?.year || '',
            club: announcement.audience?.club?._id || announcement.audience?.club || '',
            deadline: toLocalInput(announcement.deadline),
            attachments: announcement.attachments || [],
          }
        : blank
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, announcement, reset]);

  const scope = watch('scope');
  const scopeOptions = isMod
    ? [
        { value: 'all', label: 'Everyone' },
        { value: 'department', label: 'A department' },
        { value: 'year', label: 'A year' },
        { value: 'club', label: 'Club members' },
      ]
    : [{ value: 'club', label: 'Club members' }];

  const onSubmit = async (v) => {
    const payload = {
      title: v.title,
      content: v.content,
      priority: v.priority,
      deadline: v.deadline ? new Date(v.deadline).toISOString() : undefined,
      attachments: v.attachments,
      audience: {
        scope: v.scope,
        ...(v.scope === 'department' ? { department: v.department } : {}),
        ...(v.scope === 'year' ? { year: Number(v.year) } : {}),
        ...(v.scope === 'club' ? { club: v.club } : {}),
      },
    };
    try {
      if (announcement) await update({ id: announcement._id, ...payload }).unwrap();
      else await create(payload).unwrap();
      toast.success(announcement ? 'Announcement updated' : 'Announcement published 📣');
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={announcement ? 'Edit announcement' : 'New announcement'}
      subtitle="Everyone in the audience gets a real-time notification."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit(onSubmit)} loading={creating || updating}>
            {announcement ? 'Save' : 'Publish'}
          </Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
        <Input
          className="sm:col-span-2"
          label="Title"
          error={errors.title}
          {...register('title', { required: 'Title is required', minLength: { value: 3, message: 'Too short' } })}
        />
        <Textarea
          className="sm:col-span-2"
          label="Message"
          rows={5}
          error={errors.content}
          {...register('content', { required: 'Message is required' })}
        />
        <Select label="Priority" options={PRIORITIES} {...register('priority')} />
        <Select label="Audience" options={scopeOptions} {...register('scope')} />
        {scope === 'department' && (
          <Select label="Department" placeholder="Choose…" options={DEPARTMENTS} error={errors.department} {...register('department', { required: 'Required' })} />
        )}
        {scope === 'year' && (
          <Select
            label="Year"
            placeholder="Choose…"
            options={[1, 2, 3, 4].map((y) => ({ value: y, label: `Year ${y}` }))}
            error={errors.year}
            {...register('year', { required: 'Required' })}
          />
        )}
        {scope === 'club' && (
          <Select label="Club" placeholder="Choose…" options={clubOptions} error={errors.club} {...register('club', { required: 'Choose a club' })} />
        )}
        <Input label="Deadline (optional)" type="datetime-local" {...register('deadline')} />
        <div className="sm:col-span-2">
          <Controller name="attachments" control={control} render={({ field }) => <AttachmentInput label="Attachments" value={field.value} onChange={field.onChange} />} />
        </div>
      </form>
    </Modal>
  );
}
