import { forwardRef, useRef, useState } from 'react';
import { FileText, ImagePlus, Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from './primitives';
import { useUploadFileMutation } from '../../services/api';
import { errMsg } from '../../utils/format';

export function Field({ label, error, hint, children, className }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-rose-500">{error.message || error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs muted">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef(function Input({ label, error, hint, className, icon: Icon, ...props }, ref) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      <div className="relative">
        {Icon && <Icon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />}
        <input ref={ref} className={cn('input', Icon && 'pl-11', error && 'input-error')} {...props} />
      </div>
    </Field>
  );
});

export const Textarea = forwardRef(function Textarea({ label, error, hint, className, rows = 4, ...props }, ref) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      <textarea ref={ref} rows={rows} className={cn('input resize-y', error && 'input-error')} {...props} />
    </Field>
  );
});

export const Select = forwardRef(function Select({ label, error, hint, className, options = [], placeholder, ...props }, ref) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      <select ref={ref} className={cn('input cursor-pointer appearance-none capitalize', error && 'input-error')} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => {
          const opt = typeof o === 'object' ? o : { value: o, label: String(o).replace('-', ' ') };
          return (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          );
        })}
      </select>
    </Field>
  );
});

/** Chip-style multi value input (Enter or comma to add). Use with RHF <Controller>. */
export function TagInput({ label, value = [], onChange, placeholder = 'Type and press Enter', error, hint, max = 25 }) {
  const [text, setText] = useState('');
  const add = () => {
    const v = text.trim().toLowerCase().replace(/,$/, '');
    if (v && !value.includes(v) && value.length < max) onChange([...value, v]);
    setText('');
  };
  return (
    <Field label={label} error={error} hint={hint}>
      <div className={cn('input flex min-h-[46px] flex-wrap items-center gap-1.5 py-2', error && 'input-error')}>
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-primary-500/10 px-2.5 py-1 text-xs font-semibold text-primary-600 dark:text-primary-200">
            {t}
            <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))} className="rounded-full hover:text-rose-500">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={add}
          placeholder={value.length ? '' : placeholder}
          className="min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-ink-muted"
        />
      </div>
    </Field>
  );
}

/**
 * Uploads a file through the secure /api/uploads endpoint and returns its URL.
 * Use with RHF <Controller>: value = url string.
 */
export function ImageUpload({ label, value, onChange, hint, aspect = 'aspect-[16/9]' }) {
  const inputRef = useRef(null);
  const [upload, { isLoading }] = useUploadFileMutation();

  const onFile = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error('Image must be under 5 MB');
    try {
      const res = await upload({ file, kind: 'image' }).unwrap();
      onChange(res.url);
    } catch (e) {
      toast.error(errMsg(e, 'Upload failed'));
    }
  };

  return (
    <Field label={label} hint={hint}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          'group relative flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed border-primary-300/60 bg-white/40 transition-all duration-300 hover:border-primary-400 hover:bg-white/70 dark:border-primary-400/30 dark:bg-white/5',
          aspect
        )}
      >
        {value ? (
          <>
            <img src={value} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              aria-label="Remove image"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              className="absolute right-3 top-3 rounded-full bg-black/50 p-1.5 text-white backdrop-blur hover:bg-rose-500"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 p-4 text-center text-sm muted">
            {isLoading ? <Loader2 className="h-6 w-6 animate-spin text-primary-500" /> : <ImagePlus className="h-7 w-7 text-primary-400 transition-transform duration-300 group-hover:scale-110" />}
            <span className="font-semibold">{isLoading ? 'Uploading…' : 'Click or drop an image'}</span>
            <span className="text-xs">JPG, PNG, WEBP · max 5 MB</span>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </Field>
  );
}

/** Multiple attachments (images or PDFs). value = [{url, name, mimeType}] */
export function AttachmentInput({ label, value = [], onChange, max = 5 }) {
  const inputRef = useRef(null);
  const [upload, { isLoading }] = useUploadFileMutation();

  const onFile = async (file) => {
    if (!file) return;
    try {
      const res = await upload({ file, kind: 'document' }).unwrap();
      onChange([...value, { url: res.url, name: res.name, mimeType: res.mimeType }]);
    } catch (e) {
      toast.error(errMsg(e, 'Upload failed'));
    }
  };

  return (
    <Field label={label} hint="PDF or images · max 5 MB each">
      <div className="flex flex-wrap gap-2">
        {value.map((a) => (
          <span key={a.url} className="chip">
            <FileText className="h-3.5 w-3.5" />
            <span className="max-w-[160px] truncate">{a.name}</span>
            <button type="button" aria-label="Remove attachment" onClick={() => onChange(value.filter((x) => x.url !== a.url))}>
              <X className="h-3 w-3 hover:text-rose-500" />
            </button>
          </span>
        ))}
        {value.length < max && (
          <button type="button" onClick={() => inputRef.current?.click()} className="chip border-dashed" disabled={isLoading}>
            {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            Add file
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </Field>
  );
}
