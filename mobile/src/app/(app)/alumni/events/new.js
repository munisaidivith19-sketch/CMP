import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Chip, Header, Input, Screen, Segmented, T } from '../../../../components/ui';
import { useCreateAlumniEventMutation } from '../../../../services/api';
import { colors } from '../../../../theme';

const TYPES = [
  { value: 'webinar', label: 'Webinar' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'reunion', label: 'Reunion' },
  { value: 'networking', label: 'Networking' },
  { value: 'talk', label: 'Guest Talk' },
];

const MODES = [
  { value: 'virtual', label: 'Online Virtual' },
  { value: 'in_person', label: 'On Campus' },
  { value: 'hybrid', label: 'Hybrid' },
];

export default function HostEventScreen() {
  const [createEvent, { isLoading }] = useCreateAlumniEventMutation();

  const [title, setTitle] = useState('');
  const [type, setType] = useState('webinar');
  const [mode, setMode] = useState('virtual');
  const [venue, setVenue] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [daysAhead, setDaysAhead] = useState('7');
  const [durationHours, setDurationHours] = useState('1');
  const [capacity, setCapacity] = useState('50');
  const [description, setDescription] = useState('');

  const handleSubmit = async () => {
    if (!title.trim() || description.trim().length < 20) {
      alert('Please fill in a title and a detailed description (at least 20 characters).');
      return;
    }

    if (mode === 'virtual' && meetingLink.trim() && !meetingLink.trim().startsWith('http')) {
      alert('Please enter a valid video meeting URL starting with http:// or https://');
      return;
    }

    const startDate = new Date(Date.now() + (parseInt(daysAhead, 10) || 7) * 86400000);
    startDate.setHours(18, 0, 0, 0); // default to 6:00 PM
    const endDate = new Date(startDate.getTime() + (parseFloat(durationHours) || 1) * 3600000);

    try {
      await createEvent({
        title: title.trim(),
        type,
        mode,
        venue: mode !== 'virtual' ? (venue.trim() || 'College Auditorium') : undefined,
        meetingLink: mode !== 'in_person' && meetingLink.trim() ? meetingLink.trim() : undefined,
        startsAt: startDate.toISOString(),
        endsAt: endDate.toISOString(),
        capacity: capacity ? parseInt(capacity, 10) : undefined,
        description: description.trim(),
      }).unwrap();

      alert('Event scheduled successfully!');
      router.back();
    } catch (e) {
      alert(e?.data?.message || 'Could not schedule event');
    }
  };

  return (
    <Screen>
      <Header back title="Host Alumni Event" subtitle="Organize a reunion, guest lecture, or workshop" />

      <Card style={{ gap: 14 }}>
        <Input
          label="Event Title *"
          placeholder="e.g. Masterclass on System Design & Microservices"
          value={title}
          onChangeText={setTitle}
        />

        <View style={{ gap: 6 }}>
          <T v="label">Event Category</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {TYPES.map((t) => (
              <Chip
                key={t.value}
                label={t.label}
                active={type === t.value}
                onPress={() => setType(t.value)}
              />
            ))}
          </ScrollView>
        </View>

        <View style={{ gap: 6 }}>
          <T v="label">Session Format</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {MODES.map((m) => (
              <Chip
                key={m.value}
                label={m.label}
                active={mode === m.value}
                onPress={() => setMode(m.value)}
              />
            ))}
          </ScrollView>
        </View>

        {mode !== 'virtual' && (
          <Input
            label="Campus Venue *"
            placeholder="e.g. Mechanical Seminar Hall, Campus Audi"
            value={venue}
            onChangeText={setVenue}
          />
        )}

        {mode !== 'in_person' && (
          <Input
            label="Virtual Video Link"
            placeholder="https://meet.google.com/xyz or Zoom link"
            value={meetingLink}
            onChangeText={setMeetingLink}
            keyboardType="url"
            autoCapitalize="none"
          />
        )}

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Input
            label="Days from today"
            placeholder="7"
            value={daysAhead}
            onChangeText={setDaysAhead}
            keyboardType="numeric"
            style={{ flex: 1 }}
          />
          <Input
            label="Duration (Hours)"
            placeholder="1"
            value={durationHours}
            onChangeText={setDurationHours}
            keyboardType="numeric"
            style={{ flex: 1 }}
          />
        </View>

        <Input
          label="Maximum Capacity (Seats)"
          placeholder="50"
          value={capacity}
          onChangeText={setCapacity}
          keyboardType="numeric"
        />

        <Input
          label="Event Agenda & Description *"
          placeholder="Describe topics covered, guest speakers, prerequisites, and who should attend..."
          multiline
          numberOfLines={5}
          value={description}
          onChangeText={setDescription}
        />

        <Button
          title="Create Event"
          loading={isLoading}
          onPress={handleSubmit}
          style={{ marginTop: 6 }}
        />
      </Card>
    </Screen>
  );
}
