import { useState } from 'react';
import { Alert, Image, Linking, Modal, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { EyeOff, Heart, Star, Trash2 } from 'lucide-react-native';
import { Avatar, Badge, Button, Card, ErrorState, Header, Loading, Screen, SectionTitle, T } from '../../../components/ui';
import FullImage from '../../../components/FullImage';
import ReasonSheet from '../../../components/ReasonSheet';
import {
  errMsg,
  useCongratulateAchievementMutation,
  useDeleteAchievementMutation,
  useGetAchievementQuery,
  useRequestAchievementHideMutation,
  useResolveAchievementHideMutation,
  useToggleFeaturedAchievementMutation,
} from '../../../services/api';
import { assetUrl } from '../../../config';
import { ACHIEVEMENT_LEVEL_COLORS, colors } from '../../../theme';
import { displayName, fmtDate, titleCase } from '../../../utils/format';

export default function AchievementDetail() {
  const { id } = useLocalSearchParams();
  const { data: a, isLoading, isFetching, error, refetch } = useGetAchievementQuery(id);
  const [congratulate, { isLoading: cheering }] = useCongratulateAchievementMutation();
  const [toggleFeatured, { isLoading: featuring }] = useToggleFeaturedAchievementMutation();
  const [remove, { isLoading: deleting }] = useDeleteAchievementMutation();
  const [requestHide, { isLoading: hiding }] = useRequestAchievementHideMutation();
  const [resolveHide, { isLoading: resolving }] = useResolveAchievementHideMutation();
  const [hideOpen, setHideOpen] = useState(false);
  const [image, setImage] = useState(null);

  const run = async (fn, ok) => {
    try {
      await fn();
      if (ok) Alert.alert(ok);
      return true;
    } catch (e) {
      Alert.alert('Could not update', errMsg(e));
      return false;
    }
  };

  if (isLoading) return <Screen><Header back title="Achievement" /><Loading /></Screen>;
  if (error) return <Screen><Header back title="Achievement" /><ErrorState error={error} onRetry={refetch} /></Screen>;

  return (
    <Screen refreshing={isFetching} onRefresh={refetch}>
      <Header back title="Achievement" subtitle={fmtDate(a.achievedOn)} />
      {a.images?.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {a.images.map((img) => (
            <Card key={img.url} padded={false} onPress={() => setImage(img.url)} style={{ overflow: 'hidden' }}>
              <Image source={{ uri: assetUrl(img.url) }} style={{ width: 260, height: 170 }} resizeMode="cover" accessibilityLabel={img.caption || a.title} />
            </Card>
          ))}
        </ScrollView>
      ) : null}
      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {a.isFeatured ? <Badge label="Featured" color="warning" /> : null}
          <Badge label={titleCase(a.level)} color={ACHIEVEMENT_LEVEL_COLORS[a.level] || 'neutral'} />
          <Badge label={titleCase(a.category)} color="neutral" />
          {a.position ? <Badge label={titleCase(a.position)} color="success" /> : null}
          {a.isDeleted ? <Badge label="Deleted" color="danger" /> : null}
        </View>
        <T v="h2">{a.title}</T>
        {a.eventName || a.organizer ? (
          <T v="small">
            {[a.eventName, a.organizer].filter(Boolean).join(' · ')}
          </T>
        ) : null}
        <T v="body">{a.description}</T>
        {a.externalLink && /^https?:\/\//.test(a.externalLink) ? (
          <Button title="Open link" variant="soft" small onPress={() => Linking.openURL(a.externalLink)} style={{ alignSelf: 'flex-start' }} />
        ) : null}
        <Button
          title={`${a.congratulated ? 'Congratulated' : 'Congratulate'} · ${a.congratulationCount || 0}`}
          icon={Heart}
          variant={a.congratulated ? 'danger' : 'soft'}
          loading={cheering}
          onPress={() => run(() => congratulate(a._id).unwrap())}
        />
      </Card>

      <SectionTitle title={`Student${a.students.length === 1 ? '' : 's'}`} />
      <Card style={{ gap: 10 }}>
        {a.students.map((s) => (
          <View key={s._id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar user={s} size={36} />
            <View style={{ flex: 1 }}>
              <T v="strong" numberOfLines={1}>{displayName(s)}</T>
              <T v="small" numberOfLines={1}>
                {s.rollNo || '—'} · {s.department}
                {s.year ? ` · Y${s.year}` : ''}
                {s.section ? ` · Sec ${s.section}` : ''}
              </T>
            </View>
          </View>
        ))}
        {a.postedBy ? <T v="small" style={{ color: colors.muted }}>Posted by {displayName(a.postedBy)}</T> : null}
      </Card>

      {a.isMine ? (
        a.myHideRequest === 'pending' ? (
          <Card>
            <T v="small">Your request to hide this achievement is waiting for review.</T>
          </Card>
        ) : (
          <Button title="Ask to hide this from the feed" icon={EyeOff} variant="outline" onPress={() => setHideOpen(true)} />
        )
      ) : null}

      {a.hideRequests?.length ? (
        <>
          <SectionTitle title="Hide requests" />
          {a.hideRequests.map((r) => {
            const who = a.students.find((s) => String(s._id) === String(r.student));
            return (
              <Card key={r._id} style={{ gap: 8 }}>
                <T v="strong">{who ? displayName(who) : 'A featured student'}</T>
                {r.reason ? <T v="small">“{r.reason}”</T> : null}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button title="Approve" variant="success" small style={{ flex: 1 }} loading={resolving} onPress={() => run(() => resolveHide({ id: a._id, reqId: r._id, action: 'approve' }).unwrap(), 'Request approved')} />
                  <Button title="Decline" variant="danger" small style={{ flex: 1 }} loading={resolving} onPress={() => run(() => resolveHide({ id: a._id, reqId: r._id, action: 'reject' }).unwrap(), 'Request declined')} />
                </View>
              </Card>
            );
          })}
        </>
      ) : null}

      {a.canFeature || a.canDelete ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {a.canFeature ? (
            <Button title={a.isFeatured ? 'Unfeature' : 'Feature'} icon={Star} variant="soft" style={{ flex: 1 }} loading={featuring} onPress={() => run(() => toggleFeatured(a._id).unwrap())} />
          ) : null}
          {a.canDelete ? (
            <Button
              title="Delete"
              icon={Trash2}
              variant="danger"
              style={{ flex: 1 }}
              loading={deleting}
              onPress={() =>
                Alert.alert('Delete this achievement?', 'It is removed from the feed and the students’ profiles.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: async () => (await run(() => remove(a._id).unwrap())) && router.back() },
                ])
              }
            />
          ) : null}
        </View>
      ) : null}

      <ReasonSheet
        open={hideOpen}
        title="Hide this achievement?"
        subtitle="The poster reviews your request. Once approved, it no longer shows in the campus feed."
        label="Reason (optional)"
        confirmText="Send request"
        variant="primary"
        loading={hiding}
        onClose={() => setHideOpen(false)}
        onConfirm={async (reason) => (await run(() => requestHide({ id: a._id, reason: reason || undefined }).unwrap(), 'Request sent')) && setHideOpen(false)}
      />
      <Modal visible={Boolean(image)} transparent animationType="fade" onRequestClose={() => setImage(null)}>
        <Pressable onPress={() => setImage(null)} accessibilityLabel="Close image" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 12 }}>
          {image ? <FullImage uri={image} maxHeight={640} /> : null}
        </Pressable>
      </Modal>
    </Screen>
  );
}
