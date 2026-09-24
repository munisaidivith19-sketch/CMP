import { Alert, Image, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Info, MapPin, PackageSearch } from 'lucide-react-native';
import { Avatar, Badge, Button, Card, ErrorState, Header, Loading, Screen, SectionTitle, StatusBadge, T } from '../../../components/ui';
import { errMsg, useCloseLostFoundMutation, useGetLostFoundItemQuery, useGetLostFoundMatchesQuery } from '../../../services/api';
import { assetUrl } from '../../../config';
import { colors } from '../../../theme';
import { fmtDateTime, timeAgo, titleCase } from '../../../utils/format';

function Matches({ id }) {
  const { data, isLoading } = useGetLostFoundMatchesQuery(id);
  if (isLoading) return <Loading />;
  return (
    <>
      <Card style={{ flexDirection: 'row', gap: 8, backgroundColor: colors.infoSoft }}>
        <Info size={16} color={colors.info} />
        <T v="small" style={{ flex: 1, color: '#0369a1' }}>
          Possible matches are automatic suggestions, not proof of ownership. Staff verify before any handover.
        </T>
      </Card>
      {!data?.length ? (
        <T v="small" style={{ textAlign: 'center', padding: 12 }}>
          No similar reports yet.
        </T>
      ) : (
        data.map((m) => (
          <Card key={m._id} onPress={() => router.push(`/lost-found/${m._id}`)} style={{ gap: 4 }}>
            <T v="strong">{m.itemName}</T>
            <T v="small">
              {m.location} · {fmtDateTime(m.dateTime)}
            </T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {m.matchReasons.map((r) => (
                <Badge key={r} label={r} color="neutral" />
              ))}
            </View>
          </Card>
        ))
      )}
    </>
  );
}

export default function LostFoundItem() {
  const { id } = useLocalSearchParams();
  const { data: item, isLoading, error, refetch, isFetching } = useGetLostFoundItemQuery(id);
  const [close, { isLoading: closing }] = useCloseLostFoundMutation();

  if (isLoading) return <Screen><Header back title="Item" /><Loading /></Screen>;
  if (error) return <Screen><Header back title="Item" /><ErrorState error={error} onRetry={refetch} /></Screen>;
  const resolved = ['returned', 'closed'].includes(item.status);

  return (
    <Screen refreshing={isFetching} onRefresh={refetch}>
      <Header back title={item.itemName} subtitle={`${titleCase(item.type)} · ${titleCase(item.category)}`} />
      {item.photo ? (
        <Image source={{ uri: assetUrl(item.photo) }} style={{ width: '100%', height: 220, borderRadius: 28 }} resizeMode="cover" />
      ) : (
        <View style={{ height: 140, borderRadius: 28, backgroundColor: item.type === 'lost' ? colors.dangerSoft : colors.infoSoft, alignItems: 'center', justifyContent: 'center' }}>
          <PackageSearch size={44} color={item.type === 'lost' ? colors.danger : colors.info} />
        </View>
      )}
      <Card style={{ gap: 8 }}>
        <StatusBadge status={item.status} />
        {item.description ? <T v="body">{item.description}</T> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <MapPin size={14} color={colors.primary} />
          <T v="small">{item.location}</T>
        </View>
        <T v="small">When: {fmtDateTime(item.dateTime)}</T>
        {item.additionalDetails ? <T v="small">{item.additionalDetails}</T> : null}
        {item.resolutionNote ? <T v="small">Resolution: {item.resolutionNote}</T> : null}
        {item.matchedWith?._id ? (
          <Card onPress={() => router.push(`/lost-found/${item.matchedWith._id}`)} style={{ backgroundColor: colors.warningSoft }}>
            <T v="small">
              Linked {item.status === 'returned' ? 'and returned' : 'as a possible match'}: <T v="strong">{item.matchedWith.itemName}</T>
            </T>
          </Card>
        ) : null}
      </Card>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar user={item.reporter} size={42} />
        <View style={{ flex: 1 }}>
          <T v="strong">{item.isMine ? 'You' : item.reporter?.name}</T>
          <T v="small">Reported {timeAgo(item.createdAt)}</T>
          {item.reporter?.email ? <T v="small">{item.reporter.email}</T> : null}
        </View>
      </Card>
      {item.isMine && !resolved ? (
        <Button
          title="Close my report"
          variant="soft"
          loading={closing}
          onPress={() =>
            Alert.alert('Close this report?', 'Use this when you no longer need help.', [
              { text: 'Keep open', style: 'cancel' },
              { text: 'Close', onPress: () => close(item._id).unwrap().catch((e) => Alert.alert('Could not close', errMsg(e))) },
            ])
          }
        />
      ) : null}
      {(item.isMine || item.canManage) && !resolved ? (
        <>
          <SectionTitle title="Possible matches" />
          <Matches id={item._id} />
        </>
      ) : null}
    </Screen>
  );
}
