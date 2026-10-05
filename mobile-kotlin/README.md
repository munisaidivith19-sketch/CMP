# JNN Android — native Kotlin app

A Kotlin + Jetpack Compose rewrite of the Expo app in `../mobile`. It talks to the
**same backend** (`../server`) with the same endpoints, socket events and push
notifications. Every rule (roles, scope, ownership) is still enforced by the server.

## Build

Requirements: JDK 17, Android SDK 36 (both already used by the Expo build).

```bash
cd mobile-kotlin
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest      # unit tests
./gradlew assembleRelease          # talks to https://jnn.onrender.com
```

The debug build installs as `com.vexon.campus.native` ("JNN (Kotlin)"), so it can sit
next to the Expo dev build. The release build keeps `com.vexon.campus`. Release builds
are signed with the debug key until you add a real `signingConfig`.

## Configuration

| Setting | How to set it | Expo equivalent |
|---|---|---|
| Backend URL | Default `https://jnn.onrender.com` (`vexon.apiUrl` in `gradle.properties`). Override with `-Pvexon.apiUrl=…` or `VEXON_API_URL`. Users can also change it in-app on the login screen | `EXPO_PUBLIC_API_URL` |
| Local backend | `-Pvexon.apiUrl=http://10.0.2.2:5000` (the host PC as seen from the emulator) | Metro host |
| Push notifications | `app/google-services.json` plus `-Pvexon.easProjectId=…` | `GOOGLE_SERVICES_JSON`, `EAS_PROJECT_ID` |

Plain HTTP is allowed only when the configured URL is `http://` (or in debug builds),
the same rule `app.config.js` uses.

## How the Expo pieces map

| Expo / RN | Kotlin |
|---|---|
| expo-router (`src/app`) | `nav/Nav.kt` and `screens/Routes.kt`. Path-based, so server links such as `/gate-pass/123` and `/alumni?tab=jobs` work unchanged |
| RTK Query (`services/api.js`) | `core/Api.kt` and `core/Query.kt`. Cached queries with tags, invalidation, polling, refetch on foreground/reconnect |
| fetchBaseQuery, refresh on 401 | `core/Http.kt`. OkHttp, one shared in-flight refresh, GET-only retry |
| expo-secure-store | `core/SecureStore.kt`. AES-GCM with an Android Keystore key |
| socket.io-client | `core/Realtime.kt`. socket.io-client-java, same LIVE_TAGS mapping |
| expo-notifications | `push/Push.kt`. FCM token exchanged for an Expo push token, because the server only sends via Expo |
| expo-camera | `ui/Native.kt` `QrScanner`. CameraX and ML Kit |
| expo-location | `ui/Native.kt` `bestFreshFix`. Fused location, fresh fixes only, rejects mock locations |
| expo-image-picker | System photo picker (needs no storage permission) |
| components/ui.js, theme.js | `ui/Ui.kt`, `ui/Theme.kt`, `ui/Fields.kt` |

The Expo app is unchanged and still builds as before.
