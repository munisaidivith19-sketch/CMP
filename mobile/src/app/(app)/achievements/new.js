import { useState } from 'react';
import { Alert, Image, View } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import * as ImagePicker from 'expo-image-picker';
import { ImagePlus, Trophy, X } from 'lucide-react-native';
import { Avatar, Button, Card, Chip, EmptyState, Header, IconButton, Input, Screen, T } from '../../../components/ui';
import DateField from '../../../components/DateField';
import { errMsg, useCreateAchievementMutation, useSearchAchievementStudentsQuery, useUploadImageMutation } from '../../../services/api';
import { assetUrl } from '../../../config';
import { selectUser } from '../../../store/authSlice';
import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_LEVELS, ACHIEVEMENT_POSITIONS, ACHIEVEMENT_POST_ROLES, colors } from '../../../theme';
import { dateKey } from '../../../utils/dates';
import { displayName, titleCase } from '../../../utils/format';

const MAX_STUDENTS = 20;
const MAX_IMAGES = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function ChipRow({ label, options, value, onChange, optional }) {
  return (
    <View style={{ gap: 6 }}>
      <T v="label">{label}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {optional ? <Chip label="None" active={!value} onPress={() => onChange('')} /> : null}
        {options.map((o) => (
          <Chip key={o} label={titleCase(o)} active={value === o} onPress={() => onChange(o)} />
        ))}
      </View>
    </View>
  );
}

/** Principal (any department) and HOD (own department — enforced by the API) post achievements. */
export default function NewAchievement() {
  const me = useSelector(selectUser);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState('');
  const [position, setPosition] = useState('');
  const [eventName, setEventName] = useState('');
  const [organizer, setOrganizer] = useState('');
  const [externalLink, setExternalLink] = useState('');
  const [achievedOn, setAchievedOn] = useState(() => new Date());
  const [students, setStudents] = useState([]);
  const [images, setImages] = useState([]);
  const [q, setQ] = useState('');
  const [errors, setErrors] = useState({});
  const { data: found, isFetching: searching } = useSearchAchievementStudentsQuery({ q: q.trim() }, { skip: q.trim().length < 2 });
  const [upload, { isLoading: uploading }] = useUploadImageMutation();
  const [create, { isLoading }] = useCreateAchievementMutation();

  if (!ACHIEVEMENT_POST_ROLES.includes(me.role)) {
    return (
      <Screen>
        <Header back title="Post achievement" />
        <Card>
          <EmptyState icon={Trophy} title="Only the principal and HODs can post achievements" />
        </Card>
      </Screen>
    );
  }

  const addStudent = (s) => {
    if (students.some((x) => x._id === s._id)) return;
    if (students.length >= MAX_STUDENTS) return Alert.alert(`You can tag at most ${MAX_STUDENTS} students`);
    setStudents([...students, s]);
    setQ('');
  };

  const addImage = async () => {
    if (images.length >= MAX_IMAGES) return Alert.alert(`You can add at most ${MAX_IMAGES} images`);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (res.canceled) return;
    const asset = res.assets[0];
    if (asset.fileSize && asset.fileSize > MAX_BYTES) return Alert.alert('Photo too large', 'Please choose an image under 5 MB.');
    try {
      const file = await upload(asset).unwrap();
      if (!IMAGE_TYPES.includes(file.mimeType)) return Alert.alert('Unsupported image', 'Use a JPG, PNG or WebP photo.');
      setImages([...images, { url: file.url, mimeType: file.mimeType }]);
    } catch (e) {
      Alert.alert('Upload failed', errMsg(e));
    }
  };

  const submit = async () => {
    const e = {};
    if (title.trim().length < 3) e.title = 'At least 3 characters';
    if (description.trim().length < 10) e.description = 'At least 10 characters';
    if (!category) e.category = true;
    if (!level) e.level = true;
    if (!students.length) e.students = 'Select at least one student';
    if (externalLink.trim() && !/^https?:\/\/\S+$/i.test(externalLink.trim())) e.externalLink = 'Must start with http:// or https://';
    setErrors(e);
    if (Object.keys(e).length) return Alert.alert('Check the form', e.category || e.level ? 'Choose a category and a level.' : 'Some fields need attention.');
    try {
      const created = await create({
        title: title.trim(),
        description: description.trim(),
        category,
        level,
        ...(position ? { position } : {}),
        ...(eventName.trim() ? { eventName: eventName.trim() } : {}),
        ...(organizer.trim() ? { organizer: organizer.trim() } : {}),
        ...(externalLink.trim() ? { externalLink: externalLink.trim() } : {}),
        achievedOn: dateKey(achievedOn),
        students: students.map((s) => s._id),
        images,
      }).unwrap();
      router.replace(`/achievements/${created._id}`);
    } catch (err) {
      Alert.alert('Could not post', errMsg(err));
    }
  };

  return (
    <Screen>
      <Header back title="Post achievement" subtitle={me.role === 'hod' ? 'Students of your department' : 'Any department'} />
      <Card style={{ gap: 14 }}>
        <Input label="Title" value={title} onChangeText={setTitle} maxLength={160} placeholder="e.g. Winners — Smart India Hackathon" error={errors.title} />
        <Input label="Description" value={description} onChangeText={setDescription} multiline maxLength={3000} error={errors.description} />
        <ChipRow label="Category" options={ACHIEVEMENT_CATEGORIES} value={category} onChange={setCategory} />
        <ChipRow label="Level" options={ACHIEVEMENT_LEVELS} value={level} onChange={setLevel} />
        <ChipRow label="Position (optional)" options={ACHIEVEMENT_POSITIONS} value={position} onChange={setPosition} optional />
        <DateField label="Achieved on" value={achievedOn} onChange={setAchievedOn} maximumDate={new Date()} />
        <Input label="Event name (optional)" value={eventName} onChangeText={setEventName} maxLength={160} />
        <Input label="Organizer (optional)" value={organizer} onChangeText={setOrganizer} maxLength={160} />
        <Input label="Link (optional)" value={externalLink} onChangeText={setExternalLink} autoCapitalize="none" keyboardType="url" placeholder="https://" error={errors.externalLink} />
      </Card>

      <Card style={{ gap: 10 }}>
        <T v="h3">Students ({students.length}/{MAX_STUDENTS})</T>
        {students.map((s) => (
          <View key={s._id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar user={s} size={32} />
            <View style={{ flex: 1 }}>
              <T v="strong" numberOfLines={1}>{displayName(s)}</T>
              <T v="small">{s.rollNo || '—'} · {s.department}</T>
            </View>
            <IconButton icon={X} label={`Remove ${s.name}`} onPress={() => setStudents(students.filter((x) => x._id !== s._id))} />
          </View>
        ))}
        <Input placeholder="Search by name or roll no." value={q} onChangeText={setQ} autoCorrect={false} error={errors.students} />
        {q.trim().length >= 2
          ? (found?.items || []).filter((s) => !students.some((x) => x._id === s._id)).map((s) => (
              <Card key={s._id} onPress={() => addStudent(s)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 }}>
                <Avatar user={s} size={30} />
                <View style={{ flex: 1 }}>
                  <T v="strong" numberOfLines={1}>{displayName(s)}</T>
                  <T v="small">
                    {s.rollNo || '—'} · {s.department}
                    {s.year ? ` · Y${s.year}` : ''}
                  </T>
                </View>
              </Card>
            ))
          : null}
        {q.trim().length >= 2 && !searching && !found?.items?.length ? <T v="small">No students match.</T> : null}
      </Card>

      <Card style={{ gap: 10 }}>
        <T v="h3">Photos ({images.length}/{MAX_IMAGES})</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {images.map((img) => (
            <View key={img.url}>
              <Image source={{ uri: assetUrl(img.url) }} style={{ width: 90, height: 90, borderRadius: 14 }} />
              <IconButton icon={X} label="Remove photo" color={colors.danger} onPress={() => setImages(images.filter((x) => x.url !== img.url))} style={{ position: 'absolute', top: 4, right: 4, width: 30, height: 30 }} />
            </View>
          ))}
        </View>
        <Button title={uploading ? 'Uploading…' : 'Add photo'} icon={ImagePlus} variant="soft" small loading={uploading} onPress={addImage} style={{ alignSelf: 'flex-start' }} />
      </Card>

      <Button title="Post achievement" loading={isLoading} disabled={uploading} onPress={submit} />
    </Screen>
  );
}
