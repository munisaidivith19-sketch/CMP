import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Search, Send, X } from 'lucide-react';
import { useCreateConversationMutation, useGetGroupClassQuery, useGetPeopleFiltersQuery, useGetUsersQuery } from '../../services/api';
import { Avatar, Button, Skeleton, cn } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Input, Select, Textarea } from '../../components/ui/form';
import { ROLE_LABELS, STUDENT_ROLES, YEAR_LABELS } from '../../utils/constants';
import { errMsg } from '../../utils/format';

const CATEGORIES = [
  { value: 'custom', label: 'CUSTOM', hint: 'Students of your department — pick from any years and sections into one group.' },
  { value: 'academic', label: 'ACADEMICS', hint: 'One class of your department: choose the year and section, then select its students.' },
  { value: 'faculty', label: 'FACULTY', hint: 'Faculty from anywhere on campus.' },
];
const STAFF = ['faculty', 'hod'];
const sameId = (a, b) => String(a?._id || a) === String(b?._id || b);

/**
 * HOD group builder. The group is a REQUEST: it goes to the principal with the
 * reason given here, and only goes live once approved.
 *   CUSTOM    — students of the HOD's department, from several classes
 *   ACADEMICS — the students of ONE class of the HOD's department
 *   FACULTY   — faculty from anywhere on campus
 * The server re-checks every member against these rules (and again when the
 * principal approves) — these lists only offer what it accepts.
 */
export default function HodGroupModal({ open, onClose }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('custom');
  const [reason, setReason] = useState('');
  const [year, setYear] = useState('');
  const [section, setSection] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]);
  const [create, { isLoading }] = useCreateConversationMutation();
  const { data: filters } = useGetPeopleFiltersQuery(undefined, { skip: !open });
  const wantsClass = category !== 'faculty';
  const { data: cls, isFetching: loadingClass } = useGetGroupClassQuery({ year, section }, { skip: !open || !wantsClass || !year || !section });
  // Students search: the server's picker scope for an HOD is their own department.
  const searchRole = category === 'faculty' ? undefined : 'student';
  const searchable = category !== 'academic';
  const { data: found, isFetching: searching } = useGetUsersQuery(
    { q: q || undefined, limit: 20, context: 'picker', ...(searchRole ? { role: searchRole } : {}) },
    { skip: !open || !searchable || q.trim().length < 2 }
  );

  useEffect(() => {
    if (!open) {
      setName('');
      setCategory('custom');
      setReason('');
      setYear('');
      setSection('');
      setQ('');
      setPicked([]);
    }
  }, [open]);

  // Changing the type drops members the new type does not allow: Faculty keeps
  // faculty, Custom keeps students, Academics starts again from one class.
  const changeCategory = (value) => {
    setCategory(value);
    setQ('');
    if (value === 'faculty') setPicked((p) => p.filter((u) => STAFF.includes(u.role)));
    else if (value === 'custom') setPicked((p) => p.filter((u) => STUDENT_ROLES.includes(u.role)));
    else setPicked([]);
  };
  // An Academics group is one class: picking another class replaces the students.
  const changeClass = (nextYear, nextSection) => {
    setYear(nextYear);
    setSection(nextSection);
    if (category === 'academic') setPicked([]);
  };

  const students = cls?.students || [];
  const isPicked = (u) => picked.some((x) => sameId(x, u));
  const toggle = (u) => setPicked((p) => (p.some((x) => sameId(x, u)) ? p.filter((x) => !sameId(x, u)) : [...p, u]));
  const allOfClass = students.length > 0 && students.every(isPicked);
  const toggleClass = () =>
    setPicked((p) => (allOfClass ? p.filter((u) => !students.some((s) => sameId(s, u))) : [...p, ...students.filter((s) => !p.some((x) => sameId(x, s)))]));

  // Search results match the type: faculty for FACULTY, students for CUSTOM.
  const results = useMemo(
    () => (found?.items || []).filter((u) => (category === 'faculty' ? STAFF.includes(u.role) : STUDENT_ROLES.includes(u.role))),
    [found, category]
  );

  const counts = {
    students: picked.filter((u) => STUDENT_ROLES.includes(u.role)).length,
    staff: picked.filter((u) => STAFF.includes(u.role)).length,
  };
  const ready = name.trim().length >= 2 && reason.trim().length >= 5 && picked.length > 0;

  const submit = async () => {
    try {
      await create({
        type: 'group',
        name: name.trim(),
        category,
        reason: reason.trim(),
        participantIds: picked.map((u) => u._id),
      }).unwrap();
      toast.success('Request sent to the principal — the group goes live once approved');
      onClose();
    } catch (e) {
      toast.error(errMsg(e, 'Could not send the request'));
    }
  };

  const yearOptions = (filters?.years || [1, 2, 3, 4]).map((y) => ({ value: String(y), label: YEAR_LABELS[y] || `Year ${y}` }));
  const sectionOptions = (filters?.sections || []).map((s) => ({ value: s, label: `Section ${s}` }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="New group"
      subtitle="Your group is sent to the principal for approval, with your reason. Only you can edit or delete it afterwards."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={Send} loading={isLoading} disabled={!ready} onClick={submit}>
            Send request to Principal
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Group name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="e.g. Year 3 project coordination" />
        <Select
          label="Group type"
          keepCase
          value={category}
          onChange={(e) => changeCategory(e.target.value)}
          options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
          hint={CATEGORIES.find((c) => c.value === category)?.hint}
        />
        <Textarea
          label="Reason (shown to the principal)"
          className="sm:col-span-2"
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this group needed?"
        />
      </div>

      {wantsClass && (
        <div className="mt-4 rounded-2xl bg-white/50 p-3 dark:bg-white/5">
          <p className="label">{category === 'academic' ? 'The class' : 'Add students by class — several classes allowed'}</p>
          <div className="flex flex-wrap items-end gap-2">
            <Select
              className="w-full sm:w-40"
              placeholder="Year"
              keepCase
              value={year}
              onChange={(e) => changeClass(e.target.value, section)}
              options={yearOptions}
            />
            <Select
              className="w-full sm:w-40"
              placeholder="Section"
              keepCase
              value={section}
              onChange={(e) => changeClass(year, e.target.value)}
              options={sectionOptions}
            />
            {students.length > 0 && (
              <Button variant={allOfClass ? 'soft' : 'outline'} size="sm" icon={allOfClass ? X : Check} onClick={toggleClass} className="w-full sm:w-auto">
                {allOfClass ? 'Unselect this section' : `Select all students (${students.length})`}
              </Button>
            )}
          </div>
          {year && section ? (
            loadingClass ? (
              <Skeleton className="mt-3 h-24" />
            ) : students.length ? (
              <div className="mt-3 max-h-48 space-y-1 overflow-y-auto">
                {students.map((u) => (
                  <button
                    key={u._id}
                    type="button"
                    onClick={() => toggle(u)}
                    className={cn('flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-white/70 dark:hover:bg-white/5', isPicked(u) && 'bg-primary-500/10')}
                  >
                    <span className="w-14 shrink-0 text-xs tabular-nums muted">{u.rollNo || '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{u.name}</span>
                    {isPicked(u) && <Check className="h-4 w-4 text-primary-500" />}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm muted">No students in this class.</p>
            )
          ) : (
            <p className="mt-2 text-xs muted">Choose a year and a section{category === 'custom' ? ' — you can add several classes, one after another' : ''}.</p>
          )}
        </div>
      )}

      {searchable && (
        <div className="mt-4">
          <Input
            icon={Search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={category === 'custom' ? 'Search students of your department' : 'Search faculty from anywhere on campus'}
            aria-label={category === 'custom' ? 'Search students' : 'Search faculty'}
          />
          {q.trim().length >= 2 && (
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {searching && !results.length && <Skeleton className="h-12" />}
              {!searching && !results.length && <p className="py-3 text-center text-sm muted">No one matches “{q}”.</p>}
              {results.map((u) => (
                <button
                  key={u._id}
                  type="button"
                  onClick={() => toggle(u)}
                  className={cn('flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-white/70 dark:hover:bg-white/5', isPicked(u) && 'bg-primary-500/10')}
                >
                  <Avatar user={u} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{u.name}</span>
                    <span className="block truncate text-xs muted">
                      {ROLE_LABELS[u.role]}
                      {u.department ? ` · ${u.department}` : ''}
                      {u.section ? ` · Sec ${u.section}` : ''}
                    </span>
                  </span>
                  {isPicked(u) && <Check className="h-4 w-4 text-primary-500" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {picked.length > 0 && (
        <div className="mt-4">
          <p className="label">
            Selected members · {picked.length}
            {category === 'faculty' ? '' : ` student${counts.students === 1 ? '' : 's'}`}
          </p>
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {picked.map((u) => (
              <span key={u._id} className="chip">
                {u.name}
                <button type="button" aria-label={`Remove ${u.name}`} onClick={() => toggle(u)}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
