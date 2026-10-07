import { useState } from 'react';
import { AlertTriangle, ArrowLeft, BedDouble, ChevronRight, Phone, UserCheck, Users } from 'lucide-react';
import { useGetAttendanceBreakdownQuery, useGetSummaryStudentsQuery } from '../../services/api';
import { EmptyState, ErrorState, Skeleton, StatCard, cn } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { YEAR_LABELS } from '../../utils/constants';
import { displayName, fmtClassDay, todayKey } from '../../utils/format';

/**
 * HOD attendance dashboard cards: department present today, low attendance
 * and hostellers — each opens a year-wise popup (department-wise for the
 * Science & Humanities HOD, who owns every department's 1st year), and the
 * low-attendance / hosteller rows open the student list for that year.
 * Scope is decided by the server; nothing here widens it.
 */
const groupLabel = (g, groupBy) => (groupBy === 'department' ? g.department || '—' : YEAR_LABELS[g.year] || `Year ${g.year}`);

function PhoneLink({ value }) {
  if (!value) return <span className="muted">—</span>;
  return (
    <a href={`tel:${value}`} className="inline-flex items-center gap-1 font-semibold text-primary-600 hover:underline dark:text-primary-300">
      <Phone className="h-3 w-3" /> {value}
    </a>
  );
}

function Count({ label, value, tone }) {
  return (
    <div className={cn('min-w-0 rounded-xl px-2.5 py-1.5 text-center', tone)}>
      <p className="text-base font-extrabold leading-tight">{value}</p>
      <p className="truncate text-[10px] font-bold uppercase tracking-wide opacity-80">{label}</p>
    </div>
  );
}

/** One year/department row: name on the left, the tallies on the right. */
function GroupRow({ title, children, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button', onClick } : {})}
      className={cn(
        'flex w-full flex-wrap items-center gap-3 rounded-2xl border border-white/60 bg-white/50 p-3 text-left dark:border-white/10 dark:bg-white/5',
        onClick && 'transition hover:border-primary-400/50 hover:bg-primary-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400'
      )}
    >
      <p className="min-w-[7rem] flex-1 text-sm font-extrabold">{title}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {onClick && <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" />}
    </Tag>
  );
}

function Tallies({ t }) {
  return (
    <>
      <Count label="Total" value={t.total} tone="bg-primary-500/10 text-primary-700 dark:text-primary-200" />
      <Count label="Present" value={t.present} tone="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" />
      <Count label="Absent" value={t.absent} tone="bg-rose-500/10 text-rose-700 dark:text-rose-300" />
      {t.unmarked > 0 && <Count label="Not marked" value={t.unmarked} tone="bg-slate-500/10 text-ink-soft dark:text-ink-muted" />}
    </>
  );
}

/** Name · roll no · section · parent mobile, as a table that scrolls inside the popup on phones. */
function StudentTable({ students, extra }) {
  if (!students.length) return <EmptyState icon={Users} title="No students" text="Nobody in this list." />;
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[30rem] text-left text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-ink-muted">
            <th className="px-2 py-2">#</th>
            <th className="px-2 py-2">Name</th>
            <th className="px-2 py-2">Roll No</th>
            <th className="px-2 py-2">Section</th>
            <th className="px-2 py-2">Parent Mobile</th>
            {extra && <th className="px-2 py-2">{extra.label}</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/60 dark:divide-white/5">
          {students.map((s, i) => (
            <tr key={s._id}>
              <td className="px-2 py-2 text-xs muted">{i + 1}</td>
              <td className="px-2 py-2 font-semibold">{displayName(s)}</td>
              <td className="px-2 py-2 font-mono text-xs">{s.rollNo || '—'}</td>
              <td className="px-2 py-2">{s.section || '—'}</td>
              <td className="px-2 py-2 text-xs"><PhoneLink value={s.parentPhone} /></td>
              {extra && <td className="px-2 py-2 text-xs">{extra.render(s)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DAY_STATUS = {
  present: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  absent: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  unmarked: 'bg-slate-500/10 text-ink-soft',
};

/** Hostellers of one class group (year and/or department) with today's status. */
function HostellerList({ department, year, date }) {
  const params = { date, stayType: 'hosteler', ...(department ? { department } : {}), ...(year ? { year } : {}) };
  const { data, isLoading, error, refetch } = useGetSummaryStudentsQuery(params);
  if (isLoading) return <Skeleton className="h-40" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <StudentTable
      students={data.students}
      extra={{
        label: 'Today',
        render: (s) => (
          <span className={cn('rounded-lg px-2 py-0.5 text-[11px] font-bold capitalize', DAY_STATUS[s.status])}>{s.status === 'unmarked' ? 'Not marked' : s.status}</span>
        ),
      }}
    />
  );
}

const lowExtra = {
  label: 'Attendance',
  render: (s) => (
    <span className="font-bold text-rose-600 dark:text-rose-300">
      {s.percentage}% <span className="font-normal muted">({s.presentPeriods}/{s.totalPeriods})</span>
    </span>
  ),
};

/** College view: one department's low-attendance students of one year (fetched on drill-down). */
function DepartmentLowList({ department, year, date }) {
  const { data, isLoading, error, refetch } = useGetAttendanceBreakdownQuery({ date, department });
  if (isLoading) return <Skeleton className="h-40" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return <StudentTable students={data.groups.find((g) => g.year === year)?.lowAttendance || []} extra={lowExtra} />;
}

/**
 * HOD: their department (or, for the Science & Humanities HOD, every
 * department's 1st year). Principal / college-wide roles: the whole college,
 * department → year → students.
 */
export default function HodDepartmentCards({ me, extraCard }) {
  const date = todayKey();
  const { data, isLoading, error, refetch } = useGetAttendanceBreakdownQuery({ date }, { pollingInterval: 60000 });
  const [open, setOpen] = useState(null); // 'present' | 'low' | 'hostel'
  const [dept, setDept] = useState(null); // college view: the department opened
  const [drill, setDrill] = useState(null); // the year / group whose students are listed

  const show = (which) => {
    setDept(null);
    setDrill(null);
    setOpen(which);
  };
  const close = () => {
    setOpen(null);
    setDept(null);
    setDrill(null);
  };
  const back = () => (drill ? setDrill(null) : setDept(null));

  const groupBy = data?.groupBy || 'year';
  const groups = data?.groups || [];
  const college = groups.some((g) => Array.isArray(g.years));
  const t = data?.totals;
  const scopeName = college ? 'Whole college' : data?.department || me.department || 'Department';
  const dash = (v) => (isLoading ? '…' : error ? '—' : v);
  const threshold = data?.threshold ?? 75;

  // The rows on screen at this level, and how each one is named.
  const rows = college && dept ? dept.years : groups;
  const rowBy = college && dept ? 'year' : groupBy;
  const lowOf = (g) => g.lowCount ?? g.lowAttendance?.length ?? 0;
  const where = [dept?.department, drill && groupLabel(drill, rowBy)].filter(Boolean).join(' · ');
  const breakdownWord = college || groupBy === 'department' ? 'department-wise' : 'year-wise';
  const day = fmtClassDay(date, 'EEEE, dd MMM');

  const titles = {
    present: { title: `Total ${college ? 'College' : 'Department'} Present`, subtitle: `${where || scopeName} · ${day}` },
    low: { title: where ? `${where} — Low Attendance` : 'Low Attendance', subtitle: `${where || scopeName} · below ${threshold}% this semester` },
    hostel: { title: where ? `${where} — Hostellers` : 'Total Hostellers', subtitle: `${where || scopeName} · attendance on ${day}` },
  };

  // College "present" drills department → years; low / hostel always drill down to students.
  const level = college && !dept ? 'dept' : 'year';
  const rowOpens = open === 'present' ? college && level === 'dept' : true;
  const openRow = (g) => (level === 'dept' ? setDept(g) : setDrill(g));

  let body;
  if (isLoading) body = <Skeleton className="h-40" />;
  else if (error) body = <ErrorState error={error} onRetry={refetch} />;
  else if (drill) {
    body =
      open === 'low' ? (
        college ? (
          <DepartmentLowList department={dept.department} year={drill.year} date={date} />
        ) : (
          <StudentTable students={drill.lowAttendance} extra={lowExtra} />
        )
      ) : (
        <HostellerList
          date={date}
          department={college ? dept.department : groupBy === 'department' ? drill.department : undefined}
          year={college || groupBy !== 'department' ? drill.year : undefined}
        />
      );
  } else if (!rows.length) {
    body = <EmptyState icon={Users} title="No students" text="No students are in your scope yet." />;
  } else {
    body = (
      <div className="space-y-2">
        {rows.map((g) => (
          <GroupRow key={g.key || g.year} title={groupLabel(g, rowBy)} onClick={rowOpens ? () => openRow(g) : undefined}>
            {open === 'present' && <Tallies t={g.students} />}
            {open === 'hostel' && <Tallies t={g.hostellers} />}
            {open === 'low' && <Count label="Low attendance" value={lowOf(g)} tone="bg-rose-500/10 text-rose-700 dark:text-rose-300" />}
          </GroupRow>
        ))}
        {open === 'present' && (dept || t) && (
          <GroupRow title={dept ? `${dept.department} total` : `${college ? 'College' : 'Department'} total`}>
            <Tallies t={dept ? dept.students : t.students} />
          </GroupRow>
        )}
      </div>
    );
  }

  return (
    <>
      <StatCard
        icon={UserCheck}
        label={college ? 'Total College Present' : 'Total Dept Present'}
        value={dash(t ? `${t.students.present} / ${t.students.total}` : '0 / 0')}
        hint={t ? `${t.students.absent} absent${t.students.unmarked ? ` · ${t.students.unmarked} not marked` : ''} · tap for ${breakdownWord}` : 'Present today / total students'}
        gradient="from-violet-500 to-indigo-600"
        onClick={() => show('present')}
      />
      <StatCard
        icon={AlertTriangle}
        label="Low Attendance"
        value={dash(t?.lowAttendance ?? 0)}
        hint={`Below ${threshold}% · tap for ${breakdownWord}`}
        gradient="from-rose-500 to-pink-600"
        onClick={() => show('low')}
      />
      <StatCard
        icon={BedDouble}
        label="Total Hostellers"
        value={dash(t?.hostellers.total ?? 0)}
        hint={t ? `${t.hostellers.present} present · ${t.hostellers.absent} absent today` : `Hostellers in the ${college ? 'college' : 'department'}`}
        gradient="from-emerald-400 to-teal-600"
        onClick={() => show('hostel')}
      />
      {extraCard}

      <Modal open={Boolean(open)} onClose={close} size="lg" title={open ? titles[open].title : ''} subtitle={open ? titles[open].subtitle : ''}>
        <div className="space-y-3">
          {(drill || dept) && !isLoading && !error && (
            <button type="button" onClick={back} className="inline-flex items-center gap-1.5 text-xs font-bold text-primary-600 hover:underline dark:text-primary-300">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to {drill && (college || groupBy === 'year') ? 'years' : 'departments'}
            </button>
          )}
          {body}
        </div>
      </Modal>
    </>
  );
}
