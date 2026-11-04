import { useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, ArrowUpCircle, Eye, GraduationCap, History, RotateCcw } from 'lucide-react';
import {
  useApplyPromotionMutation,
  useGetPromotionQuery,
  useGetPromotionsQuery,
  usePreviewPromotionMutation,
  useUndoPromotionMutation,
} from '../../services/api';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Tabs } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/form';
import { ACADEMIC_YEARS, DEPARTMENTS, SECTIONS, YEAR_LABELS } from '../../utils/constants';
import { errMsg, fmtDateTime } from '../../utils/format';

const FINAL_SEMESTER = 8;
const COLLEGE_PHRASE = 'PROMOTE ALL';

const SCOPES = [
  { value: 'section', label: 'One section' },
  { value: 'year', label: 'One year' },
  { value: 'department', label: 'Whole department' },
  { value: 'college', label: 'Whole college' },
  { value: 'student', label: 'Particular students' },
];
const SKIP_REASONS = {
  inactive: 'Account suspended',
  no_semester: 'No semester set',
  on_gate_pass: 'Out on a gate pass',
  changed_meanwhile: 'Changed by someone else',
};
const OUTCOMES = {
  promoted: { label: 'Promoted', color: 'success' },
  moved: { label: 'Moved', color: 'info' },
  graduated: { label: 'Graduated', color: 'primary' },
  held_back: { label: 'Held back', color: 'warning' },
  skipped: { label: 'Skipped', color: 'neutral' },
};

function scopeLabel(scope) {
  if (scope.kind === 'college') return 'Whole college';
  if (scope.kind === 'student') return `Particular students (${scope.rollNos?.length || 0})`;
  return [scope.department, scope.year && YEAR_LABELS[scope.year], scope.section && `Section ${scope.section}`].filter(Boolean).join(' · ');
}

const countsLine = (c) =>
  [
    c.promoted && `${c.promoted} promoted`,
    c.moved && `${c.moved} moved`,
    c.graduated && `${c.graduated} graduated`,
    c.heldBack && `${c.heldBack} held back`,
    c.skipped && `${c.skipped} skipped`,
  ]
    .filter(Boolean)
    .join(' · ') || 'No students';

/** The scope to send, or null while a required choice is missing. */
function buildScope(f) {
  if (f.kind === 'college') return { kind: 'college' };
  if (f.kind === 'student') {
    const rollNos = f.rollNos.split(/[\s,]+/).filter(Boolean);
    return rollNos.length ? { kind: 'student', rollNos } : null;
  }
  if (f.kind === 'department') return f.department ? { kind: 'department', department: f.department } : null;
  if (f.kind === 'year') return f.year ? { kind: 'year', year: Number(f.year), ...(f.department ? { department: f.department } : {}) } : null;
  return f.department && f.year && f.section ? { kind: 'section', department: f.department, year: Number(f.year), section: f.section } : null;
}

/** Hold-back and move lists for the server, from each row's choice. */
function buildChoices(choices) {
  const holdBack = [];
  const moves = [];
  for (const [student, value] of Object.entries(choices)) {
    if (value === 'hold') holdBack.push(student);
    else if (value.startsWith('sem:')) moves.push({ student, semester: Number(value.slice(4)) });
  }
  return { holdBack, moves };
}

function rowOptions(row) {
  const sem = row.from.semester;
  const options = [
    { value: 'default', label: sem >= FINAL_SEMESTER ? 'Mark graduated' : `Promote to Sem ${sem + 1}` },
    { value: 'hold', label: `Hold back in Sem ${sem}` },
  ];
  for (let s = 1; s <= FINAL_SEMESTER; s += 1) {
    if (s !== sem && s !== sem + 1) options.push({ value: `sem:${s}`, label: `Move to Sem ${s}` });
  }
  return options;
}

function PasswordModal({ open, title, onClose, onConfirm, loading, confirmText, children, canConfirm = true }) {
  const [password, setPassword] = useState('');
  const close = () => {
    setPassword('');
    onClose();
  };
  return (
    <Modal open={open} onClose={close} title={title} size="sm">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (password && canConfirm) onConfirm(password);
        }}
      >
        {children}
        <Input label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={loading} disabled={!password || !canConfirm}>
            {confirmText}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PromoteTab({ onDone }) {
  const [form, setForm] = useState({ kind: 'section', department: '', year: '', section: '', rollNos: '' });
  const [choices, setChoices] = useState({});
  const [plan, setPlan] = useState(null);
  const [scope, setScope] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [preview, { isLoading: previewing }] = usePreviewPromotionMutation();
  const [apply, { isLoading: applying }] = useApplyPromotionMutation();

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setPlan(null);
    setChoices({});
  };

  const load = async (nextScope, nextChoices) => {
    try {
      setPlan(await preview({ scope: nextScope, ...buildChoices(nextChoices) }).unwrap());
      setScope(nextScope);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const choose = (id, value) => {
    const next = { ...choices };
    if (value === 'default') delete next[id];
    else next[id] = value;
    setChoices(next);
    load(scope, next);
  };

  const closeConfirm = () => {
    setConfirming(false);
    setAcknowledged(false);
    setPhrase('');
  };

  const submit = async (password) => {
    try {
      const res = await apply({ scope, ...buildChoices(choices), password, ...(acknowledged ? { acknowledgeRecent: true } : {}) }).unwrap();
      toast.success(countsLine(res.counts));
      closeConfirm();
      setPlan(null);
      setChoices({});
      onDone();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const wanted = buildScope(form);
  const changing = plan ? plan.counts.promoted + plan.counts.moved + plan.counts.graduated : 0;
  const isCollege = scope?.kind === 'college';
  const canConfirm = (!plan?.recentlyPromoted || acknowledged) && (!isCollege || phrase === COLLEGE_PHRASE);

  return (
    <div className="space-y-5">
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select label="Who to promote" keepCase options={SCOPES} value={form.kind} onChange={set('kind')} />
          {['section', 'year', 'department'].includes(form.kind) && (
            <Select label={form.kind === 'year' ? 'Department (optional)' : 'Department'} placeholder="Select department" keepCase options={DEPARTMENTS} value={form.department} onChange={set('department')} />
          )}
          {['section', 'year'].includes(form.kind) && (
            <Select label="Year" placeholder="Select year" keepCase options={ACADEMIC_YEARS.map((y) => ({ value: String(y), label: YEAR_LABELS[y] }))} value={form.year} onChange={set('year')} />
          )}
          {form.kind === 'section' && <Select label="Section" placeholder="Select section" keepCase options={SECTIONS} value={form.section} onChange={set('section')} />}
          {form.kind === 'student' && (
            <Input className="sm:col-span-2 lg:col-span-3" label="Roll numbers" hint="Separate with spaces or commas." value={form.rollNos} onChange={set('rollNos')} />
          )}
        </div>
        <Button className="mt-4" icon={Eye} loading={previewing && !plan} disabled={!wanted} onClick={() => load(wanted, choices)}>
          Preview
        </Button>
        <p className="mt-2 text-xs muted">Preview changes nothing. You can review each student before anything is saved.</p>
      </Card>

      {plan && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-extrabold">{scopeLabel(scope)}</h3>
              <p className="text-sm muted">
                {plan.total} student{plan.total === 1 ? '' : 's'} · {countsLine(plan.counts)}
              </p>
            </div>
            <Button icon={ArrowUpCircle} disabled={!changing || previewing} onClick={() => setConfirming(true)}>
              Promote…
            </Button>
          </div>

          {plan.recentlyPromoted > 0 && (
            <p className="mt-4 flex items-start gap-2 rounded-2xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {plan.recentlyPromoted} of these students were already promoted in the last 30 days. Promoting again moves them up another semester.
            </p>
          )}
          {plan.classInCharges.length > 0 && (
            <div className="mt-4 rounded-2xl bg-sky-500/10 p-3 text-sm">
              <p className="font-semibold">These Class In-Charges are not changed automatically. Update their class afterwards:</p>
              <ul className="mt-1 list-inside list-disc">
                {plan.classInCharges.map((c) => (
                  <li key={c.id}>
                    {c.name}: {c.department} · Section {c.section} · Semester {c.inChargeSemester}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {plan.truncated && <p className="mt-4 text-sm muted">Showing the first {plan.rows.length} students. To hold back someone not listed here, choose a smaller group.</p>}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wide muted">
                  <th className="px-3 py-2">Student</th>
                  <th className="px-3 py-2">Now</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.student} className="border-t border-white/40 dark:border-white/10">
                    <td className="px-3 py-2">
                      <p className="font-bold">{r.name}</p>
                      <p className="text-xs muted">{r.rollNo || '—'}</p>
                    </td>
                    <td className="px-3 py-2 text-xs muted">
                      {r.department || '—'}
                      {r.from.section ? ` · Sec ${r.from.section}` : ''}
                      {r.from.semester ? ` · Sem ${r.from.semester}` : ''}
                    </td>
                    <td className="px-3 py-2">
                      <Badge color={OUTCOMES[r.outcome].color}>{OUTCOMES[r.outcome].label}</Badge>
                      {r.to?.semester && <span className="ml-2 text-xs muted">Sem {r.to.semester} · Year {r.to.year}</span>}
                      {r.reason && <span className="ml-2 text-xs muted">{SKIP_REASONS[r.reason] || r.reason}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {r.outcome !== 'skipped' && (
                        <select aria-label={`Action for ${r.name}`} className="input !py-1.5 text-sm" value={choices[r.student] || 'default'} disabled={previewing} onChange={(e) => choose(r.student, e.target.value)}>
                          {rowOptions(r).map((o) => (
                            <option key={o.value} value={o.value} className="bg-white text-ink dark:bg-[#131427] dark:text-primary-50">
                              {o.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!plan.rows.length && <p className="p-4 text-center text-sm muted">No students found for this selection.</p>}
          </div>
        </Card>
      )}

      <PasswordModal open={confirming} title="Confirm promotion" onClose={closeConfirm} onConfirm={submit} loading={applying} confirmText="Promote" canConfirm={canConfirm}>
        {plan && (
          <>
            <p className="text-sm">
              <b>{scopeLabel(scope)}</b>: {countsLine(plan.counts)}.
            </p>
            {plan.counts.graduated > 0 && <p className="text-sm muted">Graduating students become alumni and must sign in again.</p>}
            <p className="text-sm muted">You can undo this afterwards from History.</p>
            {plan.recentlyPromoted > 0 && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                Yes, promote the {plan.recentlyPromoted} recently promoted student{plan.recentlyPromoted === 1 ? '' : 's'} again.
              </label>
            )}
            {isCollege && <Input label={`Type ${COLLEGE_PHRASE} to continue`} value={phrase} onChange={(e) => setPhrase(e.target.value)} />}
          </>
        )}
      </PasswordModal>
    </div>
  );
}

function BatchDetails({ id, onClose }) {
  const { data, isLoading, error } = useGetPromotionQuery(id);
  return (
    <Modal open onClose={onClose} title="Promotion details" size="lg">
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : error ? (
        <ErrorState error={error} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <tbody>
              {data.items.map((i) => (
                <tr key={i.student} className="border-t border-white/40 first:border-0 dark:border-white/10">
                  <td className="px-2 py-2">
                    <p className="font-bold">{i.name}</p>
                    <p className="text-xs muted">{i.rollNo || '—'}</p>
                  </td>
                  <td className="px-2 py-2">
                    <Badge color={OUTCOMES[i.outcome].color}>{OUTCOMES[i.outcome].label}</Badge>
                  </td>
                  <td className="px-2 py-2 text-xs muted">
                    {i.from?.semester ? `Sem ${i.from.semester}` : '—'}
                    {i.to?.semester ? ` → Sem ${i.to.semester}` : i.outcome === 'graduated' ? ' → Alumni' : ''}
                    {i.reason ? ` · ${SKIP_REASONS[i.reason] || i.reason}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function HistoryTab() {
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState(null);
  const [undoing, setUndoing] = useState(null);
  const { data, isLoading, error, refetch } = useGetPromotionsQuery({ page, limit: 10 });
  const [undo, { isLoading: saving }] = useUndoPromotionMutation();

  const submit = async (password) => {
    try {
      const res = await undo({ id: undoing.id, password }).unwrap();
      const { restored, notRestored } = res.undoResult;
      toast.success(`${restored} student${restored === 1 ? '' : 's'} restored${notRestored ? `. ${notRestored} left as they were because they changed since` : ''}`);
      setUndoing(null);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (isLoading) return <Skeleton className="h-40" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data.items.length) return <EmptyState icon={History} title="No promotions yet" text="Promotions you run will be listed here." />;

  return (
    <div className="space-y-3">
      {data.items.map((b) => (
        <Card key={b.id} className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-extrabold">
              {scopeLabel(b.scope)} {b.status === 'undone' && <Badge color="neutral">Undone</Badge>}
            </p>
            <p className="text-sm muted">{countsLine(b.counts)}</p>
            <p className="text-xs muted">
              {fmtDateTime(b.createdAt)}
              {b.status === 'undone' && ` · Undone ${fmtDateTime(b.undoneAt)}: ${b.undoResult?.restored ?? 0} restored${b.undoResult?.notRestored ? `, ${b.undoResult.notRestored} not restored` : ''}`}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" icon={Eye} onClick={() => setViewing(b.id)}>
              Details
            </Button>
            {b.status === 'applied' && (
              <Button size="sm" variant="danger" icon={RotateCcw} onClick={() => setUndoing(b)}>
                Undo
              </Button>
            )}
          </div>
        </Card>
      ))}
      <Pagination page={data.page} pages={data.pages} onChange={setPage} />
      {viewing && <BatchDetails id={viewing} onClose={() => setViewing(null)} />}
      <PasswordModal open={Boolean(undoing)} title="Undo this promotion" onClose={() => setUndoing(null)} onConfirm={submit} loading={saving} confirmText="Undo promotion">
        {undoing && (
          <>
            <p className="text-sm">
              <b>{scopeLabel(undoing.scope)}</b>: {countsLine(undoing.counts)}.
            </p>
            <p className="text-sm muted">Students go back to their earlier semester and year. Anyone changed since then is left as they are.</p>
          </>
        )}
      </PasswordModal>
    </div>
  );
}

/** Principal only: move students to the next semester, graduate final-semester students, and undo. */
export default function Promotions() {
  const [tab, setTab] = useState('promote');
  return (
    <div className="space-y-5">
      <PageHeader icon={GraduationCap} title="Student promotions" subtitle="Move students to the next semester. The year follows the semester, and students finishing Semester 8 are marked graduated." />
      <Tabs
        tabs={[
          { value: 'promote', label: 'Promote' },
          { value: 'history', label: 'History' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'promote' ? <PromoteTab onDone={() => setTab('history')} /> : <HistoryTab />}
    </div>
  );
}
