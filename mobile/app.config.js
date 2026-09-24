/**
 * Vexon Android app — Expo config.
 *
 * The app talks to the SAME CampusConnect/Vexon backend as the web app. Its
 * address comes from EXPO_PUBLIC_API_URL (see .env.example and eas.json); it is
 * never hard-coded. In development, if the variable is unset, the app falls back
 * to the computer running `npx expo start` (see src/config.js).
 */
const apiUrl = process.env.EXPO_PUBLIC_API_URL || '';
// Android blocks plain-HTTP traffic in release builds; allow it only when the
// configured backend (e.g. a campus LAN server) is not served over HTTPS.
const allowCleartext = !apiUrl || apiUrl.startsWith('http://');

module.exports = {
  expo: {
    name: 'Vexon',
    slug: 'vexon',
    scheme: 'vexon',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#eef0fb',
    },
    android: {
      package: process.env.ANDROID_PACKAGE || 'com.vexon.campus',
      versionCode: 1,
      adaptiveIcon: {
        backgroundColor: '#6c5dd3',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      // Only what the app uses: notifications, photo picking for lost & found.
      permissions: ['POST_NOTIFICATIONS', 'READ_MEDIA_IMAGES'],
      blockedPermissions: ['android.permission.RECORD_AUDIO'],
      ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
    },
    ios: { supportsTablet: false, bundleIdentifier: 'com.vexon.campus' },
    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-font',
      ['expo-notifications', { color: '#6c5dd3' }],
      ['expo-image-picker', { photosPermission: 'Vexon uses your photos to attach a picture to a lost or found item report.', cameraPermission: false }],
      ['expo-splash-screen', { image: './assets/splash-icon.png', backgroundColor: '#eef0fb', imageWidth: 180 }],
      ['expo-build-properties', { android: { usesCleartextTraffic: allowCleartext } }],
    ],
    experiments: { typedRoutes: false },
    extra: {
      // Set EAS_PROJECT_ID after `eas init` — needed for Expo push tokens.
      eas: { projectId: process.env.EAS_PROJECT_ID || undefined },
    },
  },
};
