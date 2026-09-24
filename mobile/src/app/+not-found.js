import { router } from 'expo-router';
import { Monitor } from 'lucide-react-native';
import { Button, Card, EmptyState, Screen } from '../components/ui';

/** Links to staff-only web pages (e.g. from a notification) land here. */
export default function NotFound() {
  return (
    <Screen>
      <Card style={{ marginTop: 60 }}>
        <EmptyState icon={Monitor} title="Open this on the web" text="This page is part of the Vexon web console and isn’t available in the Android app." action={<Button title="Go home" onPress={() => router.replace('/')} />} />
      </Card>
    </Screen>
  );
}
