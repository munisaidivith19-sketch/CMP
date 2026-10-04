import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { Award, Check, ImagePlus, Loader2, Search, Trophy, UserPlus, Users, X } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Avatar, Button, cn } from '../../components/ui/primitives';
import { Field, Input, Select, Textarea } from '../../components/ui/form';
import {
  useCreateAchievementMutation,
  useSearchAchievementStudentsQuery,
  useUpdateAchievementMutation,
  useUploadFileMutation,
} from '../../services/api';
import { selectUser } from '../../features/authSlice';
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_LEVELS,
  ACHIEVEMENT_POSITIONS,
} from '../../utils/constants';
import { errMsg, todayKey } from '../../utils/format';

export default function AchievementForm({ open, onClose, achievement }) {
  const me = useSelector(selectUser);
  const isPrincipal = me?.role === 'principal';
  const [create, { isLoading: creating }] = useCreateAchievementMutation();
  const [update, { isLoading: updating }] = useUpdateAchievementMutation();
  const [upload, { isLoading: uploading }] = useUploadFileMutation();

  const fileInputRef = useRef(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [images, setImages] = useState([]);

  const { data: studentResults, isFetching: searchingStudents } = useSearchAchievementStudentsQuery(
    { q: studentSearch || undefined },
    { skip: !open }
  );

  const blank = {
    title: '',
    description: '',
    category: 'academic',
    level: 'college',
    position: 'winner',
    eventName: '',
    organizer: '',
    achievedOn: todayKey(),
    externalLink: '',
  };

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ defaultValues: blank });

  useEffect(() => {
    if (!open) return;
    if (achievement) {
      reset({
        title: achievement.title || '',
        description: achievement.description || '',
        category: achievement.category || 'academic',
        level: achievement.level || 'college',
        position: achievement.position || 'winner',
        eventName: achievement.eventName || '',
        organizer: achievement.organizer || '',
        achievedOn: achievement.achievedOn ? achievement.achievedOn.slice(0, 10) : todayKey(),
        externalLink: achievement.externalLink || '',
      });
      setSelectedStudents(achievement.students || []);
      setImages(achievement.images || []);
    } else {
      reset(blank);
      setSelectedStudents([]);
      setImages([]);
    }
    setStudentSearch('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, achievement, reset]);

  const addStudent = (s) => {
    if (selectedStudents.some((item) => String(item._id) === String(s._id))) return;
    if (selectedStudents.length >= 20) return toast.error('Maximum 20 students per achievement');
    setSelectedStudents([...selectedStudents, s]);
    setStudentSearch('');
  };

  const removeStudent = (id) => {
    setSelectedStudents(selectedStudents.filter((s) => String(s._id) !== String(id)));
  };

  const onAddImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (images.length >= 5) return toast.error('Maximum 5 images allowed');
    if (file.size > 5 * 1024 * 1024) return toast.error('Image must be under 5 MB');
    try {
      const res = await upload({ file, kind: 'image' }).unwrap();
      setImages([...images, { url: res.url, name: res.name || file.name, mimeType: file.type }]);
    } catch (err) {
      toast.error(errMsg(err, 'Failed to upload photo'));
    } finally {
      e.target.value = '';
    }
  };

  const removeImage = (index) => {
    setImages(images.filter((_, i) => i !== index));
  };

  const onSubmit = async (values) => {
    if (!selectedStudents.length) {
      return toast.error('Please tag at least one student');
    }

    const payload = {
      ...values,
      students: selectedStudents.map((s) => s._id),
      images,
    };

    try {
      if (achievement) {
        await update({ id: achievement._id, ...payload }).unwrap();
        toast.success('Achievement updated successfully');
      } else {
        await create(payload).unwrap();
        toast.success('Student achievement posted & campus feed updated! 🏆');
      }
      onClose();
    } catch (err) {
      toast.error(errMsg(err, 'Failed to save achievement'));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={achievement ? 'Edit Achievement' : 'Post Student Achievement'}
      subtitle={
        isPrincipal
          ? 'Post achievements for any student in the college.'
          : `Post achievements for students in ${me?.department || 'your department'}.`
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit(onSubmit)} loading={creating || updating} icon={Trophy}>
            {achievement ? 'Save Changes' : 'Post Achievement'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Student picker */}
        <Field
          label="Featured Student(s) *"
          hint={
            isPrincipal
              ? 'Search and tag any active student across the college (up to 20)'
              : `Select students from ${me?.department || 'your department'}`
          }
        >
          {/* Selected chips */}
          <div className="flex flex-wrap gap-2 mb-2">
            {selectedStudents.map((s) => (
              <span
                key={s._id}
                className="chip inline-flex items-center gap-1.5 bg-primary-500/10 text-primary-900 dark:text-primary-100 border-primary-500/20"
              >
                <Avatar user={s} size="xs" />
                <span className="max-w-[140px] truncate font-bold text-xs">{s.name}</span>
                {s.rollNo && <span className="text-[10px] text-ink-muted">({s.rollNo})</span>}
                <button
                  type="button"
                  aria-label="Remove student"
                  onClick={() => removeStudent(s._id)}
                  className="rounded-full p-0.5 hover:bg-rose-500/20 hover:text-rose-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {selectedStudents.length === 0 && (
              <p className="text-xs text-rose-500 font-medium">At least one student must be selected.</p>
            )}
          </div>

          {/* Search box for students */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input
              type="text"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder="Search student by name or roll number..."
              className="input pl-10"
            />
            {searchingStudents && (
              <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-muted" />
            )}
          </div>

          {/* Dropdown search results */}
          {studentSearch.trim().length > 0 && (
            <div className="mt-1.5 max-h-48 divide-y divide-white/20 overflow-y-auto rounded-2xl border border-slate-200/80 bg-white/95 p-1 shadow-lg backdrop-blur dark:border-white/10 dark:bg-ink/95">
              {(studentResults?.items || []).length === 0 ? (
                <p className="p-3 text-center text-xs text-ink-muted">
                  No matching students found in {isPrincipal ? 'college' : me?.department}.
                </p>
              ) : (
                studentResults.items.map((s) => {
                  const already = selectedStudents.some((item) => String(item._id) === String(s._id));
                  return (
                    <button
                      key={s._id}
                      type="button"
                      disabled={already}
                      onClick={() => addStudent(s)}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-xl p-2 text-left text-xs transition-colors',
                        already
                          ? 'opacity-50 cursor-not-allowed bg-slate-50 dark:bg-white/5'
                          : 'hover:bg-primary-500/10'
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar user={s} size="sm" />
                        <div className="min-w-0 truncate">
                          <p className="font-bold text-ink dark:text-primary-100 truncate">{s.name}</p>
                          <p className="text-[11px] text-ink-muted truncate">
                            {s.rollNo ? `${s.rollNo} • ` : ''}
                            {s.department || ''}
                            {s.year ? ` • Year ${s.year}` : ''}
                          </p>
                        </div>
                      </div>
                      {already ? (
                        <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600">
                          <Check className="h-3.5 w-3.5" /> Added
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] font-bold text-primary-600">
                          <UserPlus className="h-3.5 w-3.5" /> Tag
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </Field>

        {/* Title */}
        <Input
          label="Achievement Title *"
          placeholder="e.g. 1st Prize in Smart India Hackathon 2026"
          error={errors.title}
          {...register('title', {
            required: 'Title is required',
            minLength: { value: 3, message: 'Title must be at least 3 characters' },
            maxLength: { value: 160, message: 'Title cannot exceed 160 characters' },
          })}
        />

        {/* Category, Level, Position */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Category *"
            options={ACHIEVEMENT_CATEGORIES}
            error={errors.category}
            {...register('category', { required: 'Category is required' })}
          />
          <Select
            label="Level *"
            options={ACHIEVEMENT_LEVELS}
            error={errors.level}
            {...register('level', { required: 'Level is required' })}
          />
          <Select
            label="Position / Rank *"
            options={ACHIEVEMENT_POSITIONS}
            error={errors.position}
            {...register('position')}
          />
        </div>

        {/* Event Name, Organizer */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Event / Competition Name"
            placeholder="e.g. Smart India Hackathon Grand Finale"
            error={errors.eventName}
            {...register('eventName', { maxLength: { value: 160, message: 'Max 160 characters' } })}
          />
          <Input
            label="Organized By"
            placeholder="e.g. Ministry of Education & AICTE"
            error={errors.organizer}
            {...register('organizer', { maxLength: { value: 160, message: 'Max 160 characters' } })}
          />
        </div>

        {/* Date and External Link */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Date of Achievement *"
            type="date"
            max={todayKey()}
            error={errors.achievedOn}
            {...register('achievedOn', { required: 'Date is required' })}
          />
          <Input
            label="External Link (Optional)"
            type="url"
            placeholder="https://news.example.com/... or linkedin.com/..."
            error={errors.externalLink}
            {...register('externalLink')}
          />
        </div>

        {/* Description */}
        <Textarea
          label="Description & Highlights *"
          rows={4}
          placeholder="Describe the achievement, project details, round stages, prize money, or special mentions..."
          error={errors.description}
          {...register('description', {
            required: 'Description is required',
            minLength: { value: 10, message: 'Description must be at least 10 characters' },
            maxLength: { value: 3000, message: 'Description cannot exceed 3000 characters' },
          })}
        />

        {/* Image uploads (up to 5) */}
        <Field label="Photos / Gallery (Optional, max 5 images)" hint="JPG, PNG, WebP up to 5 MB each">
          <div className="flex flex-wrap gap-2.5 mt-1.5">
            {images.map((img, idx) => (
              <div
                key={img.url + idx}
                className="group relative h-20 w-24 overflow-hidden rounded-2xl border border-slate-200/80 dark:border-white/10 shadow-sm"
              >
                <img src={img.url} alt={img.name || 'Achievement photo'} className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label="Remove image"
                  onClick={() => removeImage(idx)}
                  className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity hover:bg-rose-600 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}

            {images.length < 5 && (
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="flex h-20 w-24 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-primary-300/60 bg-white/40 text-ink-muted transition-colors hover:border-primary-500 hover:text-primary-600 dark:border-white/15 dark:bg-white/5"
              >
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-primary-500" />
                ) : (
                  <>
                    <ImagePlus className="h-5 w-5" />
                    <span className="text-[10px] font-bold">Add Photo</span>
                  </>
                )}
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={onAddImage}
          />
        </Field>
      </form>
    </Modal>
  );
}

