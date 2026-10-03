import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Chip, Header, Input, Screen, Segmented, T } from '../../../../components/ui';
import { useCreateAlumniJobMutation } from '../../../../services/api';
import { colors } from '../../../../theme';

const TYPES = [
  { value: 'full_time', label: 'Full Time' },
  { value: 'internship', label: 'Internship' },
  { value: 'part_time', label: 'Part Time' },
  { value: 'contract', label: 'Contract' },
];

const MODES = [
  { value: 'in_office', label: 'In-Office' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Remote' },
];

const APPLY_MODES = [
  { value: 'internal', label: 'Campus Application' },
  { value: 'external', label: 'External Website' },
];

export default function PostJobScreen() {
  const [createJob, { isLoading }] = useCreateAlumniJobMutation();

  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [type, setType] = useState('full_time');
  const [workMode, setWorkMode] = useState('in_office');
  const [applyMode, setApplyMode] = useState('internal');
  const [externalUrl, setExternalUrl] = useState('');
  const [daysValid, setDaysValid] = useState('30');
  const [description, setDescription] = useState('');

  const handleSubmit = async () => {
    if (!title.trim() || !company.trim() || !location.trim() || description.trim().length < 20) {
      alert('Please fill all required fields (description must be at least 20 characters).');
      return;
    }

    if (applyMode === 'external' && !externalUrl.trim().startsWith('http')) {
      alert('Please provide a valid URL starting with http:// or https://');
      return;
    }

    const deadline = new Date(Date.now() + (parseInt(daysValid, 10) || 30) * 86400000).toISOString();

    try {
      await createJob({
        title: title.trim(),
        company: company.trim(),
        location: location.trim(),
        type,
        workMode,
        applyMode,
        externalUrl: applyMode === 'external' ? externalUrl.trim() : undefined,
        deadline,
        description: description.trim(),
      }).unwrap();

      alert('Job posted successfully!');
      router.back();
    } catch (e) {
      alert(e?.data?.message || 'Could not post job');
    }
  };

  return (
    <Screen>
      <Header back title="Post a Job" subtitle="Share opportunities with your college community" />

      <Card style={{ gap: 14 }}>
        <Input
          label="Job Title *"
          placeholder="e.g. Software Engineer, Product Analyst"
          value={title}
          onChangeText={setTitle}
        />

        <Input
          label="Company Name *"
          placeholder="e.g. Microsoft, Razorpay"
          value={company}
          onChangeText={setCompany}
        />

        <Input
          label="Location *"
          placeholder="e.g. Bengaluru, Hyderabad"
          value={location}
          onChangeText={setLocation}
        />

        <View style={{ gap: 6 }}>
          <T v="label">Employment Type</T>
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
          <T v="label">Work Mode</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {MODES.map((m) => (
              <Chip
                key={m.value}
                label={m.label}
                active={workMode === m.value}
                onPress={() => setWorkMode(m.value)}
              />
            ))}
          </ScrollView>
        </View>

        <View style={{ gap: 6 }}>
          <T v="label">How Should Students Apply?</T>
          <Segmented
            options={APPLY_MODES}
            value={applyMode}
            onChange={setApplyMode}
          />
        </View>

        {applyMode === 'external' && (
          <Input
            label="Application Link (URL) *"
            placeholder="https://company.com/careers/job-123"
            value={externalUrl}
            onChangeText={setExternalUrl}
            keyboardType="url"
            autoCapitalize="none"
          />
        )}

        <Input
          label="Deadline (Days from today)"
          placeholder="30"
          value={daysValid}
          onChangeText={setDaysValid}
          keyboardType="numeric"
        />

        <Input
          label="Job Description & Requirements *"
          placeholder="Describe the role, responsibilities, team, and required qualifications..."
          multiline
          numberOfLines={6}
          value={description}
          onChangeText={setDescription}
        />

        <Button
          title="Publish Job"
          loading={isLoading}
          onPress={handleSubmit}
          style={{ marginTop: 6 }}
        />
      </Card>
    </Screen>
  );
}
