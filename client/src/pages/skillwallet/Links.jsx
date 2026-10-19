import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '../../components/ui/primitives';
import { Input, Select, Textarea } from '../../components/ui/form';
import { useCreateSwLinkMutation, useDeleteSwLinkMutation, useGetSwLinksQuery, useUpdateSwLinkMutation } from '../../services/skillWallet';
import { errMsg } from '../../utils/format';
import { LINK_PLATFORMS, VISIBILITY, checkHttpsUrl } from '../../utils/skillWallet';
import { SafeExternalLink } from './components';

const blank = { platform: 'github', displayName: '', url: '', description: '', visibility: 'college' };

function LinkForm({ open, onClose, link }) {
  const [create, { isLoading: c }] = useCreateSwLinkMutation();
  const [update, { isLoading: u }] = useUpdateSwLinkMutation();
  const [v, setV] = useState(blank);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (open) {
      setV(link ? { platform: link.platform, displayName: link.platform === 'other' ? link.displayName : '', url: link.url, description: link.description || '', visibility: link.visibility } : blank);
      setErrors({});
    }
  }, [open, link]);
  const set = (k) => (e) => {
    setV((s) => ({ ...s, [k]: e.target.value }));
    setErrors((s) => ({ ...s, [k]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (v.platform === 'other' && !v.displayName.trim()) errs.displayName = 'Name the platform';
    errs.url = v.url.trim() ? checkHttpsUrl(v.url) : 'Enter the profile link';
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    const body = { ...v, url: v.url.trim(), displayName: v.displayName.trim(), description: v.description.trim() };
    try {
      if (link) await update({ id: link._id, ...body }).unwrap();
      else await create(body).unwrap();
      toast.success('Link saved');
      onClose();
    } catch (err) {
      setErrors({ url: errMsg(err, 'Could not save the link') });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={link ? 'Edit link' : 'Add a profile link'}
      subtitle="Adding a link does not verify the account or its achievements."
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="sw-link-form" loading={c || u}>Save link</Button>
        </>
      }
    >
      <form id="sw-link-form" noValidate onSubmit={submit} className="grid gap-4">
        <Select label="Platform" options={LINK_PLATFORMS} keepCase value={v.platform} onChange={set('platform')} />
        {v.platform === 'other' && <Input label="Platform name *" value={v.displayName} onChange={set('displayName')} maxLength={60} error={errors.displayName} />}
        <Input label="Profile URL *" placeholder="https://…" inputMode="url" value={v.url} onChange={set('url')} error={errors.url} />
        <Textarea label="Description (optional)" rows={2} maxLength={300} value={v.description} onChange={set('description')} />
        <Select label="Who can see this link" options={VISIBILITY.map((o) => ({ value: o.value, label: `${o.label} — ${o.hint}` }))} keepCase value={v.visibility} onChange={set('visibility')} />
      </form>
    </Modal>
  );
}

export default function Links() {
  const { data, isLoading, error, refetch } = useGetSwLinksQuery();
  const [del, { isLoading: deleting }] = useDeleteSwLinkMutation();
  const [form, setForm] = useState({ open: false, link: null });
  const [removing, setRemoving] = useState(null);
  const visLabel = Object.fromEntries(VISIBILITY.map((o) => [o.value, o.label]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm muted">Coding profiles, portfolios and other platforms. You choose who sees each one.</p>
        <Button icon={Plus} onClick={() => setForm({ open: true, link: null })} disabled={data && data.items.length >= data.max}>Add link</Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.items.length ? (
        <Card><EmptyState icon={Link2} title="No links yet" text="Add GitHub, LinkedIn, LeetCode, TryHackMe and other profiles." /></Card>
      ) : (
        <Card className="divide-y divide-white/50 p-0 dark:divide-white/10">
          {data.items.map((l) => (
            <div key={l._id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-bold">{l.displayName}</p>
                <SafeExternalLink href={l.url} className="break-all text-sm">{l.url}</SafeExternalLink>
                {l.description && <p className="mt-1 text-sm muted">{l.description}</p>}
              </div>
              <Badge color={l.visibility === 'public' ? 'success' : l.visibility === 'college' ? 'info' : 'neutral'}>{visLabel[l.visibility]}</Badge>
              <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setForm({ open: true, link: l })} aria-label={`Edit ${l.displayName}`}>Edit</Button>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setRemoving(l)} aria-label={`Remove ${l.displayName}`}>Remove</Button>
            </div>
          ))}
        </Card>
      )}
      <LinkForm open={form.open} link={form.link} onClose={() => setForm({ open: false, link: null })} />
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        loading={deleting}
        title="Remove this link?"
        confirmText="Remove"
        onConfirm={async () => {
          try {
            await del(removing._id).unwrap();
            setRemoving(null);
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
