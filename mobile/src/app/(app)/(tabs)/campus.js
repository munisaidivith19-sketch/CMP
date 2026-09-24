import { View } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { CalendarClock, CalendarDays, ClipboardCheck, DoorOpen, Megaphone, MessagesSquare, PackageSearch, Search, Shapes, ShieldCheck, UserPlus, UsersRound } from 'lucide-react-native';
import { Card, Header, IconTile, Screen, T } from '../../../components/ui';
import { STUDENT_ROLES, gradients } from '../../../theme';
import { selectUser } from '../../../store/authSlice';

const ITEMS = [
  { href: '/timetable', label: 'Timetable', hint: 'Today & this week', icon: CalendarClock, g: gradients.violet },
  { href: '/attendance', label: 'Attendance', hint: 'Subject-wise %', icon: ClipboardCheck, g: gradients.emerald },
  { href: '/gate-pass', label: 'Gate pass', hint: 'Request & QR', icon: DoorOpen, g: gradients.cyan },
  { href: '/lost-found', label: 'Lost & found', hint: 'Report or search', icon: PackageSearch, g: gradients.amber },
  { href: '/events', label: 'Events', hint: 'Register', icon: CalendarDays, g: gradients.sky },
  { href: '/clubs', label: 'Clubs', hint: 'Join & follow', icon: Shapes, g: gradients.rose },
  { href: '/announcements', label: 'Announcements', hint: 'Campus news', icon: Megaphone, g: gradients.amber },
  { href: '/discussions', label: 'Discussions', hint: 'Ask & answer', icon: MessagesSquare, g: gradients.emerald },
  { href: '/search', label: 'Search', hint: 'People, clubs, events', icon: Search, g: gradients.primary },
  { href: '/settings/security', label: 'Security', hint: 'Devices & password', icon: ShieldCheck, g: gradients.violet },
];

const ADMIN_ITEMS = [
  { href: '/admin/create-user', label: 'Create login', hint: 'Students, faculty, HOD', icon: UserPlus, g: gradients.primary },
  { href: '/admin/chat-requests', label: 'Group requests', hint: 'Approve class groups', icon: UsersRound, g: gradients.rose },
];

// Security only deals with gate passes and lost & found — the rest of campus life doesn't apply to them.
const HIDDEN_FOR_SECURITY = ['/timetable', '/attendance', '/events', '/clubs', '/announcements', '/discussions', '/search'];

export default function Campus() {
  const me = useSelector(selectUser);
  const staff = !STUDENT_ROLES.includes(me.role);
  const isSecurity = me.role === 'security';
  const items = [
    ...(me.role === 'admin' ? ADMIN_ITEMS : []),
    ...ITEMS.filter((i) => !isSecurity || !HIDDEN_FOR_SECURITY.includes(i.href)).map((i) =>
      i.href === '/attendance' && staff ? { ...i, hint: me.role === 'principal' ? 'College summary' : 'Mark & review' } : i
    ),
  ];
  return (
    <Screen>
      <Header title="Campus" subtitle="Everything on Vexon, in one place." />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {items.map((i) => (
          <Card key={i.href} onPress={() => router.push(i.href)} style={{ width: '47.8%', gap: 10 }}>
            <IconTile icon={i.icon} gradient={i.g} size={42} />
            <View>
              <T v="strong">{i.label}</T>
              <T v="small">{i.hint}</T>
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
