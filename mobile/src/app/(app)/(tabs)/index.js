import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { LinearGradient } from 'expo-linear-gradient';
import { format } from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, CalendarCheck2, CalendarClock, CalendarDays, ClipboardCheck, DoorOpen, Megaphone, MessageCircle, Search, Shapes, Sparkles } from 'lucide-react-native';
import { Avatar, Badge, Card, ErrorState, IconButton, IconTile, Loading, Screen, SectionTitle, T } from '../../../components/ui';
import {
  useGetAttendanceSummaryQuery,
  useGetChatUnreadQuery,
  useGetCurrentClassQuery,
  useGetDashboardQuery,
  useGetGatePassesQuery,
  useGetMyAttendanceQuery,
} from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { STUDENT_ROLES, SUMMARY_VIEW, colors, fonts, gradients } from '../../../theme';
import { fmtDateTime, timeAgo, to12h } from '../../../utils/format';

/** "Dr. Suresh Kumar" → "Suresh" — skip honorifics in the greeting. */
const firstName = (name = '') => name.split(' ').find((w) => w && !/^(dr|prof|mr|mrs|ms|miss)[.]?$/i.test(w)) || name;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Tile({ icon, gradient, label, value, hint, onPress }) {
  return (
    <Card onPress={onPress} style={{ width: '47.8%', gap: 10 }}>
      <IconTile icon={icon} gradient={gradient} size={38} />
      <View>
        <T v="label">{label}</T>
        <T v="strong" numberOfLines={1}>
          {value}
        </T>
        {hint ? (
          <T v="small" numberOfLines={1}>
            {hint}
          </T>
        ) : null}
      </View>
    </Card>
  );
}

/** Small card that slides up from the bottom with a 2–3 item preview and "View all". */
function Sheet({ title, viewAll, onClose, children }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(27,29,58,0.35)' }} onPress={onClose} accessibilityLabel="Close" />
      <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 18, paddingBottom: 18 + insets.bottom, gap: 10, maxHeight: '75%' }}>
        <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(92,95,126,0.25)' }} />
        <T v="h3">{title}</T>
        <ScrollView contentContainerStyle={{ gap: 8 }}>{children}</ScrollView>
        {viewAll ? (
          <Pressable
            onPress={() => {
              onClose();
              router.push(viewAll);
            }}
            style={({ pressed }) => ({ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 16, backgroundColor: pressed ? colors.primary100 : colors.primarySoft })}
            accessibilityRole="button"
          >
            <T v="strong" style={{ color: colors.primary600 }}>
              View all
            </T>
            <ArrowRight size={16} color={colors.primary600} />
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

function Row({ label, value, tone }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.75)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 }}>
      <T v="small">{label}</T>
      <T v="strong" style={tone ? { color: tone } : null}>
        {value ?? '—'}
      </T>
    </View>
  );
}

function EventLine({ e, onPress }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.75)' }}>
      <LinearGradient colors={gradients.sky} style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
        <T v="small" style={{ color: '#fff', fontSize: 9, fontFamily: fonts.bold }}>
          {format(new Date(e.startDate), 'MMM').toUpperCase()}
        </T>
        <T v="h3" style={{ color: '#fff', lineHeight: 18 }}>
          {format(new Date(e.startDate), 'dd')}
        </T>
      </LinearGradient>
      <View style={{ flex: 1 }}>
        <T v="strong" numberOfLines={1}>
          {e.title}
        </T>
        <T v="small" numberOfLines={1}>
          {e.venue} · {format(new Date(e.startDate), 'h:mm a')}
        </T>
      </View>
      {e.myStatus ? <Badge label={e.myStatus} color={e.myStatus === 'waitlisted' ? 'warning' : 'success'} /> : null}
    </Pressable>
  );
}

export default function Home() {
  const user = useSelector(selectUser);
  const isStudent = STUDENT_ROLES.includes(user.role);
  const seesSummary = SUMMARY_VIEW.includes(user.role);
  const isHod = user.role === 'hod';
  const [sheet, setSheet] = useState(null);
  const close = () => setSheet(null);

  const dash = useGetDashboardQuery();
  const now = useGetCurrentClassQuery(undefined, { pollingInterval: 120000 });
  const att = useGetMyAttendanceQuery({ range: 'semester' }, { skip: !isStudent });
  const summary = useGetAttendanceSummaryQuery(undefined, { skip: !seesSummary, pollingInterval: 120000 });
  const passes = useGetGatePassesQuery({ limit: 5 }, { skip: !isStudent });
  const unread = useGetChatUnreadQuery();

  const refreshing = dash.isFetching && !dash.isLoading;
  const onRefresh = () => [dash, now, att, summary, passes, unread].forEach((q) => !q.isUninitialized && q.refetch());
  const cls = now.data?.current || now.data?.next;
  const open = passes.data?.passes?.find((p) => ['pending', 'approved', 'active'].includes(p.status));
  const o = att.data?.overall;
  const low = o && o.totalPeriods > 0 && o.percentage < att.data.threshold;
  const s = summary.data?.students;
  const f = summary.data?.faculty;
  const d = dash.data;
  const upcoming = d ? (d.stats.upcomingRegistrations ? d.myUpcoming : d.upcomingEvents) || [] : [];

  let attValue = '—';
  let attHint;
  if (isStudent) {
    attValue = o ? `${o.percentage}%` : '—';
    attHint = o ? (low ? `Below ${att.data.threshold}%` : `${o.presentPeriods}/${o.totalPeriods} periods`) : undefined;
  } else if (seesSummary) {
    attValue = s ? (isHod ? `${s.absent} absent` : `${s.percentage}% present`) : summary.isLoading ? '…' : '—';
    attHint = s ? (isHod ? `of ${s.total} students today` : `${s.present}/${s.total} students`) : 'Tap for today';
  } else {
    attValue = 'Mark classes';
    attHint = 'Your sections';
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Avatar user={user} size={46} />
        <View style={{ flex: 1 }}>
          <T v="small">{greeting()},</T>
          <T v="h2" numberOfLines={1}>
            {firstName(user.name)} 👋
          </T>
        </View>
        <IconButton icon={CalendarDays} label="Calendar" onPress={() => router.push('/calendar')} />
        <IconButton icon={Search} label="Search" onPress={() => router.push('/search')} />
      </View>

      <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 28, padding: 18, gap: 6 }}>
        <T v="small" style={{ color: 'rgba(255,255,255,0.85)' }}>
          {format(new Date(), 'EEEE, dd MMMM')}
        </T>
        <T v="h2" style={{ color: '#fff' }}>
          {cls ? `${now.data?.current ? 'Now' : 'Next'}: ${cls.subject?.name}` : now.data?.today?.length ? 'Classes are done for today' : 'No classes today'}
        </T>
        {cls ? (
          <T v="small" style={{ color: 'rgba(255,255,255,0.85)' }}>
            {to12h(cls.startTime)} – {to12h(cls.endTime)}
            {cls.room ? ` · ${cls.room}` : ''}
            {cls.faculty && isStudent ? ` · ${cls.faculty.name}` : ''}
            {!isStudent && cls.section ? ` · Section ${cls.section}` : ''}
          </T>
        ) : null}
      </LinearGradient>

      {dash.isLoading ? (
        <Loading />
      ) : dash.error ? (
        <ErrorState error={dash.error} onRetry={dash.refetch} />
      ) : (
        <>
          {/* Notice board first */}
          <SectionTitle title="Notice board" action="See all" onAction={() => router.push('/announcements')} />
          {d.announcements.length ? (
            d.announcements.slice(0, 3).map((a) => (
              <Card key={a._id} onPress={() => router.push('/announcements')} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Megaphone size={16} color={colors.primary} />
                  <T v="strong" style={{ flex: 1 }} numberOfLines={1}>
                    {a.title}
                  </T>
                  {a.priority !== 'normal' ? <Badge label={a.priority} color={a.priority === 'urgent' ? 'danger' : 'warning'} /> : null}
                </View>
                <T v="small" numberOfLines={2}>
                  {a.content}
                </T>
                <T v="small" style={{ color: colors.muted }}>
                  {a.author?.name} · {timeAgo(a.createdAt)}
                </T>
              </Card>
            ))
          ) : (
            <Card>
              <T v="small">No announcements yet.</T>
            </Card>
          )}

          {/* Small cards — tap for a quick preview */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <Tile icon={Shapes} gradient={gradients.violet} label="My clubs" value={`${d.stats.myClubs} club${d.stats.myClubs === 1 ? '' : 's'}`} hint="Tap to preview" onPress={() => setSheet('clubs')} />
            <Tile icon={CalendarCheck2} gradient={gradients.sky} label="Upcoming" value={`${d.stats.upcomingRegistrations} registered`} hint="Tap to preview" onPress={() => setSheet('upcoming')} />
            <Tile
              icon={ClipboardCheck}
              gradient={low ? gradients.rose : gradients.emerald}
              label={isHod ? 'Dept attendance' : 'Attendance'}
              value={attValue}
              hint={attHint}
              onPress={() => (seesSummary ? setSheet('attendance') : router.push('/attendance'))}
            />
            <Tile icon={MessageCircle} gradient={gradients.primary} label="Messages" value={unread.data?.total ? `${unread.data.total} unread` : 'All caught up'} onPress={() => router.push('/chat')} />
            <Tile icon={CalendarClock} gradient={gradients.amber} label="Timetable" value={`${now.data?.today?.filter((x) => !x.isBreak).length ?? 0} classes today`} onPress={() => router.push('/timetable')} />
            <Tile
              icon={DoorOpen}
              gradient={gradients.cyan}
              label="Gate pass"
              value={isStudent ? (open ? open.status : 'No active pass') : 'Review passes'}
              hint={open ? `Return ${fmtDateTime(open.expectedReturn)}` : undefined}
              onPress={() => router.push('/gate-pass')}
            />
          </View>

          {/* Recommended */}
          {d.recommended.length ? (
            <>
              <SectionTitle title="Recommended for you" action="All events" onAction={() => router.push('/events')} />
              {d.recommended.slice(0, 3).map((e) => (
                <Card key={e._id} onPress={() => router.push(`/events/${e._id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <IconTile icon={Sparkles} gradient={gradients.hero} size={42} />
                  <View style={{ flex: 1 }}>
                    <T v="strong" numberOfLines={1}>
                      {e.title}
                    </T>
                    <T v="small" numberOfLines={1}>
                      {format(new Date(e.startDate), 'EEE, dd MMM · h:mm a')} · {e.venue}
                    </T>
                  </View>
                </Card>
              ))}
            </>
          ) : null}

          {sheet === 'clubs' ? (
            <Sheet title="My clubs" viewAll="/clubs" onClose={close}>
              {d.myClubs.length ? (
                d.myClubs.slice(0, 3).map((c) => (
                  <Pressable
                    key={c._id}
                    onPress={() => {
                      close();
                      router.push(`/clubs/${c.slug}`);
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.75)' }}
                  >
                    <Avatar name={c.name} uri={c.logo} size={40} />
                    <View style={{ flex: 1 }}>
                      <T v="strong" numberOfLines={1}>
                        {c.name}
                      </T>
                      <T v="small">{c.memberCount} members</T>
                    </View>
                  </Pressable>
                ))
              ) : (
                <T v="small">You haven’t joined a club yet.</T>
              )}
            </Sheet>
          ) : null}

          {sheet === 'upcoming' ? (
            <Sheet title={d.stats.upcomingRegistrations ? 'Your upcoming events' : 'Upcoming on campus'} viewAll="/events" onClose={close}>
              {upcoming.length ? (
                upcoming.slice(0, 3).map((e) => (
                  <EventLine
                    key={e._id}
                    e={e}
                    onPress={() => {
                      close();
                      router.push(`/events/${e._id}`);
                    }}
                  />
                ))
              ) : (
                <T v="small">No upcoming events.</T>
              )}
            </Sheet>
          ) : null}

          {sheet === 'attendance' ? (
            <Sheet title={isHod ? `Today · ${summary.data?.department || 'Your department'}` : 'Today · whole college'} viewAll="/attendance" onClose={close}>
              {summary.isLoading ? (
                <Loading />
              ) : summary.error ? (
                <ErrorState error={summary.error} onRetry={summary.refetch} />
              ) : isHod ? (
                <>
                  <Row label="Total students" value={s.total} />
                  <Row label="Absent students" value={s.absent} tone={colors.danger} />
                  {s.unmarked ? <T v="small">{s.unmarked} not marked yet</T> : null}
                </>
              ) : (
                <>
                  <Row label="Total students" value={s.total} />
                  <Row label="Students present" value={s.present} tone={colors.success} />
                  <Row label="Students absent" value={s.absent} tone={colors.danger} />
                  <Row label="Total faculty" value={f.total} />
                  <Row label="Faculty present" value={`${f.percentage}%`} tone={colors.success} />
                  <Row label="Faculty absent" value={f.absent + f.leave} tone={colors.danger} />
                </>
              )}
            </Sheet>
          ) : null}
        </>
      )}
    </Screen>
  );
}
