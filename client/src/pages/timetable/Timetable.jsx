import { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { CalendarClock, Coffee, Pencil, Plus, Search, ShieldCheck } from 'lucide-react';
import { useDeleteSlotMutation, useGetMyScheduleQuery, useGetTimetableQuery } from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, Tabs, cn } from '../../components/ui/primitives';
import { ConfirmDialog } from '../../components/ui/Modal';
import { ACADEMIC_YEARS, DEPARTMENTS, FIRST_YEAR_HOD_DEPT, SECTIONS, TIMETABLE_EDITORS, YEAR_LABELS, currentSemesterOfYear, isBranchHod, isFirstYearHod, semestersOfYear } from '../../utils/constants';
import MySchedule from './MySchedule';
import MasterTimetable from './MasterTimetable';
import FacultyAvailability from './FacultyAvailability';
import EditTimetable from './EditTimetable';
import { errMsg } from '../../utils/format';
import SlotModal from './SlotModal';
import { DAYS, DAY_SHORT, SlotCard, WeekGrid, slotState, to12h, todayName, useSlotsByDay } from './TimetableGrid';
import { HolidayBanner } from '../attendance/Holidays';

export { DAYS, SlotCard };

const STUDENT_ROLES = ['student', 'club_admin'];

const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Ticks every 30 s so "now / next" stays correct while the page is open. */
function useClock() {
  const [now, setNow] = useState(nowHHMM());
  useEffect(() => {
    const t = setInterval(() => setNow(nowHHMM()), 30000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function Timetable() {
  const me = useSelector(selectUser);
  const isStudent = STUDENT_ROLES.includes(me.role);
  const now = useClock();
  const isHod = me.role === 'hod';
  const isFYH = isFirstYearHod(me);
  const isBrH = isBranchHod(me);
  const isFaculty = me.role === 'faculty';
  const isEditor = TIMETABLE_EDITORS.includes(me.role);
  const [view, setView] = useState(isHod ? 'master' : 'today');
  const [day, setDay] = useState(DAYS.includes(todayName()) ? todayName() : 'monday');
  // Faculty and HOD accounts get a "My Schedule" view of their own teaching
  // periods. A faculty member has no department / year / section selector at
  // all: that scope comes from their teaching assignments, which the server
  // enforces whatever the client sends.
  const hasMySchedule = isFaculty || isHod;
  // Faculty have two scopes: "Our Class" — the complete timetable of the class
  // they are Class In-Charge of — and "Handling Class" — only the periods they
  // teach. The server derives both from the account.
  const [facultyScope, setFacultyScope] = useState('class');
  const scopeChosen = useRef(false);
  const [lookup, setLookup] = useState({
    department: isHod ? (isFYH ? '' : me.department || '') : (me.department || ''),
    year: isFYH ? 1 : '',
    section: '',
    semester: isFYH ? 1 : '',
  });
  const [applied, setApplied] = useState(null);
  const [edit, setEdit] = useState(undefined); // undefined = closed, null = new period, object = existing
  const [preset, setPreset] = useState(null);
  const [del, setDel] = useState(null);
  const [removeSlot, { isLoading: removing }] = useDeleteSlotMutation();

  // A faculty account sends nothing but the semester; an HOD sends year,
  // section and semester, never a department (it is their own by definition).
  // First-year HOD (S&H) specifies which department they are inspecting.
  const params = isFaculty
    ? facultyScope === 'class'
      ? { scope: 'class' }
      : { scope: 'handling', semester: lookup.semester || undefined }
    : applied?.section
      ? {
          department: isBrH ? undefined : applied.department || undefined,
          year: applied.year,
          section: applied.section,
          semester: applied.semester || undefined,
        }
      : undefined;
  const { data, isLoading, isFetching, error, refetch } = useGetTimetableQuery(params, { skip: view === 'mine' || view === 'master' || view === 'edit' });
  // The semesters a faculty member actually teaches, so the one dropdown they
  // have never offers a semester they are not assigned to. Taken from the
  // unfiltered schedule, so choosing one does not shrink the list.
  const { data: mySchedule } = useGetMyScheduleQuery(undefined, { skip: !isFaculty });
  const slots = useMemo(() => data?.slots || [], [data]);
  const ourClass = isFaculty && facultyScope === 'class' ? data?.classInCharge : null;
  const noOurClass = isFaculty && facultyScope === 'class' && data && !data.classInCharge;
  // A faculty member who is not Class In-Charge of any class lands on their
  // Handling Class instead of an empty Our Class — once, so their own choice
  // afterwards is respected.
  useEffect(() => {
    if (!isFaculty || scopeChosen.current || !data || facultyScope !== 'class') return;
    scopeChosen.current = true;
    if (!data.classInCharge) setFacultyScope('handling');
  }, [isFaculty, data, facultyScope]);
  const pickScope = (value) => {
    scopeChosen.current = true;
    setFacultyScope(value);
  };

  // Editing needs one concrete class: department + year + section + semester. If no
  // semester was picked, fall back to the one semester every loaded period shares.
  const semesters = [...new Set(slots.map((s) => s.semester))];
  const department = isBrH ? me.department : applied?.department;
  const klass =
    applied?.section && department
      ? { ...applied, department, semester: applied.semester || (semesters.length === 1 ? semesters[0] : '') }
      : null;
  const canEditClass =
    isEditor &&
    klass?.semester &&
    (!isHod || (isFYH ? Number(klass.year) === 1 : klass.department === me.department && Number(klass.year) !== 1));
  const openNew = (p = null) => {
    setPreset(p);
    setEdit(null);
  };
  const editProps = canEditClass ? { onEdit: (s) => { setPreset(null); setEdit(s); }, onDelete: setDel } : {};

  const byDay = useSlotsByDay(slots);

  const today = todayName();
  const todaySlots = byDay[today] || [];
  // A period cancelled by a holiday (server-annotated) is never "next".
  const nextSlot = todaySlots.find((s) => !s.isBreak && !s.holiday && s.startTime > now);
  // The whole of today is a holiday when every class period today carries one.
  const todayClasses = todaySlots.filter((s) => !s.isBreak);
  const todayHoliday = todayClasses.length && todayClasses.every((s) => s.holiday) ? todayClasses[0].holiday : null;
  const showSection = !isStudent && !applied?.section;
  // Our Class is one class taught by many faculty: always name the faculty.
  const compactCells = !(isFaculty && facultyScope === 'class');

  const header = (
    <PageHeader
      icon={CalendarClock}
      title="Timetable"
      subtitle={
        isStudent
          ? me.section
            ? `${me.department} · ${YEAR_LABELS[me.year] || ''} · Section ${me.section}${me.semester ? ` · Semester ${me.semester}` : ''}`
            : 'Your class schedule'
          : isFaculty
            ? ourClass
              ? `Our Class · ${ourClass.department} · ${YEAR_LABELS[ourClass.year]} · Section ${ourClass.section} · Semester ${ourClass.semester}`
              : facultyScope === 'class'
                ? 'Our Class'
                : 'Handling Class · the periods you teach'
            : view === 'edit' && isHod
              ? `Edit Timetable · ${isFYH ? 'First Year (All Departments)' : me.department || 'Department'}`
            : view === 'master' && isHod
              ? `Master Timetable · ${isFYH ? 'First Year (All Departments)' : me.department || 'Department'}`
              : view === 'faculty-availability' && isHod
                ? `Faculty Availability · ${isFYH ? 'First Year (All Departments)' : me.department || 'Department'}`
              : applied?.section
                ? [isHod ? me.department : applied.department, YEAR_LABELS[applied.year], `Section ${applied.section}`, applied.semester && `Semester ${applied.semester}`]
                    .filter(Boolean)
                    .join(' · ')
                : 'Class schedules'
      }
      actions={
        <>
          {isHod && (
            <Button icon={Pencil} variant={view === 'edit' ? 'soft' : 'primary'} onClick={() => setView('edit')} aria-pressed={view === 'edit'}>
              Edit Timetable
            </Button>
          )}
          {canEditClass && view !== 'edit' && (
            <Button icon={Plus} onClick={() => openNew()}>
              Add period
            </Button>
          )}
          <Tabs
            tabs={[
              ...(isHod ? [{ value: 'master', label: 'Master Timetable' }] : []),
              ...(isHod ? [{ value: 'faculty-availability', label: 'Faculty Availability' }] : []),
              { value: 'today', label: 'Today' },
              { value: 'week', label: 'Week' },
              ...(hasMySchedule ? [{ value: 'mine', label: 'My Schedule' }] : []),
            ]}
            value={view}
            onChange={setView}
          />
        </>
      }
    />
  );

  const dialogs = (
    <>
      {klass?.semester && <SlotModal open={edit !== undefined} slot={edit} klass={klass} preset={preset} classSlots={slots} onClose={() => setEdit(undefined)} />}
      <ConfirmDialog
        open={Boolean(del)}
        onClose={() => setDel(null)}
        title="Remove this period?"
        text="Students and faculty see the change immediately."
        confirmText="Remove"
        loading={removing}
        onConfirm={async () => {
          try {
            await removeSlot(del._id).unwrap();
            toast.success('Period removed');
          } catch (e) {
            toast.error(errMsg(e));
          }
          setDel(null);
        }}
      />
    </>
  );

  if (view === 'edit' && isHod) {
    return (
      <div className="space-y-5">
        {header}
        <EditTimetable />
      </div>
    );
  }
  if (view === 'master') {
    return (
      <div className="space-y-5">
        {header}
        <MasterTimetable />
      </div>
    );
  }
  if (view === 'faculty-availability') {
    return (
      <div className="space-y-5">
        {header}
        <FacultyAvailability />
      </div>
    );
  }
  if (view === 'mine') {
    return (
      <div className="space-y-5">
        {header}
        <MySchedule />
      </div>
    );
  }
  if (isLoading) {
    return (
      <div>
        {header}
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        {header}
        <ErrorState error={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}

      {isFaculty && (
        <Card className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="w-full sm:w-auto">
            <p className="label">Scope</p>
            <Tabs
              tabs={[
                { value: 'class', label: 'Our Class' },
                { value: 'handling', label: 'Handling Class' },
              ]}
              value={facultyScope}
              onChange={pickScope}
              className="max-w-full"
            />
          </div>
          {facultyScope === 'handling' && (
            <div className="w-full sm:w-44">
              <label className="label" htmlFor="tt-sem">Semester</label>
              <select
                id="tt-sem"
                className="input"
                value={lookup.semester}
                onChange={(e) => setLookup((l) => ({ ...l, semester: e.target.value ? Number(e.target.value) : '' }))}
              >
                <option value="">All semesters</option>
                {(mySchedule?.semesters || []).map((s) => (
                  <option key={s} value={s}>
                    Semester {s}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="flex flex-1 items-center gap-2 text-xs muted sm:pb-2.5">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary-500" />
            {facultyScope === 'class'
              ? 'The complete timetable of the class you are Class In-Charge of — every subject and faculty.'
              : 'Only the periods you teach. Your department, year and sections come from your teaching assignments.'}
          </p>
        </Card>
      )}

      {!isStudent && !isFaculty && (
        <Card className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          {(!isHod || isFYH) && (
            <div className="w-full sm:min-w-[12rem] sm:flex-1">
              <label className="label" htmlFor="tt-dept">Department</label>
              <select
                id="tt-dept"
                className="input"
                value={lookup.department}
                onChange={(e) => {
                  const dept = e.target.value;
                  if (dept === FIRST_YEAR_HOD_DEPT) {
                    setLookup((l) => ({ ...l, department: dept, year: 1, semester: 1 }));
                  } else {
                    setLookup((l) => ({ ...l, department: dept }));
                  }
                }}
              >
                <option value="">{isFYH ? 'Choose department' : 'Any'}</option>
                {[...new Set([me.department, ...DEPARTMENTS].filter(Boolean))].map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </div>
          )}
          <div className="w-full sm:w-32">
            <label className="label" htmlFor="tt-year">Year</label>
            <select
              id="tt-year"
              className="input"
              value={lookup.year}
              disabled={isFYH}
              onChange={(e) => {
                const year = e.target.value ? Number(e.target.value) : '';
                setLookup((l) => ({
                  ...l,
                  year,
                  semester: year ? currentSemesterOfYear(year) : '',
                }));
              }}
            >
              {!isFYH && <option value="">Choose year</option>}
              {(isFYH ? [1] : isBrH ? [2, 3, 4] : ACADEMIC_YEARS).map((y) => (
                <option key={y} value={y}>
                  {YEAR_LABELS[y]}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-32">
            <label className="label" htmlFor="tt-sec">Section</label>
            <select id="tt-sec" className="input" value={lookup.section} onChange={(e) => setLookup((l) => ({ ...l, section: e.target.value }))}>
              <option value="">Choose section</option>
              {SECTIONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-32">
            <label className="label" htmlFor="tt-sem">Semester</label>
            <select id="tt-sem" className="input" value={lookup.semester} disabled={!lookup.year} onChange={(e) => setLookup((l) => ({ ...l, semester: e.target.value ? Number(e.target.value) : '' }))}>
              <option value="">{lookup.year ? 'Any' : 'Year first'}</option>
              {semestersOfYear(lookup.year).map((s) => (
                <option key={s} value={s}>
                  Semester {s}
                </option>
              ))}
            </select>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button icon={Search} loading={isFetching} disabled={!lookup.section || !lookup.year || (isFYH && !lookup.department)} onClick={() => setApplied({ ...lookup })}>
              View class
            </Button>
            {applied && (
              <Button variant="ghost" onClick={() => setApplied(null)}>
                Clear
              </Button>
            )}
          </div>
        </Card>
      )}

      {isEditor && !canEditClass && (
        <Card className="flex items-center gap-3 !py-3 text-sm">
          <Pencil className="h-4 w-4 shrink-0 text-primary-500" />
          <span className="muted">
            {applied?.section && !klass?.semester
              ? 'Choose a semester and press View class to add or edit periods.'
              : `To add or edit periods, choose ${isBrH ? 'a year, section' : 'a department, year, section'} and semester, then press View class.`}
          </span>
        </Card>
      )}

      {noOurClass ? (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="No class is currently assigned to you as Class In-Charge."
            text="Your administrator sets your Class In-Charge section, year and semester. Your own teaching periods are under Handling Class."
            action={<Button variant="soft" onClick={() => pickScope('handling')}>Show Handling Class</Button>}
          />
        </Card>
      ) : data?.needsSection ? (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="Your class section isn’t set yet"
            text="An administrator assigns your department, section and semester. Once that’s done your timetable appears here automatically."
          />
        </Card>
      ) : !slots.length ? (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="No classes scheduled"
            text={isStudent ? 'Your class timetable has not been published yet.' : 'No timetable entries match this view.'}
            action={canEditClass && <Button icon={Plus} onClick={() => openNew()}>Add first period</Button>}
          />
        </Card>
      ) : view === 'today' ? (
        // min-w-0 on the grid items: without it a long subject name in a
        // truncated line sets the column's minimum width and pushes the page
        // wider than a phone screen instead of ellipsizing.
        <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
          <Card className="xl:col-span-2">
            <CardHeader title={`Today · ${today.charAt(0).toUpperCase()}${today.slice(1)}`} subtitle={todayHoliday ? 'Holiday' : `${todaySlots.filter((s) => !s.isBreak).length} classes`} />
            {todayHoliday && <HolidayBanner holiday={todayHoliday} text="No classes scheduled · Attendance unavailable" className="mb-3" />}
            {!todaySlots.length ? (
              <EmptyState icon={Coffee} title="No classes today" text="Enjoy the break — check the weekly view for upcoming classes." />
            ) : (
              <div className="space-y-2.5">
                {todaySlots.map((s) => {
                  const st = slotState(s, today, now);
                  return <SlotCard key={s._id} slot={s} state={st === 'future' && s === nextSlot ? 'next' : st} showSection={showSection} {...editProps} />;
                })}
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Up next" />
            {nextSlot ? (
              <div className="space-y-3">
                <SlotCard slot={nextSlot} state="next" showSection={showSection} />
                <p className="text-xs muted">Starts at {to12h(nextSlot.startTime)}.</p>
              </div>
            ) : (
              <p className="text-sm muted">No more classes today.</p>
            )}
            <div className="mt-5 border-t border-white/60 pt-4 dark:border-white/10">
              <p className="label">This week</p>
              <div className="grid grid-cols-3 gap-2">
                {DAYS.map((d) => {
                  const classes = byDay[d].filter((s) => !s.isBreak);
                  const off = classes.length > 0 && classes.every((s) => s.holiday);
                  return (
                    <button key={d} onClick={() => { setDay(d); setView('week'); }} className={cn('rounded-2xl bg-white/50 p-2 text-center dark:bg-white/5', d === today && 'ring-2 ring-primary-400', off && 'bg-rose-500/10 dark:bg-rose-500/10')}>
                      <p className="text-[11px] font-bold uppercase muted">{DAY_SHORT[d]}</p>
                      {off ? <p className="py-1 text-[11px] font-extrabold uppercase text-rose-600 dark:text-rose-300">Holiday</p> : <p className="text-lg font-extrabold">{classes.length}</p>}
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>
        </div>
      ) : (
        <WeekGrid
          slots={slots}
          week={data?.week}
          now={now}
          day={day}
          onDayChange={setDay}
          compact={compactCells}
          showSection={showSection}
          onAdd={canEditClass ? openNew : undefined}
          {...editProps}
        />
      )}
      {dialogs}
    </div>
  );
}
