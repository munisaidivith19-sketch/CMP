import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { LinearGradient } from 'expo-linear-gradient';
import { format } from 'date-fns';
import { CalendarClock, CalendarDays, ClipboardCheck, DoorOpen, Megaphone, MessageCircle, Search } from 'lucide-react-native';
import { Avatar, Badge, Card, ErrorState, IconButton, IconTile, Loading, Screen, SectionTitle, T } from '../../../components/ui';
import { useGetChatUnreadQuery, useGetCurrentClassQuery, useGetDashboardQuery, useGetGatePassesQuery, useGetMyAttendanceQuery } from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { STUDENT_ROLES, colors, fonts, gradients } from '../../../theme';
import { fmtDateTime, timeAgo, to12h } from '../../../utils/format';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Tile({ icon, gradient, label, value, hint, href }) {
  return (
    <Card onPress={() => router.push(href)} style={{ width: '47.8%', gap: 10 }}>
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

export default function Home() {
  const user = useSelector(selectUser);
  const isStudent = STUDENT_ROLES.includes(user.role);
  const dash = useGetDashboardQuery();
  const now = useGetCurrentClassQuery(undefined, { pollingInterval: 120000 });
  const att = useGetMyAttendanceQuery({ range: 'semester' }, { skip: !isStudent });
  const passes = useGetGatePassesQuery({ limit: 5 }, { skip: !isStudent });
  const unread = useGetChatUnreadQuery();

  const refreshing = dash.isFetching && !dash.isLoading;
  const onRefresh = () => [dash, now, att, passes, unread].forEach((q) => q.refetch?.());
  const cls = now.data?.current || now.data?.next;
  const open = passes.data?.passes?.find((p) => ['pending', 'approved', 'active'].includes(p.status));
  const o = att.data?.overall;
  const low = o && o.totalPeriods > 0 && o.percentage < att.data.threshold;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar user={user} size={46} />
        <View style={{ flex: 1 }}>
          <T v="small">{greeting()},</T>
          <T v="h2" numberOfLines={1}>
            {user.name.split(' ')[0]} 👋
          </T>
        </View>
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
            {!isStudent ? ` · Section ${cls.section}` : ''}
          </T>
        ) : null}
      </LinearGradient>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <Tile icon={CalendarClock} gradient={gradients.violet} label="Timetable" value={`${now.data?.today?.filter((s) => !s.isBreak).length ?? 0} classes today`} href="/timetable" />
        <Tile
          icon={ClipboardCheck}
          gradient={low ? gradients.rose : gradients.emerald}
          label="Attendance"
          value={isStudent ? (o ? `${o.percentage}%` : '—') : 'Mark on web'}
          hint={isStudent && o ? (low ? `Below ${att.data.threshold}%` : `${o.presentPeriods}/${o.totalPeriods} periods`) : undefined}
          href="/attendance"
        />
        <Tile icon={DoorOpen} gradient={gradients.cyan} label="Gate pass" value={isStudent ? (open ? open.status : 'No active pass') : 'Review on web'} hint={open ? `Return ${fmtDateTime(open.expectedReturn)}` : undefined} href="/gate-pass" />
        <Tile icon={MessageCircle} gradient={gradients.primary} label="Messages" value={unread.data?.total ? `${unread.data.total} unread` : 'All caught up'} href="/chat" />
      </View>

      {dash.isLoading ? (
        <Loading />
      ) : dash.error ? (
        <ErrorState error={dash.error} onRetry={dash.refetch} />
      ) : (
        <>
          <SectionTitle title="Announcements" action="See all" onAction={() => router.push('/announcements')} />
          {dash.data.announcements.slice(0, 3).map((a) => (
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
          ))}

          <SectionTitle title="Upcoming events" action="All events" onAction={() => router.push('/events')} />
          {dash.data.upcomingEvents.slice(0, 4).map((e) => (
            <Pressable key={e._id} onPress={() => router.push(`/events/${e._id}`)}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <LinearGradient colors={gradients.sky} style={{ width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
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
                <CalendarDays size={18} color={colors.muted} />
              </Card>
            </Pressable>
          ))}
        </>
      )}
    </Screen>
  );
}
