import Observation
import UIKit
import UserNotifications

/// Push notifications on iOS.
///
/// What exists today on the backend: device registration (`POST /devices`) and
/// delivery through Firebase Cloud Messaging HTTP v1 with **data-only**
/// messages, and a `DeviceToken` model restricted to `platform: 'android'`
/// (server/src/models/DeviceToken.js, services/fcm.js). Data-only messages are
/// not displayed by iOS, and the server has no APNs sender. Registering an iOS
/// token with that endpoint would store it as an Android device, so this app
/// deliberately does NOT send its token yet.
///
/// What this class does now: asks for permission only when the user opts in
/// (Notification settings screen), registers with APNs so the token is ready,
/// and reports the status. In-app notifications and live socket updates work
/// regardless. See README → "Push notifications: missing backend support".
@MainActor
@Observable
final class PushManager {
    enum Status: Equatable {
        case unknown, notDetermined, denied, authorized
    }

    /// Flip to true once the server can deliver to APNs (see README).
    static let backendSupportsAPNs = false

    private(set) var status: Status = .unknown
    private(set) var hasDeviceToken = false
    private(set) var lastError: String?

    func refreshStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined: status = .notDetermined
        case .denied: status = .denied
        case .authorized, .provisional, .ephemeral: status = .authorized
        @unknown default: status = .unknown
        }
    }

    /// Ask for permission (only from an explicit user action) and register with APNs.
    func requestPermission() async {
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            if granted { UIApplication.shared.registerForRemoteNotifications() }
        } catch {
            lastError = "Could not ask for notification permission."
        }
        await refreshStatus()
    }

    func didRegister(deviceToken: Data) {
        hasDeviceToken = !deviceToken.isEmpty
        // Not sent to the server until it supports APNs — see the type comment.
    }

    func didFailToRegister(_ error: Error) {
        hasDeviceToken = false
        lastError = "This build is not set up for Apple push notifications."
    }

    /// On sign-out: stop receiving pushes for the previous account on this device.
    func unregisterLocally() async {
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        if hasDeviceToken { UIApplication.shared.unregisterForRemoteNotifications() }
        hasDeviceToken = false
    }
}

/// Receives the APNs callbacks UIKit still delivers to an app delegate.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    weak var push: PushManager?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        MainActor.assumeIsolated { push?.didRegister(deviceToken: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        MainActor.assumeIsolated { push?.didFailToRegister(error) }
    }

    /// While the app is open, notifications already appear in-app through the socket — keep banners quiet.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.list]
    }
}
