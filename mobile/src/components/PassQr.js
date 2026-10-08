import { Image, View } from 'react-native';
import { Loading, T } from './ui';
import { errMsg, useGetGatePassQrQuery } from '../services/api';
import { colors } from '../theme';
import { fmtDateTime } from '../utils/format';

/** Owner-only code for an approved/active pass — read it aloud to security at the gate. */
export default function PassQr({ pass }) {
  // Bulk-approved passes get their code from a queue, a few at a time.
  const queued = pass.status === 'approved' && ['queued', 'processing'].includes(pass.codeIssue?.state);
  const usable = ['approved', 'active'].includes(pass.status) && !queued;
  const { data, isLoading, error } = useGetGatePassQrQuery(pass._id, { skip: !usable });
  if (queued) {
    return (
      <View style={{ alignItems: 'center', gap: 6 }}>
        <T v="h3">Approved</T>
        <T v="small" style={{ textAlign: 'center' }}>Your QR code and code will be generated at {fmtDateTime(pass.codeIssue.scheduledAt)}.</T>
      </View>
    );
  }
  if (!usable) return null;
  if (isLoading) return <Loading />;
  if (error) return <T v="small" style={{ color: colors.danger, textAlign: 'center' }}>{errMsg(error)}</T>;
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <View style={{ backgroundColor: '#fff', padding: 12, borderRadius: 24 }}>
        <Image source={{ uri: data.qr }} style={{ width: 220, height: 220 }} accessibilityLabel="Gate pass code" />
      </View>
      <T v="code">{data.code}</T>
      <T v="small">Tell this code to security at the gate · valid until {fmtDateTime(data.expiresAt)}</T>
    </View>
  );
}
