import { useState } from 'react';
import { Alert, Image, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ImagePlus, X } from 'lucide-react-native';
import { Button, Card, Chip, Header, Input, Screen, T } from '../../../components/ui';
import DateTimeField from '../../../components/DateTimeField';
import { errMsg, useReportLostFoundMutation, useUploadImageMutation } from '../../../services/api';
import { colors } from '../../../theme';
import { titleCase } from '../../../utils/format';

const CATEGORIES = ['electronics', 'documents', 'clothing', 'accessories', 'books', 'keys', 'wallet', 'bag', 'sports', 'other'];
const MAX_BYTES = 5 * 1024 * 1024;

export default function ReportItem() {
  const [type, setType] = useState('lost');
  const [itemName, setItemName] = useState('');
  const [category, setCategory] = useState('electronics');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [when, setWhen] = useState(new Date());
  const [contact, setContact] = useState('email');
  const [photo, setPhoto] = useState(null);
  const [errors, setErrors] = useState({});
  const [upload, { isLoading: uploading }] = useUploadImageMutation();
  const [report, { isLoading }] = useReportLostFoundMutation();

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: true });
    if (res.canceled) return;
    const asset = res.assets[0];
    if (asset.fileSize && asset.fileSize > MAX_BYTES) return Alert.alert('Photo too large', 'Please choose an image under 5 MB.');
    try {
      // The server checks the real file type from its bytes before storing it.
      const file = await upload(asset).unwrap();
      setPhoto({ url: file.url, local: asset.uri });
    } catch (e) {
      Alert.alert('Upload failed', errMsg(e));
    }
  };

  const submit = async () => {
    const e = {};
    if (itemName.trim().length < 2) e.itemName = 'What is the item?';
    if (location.trim().length < 2) e.location = 'Where was it lost or found?';
    if (when > new Date(Date.now() + 5 * 60000)) e.when = 'Cannot be in the future';
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      const item = await report({
        type,
        itemName: itemName.trim(),
        category,
        location: location.trim(),
        description: description.trim() || undefined,
        dateTime: when.toISOString(),
        contactMethod: contact,
        photo: photo?.url,
      }).unwrap();
      router.replace(`/lost-found/${item._id}`);
    } catch (err) {
      Alert.alert('Could not submit', errMsg(err));
    }
  };

  return (
    <Screen>
      <Header back title="Report an item" subtitle="Your contact details are shared only with staff." />
      <Card style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="I lost something" active={type === 'lost'} onPress={() => setType('lost')} />
          <Chip label="I found something" active={type === 'found'} onPress={() => setType('found')} />
        </View>
        <Input label="Item" value={itemName} onChangeText={setItemName} maxLength={120} placeholder="e.g. Black HP laptop charger" error={errors.itemName} />
        <View style={{ gap: 6 }}>
          <T v="label">Category</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {CATEGORIES.map((c) => (
              <Chip key={c} label={titleCase(c)} active={category === c} onPress={() => setCategory(c)} />
            ))}
          </View>
        </View>
        <Input label={type === 'lost' ? 'Last seen at' : 'Found at'} value={location} onChangeText={setLocation} maxLength={200} placeholder="e.g. Library, 2nd floor" error={errors.location} />
        <DateTimeField label="When" value={when} onChange={setWhen} maximumDate={new Date()} error={errors.when} />
        <Input label="Description" value={description} onChangeText={setDescription} multiline maxLength={1000} placeholder="Colour, brand, marks…" />
        <View style={{ gap: 6 }}>
          <T v="label">How staff can reach you</T>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[
              ['email', 'Email'],
              ['phone', 'Phone'],
              ['in_person', 'In person'],
            ].map(([v, l]) => (
              <Chip key={v} label={l} active={contact === v} onPress={() => setContact(v)} />
            ))}
          </View>
        </View>
        {photo ? (
          <View>
            <Image source={{ uri: photo.local }} style={{ width: '100%', height: 180, borderRadius: 22 }} />
            <Pressable onPress={() => setPhoto(null)} accessibilityLabel="Remove photo" style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 16, padding: 6 }}>
              <X size={16} color="#fff" />
            </Pressable>
          </View>
        ) : (
          <Button title="Add a photo (optional)" variant="outline" icon={ImagePlus} loading={uploading} onPress={pick} />
        )}
        <T v="small" style={{ color: colors.muted }}>
          JPG, PNG, WEBP or GIF · max 5 MB
        </T>
        <Button title="Submit report" onPress={submit} loading={isLoading} disabled={uploading} />
      </Card>
    </Screen>
  );
}
