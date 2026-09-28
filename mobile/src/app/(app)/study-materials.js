import { useState } from 'react';
import { FlatList, KeyboardAvoidingView, Linking, Platform, View } from 'react-native';
import { useSelector } from 'react-redux';
import { BookOpen, Download, FileText } from 'lucide-react-native';
import { Badge, Button, Card, EmptyState, ErrorState, Header, Loading, Screen, Segmented, T } from '../../components/ui';
import StudyAssistant from '../../components/StudyAssistant';
import { useGetStudyMaterialsQuery } from '../../services/api';
import { selectUser } from '../../store/authSlice';
import { STUDENT_ROLES } from '../../theme';
import { assetUrl } from '../../config';

const CATEGORY_LABELS = { notes: 'Notes', question_bank: 'Question bank', lab_manual: 'Lab manual', syllabus: 'Syllabus', assignment: 'Assignment', other: 'Other' };

function Materials() {
  const { data, isLoading, isFetching, error, refetch } = useGetStudyMaterialsQuery({ limit: 50 });
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <FlatList
      data={data.items}
      keyExtractor={(m) => m._id}
      refreshing={isFetching && !isLoading}
      onRefresh={refetch}
      contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
      ListEmptyComponent={
        <Card>
          <EmptyState icon={BookOpen} title="No study materials yet" text="Materials for your class will appear here once uploaded." />
        </Card>
      }
      renderItem={({ item: m }) => (
        <Card style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <FileText size={16} color="#1D6FEB" />
            <T v="strong" style={{ flex: 1 }} numberOfLines={2}>{m.title}</T>
            <Badge label={CATEGORY_LABELS[m.category] || m.category} />
          </View>
          <T v="small">
            {m.subjectName} — {m.subjectCode} · {m.department}
            {m.section ? ` · Sec ${m.section}` : ''} · Sem {m.semester}
          </T>
          {m.description ? <T numberOfLines={3}>{m.description}</T> : null}
          {m.file?.url ? <Button small variant="outline" icon={Download} title={m.file.name || 'Open'} onPress={() => Linking.openURL(assetUrl(m.file.url))} style={{ alignSelf: 'flex-start', marginTop: 4 }} /> : null}
        </Card>
      )}
    />
  );
}

/** Study Materials + the JNN Study Assistant (same backend as the web app). */
export default function StudyMaterialsScreen() {
  const me = useSelector(selectUser);
  const [tab, setTab] = useState('assistant');
  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView style={{ flex: 1, padding: 16, paddingBottom: 8, gap: 12 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        <Header back title="Study Materials" subtitle={STUDENT_ROLES.includes(me.role) ? 'Notes, question banks and resources for your class.' : 'Class notes, question banks and other resources.'} />
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'assistant', label: '🤖 Study Assistant' },
            { value: 'materials', label: 'Materials' },
          ]}
        />
        {/* Both stay mounted so switching tabs never loses the conversation. */}
        <View style={{ flex: 1, display: tab === 'assistant' ? 'flex' : 'none' }}>
          <StudyAssistant />
        </View>
        <View style={{ flex: 1, display: tab === 'materials' ? 'flex' : 'none' }}>
          <Materials />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
