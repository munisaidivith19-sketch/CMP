import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ExternalLink, EyeOff, Globe2, ImagePlus, Lock, RotateCcw, School, Users, X } from 'lucide-react';
import { Badge, Button, Card, FullImage, cn } from '../../components/ui/primitives';
import { Field } from '../../components/ui/form';
import { safeHref, fmtClassDay } from '../../utils/format';
import { CERT_STATUS, INVITE_STATUS, PROJECT_IMAGE_ACCEPT, REVIEW_STATUS, precheckImage, publicationSummary } from '../../utils/skillWallet';
import { useSkillWalletUpload } from '../../services/skillWallet';
import { errMsg } from '../../utils/format';

export function StatusBadge({ kind, status }) {
  const map = { review: REVIEW_STATUS, cert: CERT_STATUS, invite: INVITE_STATUS }[kind] || {};
  const s = map[status] || { label: status, color: 'neutral' };
  return <Badge color={s.color}>{s.label}</Badge>;
}

const VIS_ICON = { private: Lock, college: School, public: Globe2 };
export function VisibilityBadge({ project }) {
  if (project?.hidden) return <Badge color="danger" icon={EyeOff}>Hidden</Badge>;
  const Icon = VIS_ICON[project?.visibility] || Lock;
  return (
    <Badge color={project?.visibility === 'public' ? 'success' : project?.visibility === 'college' ? 'info' : 'neutral'} icon={Icon}>
      {publicationSummary(project)}
    </Badge>
  );
}

/**
 * External links: validated on the server, re-checked here, and opened in a
 * new tab without referrer or opener access. Nothing is fetched or previewed.
 */
export function SafeExternalLink({ href, children, className }) {
  const safe = safeHref(href);
  if (!safe || !/^https:\/\//i.test(safe)) return <span className={className}>{children}</span>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className={cn('inline-flex items-center gap-1 font-semibold text-primary-700 hover:underline dark:text-primary-300', className)}>
      {children}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

export function Dates({ startedAt, endedAt, stage }) {
  return (
    <span>
      {fmtClassDay(startedAt)} – {stage === 'implemented' && endedAt ? fmtClassDay(endedAt) : 'ongoing'}
    </span>
  );
}

/** Card for a project the viewer is a member of. */
export function MyProjectCard({ p }) {
  return (
    <Card hover as={Link} to={`/skill-wallet/projects/${p._id}`} className="flex flex-col gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
      {p.imageUrl ? <FullImage src={p.imageUrl} alt="" fit className="h-36 w-full rounded-2xl" /> : <div className="flex h-36 items-center justify-center rounded-2xl bg-primary-500/5 text-sm muted">No image</div>}
      <div className="min-w-0">
        <p className="truncate font-bold">{p.title}</p>
        <p className="text-xs muted">{p.domain?.label} · {p.stage === 'implemented' ? 'Implemented' : 'Developing'} · {p.mode === 'team' ? `Team of ${p.memberCount}` : 'Solo'}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <StatusBadge kind="review" status={p.review?.status} />
        <VisibilityBadge project={p} />
        {!p.isOwner && <Badge color="neutral" icon={Users}>Member</Badge>}
      </div>
    </Card>
  );
}

/** Card for a published (gallery) project. */
export function GalleryCard({ p, to }) {
  return (
    <Card hover as={Link} to={to} className="flex flex-col gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
      {p.imageUrl ? <FullImage src={p.imageUrl} alt="" fit className="h-40 w-full rounded-2xl" /> : <div className="flex h-40 items-center justify-center rounded-2xl bg-primary-500/5 text-sm muted">No image</div>}
      <div className="min-w-0">
        <p className="line-clamp-2 font-bold">{p.title}</p>
        <p className="mt-0.5 text-xs muted">{p.domain?.label} · {p.department || '—'}{p.year ? ` · Year ${p.year}` : ''}</p>
      </div>
      <p className="line-clamp-3 text-sm muted">{p.description}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 text-xs">
        <Badge color="neutral">{p.stage === 'implemented' ? 'Implemented' : 'Developing'}</Badge>
        {p.facultyScore != null && <Badge color="success">Faculty score {p.facultyScore}</Badge>}
        <span className="muted">♥ {p.likeCount} · 💬 {p.commentCount}</span>
      </div>
    </Card>
  );
}

/**
 * Project image picker: uploads immediately (with progress) to the private
 * Skill Wallet store and hands back the asset id. Preview, retry and clear
 * error messages; the server validates the real image bytes.
 */
export function ProjectImagePicker({ label = 'Project image', currentUrl, onUploaded, onClear, maxMb = 5 }) {
  const upload = useSkillWalletUpload();
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const previewRef = useRef('');
  const [state, setState] = useState({ phase: 'idle', progress: 0, error: '', file: null, preview: '' });
  previewRef.current = state.preview;

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    []
  );

  const start = async (file) => {
    const problem = precheckImage(file, { maxMb });
    if (problem) return setState((s) => ({ ...s, phase: 'error', error: problem, file: null }));
    if (state.preview) URL.revokeObjectURL(state.preview);
    const preview = URL.createObjectURL(file);
    setState({ phase: 'uploading', progress: 0, error: '', file, preview });
    const form = new FormData();
    form.append('file', file);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await upload({ url: '/skill-wallet/assets/project-image', form, signal: ctrl.signal, onProgress: (progress) => setState((s) => ({ ...s, progress })) });
      setState((s) => ({ ...s, phase: 'done', progress: 100 }));
      onUploaded?.(res);
    } catch (e) {
      if (e?.status === 'ABORTED') return setState((s) => ({ ...s, phase: 'idle', progress: 0 }));
      setState((s) => ({ ...s, phase: 'error', error: errMsg(e, 'Upload failed') }));
    }
  };

  const shown = state.phase === 'idle' && !state.preview ? currentUrl : state.preview || currentUrl;
  return (
    <Field label={label} hint={`PNG, JPEG or WebP · max ${maxMb} MB · metadata is removed`}>
      <div className="relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed border-primary-300/60 bg-white/40 dark:border-primary-400/30 dark:bg-white/5">
        {shown ? <FullImage src={shown} alt="Selected project image" fit className="absolute inset-0 h-full w-full" /> : <ImagePlus className="h-8 w-8 text-primary-400" aria-hidden="true" />}
        {state.phase === 'uploading' && (
          <div className="absolute inset-x-4 bottom-4 rounded-2xl bg-black/60 p-3 text-white backdrop-blur" role="status" aria-live="polite">
            <div className="flex items-center justify-between text-xs font-bold">
              <span>Uploading…</span>
              <span>{state.progress}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-white transition-all" style={{ width: `${state.progress}%` }} />
            </div>
            <button type="button" className="mt-2 text-xs underline" onClick={() => abortRef.current?.abort()}>Cancel</button>
          </div>
        )}
      </div>
      {state.phase === 'error' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{state.error}</span>
          {state.file && <Button size="sm" variant="soft" icon={RotateCcw} type="button" onClick={() => start(state.file)}>Retry</Button>}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" icon={ImagePlus} disabled={state.phase === 'uploading'} onClick={() => inputRef.current?.click()}>
          {shown ? 'Replace image' : 'Choose image'}
        </Button>
        {shown && state.phase !== 'uploading' && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            icon={X}
            onClick={() => {
              if (state.preview) URL.revokeObjectURL(state.preview);
              setState({ phase: 'idle', progress: 0, error: '', file: null, preview: '' });
              onClear?.();
            }}
          >
            Remove
          </Button>
        )}
        {state.phase === 'done' && <span className="self-center text-xs font-semibold text-emerald-700 dark:text-emerald-300">Uploaded</span>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={PROJECT_IMAGE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) start(f);
        }}
      />
    </Field>
  );
}

/** Upload progress bar used by forms that send the file with their fields. */
export function UploadProgress({ progress, label = 'Uploading' }) {
  return (
    <div role="status" aria-live="polite" className="rounded-2xl bg-primary-500/10 p-3">
      <div className="flex justify-between text-xs font-bold">
        <span>{progress >= 100 ? 'Processing on the server…' : `${label}…`}</span>
        <span>{progress}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary-500/20">
        <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

export function SectionNote({ children, tone = 'info' }) {
  const tones = {
    info: 'bg-sky-500/10 text-sky-900 dark:text-sky-200',
    warning: 'bg-amber-500/10 text-amber-900 dark:text-amber-200',
  };
  return <p className={cn('rounded-2xl px-4 py-3 text-sm', tones[tone])}>{children}</p>;
}
