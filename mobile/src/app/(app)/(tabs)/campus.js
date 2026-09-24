import { View } from 'react-native';
import { router } from 'expo-router';
import { CalendarClock, CalendarDays, ClipboardCheck, DoorOpen, Megaphone, MessagesSquare, PackageSearch, Search, Shapes, ShieldCheck } from 'lucide-react-native';
import { Card, Header, IconTile, Screen, T } from '../../../components/ui';
import { gradients } from '../../../theme';

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

export default function Campus() {
  return (
    <Screen>
      <Header title="Campus" subtitle="Everything on Vexon, in one place." />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {ITEMS.map((i) => (
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
