import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/primitives';
import { AttachmentInput, ImageUpload, Input, Select, Textarea } from '../../components/ui/form';
import { useCreateAnnouncementMutation, useGetClubsQuery, useUpdateAnnouncementMutation } from '../../services/api';
import { selectIsModerator, selectUser } from '../../features/authSlice';
import { DEPARTMENTS, FIRST_YEAR_HOD_DEPT, PRIORITIES, SECTIONS, YEAR_LABELS, isFirstYearHod } from '../../utils/constants';
import { errMsg, toLocalInput } from '../../utils/format';

/**
 * Campus audience = Department × Year × Section, each starting with "All".
 *   All departments + All years            → main announcement (Principal only)
 *   One department  + All years            → department
 *   Any department  + one year (+ All sec) → year
 *   One department  + one year + section   → section
 * The server re-validates every rule; this only decides what the form offers.
 */
function toAudience(v) {
  if (v.postTo === 'club') return { scope: 'club', club: v.club };
  const year = v.year ? Number(v.year) : undefined;
  if (!year) return v.department ? { scope: 'department', department: v.department } : { scope: 'all' };
  if (v.department && v.section) return { scope: 'section', department: v.department, year, section: v.section };
  return { scope: 'year', year, ...(v.department ? { department: v.department } : {}) };
}

function describe(aud) {
  const yr = (y) => YEAR_LABELS[y] || `Year ${y}`;
  switch (aud.scope) {
    case 'all':
      return 'Main announcement — every student and staff member on campus.';
    case 'department':
      return `Everyone in ${aud.department}.`;
    case 'year':
      return `${yr(aud.year)} students of ${aud.department || 'all departments'}${aud.department ? `, plus ${aud.department} faculty` : ''}.`;
    case 'section':
      return `${aud.department} ${yr(aud.year)} Section ${aud.section} students, plus ${aud.department} faculty.`;
    default:
      return 'Members of the selected club.';
  }
}

export default function AnnouncementForm({ open, onClose, announcement, defaultClub }) {
  const user = useSelector(selectUser);
  const isMod = useSelector(selectIsModerator);
  const role = user?.role;
  const fyHod = isFirstYearHod(user);
  const branchHod = role === 'hod' && !fyHod;
  const editingCampus = Boolean(announcement && announcement.audience?.scope !== 'club');
  const canCampus = role === 'principal' || role === 'hod' || editingCampus;

  const { data: clubs } = useGetClubsQuery({ mine: isMod ? undefined : 'true', limit: 50 }, { skip: !open });
  const clubOptions = (clubs?.items || []).filter((c) => isMod || c.isManager).map((c) => ({ value: c._id, label: c.name }));
  const [create, { isLoading: creating }] = useCreateAnnouncementMutation();
  const [update, { isLoading: updating }] = useUpdateAnnouncementMutation();

  const blank = {
    title: '',
    content: '',
    priority: 'normal',
    postTo: defaultClub || !canCampus ? 'club' : 'campus',
    department: branchHod ? user.department : '',
    year: fyHod ? '1' : '',
    section: '',
    club: defaultClub || '',
    deadline: '',
    image: '',
    attachments: [],
  };
  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm({ defaultValues: blank });

  useEffect(() => {
    if (!open) return;
    const aud = announcement?.audience || {};
    reset(
      announcement
        ? {
            ...blank,
            title: announcement.title,
            content: announcement.content,
            priority: announcement.priority,
            postTo: aud.scope === 'club' ? 'club' : 'campus',
            department: aud.department || '',
            year: aud.year ? String(aud.year) : '',
            section: aud.section || '',
            club: aud.club?._id || aud.club || '',
            deadline: toLocalInput(announcement.deadline),
            image: announcement.image || '',
            attachments: announcement.attachments || [],
          }
        : blank
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, announcement, reset]);

  // The locked HOD fields are disabled inputs, so pin their values here instead of trusting the DOM.
  const locked = (v) => ({
    ...v,
    department: branchHod ? user.department : v.department || '',
    year: fyHod ? '1' : v.year || '',
    section: v.section || '',
  });
  const values = locked(watch());
  const { postTo, department, year } = values;
  // A section belongs to one department + year: clear it when either goes back to "All".
  useEffect(() => {
    if ((!department || !year) && values.section) setValue('section', '');
  }, [department, year, values.section, setValue]);
  const sectionDisabled = !department || !year;

  const postToOptions = [
    ...(canCampus ? [{ value: 'campus', label: 'Campus (department / year / section)' }] : []),
    ...(clubOptions.length || defaultClub || postTo === 'club' ? [{ value: 'club', label: 'Club members' }] : []),
  ];
  const branchDepartments = DEPARTMENTS.filter((d) => d !== FIRST_YEAR_HOD_DEPT);
  const departmentOptions = branchHod
    ? [{ value: user.department, label: user.department }]
    : [{ value: '', label: 'All departments' }, ...(fyHod ? branchDepartments : DEPARTMENTS).map((d) => ({ value: d, label: d }))];
  const years = fyHod ? [1] : branchHod ? [2, 3, 4] : [1, 2, 3, 4];
  const yearOptions = [...(fyHod ? [] : [{ value: '', label: 'All years' }]), ...years.map((y) => ({ value: String(y), label: YEAR_LABELS[y] }))];
  const sectionOptions = [{ value: '', label: 'All sections' }, ...SECTIONS.map((s) => ({ value: s, label: `Section ${s}` }))];
  const audience = toAudience(values);
  const mainNotAllowed = postTo === 'campus' && audience.scope === 'all' && role !== 'principal' && !editingCampus;

  const onSubmit = async (raw) => {
    const v = locked(raw);
    const aud = toAudience(v);
    if (aud.scope === 'all' && role !== 'principal' && !editingCampus) {
      toast.error('Only the Principal can publish the main campus announcement');
      return;
    }
    const payload = {
      title: v.title,
      content: v.content,
      priority: v.priority,
      deadline: v.deadline ? new Date(v.deadline).toISOString() : undefined,
      image: v.image || (announcement?.image ? '' : undefined),
      attachments: v.attachments,
      audience: aud,
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
          <Button onClick={handleSubmit(onSubmit)} loading={creating || updating} disabled={mainNotAllowed}>
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
          {...register('title', { required: 'Title is required', minLength: { value: 3, message: 'Too short' }, maxLength: { value: 160, message: 'Too long' } })}
        />
        <Textarea
          className="sm:col-span-2"
          label="Message"
          rows={5}
          error={errors.content}
          {...register('content', { required: 'Message is required', minLength: { value: 5, message: 'Too short' }, maxLength: { value: 5000, message: 'Too long' } })}
        />
        <Select label="Priority" options={PRIORITIES} {...register('priority')} />
        <Select label="Post to" keepCase options={postToOptions} {...register('postTo')} />

        {postTo === 'campus' && (
          <>
            <Select label="Department" keepCase options={departmentOptions} disabled={branchHod} {...register('department')} />
            <Select label="Year" keepCase options={yearOptions} disabled={fyHod} {...register('year')} />
            <Select
              label="Section"
              keepCase
              options={sectionOptions}
              disabled={sectionDisabled}
              hint={sectionDisabled ? 'Pick a department and year first' : undefined}
              {...register('section')}
            />
            <div className="flex items-end sm:col-span-1">
              <p className={mainNotAllowed ? 'text-xs font-semibold text-rose-500' : 'text-xs muted'}>
                {mainNotAllowed ? 'Only the Principal can publish the main campus announcement. Pick a department or year.' : `Audience: ${describe(audience)}`}
              </p>
            </div>
          </>
        )}
        {postTo === 'club' && (
          <Select label="Club" placeholder="Choose…" options={clubOptions} error={errors.club} {...register('club', { validate: (c, all) => all.postTo !== 'club' || Boolean(c) || 'Choose a club' })} />
        )}

        <Input label="Deadline (optional)" type="datetime-local" {...register('deadline')} />
        <div className="sm:col-span-2">
          <Controller
            name="image"
            control={control}
            render={({ field }) => <ImageUpload label="Image (optional)" hint="Shown when someone opens the announcement." value={field.value} onChange={field.onChange} />}
          />
        </div>
        <div className="sm:col-span-2">
          <Controller name="attachments" control={control} render={({ field }) => <AttachmentInput label="Attachments" value={field.value} onChange={field.onChange} />} />
        </div>
      </form>
    </Modal>
  );
}
