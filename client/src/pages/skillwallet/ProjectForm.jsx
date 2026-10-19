import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/primitives';
import { Field, Input, Select, TagInput, Textarea } from '../../components/ui/form';
import { useCreateSwProjectMutation, useGetSwConfigQuery, useUpdateSwProjectMutation } from '../../services/skillWallet';
import { errMsg } from '../../utils/format';
import { DRIVE_HOSTS, STAGES, checkGithubRepo, checkHttpsUrl, checkProjectDates, checkSkills, normaliseSkills, toDayInput, todayDay } from '../../utils/skillWallet';
import { ProjectImagePicker, SectionNote } from './components';

const initial = (p) => ({
  title: p?.title || '',
  domain: p?.domain?.key || '',
  description: p?.description || '',
  skills: p?.skills || [],
  stage: p?.stage || 'developing',
  startedAt: toDayInput(p?.startedAt),
  endedAt: toDayInput(p?.endedAt),
  githubUrl: p?.githubUrl || '',
  driveUrl: p?.driveUrl || '',
  mode: p?.mode || 'solo',
});

/**
 * Create / edit a project. The end date exists only for implemented projects:
 * the field is hidden for "developing" and the payload sends endedAt: null.
 * The server enforces the same rules for direct API calls.
 */
export default function ProjectForm({ open, onClose, project, onSaved }) {
  const editing = Boolean(project);
  const { data: config } = useGetSwConfigQuery();
  const [create, { isLoading: creating }] = useCreateSwProjectMutation();
  const [update, { isLoading: updating }] = useUpdateSwProjectMutation();
  const [v, setV] = useState(() => initial(project));
  const [image, setImage] = useState(undefined); // undefined = unchanged, null = remove, id = new upload
  const [errors, setErrors] = useState({});
  const today = todayDay();

  const domains = useMemo(() => {
    const list = (config?.domains || []).filter((d) => d.active !== false || d.key === v.domain);
    return list.map((d) => ({ value: d.key, label: d.label }));
  }, [config, v.domain]);

  const set = (k) => (e) => {
    const value = e?.target ? e.target.value : e;
    setV((s) => ({ ...s, [k]: value }));
    setErrors((s) => ({ ...s, [k]: undefined }));
  };

  const validate = () => {
    const errs = {};
    if (v.title.trim().length < 3) errs.title = 'Give the project a title (at least 3 characters)';
    if (!v.domain) errs.domain = 'Choose a domain';
    if (v.description.trim().length < 10) errs.description = 'Describe the project in at least 10 characters';
    const skills = normaliseSkills(v.skills);
    const skillErr = checkSkills(skills);
    if (skillErr) errs.skills = skillErr;
    const { errors: dateErrs, payload } = checkProjectDates(v, today);
    Object.assign(errs, dateErrs);
    const gh = checkGithubRepo(v.githubUrl);
    if (gh) errs.githubUrl = gh;
    const dr = checkHttpsUrl(v.driveUrl, { hosts: DRIVE_HOSTS });
    if (dr) errs.driveUrl = dr;
    return { errs, body: { ...v, title: v.title.trim(), description: v.description.trim(), skills, ...payload, githubUrl: v.githubUrl.trim(), driveUrl: v.driveUrl.trim() } };
  };

  const submit = async (e) => {
    e.preventDefault();
    const { errs, body } = validate();
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return toast.error('Please fix the highlighted fields');
    if (image !== undefined) body.imageAssetId = image;
    if (editing && !project.canManage) delete body.mode;
    try {
      const saved = editing ? await update({ id: project._id, ...body }).unwrap() : await create(body).unwrap();
      toast.success(editing ? (saved.revision > project.revision ? 'Saved as a new revision' : 'Project saved') : 'Project created (private)');
      onSaved?.(saved);
      onClose();
    } catch (err) {
      toast.error(errMsg(err, 'Could not save the project'));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? 'Edit project' : 'New project'}
      subtitle={editing ? 'Material changes create a new revision that must be reviewed again before the gallery shows it.' : 'New projects are private until you choose to publish them.'}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="sw-project-form" loading={creating || updating}>{editing ? 'Save changes' : 'Create project'}</Button>
        </>
      }
    >
      <form id="sw-project-form" noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Input className="sm:col-span-2" label="Project title *" value={v.title} onChange={set('title')} maxLength={140} error={errors.title} required />
        <Select label="Project domain *" placeholder="Choose a domain" options={domains} keepCase value={v.domain} onChange={set('domain')} error={errors.domain} required />
        <Field label="Project mode *" error={errors.mode} hint={editing && !project.canManage ? 'Only the owner can change the mode' : 'Team projects invite teammates by roll number'}>
          <div className="flex gap-2" role="radiogroup" aria-label="Project mode">
            {[
              { value: 'solo', label: 'Solo' },
              { value: 'team', label: 'Team' },
            ].map((o) => (
              <label key={o.value} className={`chip cursor-pointer ${v.mode === o.value ? 'chip-active' : ''}`}>
                <input type="radio" name="mode" value={o.value} checked={v.mode === o.value} onChange={set('mode')} disabled={editing && !project.canManage} className="sr-only" />
                {o.label}
              </label>
            ))}
          </div>
        </Field>
        <Textarea className="sm:col-span-2" label="Project description *" rows={5} maxLength={5000} value={v.description} onChange={set('description')} error={errors.description} required />
        <div className="sm:col-span-2">
          <TagInput label="Skills learned" value={v.skills} onChange={set('skills')} max={20} placeholder="e.g. react, esp32 — press Enter" error={errors.skills} hint="Up to 20 skills" />
        </div>

        <Field label="Development stage *" className="sm:col-span-2">
          <div className="flex gap-2" role="radiogroup" aria-label="Development stage">
            {STAGES.map((o) => (
              <label key={o.value} className={`chip cursor-pointer ${v.stage === o.value ? 'chip-active' : ''}`}>
                <input
                  type="radio"
                  name="stage"
                  value={o.value}
                  checked={v.stage === o.value}
                  className="sr-only"
                  onChange={(e) => {
                    const stage = e.target.value;
                    // Switching back to "developing" clears the end date.
                    setV((s) => ({ ...s, stage, endedAt: stage === 'developing' ? '' : s.endedAt }));
                    setErrors((s) => ({ ...s, endedAt: undefined }));
                  }}
                />
                {o.label}
              </label>
            ))}
          </div>
        </Field>
        <Input type="date" label="Started on *" max={today} value={v.startedAt} onChange={set('startedAt')} error={errors.startedAt} required />
        {v.stage === 'implemented' ? (
          <Input type="date" label="Ended on *" min={v.startedAt || undefined} max={today} value={v.endedAt} onChange={set('endedAt')} error={errors.endedAt} required />
        ) : (
          <p className="self-end pb-3 text-xs muted">No end date while the project is developing.</p>
        )}

        <div className="sm:col-span-2">
          <ProjectImagePicker currentUrl={image === null ? null : project?.imageUrl} onUploaded={(a) => setImage(a.assetId)} onClear={() => setImage(null)} />
        </div>
        <Input label="GitHub repository (optional)" placeholder="https://github.com/owner/repository" value={v.githubUrl} onChange={set('githubUrl')} error={errors.githubUrl} inputMode="url" />
        <Input label="Google Drive link (optional)" placeholder="https://drive.google.com/…" value={v.driveUrl} onChange={set('driveUrl')} error={errors.driveUrl} inputMode="url" />
        {v.driveUrl && (
          <div className="sm:col-span-2">
            <SectionNote tone="warning">VEXON does not open or check Drive links. Make sure the sharing settings let reviewers open it — and that nothing private is shared publicly.</SectionNote>
          </div>
        )}
      </form>
    </Modal>
  );
}
