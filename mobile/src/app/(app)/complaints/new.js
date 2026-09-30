import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { EyeOff, FileText, ImagePlus, Users, X } from 'lucide-react-native';
import { Button, Card, Chip, Header, Input, Screen, T } from '../../../components/ui';
import { errMsg, useCreateComplaintMutation, useUploadImageMutation } from '../../../services/api';
import { COMPLAINT_CATEGORY_LABELS, COMPLAINT_ESCALATE_TO_OPTIONS, COMPLAINT_SUBCATEGORY_OPTIONS, ROLE_LABELS, colors, fonts } from '../../../theme';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 5;

function ChoiceGroup({ label, options, value, onChange, error }) {
  return (
    <View style={{ gap: 6 }}>
      <T v="label">{label}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {options.map((o) => (
          <Chip key={o.value} label={o.label} active={value === o.value} onPress={() => onChange(o.value)} />
        ))}
      </View>
      {error ? <T v="small" style={{ color: colors.danger }}>{error}</T> : null}
    </View>
  );
}

function IdentityOption({ icon: Icon, label, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 14,
        borderRadius: 18,
        borderWidth: 2,
        borderColor: active ? colors.primary : colors.border,
        backgroundColor: active ? colors.primary50 : 'rgba(255,255,255,0.8)',
      }}
    >
      <Icon size={16} color={active ? colors.primary600 : colors.soft} />
      <T style={{ fontFamily: fonts.bold, color: active ? colors.primary600 : colors.soft }}>{label}</T>
    </Pressable>
  );
}

export default function RegisterComplaint() {
  const [anonymous, setAnonymous] = useState(false);
  const [category, setCategory] = useState('academics');
  const [subCategory, setSubCategory] = useState('');
  const [escalateTo, setEscalateTo] = useState('');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [errors, setErrors] = useState({});
  const [upload, { isLoading: uploading }] = useUploadImageMutation();
  const [create, { isLoading }] = useCreateComplaintMutation();

  const subOptions = COMPLAINT_SUBCATEGORY_OPTIONS[category] || [];
  const escalateOptions = (COMPLAINT_ESCALATE_TO_OPTIONS[category] || []).map((r) => ({ value: r, label: ROLE_LABELS[r] || r }));

  // Dependent choices reset whenever the category changes (same as the web form).
  const pickCategory = (c) => {
    setCategory(c);
    setSubCategory('');
    setEscalateTo('');
  };

  const addFile = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (res.canceled) return;
    const asset = res.assets[0];
    if (asset.fileSize && asset.fileSize > MAX_BYTES) return Alert.alert('File too large', 'Please choose a file under 5 MB.');
    try {
      const file = await upload(asset).unwrap();
      setAttachments((a) => [...a, { url: file.url, name: file.name || asset.fileName || 'Photo', mimeType: file.mimeType || asset.mimeType }]);
    } catch (e) {
      Alert.alert('Upload failed', errMsg(e));
    }
  };

  const submit = async () => {
    const e = {};
    if (subOptions.length && !subCategory) e.subCategory = 'Required';
    if (!escalateTo) e.escalateTo = 'Required';
    if (!description.trim()) e.description = 'Please describe the complaint';
    else if (description.trim().length < 10) e.description = 'At least 10 characters';
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      const complaint = await create({
        anonymous,
        category,
        subCategory: subCategory || undefined,
        escalateTo,
        description: description.trim(),
        attachments,
      }).unwrap();
      Alert.alert('Complaint registered', 'The responsible authority has been notified.');
      router.replace(complaint?._id ? `/complaints/${complaint._id}` : '/complaints');
    } catch (err) {
      Alert.alert('Could not submit', errMsg(err));
    }
  };

  return (
    <Screen>
      <Header back title="Register a complaint" subtitle="Tell us what happened — we'll route it to the right authority." />
      <Card style={{ gap: 16 }}>
        <View style={{ gap: 8 }}>
          <T v="label">Choose how your complaint will be submitted</T>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <IdentityOption icon={EyeOff} label="Anonymous" active={anonymous} onPress={() => setAnonymous(true)} />
            <IdentityOption icon={Users} label="Visible" active={!anonymous} onPress={() => setAnonymous(false)} />
          </View>
          <T v="small">
            {anonymous
              ? 'Your identity will be hidden from the authorities handling the complaint. Your identity can only be accessed by authorized Chairman/Admin accounts according to the system’s privacy rules.'
              : 'The responsible authority will be able to see your identity.'}
          </T>
        </View>

        <ChoiceGroup
          label="Complaint category"
          value={category}
          onChange={pickCategory}
          options={Object.entries(COMPLAINT_CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
        />

        {subOptions.length ? (
          <ChoiceGroup
            label={category === 'academics' ? 'Academic category' : 'Select category'}
            value={subCategory}
            onChange={setSubCategory}
            options={subOptions}
            error={errors.subCategory}
          />
        ) : null}

        <ChoiceGroup label="Escalate to" value={escalateTo} onChange={setEscalateTo} options={escalateOptions} error={errors.escalateTo} />

        <Input
          label="Complaint description"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={2000}
          placeholder="Describe what happened in detail…"
          error={errors.description}
        />

        <View style={{ gap: 8 }}>
          <T v="label">Upload supporting files</T>
          {attachments.map((a) => (
            <View key={a.url} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primarySoft, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 }}>
              <FileText size={14} color={colors.primary600} />
              <T v="small" numberOfLines={1} style={{ flex: 1, color: colors.primary600 }}>
                {a.name}
              </T>
              <Pressable onPress={() => setAttachments((list) => list.filter((x) => x.url !== a.url))} hitSlop={8} accessibilityLabel="Remove attachment">
                <X size={16} color={colors.primary600} />
              </Pressable>
            </View>
          ))}
          {attachments.length < MAX_FILES ? <Button title="Add file" variant="outline" icon={ImagePlus} small loading={uploading} onPress={addFile} /> : null}
          <T v="small" style={{ color: colors.muted }}>
            Images · max 5 MB each · up to {MAX_FILES} files
          </T>
        </View>

        <Button title="Submit complaint" onPress={submit} loading={isLoading} disabled={uploading} />
      </Card>
    </Screen>
  );
}
