import { View } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { AlertTriangle, BedDouble, BookOpen, CalendarCheck, CalendarClock, CalendarDays, CalendarOff, ClipboardCheck, DoorOpen, GraduationCap, Megaphone, MessageSquareWarning, MessagesSquare, PackageSearch, Search, Shapes, ShieldCheck, Trophy, UserPlus, Users, UsersRound } from 'lucide-react-native';
import { Card, Header, IconTile, Screen, T } from '../../../components/ui';
import { HOSTEL_ROLES, STUDENT_ROLES, gradients } from '../../../theme';
import { selectUser } from '../../../store/authSlice';

const ITEMS = [
  { href: '/sos', label: 'Emergency SOS', hint: 'Instant alert', icon: AlertTriangle, g: gradients.rose },
  { href: '/timetable', label: 'Timetable', hint: 'Today & this week', icon: CalendarClock, g: gradients.violet },
  { href: '/attendance', label: 'Attendance', hint: 'Subject-wise %', icon: ClipboardCheck, g: gradients.emerald },
  { href: '/od-leave', label: 'OD & Leave', hint: 'Apply & track', icon: CalendarCheck, g: gradients.sky },
  { href: '/holidays', label: 'Holidays', hint: 'College holidays', icon: CalendarOff, g: gradients.rose },
  { href: '/study-materials', label: 'Study Materials', hint: 'Notes & AI assistant', icon: BookOpen, g: gradients.sky },
  { href: '/alumni', label: 'Alumni Network', hint: 'Mentors, jobs & chapters', icon: GraduationCap, g: gradients.primary },
  { href: '/achievements', label: 'Achievements', hint: 'Student wins', icon: Trophy, g: gradients.amber },
  { href: '/hostel', label: 'Hostel', hint: 'Inside & outside', icon: BedDouble, g: gradients.violet },
  { href: '/gate-pass', label: 'Gate pass', hint: 'Request & QR', icon: DoorOpen, g: gradients.cyan },
  { href: '/lost-found', label: 'Lost & found', hint: 'Report or search', icon: PackageSearch, g: gradients.amber },
  { href: '/complaints', label: 'Complaints', hint: 'Register & track', icon: MessageSquareWarning, g: gradients.rose },
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
const HIDDEN_FOR_SECURITY = ['/timetable', '/study-materials', '/attendance', '/events', '/clubs', '/announcements', '/discussions', '/search', '/complaints', '/alumni', '/achievements'];
// Warden/Security have zero timetable or study-materials access anywhere in the app.
const HIDDEN_FOR_NO_TIMETABLE = ['/timetable', '/study-materials', '/holidays', '/achievements'];
const NO_TIMETABLE_ROLES = ['warden', 'security'];
// Alumni only access alumni network, events, clubs, announcements, discussions, search, and security
const HIDDEN_FOR_ALUMNI = ['/timetable', '/attendance', '/study-materials', '/gate-pass', '/lost-found', '/complaints', '/holidays'];
// Only these roles have an OD & Leave screen (students apply; the rest review). The API enforces the same.
const OD_LEAVE_ROLES = [...STUDENT_ROLES, 'faculty', 'hod', 'principal', 'admin'];
// Faculty Class In-Charge: manage their own class's student logins.
const isClassInCharge = (u) => u?.role === 'faculty' && Boolean(u.section && u.inChargeYear && u.inChargeSemester);
const CLASS_ITEM = { href: '/class/students', label: 'My class', hint: 'Student logins', icon: Users, g: gradients.emerald };

export default function Campus() {
  const me = useSelector(selectUser);
  const staff = !STUDENT_ROLES.includes(me.role);
  const isSecurity = me.role === 'security';
  const isAlumni = me.role === 'alumni';
  const noTimetable = NO_TIMETABLE_ROLES.includes(me.role);

  let items = [
    ...(me.role === 'admin' ? ADMIN_ITEMS : []),
    // The principal approves the chat groups HODs ask to create.
    ...(me.role === 'principal' ? ADMIN_ITEMS.filter((i) => i.href === '/admin/chat-requests') : []),
    ...(isClassInCharge(me) ? [CLASS_ITEM] : []),
    ...ITEMS.filter(
      (i) =>
        (!isSecurity || !HIDDEN_FOR_SECURITY.includes(i.href)) &&
        (!noTimetable || !HIDDEN_FOR_NO_TIMETABLE.includes(i.href)) &&
        (!isAlumni || !HIDDEN_FOR_ALUMNI.includes(i.href)) &&
        (i.href !== '/od-leave' || OD_LEAVE_ROLES.includes(me.role)) &&
        (i.href !== '/hostel' || HOSTEL_ROLES.includes(me.role))
    ).map((i) =>
      i.href === '/attendance' && staff ? { ...i, hint: me.role === 'principal' ? 'College summary' : 'Mark & review' } : i
    ),
  ];

  if (isAlumni) {
    const alumniItem = items.find((i) => i.href === '/alumni');
    if (alumniItem) {
      items = [alumniItem, ...items.filter((i) => i.href !== '/alumni')];
    }
  }
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
