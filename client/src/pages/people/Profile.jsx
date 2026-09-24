import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  Award,
  CalendarCheck2,
  Camera,
  KeyRound,
  Mail,
  MessagesSquare,
  Pencil,
  Plus,
  Shapes,
  Sparkles,
  Trash2,
  Trophy,
  Wrench,
} from 'lucide-react';
import {
  useChangePasswordMutation,
  useGetUserQuery,
  useUpdateMeMutation,
  useUploadAvatarMutation,
} from '../../services/api';
import { selectUser, setCredentials, setUser } from '../../features/authSlice';
import { Avatar, Badge, Button, Card, CardHeader, CategoryBadge, ErrorState, PageLoader } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Input, Select, TagInput, Textarea } from '../../components/ui/form';
import { ReportButton } from '../../components/domain';
import { DEPARTMENTS, ROLE_LABELS } from '../../utils/constants';
import { errMsg, fmtDate, friendlyDay } from '../../utils/format';

function EditProfile({ open, onClose, user }) {
  const dispatch = useDispatch();
  const [save, { isLoading }] = useUpdateMeMutation();
  const { register, control, handleSubmit, reset, formState: { errors } } = useForm();
  const { fields, append, remove } = useFieldArray({ control, name: 'achievements' });

  useEffect(() => {
    if (open)
      reset({
        name: user.name,
        department: user.department || '',
        year: user.year || '',
        rollNo: user.rollNo || '',
        designation: user.designation || '',
        phone: user.phone || '',
        bio: user.bio || '',
        interests: user.interests || [],
        skills: user.skills || [],
        extracurriculars: user.extracurriculars || [],
        achievements: (user.achievements || []).map((a) => ({ ...a, date: a.date ? String(a.date).slice(0, 10) : '' })),
      });
  }, [open, user, reset]);

  const onSubmit = async (v) => {
    try {
      const updated = await save({
        ...v,
        year: v.year ? Number(v.year) : null,
        achievements: v.achievements.filter((a) => a.title?.trim()).map(({ _id, ...a }) => ({ ...a, date: a.date || undefined })),
      }).unwrap();
      dispatch(setUser(updated));
      toast.success('Profile saved');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const isStudent = ['student', 'club_admin'].includes(user.role);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Edit profile"
      subtitle="Interests power your event recommendations."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isLoading} onClick={handleSubmit(onSubmit)}>
            Save profile
          </Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
        <Input label="Full name" error={errors.name} {...register('name', { required: 'Required', minLength: { value: 2, message: 'Too short' } })} />
        <Select label="Department" placeholder="Select" options={DEPARTMENTS} {...register('department')} />
        {isStudent ? (
          <>
            <Select label="Year" placeholder="Select" options={[1, 2, 3, 4, 5].map((y) => ({ value: y, label: `Year ${y}` }))} {...register('year')} />
            <Input label="Roll number" {...register('rollNo')} />
          </>
        ) : (
          <Input label="Designation" {...register('designation')} />
        )}
        <Input label="Phone" {...register('phone')} />
        <Textarea className="sm:col-span-2" label="Bio" rows={3} maxLength={500} {...register('bio')} />
        <Controller name="interests" control={control} render={({ field }) => <TagInput label="Interests" hint="e.g. technical, hackathon, cultural, sports" value={field.value} onChange={field.onChange} />} />
        <Controller name="skills" control={control} render={({ field }) => <TagInput label="Skills" value={field.value} onChange={field.onChange} />} />
        <div className="sm:col-span-2">
          <Controller
            name="extracurriculars"
            control={control}
            render={({ field }) => <TagInput label="Extracurricular activities" hint="NSS, NCC, sports teams…" value={field.value} onChange={field.onChange} />}
          />
        </div>
        <div className="sm:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="label mb-0">Achievements</span>
            <Button type="button" size="sm" variant="soft" icon={Plus} onClick={() => append({ title: '', description: '', date: '' })}>
              Add
            </Button>
          </div>
          <div className="space-y-3">
            {fields.map((f, i) => (
              <div key={f.id} className="grid gap-2 rounded-3xl bg-white/40 p-3 sm:grid-cols-[1fr_150px_auto] dark:bg-white/5">
                <input className="input" placeholder="Title" {...register(`achievements.${i}.title`)} />
                <input className="input" type="date" {...register(`achievements.${i}.date`)} />
                <button type="button" className="btn-icon btn-danger" onClick={() => remove(i)} aria-label="Remove achievement">
                  <Trash2 className="h-4 w-4" />
                </button>
                <input className="input sm:col-span-3" placeholder="Short description (optional)" {...register(`achievements.${i}.description`)} />
              </div>
            ))}
            {!fields.length && <p className="text-xs muted">No achievements added yet.</p>}
          </div>
        </div>
      </form>
    </Modal>
  );
}

function ChangePassword({ open, onClose }) {
  const dispatch = useDispatch();
  const [change, { isLoading }] = useChangePasswordMutation();
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm();
  const onSubmit = async ({ confirm, ...v }) => {
    try {
      const data = await change(v).unwrap();
      dispatch(setCredentials(data));
      toast.success('Password changed. Other devices were signed out.');
      reset();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Change password"
      footer={
        <Button loading={isLoading} onClick={handleSubmit(onSubmit)}>
          Update password
        </Button>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <Input label="Current password" type="password" error={errors.currentPassword} {...register('currentPassword', { required: 'Required' })} />
        <Input
          label="New password"
          type="password"
          error={errors.newPassword}
          {...register('newPassword', {
            required: 'Required',
            minLength: { value: 8, message: 'At least 8 characters' },
            validate: (v) => (/[A-Za-z]/.test(v) && /\d/.test(v)) || 'Include a letter and a number',
          })}
        />
        <Input label="Confirm" type="password" error={errors.confirm} {...register('confirm', { validate: (v) => v === watch('newPassword') || 'Passwords do not match' })} />
      </form>
    </Modal>
  );
}

export default function Profile() {
  const params = useParams();
  const me = useSelector(selectUser);
  const dispatch = useDispatch();
  const id = params.id || me._id;
  const isMe = id === me._id;
  const [search, setSearch] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [pwd, setPwd] = useState(false);
  const fileRef = useRef(null);
  const { data: user, isLoading, error, refetch } = useGetUserQuery(id);
  const [uploadAvatar, { isLoading: uploading }] = useUploadAvatarMutation();

  useEffect(() => {
    if (isMe && search.get('edit')) {
      setEditing(true);
      setSearch({}, { replace: true });
    }
  }, [isMe, search, setSearch]);

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const onAvatar = async (file) => {
    if (!file) return;
    try {
      const updated = await uploadAvatar(file).unwrap();
      dispatch(setUser(updated));
      toast.success('Photo updated');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const stats = [
    { icon: Shapes, label: 'Clubs', value: user.stats.clubs },
    { icon: CalendarCheck2, label: 'Events joined', value: user.stats.eventsJoined },
    { icon: Trophy, label: 'Attended', value: user.stats.eventsAttended },
    { icon: MessagesSquare, label: 'Discussions', value: user.stats.discussions },
  ];

  return (
    <div className="space-y-6">
      <Card className="relative overflow-hidden p-0">
        <div className="h-36 bg-gradient-to-br from-primary-400 via-fuchsia-400 to-sky-400">
          <div className="h-full w-full opacity-30 [background:radial-gradient(circle_at_20%_40%,white_0,transparent_35%),radial-gradient(circle_at_80%_20%,white_0,transparent_30%)]" />
        </div>
        <div className="flex flex-col gap-4 px-6 pb-6 sm:flex-row sm:items-end">
          <div className="relative -mt-14">
            <Avatar user={user} size="xl" ring className="rounded-[28px]" />
            {isMe && (
              <>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-primary-500 text-white shadow-glow transition-transform hover:scale-110"
                  aria-label="Change photo"
                  disabled={uploading}
                >
                  <Camera className="h-4 w-4" />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    onAvatar(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight">{user.name}</h1>
              <Badge color={user.role === 'faculty' ? 'info' : 'primary'}>{ROLE_LABELS[user.role]}</Badge>
            </div>
            <p className="text-sm muted">
              {[user.designation, user.department, user.year && `Year ${user.year}`, user.rollNo].filter(Boolean).join(' · ')}
            </p>
            {user.email && (
              <p className="mt-1 flex items-center gap-1.5 text-xs muted">
                <Mail className="h-3.5 w-3.5" /> {user.email}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {isMe ? (
              <>
                <Button variant="outline" icon={KeyRound} onClick={() => setPwd(true)}>
                  Password
                </Button>
                <Button icon={Pencil} onClick={() => setEditing(true)}>
                  Edit profile
                </Button>
              </>
            ) : (
              <ReportButton targetType="user" targetId={user._id} label="Report user" />
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ icon: Icon, label, value }) => (
          <Card key={label} className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-600 dark:text-primary-300">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-extrabold">{value}</p>
              <p className="text-xs muted">{label}</p>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="About" />
            <p className="whitespace-pre-line text-sm muted">{user.bio || (isMe ? 'Add a short bio so others know who you are.' : 'No bio yet.')}</p>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div>
                <p className="label flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> Interests
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {user.interests?.length ? user.interests.map((t) => <span key={t} className="chip">{t}</span>) : <span className="text-xs muted">—</span>}
                </div>
              </div>
              <div>
                <p className="label flex items-center gap-1.5">
                  <Wrench className="h-3.5 w-3.5" /> Skills
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {user.skills?.length ? user.skills.map((t) => <span key={t} className="chip">{t}</span>) : <span className="text-xs muted">—</span>}
                </div>
              </div>
              <div className="sm:col-span-2">
                <p className="label">Extracurricular activities</p>
                <div className="flex flex-wrap gap-1.5">
                  {user.extracurriculars?.length ? user.extracurriculars.map((t) => <span key={t} className="chip">{t}</span>) : <span className="text-xs muted">—</span>}
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Achievements" action={<Award className="h-5 w-5 text-amber-500" />} />
            {user.achievements?.length ? (
              <div className="space-y-3">
                {user.achievements.map((a) => (
                  <div key={a._id} className="flex gap-3 rounded-3xl bg-white/50 p-4 dark:bg-white/[0.03]">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                      <Trophy className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-bold">{a.title}</p>
                      {a.description && <p className="text-sm muted">{a.description}</p>}
                      {a.date && <p className="mt-0.5 text-xs text-ink-muted">{fmtDate(a.date)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm muted">No achievements listed.</p>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Clubs" />
            <div className="space-y-2">
              {user.clubs?.length ? (
                user.clubs.map((c) => (
                  <Link key={c._id} to={`/clubs/${c.slug}`} className="flex items-center gap-3 rounded-2xl p-1.5 hover:bg-white/60 dark:hover:bg-white/5">
                    <Avatar name={c.name} src={c.logo} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{c.name}</p>
                      <CategoryBadge category={c.category} className="mt-0.5" />
                    </div>
                  </Link>
                ))
              ) : (
                <p className="text-sm muted">Not a member of any club yet.</p>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Recent events" />
            <div className="space-y-2">
              {user.recentEvents?.length ? (
                user.recentEvents.map((e) => (
                  <Link key={e._id} to={`/events/${e._id}`} className="block rounded-2xl p-2 hover:bg-white/60 dark:hover:bg-white/5">
                    <p className="truncate text-sm font-semibold">{e.title}</p>
                    <p className="text-[11px] muted">{friendlyDay(e.startDate)}</p>
                  </Link>
                ))
              ) : (
                <p className="text-sm muted">No events yet.</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      {isMe && <EditProfile open={editing} onClose={() => setEditing(false)} user={{ ...me, ...user }} />}
      {isMe && <ChangePassword open={pwd} onClose={() => setPwd(false)} />}
    </div>
  );
}
