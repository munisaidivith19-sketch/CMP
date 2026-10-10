import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Check, ChevronDown } from 'lucide-react-native';
import { T } from './ui';
import { colors, fonts, radius, shadow } from '../theme';

/**
 * Form dropdown: a field showing the current choice that opens a small menu.
 * options: [{ value, label, hint? }]. Values are compared as strings.
 */
export default function Dropdown({ label, value, options, onChange, placeholder = 'Select…', disabled }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => String(o.value) === String(value));
  return (
    <View>
      {label ? <T v="label" style={{ marginBottom: 6 }}>{label}</T> : null}
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label || 'Select'}: ${current?.label || placeholder}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: pressed ? colors.primary50 : colors.surfaceStrong,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingHorizontal: 14,
          paddingVertical: 12,
          opacity: disabled ? 0.5 : 1,
        })}
      >
        <T numberOfLines={1} style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: current ? colors.ink : colors.muted }}>
          {current?.label || placeholder}
        </T>
        <ChevronDown size={16} color={colors.muted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(27,29,58,0.3)', justifyContent: 'center', padding: 28 }} onPress={() => setOpen(false)}>
          <View style={[{ backgroundColor: '#fff', borderRadius: radius.lg, paddingVertical: 6, maxHeight: '75%' }, shadow]}>
            {label ? <T v="label" style={{ paddingHorizontal: 18, paddingTop: 10, paddingBottom: 6 }}>{label}</T> : null}
            <ScrollView>
              {options.map((o) => {
                const active = String(o.value) === String(value);
                return (
                  <Pressable
                    key={String(o.value)}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: pressed ? colors.primary50 : 'transparent' })}
                  >
                    <View style={{ flex: 1 }}>
                      <T v="body" style={{ fontFamily: active ? fonts.bold : fonts.regular, color: active ? colors.primary600 : colors.ink }}>{o.label}</T>
                      {o.hint ? <T v="small">{o.hint}</T> : null}
                    </View>
                    {active ? <Check size={18} color={colors.primary600} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
