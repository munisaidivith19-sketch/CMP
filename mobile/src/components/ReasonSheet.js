import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import { Button, Input, T } from './ui';

/**
 * Bottom sheet asking for a short reason (reject / revoke / hide request).
 * Works on Android too, unlike Alert.prompt which is iOS-only.
 */
export default function ReasonSheet({ open, title, subtitle, label = 'Reason', confirmText = 'Confirm', variant = 'danger', minLength = 0, maxLength = 300, loading, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const tooShort = reason.trim().length < minLength;
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(27,29,58,0.35)' }} onPress={onClose} accessibilityLabel="Close" />
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 12 }}>
          <T v="h2">{title}</T>
          {subtitle ? <T v="small">{subtitle}</T> : null}
          <Input
            label={label}
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={maxLength}
            hint={minLength ? `At least ${minLength} characters` : undefined}
          />
          <Button title={confirmText} variant={variant} loading={loading} disabled={tooShort} onPress={() => onConfirm(reason.trim())} />
          <Button title="Cancel" variant="ghost" onPress={onClose} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
