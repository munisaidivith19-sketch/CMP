import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { CalendarDays, MapPin, PackageCheck, PackageSearch, Plus, Search } from 'lucide-react';
import { useGetLostFoundQuery, useReportLostFoundMutation } from '../../services/api';
import { Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, StatCard, Tabs, cn } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { ImageUpload, Input, Select, Textarea } from '../../components/ui/form';
import { StatusBadge } from '../../components/insights';
import { errMsg, fmtDateTime, timeAgo, titleCase, toLocalInput } from '../../utils/format';

export const LF_CATEGORIES = ['electronics', 'documents', 'clothing', 'accessories', 'books', 'keys', 'wallet', 'bag', 'sports', 'other'];
export const LF_STATUSES = ['lost', 'found', 'possible_match', 'under_verification', 'returned', 'closed'];

export function ReportItemModal({ open, onClose, defaultType = 'lost' }) {
  const [report, { isLoading }] = useReportLostFoundMutation();
  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm();
  const type = watch('type');

  // Fresh form each time the dialog opens, preset to "lost" or "found".
  useEffect(() => {
    if (open) {
      reset({ type: defaultType, itemName: '', category: 'electronics', description: '', location: '', dateTime: toLocalInput(new Date()), additionalDetails: '', contactMethod: 'email', photo: '' });
    }
  }, [open, defaultType, reset]);

  const onSubmit = async (v) => {
    try {
      await report({ ...v, dateTime: new Date(v.dateTime).toISOString(), photo: v.photo || undefined }).unwrap();
      toast.success(v.type === 'lost' ? 'Lost item reported — we’ll let you know about possible matches' : 'Thanks for reporting a found item!');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Report an item"
      subtitle="Reports are visible to everyone on campus; your contact details are shared only with staff."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isLoading} onClick={handleSubmit(onSubmit)}>
            Submit report
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-3 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2 flex gap-2" role="radiogroup" aria-label="Report type">
          {['lost', 'found'].map((t) => (
            <label key={t} className={cn('chip cursor-pointer', type === t && 'chip-active')}>
              <input type="radio" value={t} className="sr-only" {...register('type')} />
              {t === 'lost' ? 'I lost something' : 'I found something'}
            </label>
          ))}
        </div>
        <Input label="Item" placeholder="e.g. Black HP laptop charger" maxLength={120} error={errors.itemName} {...register('itemName', { required: 'What is the item?', minLength: { value: 2, message: 'Too short' } })} />
        <Select label="Category" options={LF_CATEGORIES.map((c) => ({ value: c, label: titleCase(c) }))} {...register('category')} />
        <Input label={type === 'lost' ? 'Last seen at' : 'Found at'} placeholder="e.g. Library, 2nd floor" maxLength={200} error={errors.location} {...register('location', { required: 'Location is required' })} />
        <Input
          label="When"
          type="datetime-local"
          max={toLocalInput(new Date())}
          error={errors.dateTime}
          {...register('dateTime', { required: 'Required', validate: (v) => new Date(v) <= new Date(Date.now() + 5 * 60000) || 'Cannot be in the future' })}
        />
        <Textarea label="Description" className="sm:col-span-2" rows={3} maxLength={1000} placeholder="Colour, brand, marks — anything that helps identify it" {...register('description')} />
        <Select
          label="How staff can reach you"
          options={[
            { value: 'email', label: 'Email' },
            { value: 'phone', label: 'Phone' },
            { value: 'in_person', label: 'In person' },
          ]}
          {...register('contactMethod')}
        />
        <Input label="Additional details" maxLength={500} placeholder={type === 'found' ? 'e.g. Handed to the security desk' : 'Optional'} {...register('additionalDetails')} />
        <div className="sm:col-span-2">
          <Controller control={control} name="photo" render={({ field }) => <ImageUpload label="Photo (optional)" value={field.value} onChange={field.onChange} aspect="aspect-[3/1]" />} />
        </div>
      </form>
    </Modal>
  );
}

function ItemCard({ item }) {
  return (
    <Link to={`/lost-found/${item._id}`} className="group block animate-fade-up">
      <Card hover className="flex h-full flex-col overflow-hidden p-0">
        <div className={cn('relative h-36 overflow-hidden bg-gradient-to-br', item.type === 'lost' ? 'from-rose-300 to-orange-300' : 'from-sky-300 to-emerald-300')}>
          {item.photo ? (
            <img src={item.photo} alt="" className="h-full w-full object-cover transition-transform duration-700 ease-smooth group-hover:scale-105" loading="lazy" />
          ) : (
            <div className="flex h-full items-center justify-center text-white/80">
              {item.type === 'lost' ? <PackageSearch className="h-10 w-10" /> : <PackageCheck className="h-10 w-10" />}
            </div>
          )}
          <span className={cn('absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase text-white', item.type === 'lost' ? 'bg-rose-500' : 'bg-sky-500')}>{item.type}</span>
        </div>
        <div className="flex flex-1 flex-col p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-1 font-bold">{item.itemName}</p>
            <StatusBadge status={item.status} />
          </div>
          <p className="mt-1 flex items-center gap-1 text-xs muted">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{item.location}</span>
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-xs muted">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            {fmtDateTime(item.dateTime)}
          </p>
          <p className="mt-auto pt-3 text-[11px] muted">
            {titleCase(item.category)} · by {item.isMine ? 'you' : item.reporter?.name} · {timeAgo(item.createdAt)}
          </p>
        </div>
      </Card>
    </Link>
  );
}

export default function LostFound() {
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [report, setReport] = useState(null);

  const params = {
    page,
    limit: 12,
    search: q || undefined,
    category: category || undefined,
    status: status || undefined,
    ...(tab === 'lost' || tab === 'found' ? { type: tab } : {}),
    ...(tab === 'mine' ? { mine: 'true' } : {}),
  };
  const { data, isLoading, isFetching, error, refetch } = useGetLostFoundQuery(params);
  const reset = (fn) => (v) => {
    fn(v);
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        icon={PackageSearch}
        title="Lost & found"
        subtitle="Report lost or found items. Possible matches are suggestions — staff verify ownership before any handover."
        actions={
          <>
            <Button variant="outline" icon={PackageCheck} onClick={() => setReport('found')}>
              I found something
            </Button>
            <Button icon={Plus} onClick={() => setReport('lost')}>
              Report lost item
            </Button>
          </>
        }
      />

      {data?.summary && (
        <div className="grid gap-5 sm:grid-cols-3">
          <StatCard icon={PackageSearch} label="Lost · open" value={data.summary.lostOpen} gradient="from-rose-400 to-orange-500" />
          <StatCard icon={PackageCheck} label="Found · open" value={data.summary.foundOpen} gradient="from-sky-400 to-blue-500" delay={60} />
          <StatCard icon={PackageCheck} label="Resolved" value={data.summary.resolved} gradient="from-emerald-400 to-teal-500" delay={120} />
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Tabs
          tabs={[
            { value: 'all', label: 'All' },
            { value: 'lost', label: 'Lost' },
            { value: 'found', label: 'Found' },
            { value: 'mine', label: 'My reports' },
          ]}
          value={tab}
          onChange={reset(setTab)}
        />
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Search items or places…" aria-label="Search items" className="input pl-11" />
        </div>
        <select aria-label="Category" className="input lg:w-44" value={category} onChange={(e) => reset(setCategory)(e.target.value)}>
          <option value="">All categories</option>
          {LF_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {titleCase(c)}
            </option>
          ))}
        </select>
        <select aria-label="Status" className="input lg:w-44" value={status} onChange={(e) => reset(setStatus)(e.target.value)}>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="">Any status</option>
          {LF_STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.items.length ? (
        <Card>
          <EmptyState
            icon={PackageSearch}
            title={q || category ? 'Nothing matches your filters' : tab === 'mine' ? 'You haven’t reported anything' : 'No items here'}
            text="Lost something? Report it and we’ll look for possible matches."
            action={<Button icon={Plus} onClick={() => setReport('lost')}>Report lost item</Button>}
          />
        </Card>
      ) : (
        <>
          <div className={cn('grid gap-5 sm:grid-cols-2 xl:grid-cols-4', isFetching && 'opacity-70')}>
            {data.items.map((i) => (
              <ItemCard key={i._id} item={i} />
            ))}
          </div>
          <Pagination page={data.pagination.page} pages={data.pagination.pages} onChange={setPage} />
        </>
      )}
      <ReportItemModal open={Boolean(report)} defaultType={report || 'lost'} onClose={() => setReport(null)} />
    </div>
  );
}
