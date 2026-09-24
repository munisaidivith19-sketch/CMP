import { Image, View } from 'react-native';
import { Loading, T } from './ui';
import { errMsg, useGetGatePassQrQuery } from '../services/api';
import { colors, fonts } from '../theme';
import { fmtDateTime } from '../utils/format';

/** Owner-only code for an approved/active pass — read it aloud to security at the gate. */
export default function PassQr({ pass }) {
  const usable = ['approved', 'active'].includes(pass.status);
  const { data, isLoading, error } = useGetGatePassQrQuery(pass._id, { skip: !usable });
  if (!usable) return null;
  if (isLoading) return <Loading />;
  if (error) return <T v="small" style={{ color: colors.danger, textAlign: 'center' }}>{errMsg(error)}</T>;
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <View style={{ backgroundColor: '#fff', padding: 12, borderRadius: 24 }}>
        <Image source={{ uri: data.qr }} style={{ width: 220, height: 220 }} accessibilityLabel="Gate pass code" />
      </View>
      <T style={{ fontFamily: fonts.extrabold, fontSize: 40, letterSpacing: 6, color: colors.ink }}>{data.code}</T>
      <T v="small">Tell this code to security at the gate · valid until {fmtDateTime(data.expiresAt)}</T>
    </View>
  );
}
