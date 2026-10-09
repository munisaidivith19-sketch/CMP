import { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useDispatch, useSelector } from 'react-redux';
import { Camera, LogOut, Pencil, ShieldCheck } from 'lucide-react-native';
import { Avatar, Badge, Button, Card, Header, Input, Screen, T } from '../../../components/ui';
import { api, errMsg, useUpdateMeMutation, useUploadAvatarMutation } from '../../../services/api';
import { clearRefreshToken, mobileHeaders, readRefreshToken } from '../../../services/session';
import { disconnectSocket } from '../../../services/socket';
import { getPushToken } from '../../../services/push';
import { loggedOut, selectUser, setUser } from '../../../store/authSlice';
import { fetchWithTimeout, getApiUrl } from '../../../config';
import { ROLE_LABELS, colors } from '../../../theme';
import { displayName } from '../../../utils/format';

const Row = ({ label, value }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}>
    <T v="small">{label}</T>
    <T v="strong">{value || '—'}</T>
  </View>
);

export default function Profile() {
  const dispatch = useDispatch();
  const user = useSelector(selectUser);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ bio: '', phone: '', skills: '' });
  const [save, { isLoading }] = useUpdateMeMutation();
  const [signingOut, setSigningOut] = useState(false);
  const [uploadAvatar, { isLoading: uploadingAvatar }] = useUploadAvatarMutation();

  const changePhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: true, aspect: [1, 1] });
    if (res.canceled) return;
    const asset = res.assets[0];
    if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) return Alert.alert('Photo too large', 'Please choose an image under 5 MB.');
    try {
      dispatch(setUser(await uploadAvatar(asset).unwrap()));
    } catch (e) {
      Alert.alert('Could not update photo', errMsg(e));
    }
  };

  useEffect(() => {
    setForm({ bio: user.bio || '', phone: user.phone || '', skills: (user.skills || []).join(', ') });
  }, [user, editing]);

  const submit = async () => {
    try {
      const updated = await save({ bio: form.bio, phone: form.phone, skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean) }).unwrap();
      dispatch(setUser(updated));
      setEditing(false);
    } catch (e) {
      Alert.alert('Could not save', errMsg(e));
    }
  };

  /** Sign out THIS device: the server revokes only this session and forgets its push token. */
  const signOut = async () => {
    setSigningOut(true);
    try {
      const [refreshToken, pushToken] = await Promise.all([readRefreshToken(), getPushToken().catch(() => null)]);
      await fetchWithTimeout(`${getApiUrl()}/api/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...mobileHeaders() },
        body: JSON.stringify({ refreshToken, pushToken }),
      }).catch(() => null);
    } finally {
      await clearRefreshToken();
      disconnectSocket();
      dispatch(api.util.resetApiState());
      dispatch(loggedOut());
      router.replace('/login');
    }
  };

  return (
    <Screen>
      <Header title="Profile" right={<Button small variant="soft" icon={Pencil} title={editing ? 'Cancel' : 'Edit'} onPress={() => setEditing((e) => !e)} />} />
      <Card style={{ alignItems: 'center', gap: 8 }}>
        <Pressable onPress={changePhoto} disabled={uploadingAvatar} accessibilityRole="button" accessibilityLabel="Change profile photo">
          <Avatar user={user} size={84} />
          <View style={{ position: 'absolute', right: -4, bottom: -4, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' }}>
            <Camera size={14} color="#fff" />
          </View>
        </Pressable>
        {uploadingAvatar ? <T v="small">Uploading photo…</T> : null}
        <T v="h2">{displayName(user)}</T>
        <T v="small">{user.email}</T>
        <Badge label={ROLE_LABELS[user.role]} />
      </Card>

      {editing ? (
        <Card style={{ gap: 12 }}>
          <Input label="Bio" value={form.bio} onChangeText={(bio) => setForm((f) => ({ ...f, bio }))} multiline maxLength={500} />
          <Input label="Phone" value={form.phone} onChangeText={(phone) => setForm((f) => ({ ...f, phone }))} keyboardType="phone-pad" maxLength={20} />
          <Input label="Skills" value={form.skills} onChangeText={(skills) => setForm((f) => ({ ...f, skills }))} hint="Comma-separated" />
          <Button title="Save profile" onPress={submit} loading={isLoading} />
        </Card>
      ) : (
        <Card>
          <Row label="Department" value={user.department} />
          <Row label="Year" value={user.year} />
          <Row label="Section" value={user.section} />
          <Row label="Semester" value={user.semester} />
          <Row label="Roll number" value={user.rollNo} />
          {user.bio ? <T v="body" style={{ marginTop: 8 }}>{user.bio}</T> : null}
          {user.skills?.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {user.skills.map((s) => (
                <Badge key={s} label={s} color="neutral" />
              ))}
            </View>
          ) : null}
        </Card>
      )}

      <Button title="Account security" variant="outline" icon={ShieldCheck} onPress={() => router.push('/settings/security')} />
      <Button title="Sign out" variant="danger" icon={LogOut} loading={signingOut} onPress={signOut} />
      <T v="small" style={{ textAlign: 'center', color: colors.muted }}>
        Class details (section, semester) are managed by your administrator.
      </T>
    </Screen>
  );
}
