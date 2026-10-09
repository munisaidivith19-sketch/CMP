import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, View } from 'react-native';
import { useSelector } from 'react-redux';
import * as ImagePicker from 'expo-image-picker';
import { ImagePlus, Send, X } from 'lucide-react-native';
import { Button, Chip, IconButton, Input, T } from './ui';
import PickerField from './PickerField';
import FullImage from './FullImage';
import { errMsg, useCreateAnnouncementMutation, useUploadImageMutation } from '../services/api';
import { selectUser } from '../store/authSlice';
import { ACADEMIC_YEARS, DEPARTMENTS, FIRST_YEAR_HOD_DEPT, SECTIONS, colors, isFirstYearHod } from '../theme';

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Who can post where — the same rules the API enforces (it re-checks every one):
 * Principal: whole campus, or any department / year / section.
 * Branch HOD: own department, 2nd–4th year. First-year HOD: 1st year.
 */
function scopesFor(user) {
  if (user.role === 'principal') return ['all', 'department', 'year', 'section'];
  if (user.role === 'hod') return ['department', 'year', 'section'];
  return [];
}
const SCOPE_LABEL = { all: 'Whole campus', department: 'Department', year: 'Year', section: 'Section' };

export const canPostAnnouncements = (user) => scopesFor(user).length > 0;

export default function AnnouncementForm({ open, onClose }) {
  const me = useSelector(selectUser);
  const firstYear = isFirstYearHod(me);
  const scopes = scopesFor(me);
  const lockedDept = me.role === 'hod' && !firstYear ? me.department : '';
  const years = me.role === 'hod' ? (firstYear ? [1] : ACADEMIC_YEARS.filter((y) => y !== 1)) : ACADEMIC_YEARS;
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState('normal');
  const [scope, setScope] = useState(scopes[0]);
  const [department, setDepartment] = useState(lockedDept);
  const [year, setYear] = useState(years[0]);
  const [section, setSection] = useState('');
  const [image, setImage] = useState(null);
  const [create, { isLoading }] = useCreateAnnouncementMutation();
  const [upload, { isLoading: uploading }] = useUploadImageMutation();

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setContent('');
    setPriority('normal');
    setScope(scopes[0]);
    setDepartment(firstYear ? FIRST_YEAR_HOD_DEPT : lockedDept);
    setYear(years[0]);
    setSection('');
    setImage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (res.canceled) return;
    const asset = res.assets[0];
    if (asset.fileSize && asset.fileSize > MAX_BYTES) return Alert.alert('Photo too large', 'Please choose an image under 5 MB.');
    try {
      setImage((await upload(asset).unwrap()).url);
    } catch (e) {
      Alert.alert('Upload failed', errMsg(e));
    }
  };

  const submit = async () => {
    if (title.trim().length < 3) return Alert.alert('Title must be at least 3 characters');
    if (content.trim().length < 5) return Alert.alert('Please write the announcement (5+ characters)');
    const audience = { scope };
    // First-year HOD year/section posts are college-wide 1st year unless a section is chosen.
    if (scope === 'department') audience.department = department;
    if (scope === 'year' || scope === 'section') {
      audience.year = year;
      if (department && !(firstYear && department === FIRST_YEAR_HOD_DEPT)) audience.department = department;
    }
    if (scope === 'section') audience.section = section;
    if (scope === 'department' && !audience.department) return Alert.alert('Choose a department');
    if (scope === 'section' && (!audience.department || !section)) return Alert.alert('Choose a department and a section');
    try {
      await create({ title: title.trim(), content: content.trim(), priority, audience, ...(image ? { image } : {}) }).unwrap();
      onClose();
    } catch (e) {
      Alert.alert('Could not post', errMsg(e));
    }
  };

  const deptOptions = firstYear ? DEPARTMENTS : DEPARTMENTS.filter((d) => d !== FIRST_YEAR_HOD_DEPT);

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 56, gap: 12 }} keyboardShouldPersistTaps="handled">
          <T v="h2">New announcement</T>
          <Input label="Title" value={title} onChangeText={setTitle} maxLength={160} />
          <Input label="Message" value={content} onChangeText={setContent} multiline maxLength={5000} />
          <View style={{ gap: 6 }}>
            <T v="label">Priority</T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {['normal', 'important', 'urgent'].map((p) => (
                <Chip key={p} label={p[0].toUpperCase() + p.slice(1)} active={priority === p} onPress={() => setPriority(p)} />
              ))}
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <T v="label">Audience</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {scopes.map((s) => (
                <Chip key={s} label={SCOPE_LABEL[s]} active={scope === s} onPress={() => setScope(s)} />
              ))}
            </View>
          </View>
          {scope !== 'all' && !lockedDept ? (
            <PickerField label={scope === 'year' ? 'Department (optional)' : 'Department'} value={department} onChange={setDepartment} options={deptOptions} placeholder="Select department" />
          ) : null}
          {scope !== 'all' && lockedDept ? <T v="small">Department: {lockedDept}</T> : null}
          {scope === 'year' || scope === 'section' ? (
            <View style={{ gap: 6 }}>
              <T v="label">Year</T>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {years.map((y) => (
                  <Chip key={y} label={`Year ${y}`} active={year === y} onPress={() => setYear(y)} />
                ))}
              </View>
            </View>
          ) : null}
          {scope === 'section' ? (
            <View style={{ gap: 6 }}>
              <T v="label">Section</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {SECTIONS.map((s) => (
                  <Chip key={s} label={s} active={section === s} onPress={() => setSection(s)} />
                ))}
              </View>
            </View>
          ) : null}
          {image ? (
            <View>
              <FullImage uri={image} maxHeight={220} />
              <IconButton icon={X} label="Remove image" onPress={() => setImage(null)} style={{ position: 'absolute', top: 8, right: 8 }} />
            </View>
          ) : (
            <Button title={uploading ? 'Uploading…' : 'Add image'} icon={ImagePlus} variant="soft" small loading={uploading} onPress={pickImage} style={{ alignSelf: 'flex-start' }} />
          )}
          <Button title="Post announcement" icon={Send} loading={isLoading} disabled={uploading} onPress={submit} />
          <Button title="Cancel" variant="ghost" onPress={onClose} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
