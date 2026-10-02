import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Pressable, View } from 'react-native';
import { X } from 'lucide-react-native';
import { Button, T } from './ui';
import { hasNativeModule, UPDATE_APP_MESSAGE } from '../utils/native';
import { createScanGate } from '../utils/gateQr';

// Loaded only when this app build contains the camera module; an older build
// must not crash the security screens that offer scanning.
const Camera = hasNativeModule('ExpoCamera') ? require('expo-camera') : null;

const FRAME = 248;
// Dark pill behind overlay text so it stays readable over a bright camera image.
const PILL = { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, overflow: 'hidden' };
const DENIED_RETRY = 'Camera permission is required to scan a QR code. Please allow camera access in your device settings and try again.';
const BLOCKED = 'Camera access is disabled for Vexon. Please enable camera permission in Android Settings to scan QR codes.';

function Notice({ title, text, children }) {
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 14, width: '100%', maxWidth: 360 }}>
      <T v="h3">{title}</T>
      <T v="small">{text}</T>
      {children}
    </View>
  );
}

function CloseButton({ onClose }) {
  return (
    <Pressable
      onPress={onClose}
      accessibilityRole="button"
      accessibilityLabel="Close scanner"
      hitSlop={12}
      style={{ position: 'absolute', top: 44, right: 20, width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}
    >
      <X size={24} color="#fff" />
    </Pressable>
  );
}

const CORNERS = [
  { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 16 },
  { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 16 },
  { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 16 },
  { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 16 },
];

/** Camera + permissions. Rendered only while the scanner modal is open, so it unmounts (and releases the camera) on close. */
function ScannerBody({ onClose, onScanned, title }) {
  const [permission, requestPermission] = Camera.useCameraPermissions();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [scanning, setScanning] = useState(true);
  const gate = useRef(null);
  if (!gate.current) {
    gate.current = createScanGate((value) => {
      setScanning(false); // stop the preview immediately — one scan, one backend request
      onScanned(value);
    });
  }

  // Ask only now — the user has just tapped "Scan QR code".
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain && permission.status === 'undetermined') requestPermission();
  }, [permission, requestPermission]);

  // No camera while the app is in the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);

  const granted = permission?.granted;
  const blocked = permission && !permission.granted && !permission.canAskAgain;
  const showCamera = granted && foreground && scanning;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {showCamera ? (
        <Camera.CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(e) => gate.current.handle(e)}
          onMountError={() => setScanning(false)}
        />
      ) : null}

      <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        {!permission ? null : granted ? (
          scanning ? (
            <>
              <View style={{ position: 'absolute', top: 104, left: 24, right: 24, alignItems: 'center' }}>
                <T style={PILL}>{title}</T>
              </View>
              <View style={{ width: FRAME, height: FRAME, maxWidth: '86%' }} accessibilityLabel="Scanning area">
                {CORNERS.map((c, i) => (
                  <View key={i} style={{ position: 'absolute', width: 44, height: 44, borderColor: '#fff', ...c }} />
                ))}
              </View>
              <View style={{ position: 'absolute', bottom: 120, left: 24, right: 24, alignItems: 'center' }}>
                <T style={[PILL, { fontSize: 14, fontWeight: '600' }]}>Align the QR code inside the frame</T>
              </View>
              <View style={{ position: 'absolute', bottom: 40, left: 24, right: 24 }}>
                <Button title="Close" variant="outline" onPress={onClose} />
              </View>
            </>
          ) : (
            <Notice title="Camera unavailable" text="The camera could not be started. Close the scanner and try again, or enter the code manually." />
          )
        ) : blocked ? (
          <Notice title="Camera access needed" text={BLOCKED}>
            <Button title="Open settings" onPress={() => Linking.openSettings()} />
          </Notice>
        ) : (
          <Notice title="Camera access needed" text={DENIED_RETRY}>
            <Button title="Allow camera" onPress={requestPermission} />
          </Notice>
        )}
      </View>
      <CloseButton onClose={onClose} />
    </View>
  );
}

/**
 * Full-screen in-app QR scanner. Reports the raw scanned value once via
 * onScanned — it verifies nothing itself. The caller passes that value to the
 * same backend verification used for a manually typed code.
 */
export default function QrScanner({ open, onClose, onScanned, title = 'Scan gate pass QR' }) {
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {!open ? null : Camera ? (
        <ScannerBody onClose={onClose} onScanned={onScanned} title={title} />
      ) : (
        <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Notice title="Scanner not available" text={UPDATE_APP_MESSAGE}>
            <Button title="Enter code manually" onPress={onClose} />
          </Notice>
          <CloseButton onClose={onClose} />
        </View>
      )}
    </Modal>
  );
}
