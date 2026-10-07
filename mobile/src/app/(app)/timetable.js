import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSelector } from 'react-redux';
import { CalendarClock, Clock, Coffee, GraduationCap, MapPin, User } from 'lucide-react-native';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, Header, Loading, Screen, Segmented, T } from '../../components/ui';
import { useGetFacultyAvailabilityQuery, useGetMasterTimetableQuery, useGetTimetableQuery } from '../../services/api';
import { selectUser } from '../../store/authSlice';
import { DEPARTMENTS, STUDENT_ROLES, YEAR_LABELS, colors, isFirstYearHod } from '../../theme';
import { displayName, to12h } from '../../utils/format';
import HolidayCard from '../../components/HolidayCard';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const todayName = () => ['sunday', ...DAYS][new Date().getDay()];
const hhmm = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function Timetable() {
  const me = useSelector(selectUser);
  const isFaculty = me.role === 'faculty';
  const isHod = me.role === 'hod';
  const isFYH = isFirstYearHod(me);
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  // Faculty: "Our Class" = the complete timetable of their Class In-Charge
  // class; "Handling Class" = only the periods they teach. Same server scope
  // as the web app — the client only names which one it wants.
  const [scope, setScope] = useState('class');
  const [hodTab, setHodTab] = useState('master');
  const chosen = useRef(false);
  const [day, setDay] = useState(DAYS.includes(todayName()) ? todayName() : 'monday');
  const queryParams = isFaculty ? { scope } : isFYH && selectedDept ? { department: selectedDept } : undefined;
  const { data: regularData, isLoading: regLoading, isFetching: regFetching, error: regError, refetch: regRefetch } = useGetTimetableQuery(queryParams, { skip: isHod });
  const { data: masterData, isLoading: masterLoading, isFetching: masterFetching, error: masterError, refetch: masterRefetch } = useGetMasterTimetableQuery(
    { ...(isFYH && selectedDept ? { department: selectedDept } : {}), ...(selectedYear ? { year: selectedYear } : {}) },
    { skip: !isHod || hodTab !== 'master' }
  );
  const { data: availData, isLoading: availLoading, isFetching: availFetching, error: availError, refetch: availRefetch } = useGetFacultyAvailabilityQuery(
    { dayOfWeek: day, ...(isFYH && selectedDept ? { department: selectedDept } : {}) },
    { skip: !isHod || hodTab !== 'availability' }
  );

  const data = isHod ? (hodTab === 'availability' ? availData : masterData) : regularData;
  const isLoading = isHod ? (hodTab === 'availability' ? availLoading : masterLoading) : regLoading;
  const isFetching = isHod ? (hodTab === 'availability' ? availFetching : masterFetching) : regFetching;
  const error = isHod ? (hodTab === 'availability' ? availError : masterError) : regError;
  const refetch = isHod ? (hodTab === 'availability' ? availRefetch : masterRefetch) : regRefetch;

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
  const [now, setNow] = useState(hhmm());
  useEffect(() => {
    const t = setInterval(() => setNow(hhmm()), 30000);
    return () => clearInterval(t);
  }, []);

  const slots = useMemo(() => (data?.slots || []).filter((s) => s.dayOfWeek === day).sort((a, b) => a.startTime.localeCompare(b.startTime)), [data, day]);
  const isToday = day === todayName();
  // Holidays are annotated per slot by the server for this week's date.
  const next = isToday ? slots.find((s) => !s.isBreak && !s.holiday && s.startTime > now) : null;
  const classes = slots.filter((s) => !s.isBreak);
  const dayHoliday = classes.length && classes.every((s) => s.holiday) ? classes[0].holiday : null;

  // Group slots by class for HOD master view
  const slotsByClass = useMemo(() => {
    if (!isHod) return [];
    const map = new Map();
    (slots || []).forEach((s) => {
      const key = `${s.department} · Year ${s.year} · Sec ${s.section} (Sem ${s.semester})`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    });
    return [...map.entries()].map(([className, classSlots]) => ({
      className,
      slots: classSlots.sort((a, b) => a.startTime.localeCompare(b.startTime)),
    }));
  }, [slots, isHod]);

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
            : isHod
              ? `Master Timetable · ${isFYH ? (selectedDept || 'All Departments (Year 1)') : me.department || 'Department'}`
              : ourClass
                ? `Our Class · ${YEAR_LABELS[ourClass.year]} · Sec ${ourClass.section} · Sem ${ourClass.semester}`
                : isFaculty && scope === 'handling'
                  ? 'Handling Class · the periods you teach'
                  : 'Your teaching schedule'
        }
      />
      {isFYH ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
          <Chip label="All Departments" active={!selectedDept} onPress={() => setSelectedDept('')} />
          {DEPARTMENTS.filter((d) => d !== 'Science & Humanities').map((d) => (
            <Chip key={d} label={d} active={selectedDept === d} onPress={() => setSelectedDept(d)} />
          ))}
        </ScrollView>
      ) : null}
      {isHod && !isFYH ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
          <Chip label="All Years (2–4)" active={!selectedYear} onPress={() => setSelectedYear('')} />
          {[2, 3, 4].map((y) => (
            <Chip key={y} label={YEAR_LABELS[y] || `Year ${y}`} active={selectedYear === y} onPress={() => setSelectedYear(y)} />
          ))}
        </ScrollView>
      ) : null}
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
      {isHod ? (
        <Segmented
          value={hodTab}
          onChange={setHodTab}
          options={[
            { value: 'master', label: 'Master Schedule' },
            { value: 'availability', label: 'Faculty Availability' },
          ]}
        />
      ) : null}
      <Segmented value={day} onChange={setDay} options={DAYS.map((d) => ({ value: d, label: d === todayName() ? 'Today' : d.slice(0, 3).replace(/^./, (c) => c.toUpperCase()) }))} />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isHod && hodTab === 'availability' ? (
        (availData?.faculties || []).length === 0 ? (
          <Card>
            <EmptyState icon={User} title="No faculty found" text="No department faculty members found." />
          </Card>
        ) : (
          (availData?.faculties || []).map((f) => (
            <Card key={f._id} style={{ gap: 10, padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: 'rgba(0,0,0,0.06)', paddingBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(16, 185, 129, 0.15)', alignItems: 'center', justifyContent: 'center' }}>
                    <User size={16} color="#059669" />
                  </View>
                  <View>
                    <T v="strong" style={{ color: colors.ink }}>{f.name}</T>
                    <T v="small" style={{ color: colors.soft }}>{f.designation || 'Faculty'}{f.employeeId ? ` · ${f.employeeId}` : ''}</T>
                  </View>
                </View>
                <Badge label={`${f.freePeriods} Free / ${f.busyPeriods} Class`} color={f.freePeriods > 0 ? 'success' : 'neutral'} />
              </View>
              <View style={{ gap: 6 }}>
                {(f.periods || []).map((pItem, idx) => {
                  if (pItem.isBreak) {
                    return (
                      <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6, borderRadius: 10, backgroundColor: 'rgba(245, 158, 11, 0.08)' }}>
                        <Coffee size={12} color="#d97706" />
                        <T v="small" style={{ color: '#b45309' }}>{pItem.breakLabel || 'Break'} ({to12h(pItem.startTime)} – {to12h(pItem.endTime)})</T>
                      </View>
                    );
                  }
                  if (pItem.status === 'free') {
                    return (
                      <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 8, borderRadius: 10, backgroundColor: 'rgba(16, 185, 129, 0.08)', borderWidth: 1, borderColor: 'rgba(16, 185, 129, 0.2)' }}>
                        <T v="small" style={{ fontWeight: 'bold', color: '#047857' }}>Period {pItem.period} ({to12h(pItem.startTime)} – {to12h(pItem.endTime)})</T>
                        <Badge label="Available" color="success" size="small" />
                      </View>
                    );
                  }
                  if (pItem.status === 'holiday') {
                    return (
                      <View key={idx} style={{ padding: 6, borderRadius: 10, backgroundColor: colors.dangerSoft }}>
                        <T v="small" style={{ color: '#be123c' }}>Period {pItem.period}: Holiday</T>
                      </View>
                    );
                  }
                  const slot = pItem.slot;
                  return (
                    <View key={idx} style={{ padding: 8, borderRadius: 10, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', gap: 2 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <T v="strong" style={{ color: colors.primary }}>Period {pItem.period} · {slot?.subject?.code || 'CLASS'}</T>
                        {slot?.room ? <T v="small" style={{ color: colors.soft }}>Rm {slot.room}</T> : null}
                      </View>
                      <T v="small" style={{ color: colors.ink }}>{slot ? `${slot.department} · Y${slot.year} Sec ${slot.section}` : 'In Class'}</T>
                    </View>
                  );
                })}
              </View>
            </Card>
          ))
        )
      ) : isHod ? (
        slotsByClass.length === 0 ? (
          <Card>
            <EmptyState icon={Coffee} title="No classes scheduled" text="Nothing scheduled for this day." />
          </Card>
        ) : (
          slotsByClass.map(({ className, slots: cSlots }) => (
            <Card key={className} style={{ gap: 10, padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: 'rgba(0,0,0,0.06)', paddingBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <GraduationCap size={16} color={colors.primary} />
                  <T v="strong" style={{ color: colors.ink }}>{className}</T>
                </View>
                <Badge label={`${cSlots.filter((s) => !s.isBreak).length} periods`} color="neutral" />
              </View>
              <View style={{ gap: 8 }}>
                {cSlots.map((s) => {
                  if (s.isBreak) {
                    return (
                      <View key={s._id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 12, backgroundColor: 'rgba(245, 158, 11, 0.1)' }}>
                        <Coffee size={14} color="#d97706" />
                        <T v="small" style={{ color: '#b45309', fontWeight: 'bold' }}>{s.breakLabel || 'Break'} ({to12h(s.startTime)} – {to12h(s.endTime)})</T>
                      </View>
                    );
                  }
                  if (s.holiday) {
                    return (
                      <View key={s._id} style={{ padding: 8, borderRadius: 12, backgroundColor: colors.dangerSoft }}>
                        <T v="small" style={{ color: '#be123c', fontWeight: 'bold' }}>Holiday · P{s.period}: {s.holiday.reason}</T>
                      </View>
                    );
                  }
                  return (
                    <View key={s._id} style={{ padding: 10, borderRadius: 14, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', gap: 4 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <T v="strong" style={{ color: colors.primary }}>
                          P{s.period} · {s.subject?.code}
                        </T>
                        {s.subject?.type === 'lab' ? <Badge label="Lab" color="warning" /> : null}
                      </View>
                      <T v="body" style={{ fontWeight: '600' }}>{s.subject?.name}</T>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 2 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Clock size={12} color={colors.muted} />
                          <T v="small" style={{ color: colors.muted }}>{to12h(s.startTime)} – {to12h(s.endTime)}</T>
                        </View>
                        {s.faculty?.name ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <User size={12} color={colors.muted} />
                            <T v="small" style={{ color: colors.muted, fontWeight: 'bold' }}>{s.faculty.name}</T>
                          </View>
                        ) : null}
                        {s.room ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <MapPin size={12} color={colors.muted} />
                            <T v="small" style={{ color: colors.muted }}>{s.room}</T>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            </Card>
          ))
        )
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
        [dayHoliday ? <HolidayCard key="holiday" holiday={dayHoliday} text="No classes scheduled · Attendance unavailable" /> : null].concat(slots.map((s) => {
          if (s.holiday) {
            return (
              <Card key={s._id} style={{ gap: 4, backgroundColor: colors.dangerSoft, borderColor: 'rgba(244,63,94,0.3)' }}>
                <T v="label" style={{ color: '#be123c' }}>
                  HOLIDAY · Period {s.period}
                </T>
                <T v="strong">{s.holiday.reason}</T>
                <T v="small" style={{ textDecorationLine: 'line-through' }}>
                  {s.subject?.code} · {s.subject?.name}
                </T>
                <T v="small">
                  {to12h(s.startTime)} – {to12h(s.endTime)} · No class · Attendance unavailable
                </T>
              </Card>
            );
          }
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
                  STUDENT_ROLES.includes(me.role) || ourClass ? [User, displayName(s.faculty)] : null,
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
        }))
      )}
    </Screen>
  );
}
