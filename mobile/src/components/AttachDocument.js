import { Alert, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { FileText, X } from 'lucide-react-native';
import { Button, IconButton, T } from './ui';
import { errMsg, useUploadDocumentMutation } from '../services/api';
import { colors } from '../theme';

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Attach a photo of a supporting document (letter, invitation, medical note).
 * Images are valid documents on the server, which checks the real file type
 * from its bytes before storing it. `value` is { url, name, mimeType } or null.
 */
export default function AttachDocument({ label = 'Attachment', value, onChange, required, hint }) {
  const [upload, { isLoading }] = useUploadDocumentMutation();

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (res.canceled) return;
    const asset = res.assets[0];
    if (asset.fileSize && asset.fileSize > MAX_BYTES) return Alert.alert('File too large', 'Please choose an image under 5 MB.');
    try {
      const file = await upload(asset).unwrap();
      onChange({ url: file.url, name: file.name || asset.fileName || 'document.jpg', mimeType: file.mimeType || asset.mimeType || 'image/jpeg' });
    } catch (e) {
      Alert.alert('Upload failed', errMsg(e, 'Could not upload the document'));
    }
  };

  return (
    <View style={{ gap: 6 }}>
      <T v="label">
        {label}
        {required ? ' *' : ' (optional)'}
      </T>
      {value ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <FileText size={16} color={colors.primary} />
          <T v="small" numberOfLines={1} style={{ flex: 1 }}>
            {value.name}
          </T>
          <IconButton icon={X} label="Remove attachment" onPress={() => onChange(null)} />
        </View>
      ) : (
        <Button title={isLoading ? 'Uploading…' : 'Attach a photo'} icon={FileText} variant="soft" small loading={isLoading} onPress={pick} style={{ alignSelf: 'flex-start' }} />
      )}
      {hint ? <T v="small">{hint}</T> : null}
    </View>
  );
}
