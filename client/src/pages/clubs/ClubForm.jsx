import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/primitives';
import { ImageUpload, Input, Select, TagInput, Textarea } from '../../components/ui/form';
import { useCreateClubMutation, useGetUsersQuery, useUpdateClubMutation } from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { CLUB_CATEGORIES } from '../../utils/constants';
import { errMsg } from '../../utils/format';

const blank = {
  name: '',
  tagline: '',
  description: '',
  category: 'technical',
  tags: [],
  contactEmail: '',
  logo: '',
  coverImage: '',
  facultyAdvisor: '',
  socialLinks: { website: '', instagram: '', linkedin: '' },
};

export default function ClubForm({ open, onClose, club, onSaved }) {
  const user = useSelector(selectUser);
  const isAdmin = user.role === 'admin';
  const [create, { isLoading: creating }] = useCreateClubMutation();
  const [update, { isLoading: updating }] = useUpdateClubMutation();
  const { data: faculty } = useGetUsersQuery({ role: 'faculty', limit: 50 }, { skip: !open });

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm({ defaultValues: blank });

  useEffect(() => {
    if (open)
      reset(
        club
          ? {
              ...blank,
              ...club,
              facultyAdvisor: club.facultyAdvisor?._id || '',
              socialLinks: { ...blank.socialLinks, ...club.socialLinks },
              logo: club.logo || '',
              coverImage: club.coverImage || '',
            }
          : blank
      );
  }, [open, club, reset]);

  const onSubmit = async (v) => {
    const payload = {
      name: v.name,
      tagline: v.tagline,
      description: v.description,
      category: v.category,
      tags: v.tags,
      contactEmail: v.contactEmail || undefined,
      logo: v.logo || undefined,
      coverImage: v.coverImage || undefined,
      socialLinks: v.socialLinks,
      ...(club ? (isAdmin ? { facultyAdvisor: v.facultyAdvisor || '' } : {}) : { facultyAdvisor: v.facultyAdvisor || undefined }),
    };
    try {
      const saved = club ? await update({ id: club._id, ...payload }).unwrap() : await create(payload).unwrap();
      toast.success(club ? 'Club updated' : saved.status === 'approved' ? 'Club created 🎉' : 'Request sent — an admin will review your club');
      onSaved?.(saved);
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
      title={club ? 'Edit club' : isAdmin ? 'Create a club' : 'Request a new club'}
      subtitle={!club && !isAdmin ? 'New clubs go live after an administrator approves them.' : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit(onSubmit)} loading={creating || updating}>
            {club ? 'Save changes' : isAdmin ? 'Create club' : 'Submit request'}
          </Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
        <Input label="Club name" error={errors.name} {...register('name', { required: 'Name is required', minLength: { value: 3, message: 'Too short' } })} />
        <Select label="Category" options={CLUB_CATEGORIES} {...register('category')} />
        <Input className="sm:col-span-2" label="Tagline" placeholder="One line that sums up your club" {...register('tagline', { maxLength: 140 })} />
        <Textarea
          className="sm:col-span-2"
          label="Description"
          rows={4}
          error={errors.description}
          {...register('description', { required: 'Description is required', minLength: { value: 20, message: 'At least 20 characters' } })}
        />
        <Controller name="tags" control={control} render={({ field }) => <TagInput label="Tags" value={field.value} onChange={field.onChange} />} />
        <Input label="Contact email" type="email" {...register('contactEmail')} />
        {(!club || isAdmin) && (
          <Select
            label="Faculty advisor"
            placeholder="None"
            options={(faculty?.items || []).map((f) => ({ value: f._id, label: f.name }))}
            {...register('facultyAdvisor')}
          />
        )}
        <Input label="Website" placeholder="https://" {...register('socialLinks.website')} />
        <Input label="Instagram" placeholder="https://instagram.com/…" {...register('socialLinks.instagram')} />
        <Input label="LinkedIn" placeholder="https://linkedin.com/…" {...register('socialLinks.linkedin')} />
        <Controller name="logo" control={control} render={({ field }) => <ImageUpload label="Logo" aspect="aspect-square max-w-[180px]" value={field.value} onChange={field.onChange} />} />
        <Controller name="coverImage" control={control} render={({ field }) => <ImageUpload label="Cover image" value={field.value} onChange={field.onChange} />} />
      </form>
    </Modal>
  );
}
