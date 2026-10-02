import { useState } from 'react';
import { Alert, Image, Linking, Pressable, View } from 'react-native';
import { useSelector } from 'react-redux';
import * as ImagePicker from 'expo-image-picker';
import { CheckCircle2, FileText, ImagePlus, QrCode } from 'lucide-react-native';
import { Badge, Button, Input, Loading, T } from './ui';
import DateTimeField from './DateTimeField';
import PickerField from './PickerField';
import { errMsg, useCreateEmergencyGatePassMutation, useGetGatePassQrQuery, useUploadImageMutation } from '../services/api';
import { selectUser } from '../store/authSlice';
import { YEAR_LABELS, colors, radius } from '../theme';
import { fmtDateTime, timeAgo } from '../utils/format';
import { getApiUrl } from '../config';

export const AUTHORITY_LABELS = { principal: 'PRINCIPAL', ao: 'AO', dean: 'DEAN', chairman: 'CHAIRMAN' };
const AUTHORITY_BY_LABEL = Object.fromEntries(Object.entries(AUTHORITY_LABELS).map(([k, v]) => [v, k]));
const MAX_BYTES = 5 * 1024 * 1024;

export const isEmergency = (pass) => pass?.passType === 'emergency';
export const EmergencyBadge = () => <Badge label="Emergency" color="danger" />;
export const emergencyStatusLabel = (pass) =>
  pass.status === 'pending_authority' ? `Pending — ${AUTHORITY_LABELS[pass.emergencyAuthority]} approval` : null;

function Facts({ rows }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }}>
      {rows.map(([label, value]) => (
        <View key={label} style={{ width: '50%', paddingRight: 8 }}>
          <T v="small" style={{ color: colors.muted }}>
            {label}
          </T>
          <T v="strong">{value || '—'}</T>
        </View>
      ))}
    </View>
  );
}

const absoluteUrl = (url) => (/^https?:/i.test(url) ? url : `${getApiUrl()}${url}`);

/** Emergency facts for reviewers, the pass holder and the detail screen. */
export function EmergencyDetails({ pass, showReason = true }) {
  const s = pass.student || {};
  return (
    <View style={{ gap: 8 }}>
      {showReason ? (
        <T v="small">
          <T v="strong">Reason: </T>
          {pass.description}
        </T>
      ) : null}
      <Facts
        rows={[
          ['Roll number', s.rollNo],
          ['Department', s.department || pass.department],
          ['Year', YEAR_LABELS[s.year] || s.year],
          ['Section', s.section || pass.section],
          ['Destination', pass.destination?.area],
          ['Sent to', AUTHORITY_LABELS[pass.emergencyAuthority]],
          ['Leaving', fmtDateTime(pass.leaveAt)],
          ['Expected return', fmtDateTime(pass.expectedReturnAt)],
          ['Requested', timeAgo(pass.createdAt)],
        ]}
      />
      {pass.supportingDocument?.url ? (
        <Pressable onPress={() => Linking.openURL(absoluteUrl(pass.supportingDocument.url))} accessibilityRole="link" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <FileText size={14} color={colors.primary} />
          <T v="small" style={{ color: colors.primary600, flex: 1 }} numberOfLines={1}>
            {pass.supportingDocument.name || 'Supporting document'}
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Approved emergency pass: its one code, with the QR on request. */
export function EmergencyApprovedCode({ pass }) {
  const { data, isLoading, error } = useGetGatePassQrQuery(pass._id);
  const [showQr, setShowQr] = useState(false);
  if (isLoading) return <Loading />;
  if (error) return <T v="small" style={{ color: colors.danger, textAlign: 'center' }}>{errMsg(error)}</T>;
  return (
    <View style={{ alignItems: 'center', gap: 8, padding: 14, borderRadius: radius.md, backgroundColor: colors.successSoft }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <CheckCircle2 size={18} color={colors.success} />
        <T v="strong" style={{ color: '#059669' }}>
          EMERGENCY GATE PASS APPROVED
        </T>
      </View>
      <T v="small">Approved by: {AUTHORITY_LABELS[pass.emergencyAuthority]}</T>
      <T v="label">Gate pass code</T>
      <T v="code" accessibilityLabel={`Gate pass code ${data.code.split('').join(' ')}`}>
        {data.code}
      </T>
      {showQr ? (
        <View style={{ backgroundColor: '#fff', padding: 12, borderRadius: 24 }}>
          <Image source={{ uri: data.qr }} style={{ width: 220, height: 220 }} accessibilityLabel="Gate pass QR code" />
        </View>
      ) : null}
      <Button title={showQr ? 'Hide QR' : 'Show QR'} icon={QrCode} variant="outline" onPress={() => setShowQr((v) => !v)} style={{ alignSelf: 'stretch' }} />
      <T v="small" style={{ textAlign: 'center' }}>
        Present this code or QR to Security.
      </T>
    </View>
  );
}

/** Emergency request form: identity is read-only, from the signed-in account. */
export function EmergencyRequestForm({ onSubmitted }) {
  const me = useSelector(selectUser);
  const [create, { isLoading }] = useCreateEmergencyGatePassMutation();
  const [upload, { isLoading: uploading }] = useUploadImageMutation();
  const [authority, setAuthority] = useState('');
  const [reason, setReason] = useState('');
  const [destination, setDestination] = useState('');
  const [leaveAt, setLeaveAt] = useState(() => new Date(Date.now() + 15 * 60000));
  const [returnAt, setReturnAt] = useState(() => new Date(Date.now() + 4 * 3600000));
  const [doc, setDoc] = useState(null);
  const [errors, setErrors] = useState({});

  const pickDocument = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (res.canceled) return;
    const asset = res.assets[0];
    if (asset.fileSize && asset.fileSize > MAX_BYTES) return Alert.alert('File too large', 'Please choose an image under 5 MB.');
    try {
      const file = await upload(asset).unwrap();
      setDoc({ url: file.url, name: file.name, mimeType: file.mimeType, local: asset.uri });
    } catch (e) {
      Alert.alert('Upload failed', errMsg(e));
    }
  };

  const submit = async () => {
    const e = {};
    if (!authority) e.authority = 'Choose who should approve it';
    if (reason.trim().length < 5) e.reason = 'Please describe the emergency (5+ characters)';
    if (destination.trim().length < 2) e.destination = 'Required';
    if (returnAt <= leaveAt) e.returnAt = 'Must be after the leaving time';
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      await create({
        authority,
        reason: reason.trim(),
        destination: destination.trim(),
        leaveAt: leaveAt.toISOString(),
        expectedReturnAt: returnAt.toISOString(),
        ...(doc ? { supportingDocument: { url: doc.url, name: doc.name, mimeType: doc.mimeType } } : {}),
      }).unwrap();
      Alert.alert('Emergency request sent', `It went straight to the ${AUTHORITY_LABELS[authority]}.`);
      onSubmitted?.();
    } catch (err) {
      Alert.alert('Could not submit', errMsg(err));
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={{ padding: 12, borderRadius: radius.md, backgroundColor: colors.primarySoft }}>
        <Facts
          rows={[
            ['Student name', me?.name],
            ['Roll number', me?.rollNo],
            ['Department', me?.department],
            ['Year', YEAR_LABELS[me?.year] || me?.year],
            ['Section', me?.section],
          ]}
        />
      </View>
      <PickerField
        label="Authority to escalate to"
        value={AUTHORITY_LABELS[authority] || ''}
        onChange={(label) => setAuthority(AUTHORITY_BY_LABEL[label])}
        options={Object.values(AUTHORITY_LABELS)}
        placeholder="Select authority"
        error={errors.authority}
      />
      <Input label="Reason" value={reason} onChangeText={setReason} multiline maxLength={500} placeholder="What is the emergency?" error={errors.reason} />
      <Input label="Destination" value={destination} onChangeText={setDestination} maxLength={120} error={errors.destination} />
      <DateTimeField label="Date & requested leaving time" value={leaveAt} onChange={setLeaveAt} minimumDate={new Date()} />
      <DateTimeField label="Expected return time" value={returnAt} onChange={setReturnAt} minimumDate={leaveAt} error={errors.returnAt} />
      <View style={{ gap: 8 }}>
        <T v="label">Supporting document (optional)</T>
        {doc ? <Image source={{ uri: doc.local }} style={{ width: '100%', height: 140, borderRadius: radius.md }} resizeMode="cover" accessibilityLabel="Attached document" /> : null}
        <Button title={doc ? 'Replace photo' : 'Attach a photo'} variant="outline" icon={ImagePlus} loading={uploading} onPress={pickDocument} />
      </View>
      <Button title="Send emergency request" variant="danger" onPress={submit} loading={isLoading} disabled={uploading} />
    </View>
  );
}
