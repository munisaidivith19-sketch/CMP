import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { Building2, CalendarClock, Coffee, Info, Plus } from 'lucide-react';
import { useDeleteSlotMutation, useGetTimetableQuery } from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '../../components/ui/primitives';
import { ConfirmDialog } from '../../components/ui/Modal';
import { DEPARTMENTS, FIRST_YEAR_HOD_DEPT, SECTIONS, YEAR_LABELS, currentSemesterOfYear, isFirstYearHod, semestersOfYear } from '../../utils/constants';
import { errMsg } from '../../utils/format';
import SlotModal from './SlotModal';
import { DAYS, WeekGrid, todayName } from './TimetableGrid';

const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * HOD → Timetable → Edit Timetable.
 *
 * The HOD picks Year, Section and Semester; the department is always their
 * own assigned department (shown, never chosen). The Science & Humanities HOD
 * owns every department's 1st year, so they pick the department instead and
 * the year is fixed to 1st Year. The server enforces the same scope on every
 * read and write, whatever this page sends.
 */
export default function EditTimetable() {
  const me = useSelector(selectUser);
  const isFYH = isFirstYearHod(me);
  const years = isFYH ? [1] : [2, 3, 4];
  const departments = useMemo(() => DEPARTMENTS.filter((d) => d !== FIRST_YEAR_HOD_DEPT), []);

  const [pick, setPick] = useState({ department: isFYH ? '' : me.department || '', year: isFYH ? 1 : '', section: '', semester: isFYH ? currentSemesterOfYear(1) : '' });
  const [day, setDay] = useState(DAYS.includes(todayName()) ? todayName() : 'monday');
  const [edit, setEdit] = useState(undefined); // undefined = closed, null = new, object = existing
  const [preset, setPreset] = useState(null);
  const [del, setDel] = useState(null);
  const [removeSlot, { isLoading: removing }] = useDeleteSlotMutation();

  // One concrete class: department + year + section + semester.
  const ready = Boolean(pick.department && pick.year && pick.section && pick.semester);
  const klass = ready ? { department: pick.department, year: Number(pick.year), section: pick.section, semester: Number(pick.semester) } : null;
  const params = klass
    ? {
        // A branch HOD never sends a department — the server uses their own.
        ...(isFYH ? { department: klass.department } : {}),
        year: klass.year,
        section: klass.section,
        semester: klass.semester,
      }
    : undefined;
  const { data, isLoading, isFetching, error, refetch } = useGetTimetableQuery(params, { skip: !klass });
  const slots = useMemo(() => data?.slots || [], [data]);

  const [now, setNow] = useState(nowHHMM());
  useEffect(() => {
    const t = setInterval(() => setNow(nowHHMM()), 30000);
    return () => clearInterval(t);
  }, []);

  const classCount = slots.filter((s) => !s.isBreak).length;
  const breakCount = slots.length - classCount;

  const openNew = (p = null) => {
    setPreset(p);
    setEdit(null);
  };

  const field = 'w-full sm:w-40';
  return (
    <div className="space-y-5">
      <Card className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {isFYH ? (
          <div className="w-full sm:min-w-[12rem] sm:flex-1">
            <label className="label" htmlFor="et-dept">Department</label>
            <select id="et-dept" className="input" value={pick.department} onChange={(e) => setPick((p) => ({ ...p, department: e.target.value }))}>
              <option value="">Choose department</option>
              {departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="w-full sm:min-w-[12rem] sm:flex-1">
            <p className="label">Department</p>
            <div className="input flex items-center gap-2 !cursor-default" aria-readonly>
              <Building2 className="h-4 w-4 shrink-0 text-primary-500" />
              <span className="truncate font-semibold">{me.department || 'No department assigned'}</span>
            </div>
          </div>
        )}
        <div className={field}>
          <label className="label" htmlFor="et-year">Year</label>
          <select
            id="et-year"
            className="input"
            value={pick.year}
            disabled={isFYH}
            onChange={(e) => {
              const year = e.target.value ? Number(e.target.value) : '';
              setPick((p) => ({ ...p, year, semester: year ? currentSemesterOfYear(year) : '' }));
            }}
          >
            {!isFYH && <option value="">Choose year</option>}
            {years.map((y) => (
              <option key={y} value={y}>
                {YEAR_LABELS[y]}
              </option>
            ))}
          </select>
        </div>
        <div className={field}>
          <label className="label" htmlFor="et-sec">Section</label>
          <select id="et-sec" className="input" value={pick.section} onChange={(e) => setPick((p) => ({ ...p, section: e.target.value }))}>
            <option value="">Choose section</option>
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                Section {s}
              </option>
            ))}
          </select>
        </div>
        <div className={field}>
          <label className="label" htmlFor="et-sem">Semester</label>
          <select
            id="et-sem"
            className="input"
            value={pick.semester}
            disabled={!pick.year}
            onChange={(e) => setPick((p) => ({ ...p, semester: e.target.value ? Number(e.target.value) : '' }))}
          >
            <option value="">{pick.year ? 'Choose semester' : 'Year first'}</option>
            {semestersOfYear(pick.year).map((s) => (
              <option key={s} value={s}>
                Semester {s}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {!me.department && !isFYH ? (
        <Card>
          <EmptyState icon={Building2} title="No department assigned" text="An administrator must assign your department before you can edit timetables." />
        </Card>
      ) : !klass ? (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="Choose a class to edit"
            text={`Pick the ${isFYH ? 'department, ' : ''}year, section and semester. You can edit only ${isFYH ? 'first-year classes' : `${me.department} classes`}.`}
          />
        </Card>
      ) : isLoading ? (
        <Skeleton className="h-72 rounded-3xl" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          <Card className="flex flex-wrap items-center gap-3 !py-3">
            <div className="min-w-0 flex-1">
              <p className="font-extrabold">
                {klass.department} · {YEAR_LABELS[klass.year]} · Section {klass.section} · Semester {klass.semester}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs muted">
                <Info className="h-3.5 w-3.5 shrink-0 text-primary-500" />
                Only classes are periods (P1, P2, P3…). Breaks are shown by name and never take a period number.
              </p>
            </div>
            <Badge color="info">{classCount} periods / week</Badge>
            {breakCount > 0 && (
              <Badge color="neutral" icon={Coffee}>
                {breakCount} breaks
              </Badge>
            )}
            <Button icon={Plus} loading={isFetching} onClick={() => openNew({ dayOfWeek: day })}>
              Add period
            </Button>
          </Card>

          {!slots.length ? (
            <Card>
              <EmptyState
                icon={CalendarClock}
                title="No timetable yet for this class"
                text="Add the first period — the period number follows the start time."
                action={<Button icon={Plus} onClick={() => openNew({ dayOfWeek: day })}>Add first period</Button>}
              />
            </Card>
          ) : (
            <WeekGrid
              slots={slots}
              week={data?.week}
              now={now}
              day={day}
              onDayChange={setDay}
              onAdd={openNew}
              onEdit={(s) => {
                setPreset(null);
                setEdit(s);
              }}
              onDelete={setDel}
            />
          )}
        </>
      )}

      {klass && <SlotModal open={edit !== undefined} slot={edit} klass={klass} preset={preset} classSlots={slots} onClose={() => setEdit(undefined)} />}
      <ConfirmDialog
        open={Boolean(del)}
        onClose={() => setDel(null)}
        title={del?.isBreak ? 'Remove this break?' : 'Remove this period?'}
        text="Students and faculty see the change immediately. Attendance already taken is kept."
        confirmText="Remove"
        loading={removing}
        onConfirm={async () => {
          try {
            await removeSlot(del._id).unwrap();
            toast.success(del.isBreak ? 'Break removed' : 'Period removed');
          } catch (e) {
            toast.error(errMsg(e));
          }
          setDel(null);
        }}
      />
    </div>
  );
}
