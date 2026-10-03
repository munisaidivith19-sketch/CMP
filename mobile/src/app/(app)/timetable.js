import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useSelector } from 'react-redux';
import { CalendarClock, Clock, Coffee, GraduationCap, MapPin, User } from 'lucide-react-native';
import { Badge, Button, Card, EmptyState, ErrorState, Header, Loading, Screen, Segmented, T } from '../../components/ui';
import { useGetTimetableQuery } from '../../services/api';
import { selectUser } from '../../store/authSlice';
import { STUDENT_ROLES, YEAR_LABELS, colors } from '../../theme';
import { to12h } from '../../utils/format';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const todayName = () => ['sunday', ...DAYS][new Date().getDay()];
const hhmm = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function Timetable() {
  const me = useSelector(selectUser);
  const isFaculty = me.role === 'faculty';
  // Faculty: "Our Class" = the complete timetable of their Class In-Charge
  // class; "Handling Class" = only the periods they teach. Same server scope
  // as the web app — the client only names which one it wants.
  const [scope, setScope] = useState('class');
  const chosen = useRef(false);
  const { data, isLoading, isFetching, error, refetch } = useGetTimetableQuery(isFaculty ? { scope } : undefined);
  useEffect(() => {
    if (!isFaculty || chosen.current || !data || scope !== 'class') return;
    chosen.current = true;
    if (!data.classInCharge) setScope('handling');
  }, [isFaculty, data, scope]);
  const pickScope = (v) => {
    chosen.current = true;
    setScope(v);
  };
  const ourClass = isFaculty && scope === 'class' ? data?.classInCharge : null;
  const noOurClass = isFaculty && scope === 'class' && data && !data.classInCharge;
  const [day, setDay] = useState(DAYS.includes(todayName()) ? todayName() : 'monday');
  const [now, setNow] = useState(hhmm());
  useEffect(() => {
    const t = setInterval(() => setNow(hhmm()), 30000);
    return () => clearInterval(t);
  }, []);

  const slots = useMemo(() => (data?.slots || []).filter((s) => s.dayOfWeek === day).sort((a, b) => a.startTime.localeCompare(b.startTime)), [data, day]);
  const isToday = day === todayName();
  const next = isToday ? slots.find((s) => !s.isBreak && s.startTime > now) : null;

  return (
    <Screen refreshing={isFetching && !isLoading} onRefresh={refetch}>
      <Header
        back
        title="Timetable"
        subtitle={
          STUDENT_ROLES.includes(me.role)
            ? me.section
              ? `${me.department} · ${YEAR_LABELS[me.year] || ''} · Section ${me.section}${me.semester ? ` · Sem ${me.semester}` : ''}`
              : 'Your class schedule'
            : ourClass
              ? `Our Class · ${YEAR_LABELS[ourClass.year]} · Sec ${ourClass.section} · Sem ${ourClass.semester}`
              : isFaculty && scope === 'handling'
                ? 'Handling Class · the periods you teach'
                : 'Your teaching schedule'
        }
      />
      {isFaculty ? (
        <Segmented
          value={scope}
          onChange={pickScope}
          options={[
            { value: 'class', label: 'Our Class' },
            { value: 'handling', label: 'Handling Class' },
          ]}
        />
      ) : null}
      <Segmented value={day} onChange={setDay} options={DAYS.map((d) => ({ value: d, label: d === todayName() ? 'Today' : d.slice(0, 3).replace(/^./, (c) => c.toUpperCase()) }))} />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : noOurClass ? (
        <Card>
          <EmptyState
            icon={GraduationCap}
            title="No class is currently assigned to you as Class In-Charge."
            text="Your own teaching periods are under Handling Class."
            action={<Button title="Show Handling Class" variant="soft" small onPress={() => pickScope('handling')} />}
          />
        </Card>
      ) : data.needsSection ? (
        <Card>
          <EmptyState icon={CalendarClock} title="Your section isn’t set yet" text="An administrator assigns your department, section and semester. Your timetable appears here automatically after that." />
        </Card>
      ) : !slots.length ? (
        <Card>
          <EmptyState icon={Coffee} title="No classes" text="Nothing scheduled on this day." />
        </Card>
      ) : (
        slots.map((s) => {
          if (s.isBreak) {
            return (
              <View key={s._id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary300 }}>
                <Coffee size={16} color={colors.soft} />
                <T v="small" style={{ flex: 1 }}>{s.breakLabel || 'Break'}</T>
                <T v="small">{to12h(s.startTime)} – {to12h(s.endTime)}</T>
              </View>
            );
          }
          const current = isToday && s.startTime <= now && s.endTime > now;
          const past = isToday && s.endTime <= now;
          return (
            <Card key={s._id} style={[{ gap: 6, opacity: past ? 0.55 : 1 }, current && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <T v="label" style={{ color: current ? 'rgba(255,255,255,0.85)' : colors.primary }}>
                  {s.subject?.code} · Period {s.period}
                </T>
                {current ? <Badge label="Now" color="neutral" style={{ backgroundColor: 'rgba(255,255,255,0.25)' }} /> : s === next ? <Badge label="Next" color="info" /> : s.subject?.type === 'lab' ? <Badge label="Lab" color="warning" /> : null}
              </View>
              <T v="h3" style={current && { color: '#fff' }}>
                {s.subject?.name}
              </T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {[
                  [Clock, `${to12h(s.startTime)} – ${to12h(s.endTime)}`],
                  s.room ? [MapPin, s.room] : null,
                  STUDENT_ROLES.includes(me.role) || ourClass ? [User, s.faculty?.name] : null,
                  STUDENT_ROLES.includes(me.role) ? null : [GraduationCap, `${YEAR_LABELS[s.year] || `Year ${s.year}`} · Sec ${s.section} · Sem ${s.semester} · ${s.department}`],
                ]
                  .filter(Boolean)
                  .map(([Icon, label]) => (
                    <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Icon size={13} color={current ? '#fff' : colors.soft} />
                      <T v="small" style={current && { color: 'rgba(255,255,255,0.9)' }}>
                        {label}
                      </T>
                    </View>
                  ))}
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
