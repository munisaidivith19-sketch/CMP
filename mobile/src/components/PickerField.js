import { useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { Input, T } from './ui';
import { colors, fonts } from '../theme';

/** Tap to open a searchable full-screen list and pick one option (used for the state dropdown). */
export default function PickerField({ label, value, onChange, options, placeholder = 'Select…', error }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));

  return (
    <View>
      {label ? <T v="label" style={{ marginBottom: 6 }}>{label}</T> : null}
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.75)', borderWidth: 1, borderColor: error ? colors.danger : 'rgba(255,255,255,0.85)', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 13 }}
      >
        <T style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: value ? colors.ink : colors.muted }}>{value || placeholder}</T>
        <ChevronDown size={16} color={colors.muted} />
      </Pressable>
      {error ? <T v="small" style={{ color: colors.danger, marginTop: 4 }}>{error}</T> : null}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: 60, paddingHorizontal: 16 }}>
          <T v="h2" style={{ marginBottom: 12 }}>{label || 'Choose one'}</T>
          <Input placeholder="Search" value={q} onChangeText={setQ} autoFocus />
          <FlatList
            data={filtered}
            keyExtractor={(item) => item}
            contentContainerStyle={{ paddingVertical: 12 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onChange(item);
                  setOpen(false);
                  setQ('');
                }}
                style={{ paddingVertical: 14, borderBottomWidth: 1, borderColor: 'rgba(108,93,211,0.08)' }}
              >
                <T v="body" style={item === value ? { color: colors.primary, fontFamily: fonts.bold } : null}>
                  {item}
                </T>
              </Pressable>
            )}
          />
          <Pressable onPress={() => setOpen(false)} style={{ paddingVertical: 14, alignItems: 'center' }}>
            <T v="strong" style={{ color: colors.primary }}>Close</T>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}
