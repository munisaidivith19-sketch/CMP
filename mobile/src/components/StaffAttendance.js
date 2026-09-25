import { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, View } from 'react-native';
import { useSelector } from 'react-redux';
import { Check, ClipboardList, Lock, Phone, Plane, Save, Users, X } from 'lucide-react-native';
import { Avatar, Badge, Button, Card, Chip, EmptyState, ErrorState, Header, Loading, Screen, Segmented, SectionTitle, StatusBadge, T } from './ui';
import {
  errMsg,
  useGetAttendanceSummaryQuery,
  useGetCurrentClassQuery,
  useGetFacultyRosterQuery,
  useGetRosterQuery,
  useGetSubjectsQuery,
  useGetSummaryFacultyQuery,
  useGetSummaryStudentsQuery,
  useMarkClassAttendanceMutation,
  useMarkFacultyAttendanceMutation,
} from '../services/api';
import { selectUser } from '../store/authSlice';
import { SUMMARY_VIEW, colors, fonts } from '../theme';
import { fmtClassDay, to12h } from '../utils/format';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayKey = () => ymd(new Date());
const yesterdayKey = () => ymd(new Date(Date.now() - 86400000));

/** Row of big tap targets: the "[PRESENT] [ABSENT]" buttons. */
function StatusButtons({ value, onChange, options, disabled }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {options.map(({ value: v, label, icon: Icon, color }) => {
        const on = value === v;
        return (
          <Pressable
            key={v}
            disabled={disabled}
            onPress={() => onChange(v)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled }}
            accessibilityLabel={label}
            hitSlop={4}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: on ? color : colors.border,
              backgroundColor: on ? color : 'rgba(255,255,255,0.7)',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <Icon size={14} color={on ? '#fff' : color} />
            <T v="small" style={{ color: on ? '#fff' : color, fontFamily: fonts.bold, fontSize: 11 }}>
              {label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

const STUDENT_OPTIONS = [
  { value: 'present', label: 'PRESENT', icon: Check, color: colors.success },
  { value: 'absent', label: 'ABSENT', icon: X, color: colors.danger },
];
const FACULTY_OPTIONS = [...STUDENT_OPTIONS, { value: 'leave', label: 'LEAVE', icon: Plane, color: colors.warning }];

function LockNote({ text }) {
  return (
    <Card style={{ flexDirection: 'row', gap: 8, backgroundColor: colors.warningSoft }}>
      <Lock size={16} color="#b45309" />
      <T v="small" style={{ flex: 1, color: '#b45309' }}>
        {text}
      </T>
    </Card>
  );
}

/* ── Mark a class ─────────────────────────────────────────────── */
function MarkClass() {
  const me = useSelector(selectUser);
  const scope = me.role === 'faculty' ? { mine: 'true' } : me.role === 'hod' ? { department: me.department } : undefined;
  const subjects = useGetSubjectsQuery(scope);
  const now = useGetCurrentClassQuery();
  const [form, setForm] = useState({ subjectId: '', section: '', period: '', date: todayKey() });
  const [marks, setMarks] = useState({});
  const [save, { isLoading: saving }] = useMarkClassAttendanceMutation();
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const subject = subjects.data?.find((s) => s._id === form.subjectId);
  const ready = Boolean(form.subjectId && form.period && (!subject?.sections?.length || form.section));
  const roster = useGetRosterQuery(
    { subjectId: form.subjectId, date: form.date, period: form.period, section: form.section || undefined },
    { skip: !ready, refetchOnMountOrArgChange: true }
  );
  const r = roster.data;

  // Start from what is saved; unmarked students default to present.
  useEffect(() => {
    if (r) setMarks(Object.fromEntries(r.students.map((s) => [s._id, s.status || 'present'])));
  }, [r]);

  const todays = (now.data?.today || []).filter((s) => !s.isBreak && s.subject?._id);
  const counts = useMemo(() => Object.values(marks).reduce((a, v) => ({ ...a, [v]: (a[v] || 0) + 1 }), {}), [marks]);

  const submit = async () => {
    try {
      const res = await save({
        subjectId: form.subjectId,
        date: form.date,
        period: Number(form.period),
        section: form.section || undefined,
        records: Object.entries(marks).map(([student, status]) => ({ student, status })),
      }).unwrap();
      Alert.alert('Attendance saved', `${res.message}\n${counts.present || 0} present · ${counts.absent || 0} absent`);
    } catch (e) {
      Alert.alert('Could not save', errMsg(e));
    }
  };

  return (
    <>
      {todays.length ? (
        <>
          <SectionTitle title="Your classes today" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {todays.map((s) => (
              <Chip
                key={s._id}
                active={form.subjectId === s.subject._id && form.period === String(s.period) && form.date === todayKey()}
                label={`P${s.period} · ${s.subject.code}${s.section ? ` · ${s.section}` : ''} · ${to12h(s.startTime)}`}
                onPress={() => set({ subjectId: s.subject._id, section: s.section || '', period: String(s.period), date: todayKey() })}
              />
            ))}
          </View>
        </>
      ) : null}

      <Card style={{ gap: 12 }}>
        <T v="label">Subject</T>
        {subjects.isLoading ? (
          <Loading />
        ) : subjects.error ? (
          <ErrorState error={subjects.error} onRetry={subjects.refetch} />
        ) : subjects.data?.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {subjects.data.map((s) => (
              <Chip key={s._id} label={`${s.code} · Sem ${s.semester}`} active={form.subjectId === s._id} onPress={() => set({ subjectId: s._id, section: '' })} />
            ))}
          </View>
        ) : (
          <T v="small">No subjects are assigned to you yet.</T>
        )}
        {subject?.sections?.length ? (
          <>
            <T v="label">Section</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {subject.sections.map((sec) => (
                <Chip key={sec} label={`Section ${sec}`} active={form.section === sec} onPress={() => set({ section: sec })} />
              ))}
            </View>
          </>
        ) : null}
        <T v="label">Period</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((p) => (
            <Chip key={p} label={`P${p}`} active={form.period === String(p)} onPress={() => set({ period: String(p) })} />
          ))}
        </View>
        <T v="label">Day</T>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="Today" active={form.date === todayKey()} onPress={() => set({ date: todayKey() })} />
          <Chip label="Yesterday" active={form.date === yesterdayKey()} onPress={() => set({ date: yesterdayKey() })} />
        </View>
      </Card>

      {!ready ? (
        <Card>
          <EmptyState icon={ClipboardList} title="Choose a class" text="Pick the subject, section and period to load your students." />
        </Card>
      ) : roster.isFetching && !r ? (
        <Loading />
      ) : roster.error ? (
        <ErrorState error={roster.error} onRetry={roster.refetch} />
      ) : r && !r.students.length ? (
        <Card>
          <EmptyState icon={Users} title="No students in this class" text="Students appear once an admin assigns them to this department and section." />
        </Card>
      ) : r ? (
        <>
          <View style={{ gap: 2 }}>
            <T v="h3">
              {r.subject.code}
              {r.section ? ` · Section ${r.section}` : ''} · P{r.period}
            </T>
            <T v="small">
              {fmtClassDay(r.date, 'EEEE, dd MMM')}
              {r.alreadyMarked ? ` · marked by ${r.markedBy?.name || 'staff'}` : ''}
            </T>
          </View>
          {!r.editable ? <LockNote text={r.lockedReason} /> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button small variant="success" title="All present" disabled={!r.editable} onPress={() => setMarks(Object.fromEntries(r.students.map((s) => [s._id, 'present'])))} />
            <Button small variant="danger" title="All absent" disabled={!r.editable} onPress={() => setMarks(Object.fromEntries(r.students.map((s) => [s._id, 'absent'])))} />
          </View>
          <Card padded={false}>
            {r.students.map((s, i) => (
              <View key={s._id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: 'rgba(29,111,235,0.1)' }}>
                <View style={{ flex: 1 }}>
                  <T v="strong" numberOfLines={1}>
                    {s.name}
                  </T>
                  <T v="small">{s.rollNo || '—'}</T>
                </View>
                <StatusButtons value={marks[s._id]} options={STUDENT_OPTIONS} disabled={!r.editable} onChange={(v) => setMarks((m) => ({ ...m, [s._id]: v }))} />
              </View>
            ))}
          </Card>
          <T v="small" style={{ textAlign: 'center' }}>
            {counts.present || 0} present · {counts.absent || 0} absent · {r.students.length} students
          </T>
          <Button title="Save attendance" icon={Save} onPress={submit} loading={saving} disabled={!r.editable} />
        </>
      ) : null}
    </>
  );
}

/* ── Daily summary + view-all lists ───────────────────────────── */
function Stat({ label, value, tone }) {
  return (
    <Card style={{ width: '47.8%', gap: 2 }}>
      <T v="label">{label}</T>
      <T v="h2" style={tone ? { color: tone } : null}>
        {value ?? '—'}
      </T>
    </Card>
  );
}

function DailySummary() {
  const [date, setDate] = useState(todayKey());
  const [who, setWho] = useState('students');
  const [status, setStatus] = useState('absent');
  const params = { date, ...(status ? { status } : {}) };
  const summary = useGetAttendanceSummaryQuery({ date });
  const students = useGetSummaryStudentsQuery(params, { skip: who !== 'students' });
  const faculty = useGetSummaryFacultyQuery(params, { skip: who !== 'faculty' });
  const list = who === 'students' ? students : faculty;
  const rows = (who === 'students' ? students.data?.students : faculty.data?.faculty) || [];
  const s = summary.data?.students;
  const f = summary.data?.faculty;

  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="Today" active={date === todayKey()} onPress={() => setDate(todayKey())} />
        <Chip label="Yesterday" active={date === yesterdayKey()} onPress={() => setDate(yesterdayKey())} />
      </View>
      {summary.isLoading ? (
        <Loading />
      ) : summary.error ? (
        <ErrorState error={summary.error} onRetry={summary.refetch} />
      ) : (
        <>
          <T v="small">{summary.data.department}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <Stat label="Students" value={s.total} />
            <Stat label="Present" value={s.present} tone={colors.success} />
            <Stat label="Absent" value={s.absent} tone={colors.danger} />
            <Stat label="Not marked" value={s.unmarked} />
            <Stat label="Faculty present" value={`${f.present}/${f.total}`} tone={colors.success} />
            <Stat label="Faculty absent" value={f.absent + f.leave} tone={colors.danger} />
          </View>
        </>
      )}

      <Segmented
        value={who}
        onChange={(w) => {
          setWho(w);
          setStatus('absent');
        }}
        options={[
          { value: 'students', label: 'Students' },
          { value: 'faculty', label: 'Faculty' },
        ]}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {[
          ['absent', 'Absent'],
          ['present', 'Present'],
          ...(who === 'faculty' ? [['leave', 'Leave']] : []),
          ['unmarked', 'Not marked'],
          ['', 'All'],
        ].map(([v, l]) => (
          <Chip key={v || 'all'} label={l} active={status === v} onPress={() => setStatus(v)} />
        ))}
      </View>
      {list.isFetching && !list.data ? (
        <Loading />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : !rows.length ? (
        <Card>
          <EmptyState icon={Users} title="Nobody here" text="No one matches this filter for the day." />
        </Card>
      ) : (
        <Card padded={false}>
          {rows.map((row, i) => (
            <View key={row._id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderTopWidth: i ? 1 : 0, borderColor: 'rgba(29,111,235,0.1)' }}>
              <Avatar user={row} size={36} />
              <View style={{ flex: 1 }}>
                <T v="strong" numberOfLines={1}>
                  {row.name}
                </T>
                <T v="small" numberOfLines={1}>
                  {who === 'students' ? [row.rollNo, row.section && `Sec ${row.section}`].filter(Boolean).join(' · ') : [row.employeeId, row.department].filter(Boolean).join(' · ')}
                  {row.phone ? ` · ${row.phone}` : ''}
                </T>
              </View>
              {row.status === 'unmarked' ? <Badge label="Not marked" color="neutral" /> : <StatusBadge status={row.status} />}
              {row.phone ? (
                <Pressable onPress={() => Linking.openURL(`tel:${row.phone}`).catch(() => {})} hitSlop={8} accessibilityLabel={`Call ${row.name}`} style={{ padding: 6 }}>
                  <Phone size={18} color={colors.primary} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </Card>
      )}
    </>
  );
}

/* ── HOD / admin: faculty attendance ──────────────────────────── */
function FacultyMarking() {
  const [date, setDate] = useState(todayKey());
  const roster = useGetFacultyRosterQuery({ date }, { refetchOnMountOrArgChange: true });
  const [marks, setMarks] = useState({});
  const [save, { isLoading: saving }] = useMarkFacultyAttendanceMutation();
  const r = roster.data;

  useEffect(() => {
    if (r) setMarks(Object.fromEntries(r.faculty.map((f) => [f._id, f.status || 'present'])));
  }, [r]);

  const submit = async () => {
    try {
      const res = await save({ date, records: Object.entries(marks).map(([faculty, status]) => ({ faculty, status })) }).unwrap();
      Alert.alert('Saved', res.message);
    } catch (e) {
      Alert.alert('Could not save', errMsg(e));
    }
  };

  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="Today" active={date === todayKey()} onPress={() => setDate(todayKey())} />
        <Chip label="Yesterday" active={date === yesterdayKey()} onPress={() => setDate(yesterdayKey())} />
      </View>
      {roster.isLoading ? (
        <Loading />
      ) : roster.error ? (
        <ErrorState error={roster.error} onRetry={roster.refetch} />
      ) : !r.faculty.length ? (
        <Card>
          <EmptyState icon={Users} title="No faculty to mark" />
        </Card>
      ) : (
        <>
          <T v="small">{r.department}</T>
          {!r.editable ? <LockNote text={r.lockedReason} /> : null}
          <Card padded={false}>
            {r.faculty.map((f, i) => (
              <View key={f._id} style={{ padding: 12, gap: 8, borderTopWidth: i ? 1 : 0, borderColor: 'rgba(29,111,235,0.1)' }}>
                <View>
                  <T v="strong" numberOfLines={1}>
                    {f.name}
                  </T>
                  <T v="small" numberOfLines={1}>
                    {[f.employeeId, f.designation, f.department].filter(Boolean).join(' · ')}
                  </T>
                </View>
                <StatusButtons value={marks[f._id]} options={FACULTY_OPTIONS} disabled={!r.editable} onChange={(v) => setMarks((m) => ({ ...m, [f._id]: v }))} />
              </View>
            ))}
          </Card>
          <Button title="Save faculty attendance" icon={Save} onPress={submit} loading={saving} disabled={!r.editable} />
        </>
      )}
    </>
  );
}

/** Attendance for staff: faculty mark their classes, HOD/admin also see the day and mark faculty; principal views. */
export default function StaffAttendance() {
  const me = useSelector(selectUser);
  const tabs = [
    ...(me.role !== 'principal' ? [{ value: 'mark', label: 'Mark class' }] : []),
    ...(SUMMARY_VIEW.includes(me.role) ? [{ value: 'today', label: 'Daily summary' }] : []),
    ...(['admin', 'hod'].includes(me.role) ? [{ value: 'faculty', label: 'Faculty' }] : []),
  ];
  const [tab, setTab] = useState(tabs[0]?.value);

  return (
    <Screen>
      <Header back title="Attendance" subtitle={me.role === 'hod' ? `${me.department} department` : me.role === 'faculty' ? 'Your classes' : 'Whole college'} />
      {tabs.length > 1 ? <Segmented value={tab} onChange={setTab} options={tabs} /> : null}
      {tab === 'mark' && <MarkClass />}
      {tab === 'today' && <DailySummary />}
      {tab === 'faculty' && <FacultyMarking />}
    </Screen>
  );
}
