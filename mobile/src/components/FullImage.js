import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { assetUrl } from '../config';
import { colors } from '../theme';

/**
 * Shows a whole image — never cropped. The box takes the image's own aspect
 * ratio (measured once loaded), capped at maxHeight, and the picture is drawn
 * with resizeMode="contain" so nothing is cut off.
 */
export default function FullImage({ uri, maxHeight = 420, radius = 20, style }) {
  const src = assetUrl(uri);
  const [ratio, setRatio] = useState(16 / 9);
  useEffect(() => {
    if (!src) return undefined;
    let alive = true;
    Image.getSize(
      src,
      (w, h) => alive && w > 0 && h > 0 && setRatio(w / h),
      () => {}
    );
    return () => {
      alive = false;
    };
  }, [src]);
  if (!src) return null;
  return (
    <View style={[{ width: '100%', maxHeight, aspectRatio: ratio, borderRadius: radius, overflow: 'hidden', backgroundColor: colors.primarySoft }, style]}>
      <Image source={{ uri: src }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
    </View>
  );
}
