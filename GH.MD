# VEXON — Cross-Platform Location Verification Fix

Act as a senior Android Kotlin, web browser geolocation, backend, and application security engineer.

## Problem

VEXON's Gate Pass → Return to Campus location verification works on some devices but fails on others. Android phones such as Redmi Note 10 Lite can fail even when location permission is granted. The web application in Chrome must also work reliably across supported desktop and mobile devices.

## 1. Audit the complete workflow

Inspect the existing code before making changes:

- Native Kotlin Android location implementation
- Web frontend location implementation and browser permission handling
- Shared/backend Gate Pass return-verification API
- AndroidManifest.xml and Gradle dependencies
- Web API client, error handling and HTTPS configuration
- Geofence configuration and existing tests

Identify the actual root causes. Do not assume the Android and browser failures have the same cause.

## 2. Fix native Android

- Correctly handle asynchronous FusedLocationProviderClient success and failure callbacks.
- Distinguish permission denial, disabled location services, timeout, unavailable provider and poor accuracy.
- Handle approximate and precise location permissions.
- Prevent duplicate requests and clean up callbacks and location updates.
- Do not silently swallow exceptions or accept stale readings.
- Preserve compatibility with supported Android versions and manufacturers.

## 3. Fix web Chrome and other supported browsers

- Use the browser Geolocation API correctly.
- Check for HTTPS/secure-context requirements and browser permission status where supported.
- Handle denied permission, blocked site permissions, location timeout, unavailable position and poor accuracy separately.
- Handle Chrome on Android and desktop, including device location settings and browser-specific limitations.
- Request a fresh position with suitable timeout and accuracy options.
- Provide a retry action and clear instructions for granting permission or enabling device location.
- Do not assume browser permission guarantees that a valid position will be available.
- Do not confuse network connectivity with location availability.

## 4. Preserve the same security policy on every platform

- Campus radius: **500 metres**.
- Maximum accepted reported accuracy: **50 metres**, unless the existing server policy specifies otherwise.
- Maximum location age: **30 seconds**.
- Backend remains authoritative for distance and location-uncertainty checks.
- Approximate location is accepted only when the existing backend uncertainty policy permits it.
- If location uncertainty overlaps the boundary, request a better reading.
- Never trust frontend distance calculations as proof of campus presence.
- Never automatically mark a student as returned when verification fails.
- No background location tracking.

Verify the effective deployed radius configuration and ensure Android and web use the same backend policy.

## 5. Correct error messages

Implement distinct actionable messages for:

- Permission denied
- Approximate location insufficient
- Location services disabled
- Browser site permission blocked
- Secure HTTPS context required
- Location timeout
- Location provider unavailable
- Poor or stale location
- Outside the 500-metre radius
- Network/API failure
- Backend verification rejection

Do not display “Turn on GPS” for every error. Do not expose sensitive coordinates, stack traces or internal server details.

## 6. Testing

Test both platforms independently.

**Android:** permission states, precise/approximate location, timeouts, provider failures, retries, stale readings and multiple device types.

**Web:** Chrome desktop, Chrome Android, denied/blocked permissions, HTTP versus HTTPS behavior, timeouts, unavailable location, approximate readings where supported, and API/network errors.

**Backend:** 500-metre boundary cases, accuracy and age limits, uncertainty handling, unauthorized requests and failed verification.

Run existing and relevant new tests, frontend builds, backend tests and Android build checks. Report tests actually executed; do not claim universal compatibility without device/browser evidence.

## Rules

- Preserve existing VEXON features and architecture.
- Do not introduce Expo or React Native into the Kotlin application.
- Do not weaken authorization or geofence checks.
- Avoid unnecessary dependency upgrades and database changes.
- Do not commit or push.

Finally report the root cause for each platform, files changed, test results, unresolved limitations, and whether a new Android APK or web deployment is required.