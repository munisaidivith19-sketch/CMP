import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  useGetMyTeachingAssignmentsQuery,
  useGetSubjectsQuery,
  useUpdateStudyMaterialMutation,
  useUploadStudyMaterialMutation,
} from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/primitives';
import { DocumentUpload, Select, Textarea, Input } from '../../components/ui/form';
import { DEPARTMENTS, SECTIONS, STUDY_MATERIAL_CATEGORY_LABELS } from '../../utils/constants';
import { errMsg, titleCase } from '../../utils/format';

const CATEGORY_OPTIONS = Object.entries(STUDY_MATERIAL_CATEGORY_LABELS).map(([value, label]) => ({ value, label }));

/**
 * Upload/edit form. What academic scope can be picked is entirely different
 * per role, matching what the backend will actually allow:
 * - Faculty choose only from their own current teaching assignments — the
 *   department/section/semester/subject fields never become free inputs.
 * - HOD have their department locked, then pick any subject in it.
 * - Admin pick freely, college-wide.
 */
export default function UploadMaterialModal({ open, onClose, material }) {
  const me = useSelector(selectUser);
  const isFaculty = me.role === 'faculty';
  const isHod = me.role === 'hod';
  const isEdit = Boolean(material);

  const { data: assignments = [] } = useGetMyTeachingAssignmentsQuery(undefined, { skip: !isFaculty || !open });
  const { register, handleSubmit, reset, watch, setValue, control, formState: { errors } } = useForm();
  const [upload, { isLoading: uploading }] = useUploadStudyMaterialMutation();
  const [update, { isLoading: updating }] = useUpdateStudyMaterialMutation();

  const department = isHod ? me.department : watch('department');
  const { data: subjects = [] } = useGetSubjectsQuery(
    department ? { department, semester: watch('semester') || undefined } : undefined,
    { skip: (isHod ? false : !department) || !open || isFaculty }
  );

  useEffect(() => {
    if (!open) return;
    reset({
      assignmentKey: '',
      title: material?.title || '',
      description: material?.description || '',
      category: material?.category || 'notes',
      department: material?.department || (isHod ? me.department : ''),
      section: material?.section || '',
      semester: material?.semester || '',
      subjectId: material?.subject?._id || material?.subject || '',
      file: material?.file || null,
    });
  }, [open, material, isHod, me.department, reset]);

  const applyAssignment = (key) => {
    const a = assignments.find((x) => `${x.department}|${x.section}|${x.semester}|${x.subject._id}` === key);
    if (!a) return;
    setValue('assignmentKey', key);
    setValue('department', a.department);
    setValue('section', a.section);
    setValue('semester', a.semester);
    setValue('subjectId', a.subject._id);
  };

  const onSubmit = async (v) => {
    if (!v.file?.url) return toast.error('Choose a file to upload');
    if (!v.subjectId) return toast.error(isFaculty ? 'Choose a teaching assignment' : 'Choose a subject');
    const body = {
      title: v.title.trim(),
      description: v.description?.trim() || undefined,
      category: v.category,
      subjectId: v.subjectId,
      department: isHod ? undefined : v.department, // HOD's is always forced server-side anyway
      section: v.section || '',
      semester: Number(v.semester),
      file: v.file,
    };
    try {
      if (isEdit) await update({ id: material._id, ...body }).unwrap();
      else await upload(body).unwrap();
      toast.success(isEdit ? 'Material updated' : 'Material uploaded');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit material' : 'Upload material'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={uploading || updating} onClick={handleSubmit(onSubmit)}>
            {isEdit ? 'Save changes' : 'Upload'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {isFaculty && !isEdit && (
          <Select
            label="Teaching assignment"
            placeholder={assignments.length ? 'Choose the class this material is for' : 'No teaching assignments on your timetable yet'}
            options={assignments.map((a) => ({
              value: `${a.department}|${a.section}|${a.semester}|${a.subject._id}`,
              label: `${a.subject.name} — ${a.subject.code} · ${a.department} · Sec ${a.section} · Sem ${a.semester}`,
            }))}
            value={watch('assignmentKey')}
            onChange={(e) => applyAssignment(e.target.value)}
            error={!watch('subjectId') && errors.subjectId}
            hint={!assignments.length ? 'You can only upload for classes you currently teach — check the Timetable page.' : undefined}
          />
        )}
        {isFaculty && isEdit && (
          <p className="text-sm muted">
            {material.subjectName} — {material.subjectCode} · {material.department} · Sec {material.section} · Sem {material.semester}
          </p>
        )}

        {!isFaculty && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Department"
              options={isHod ? [me.department] : DEPARTMENTS}
              disabled={isHod}
              {...register('department', { required: true })}
            />
            <Select
              label="Section"
              placeholder="Whole class (no section)"
              options={SECTIONS}
              {...register('section')}
            />
            <Input label="Semester" type="number" min={1} max={12} error={errors.semester} {...register('semester', { required: 'Required', min: 1, max: 12 })} />
            <Select
              label="Subject"
              placeholder={subjects.length ? 'Choose subject' : 'No subjects for this department/semester'}
              options={subjects.map((s) => ({ value: s._id, label: `${s.name} — ${s.code}` }))}
              error={errors.subjectId}
              {...register('subjectId', { required: 'Choose a subject' })}
            />
          </div>
        )}

        <Select label="Category" options={CATEGORY_OPTIONS} {...register('category')} />
        <Input label="Title" error={errors.title} {...register('title', { required: 'Required', minLength: { value: 2, message: 'Too short' } })} />
        <Textarea label="Description (optional)" rows={3} maxLength={1000} {...register('description')} />
        <Controller name="file" control={control} render={({ field }) => <DocumentUpload label="File" value={field.value} onChange={field.onChange} />} />
      </form>
    </Modal>
  );
}
