import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/primitives';
import { ImageUpload, Input, Select, TagInput, Textarea } from '../../components/ui/form';
import { useCreateEventMutation, useGetClubsQuery, useUpdateEventMutation } from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { EVENT_CATEGORIES, STAFF_VIEW } from '../../utils/constants';
import { errMsg, toLocalInput } from '../../utils/format';

const blank = {
  title: '',
  description: '',
  category: 'technical',
  club: '',
  startDate: '',
  endDate: '',
  registrationDeadline: '',
  venue: '',
  capacity: 0,
  tags: [],
  poster: '',
  isFeatured: false,
};

export default function EventForm({ open, onClose, event, defaultClub, onSaved }) {
  const user = useSelector(selectUser);
  const isStaff = STAFF_VIEW.includes(user.role);
  const { data: clubs } = useGetClubsQuery({ mine: true, limit: 50 }, { skip: !open });
  const manageable = clubs?.items?.filter((c) => c.isManager) || [];
  const [create, { isLoading: creating }] = useCreateEventMutation();
  const [update, { isLoading: updating }] = useUpdateEventMutation();

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
      event
        ? {
            ...blank,
            ...event,
            club: event.club?._id || event.club || '',
            startDate: toLocalInput(event.startDate),
            endDate: toLocalInput(event.endDate),
            registrationDeadline: toLocalInput(event.registrationDeadline),
            tags: event.tags || [],
            poster: event.poster || '',
          }
        : { ...blank, club: defaultClub || '' }
    );
  }, [open, event, defaultClub, reset]);

  const onSubmit = async (v) => {
    const payload = {
      title: v.title,
      description: v.description,
      category: v.category,
      venue: v.venue,
      capacity: Number(v.capacity) || 0,
      tags: v.tags,
      poster: v.poster || undefined,
      startDate: new Date(v.startDate).toISOString(),
      endDate: new Date(v.endDate).toISOString(),
      registrationDeadline: v.registrationDeadline ? new Date(v.registrationDeadline).toISOString() : undefined,
      ...(isStaff && user.role === 'admin' ? { isFeatured: Boolean(v.isFeatured) } : {}),
    };
    try {
      if (event) {
        const saved = await update({ id: event._id, ...payload }).unwrap();
        toast.success('Event updated');
        onSaved?.(saved);
      } else {
        const saved = await create({ ...payload, club: v.club || undefined }).unwrap();
        toast.success('Event published 🎉');
        onSaved?.(saved);
      }
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const clubOptions = manageable.map((c) => ({ value: c._id, label: c.name }));
  const noHost = !event && !isStaff && !manageable.length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={event ? 'Edit event' : 'Create an event'}
      subtitle={event ? 'Registered students are notified if the date or venue changes.' : 'Members get notified as soon as you publish.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit(onSubmit)} loading={creating || updating} disabled={noHost}>
            {event ? 'Save changes' : 'Publish event'}
          </Button>
        </>
      }
    >
      {noHost ? (
        <p className="rounded-2xl bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
          Only club admins, faculty and administrators can create events. Become an admin of a club to host events.
        </p>
      ) : (
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
          <Input
            className="sm:col-span-2"
            label="Title"
            error={errors.title}
            {...register('title', { required: 'Title is required', minLength: { value: 3, message: 'Too short' } })}
          />
          <Select label="Category" options={EVENT_CATEGORIES} {...register('category')} />
          {!event && (
            <Select
              label="Hosted by"
              options={clubOptions}
              placeholder={isStaff ? 'College (no club)' : undefined}
              error={errors.club}
              {...register('club', { validate: (v) => isStaff || Boolean(v) || 'Choose a club' })}
            />
          )}
          <Input
            label="Starts"
            type="datetime-local"
            error={errors.startDate}
            {...register('startDate', { required: 'Start date is required' })}
          />
          <Input
            label="Ends"
            type="datetime-local"
            error={errors.endDate}
            {...register('endDate', {
              required: 'End date is required',
              validate: (v) => !watch('startDate') || new Date(v) >= new Date(watch('startDate')) || 'Must be after the start',
            })}
          />
          <Input label="Venue" error={errors.venue} {...register('venue', { required: 'Venue is required' })} />
          <Input
            label="Participation limit"
            type="number"
            min={0}
            hint="0 = unlimited. Extra sign-ups join a waitlist."
            error={errors.capacity}
            {...register('capacity', { min: { value: 0, message: 'Cannot be negative' } })}
          />
          <Input label="Registration closes (optional)" type="datetime-local" {...register('registrationDeadline')} />
          <Controller
            name="tags"
            control={control}
            render={({ field }) => <TagInput label="Tags" value={field.value} onChange={field.onChange} placeholder="e.g. ai, workshop" />}
          />
          <Textarea
            className="sm:col-span-2"
            label="Description"
            rows={5}
            error={errors.description}
            {...register('description', { required: 'Description is required', minLength: { value: 10, message: 'Add a little more detail' } })}
          />
          <div className="sm:col-span-2">
            <Controller name="poster" control={control} render={({ field }) => <ImageUpload label="Poster" value={field.value} onChange={field.onChange} />} />
          </div>
          {user.role === 'admin' && (
            <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2">
              <input type="checkbox" className="h-4 w-4 accent-primary-500" {...register('isFeatured')} /> Feature this event on the dashboard
            </label>
          )}
        </form>
      )}
    </Modal>
  );
}
