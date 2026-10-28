import Observation
import UIKit
import UserNotifications
import VEXONKit

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
/// What this class does now: asks for permission only from an explicit tap (the
/// mandatory "Notifications Required" screen or Notification settings), registers
/// with APNs so the token is ready, and reports the status that drives
/// `NotificationGate`. In-app notifications and live socket updates work
/// regardless. See README → "Push notifications: missing backend support".
@MainActor
@Observable
final class PushManager {
    enum Status: Equatable {
        /// `provisional`: quiet delivery to Notification Center only — not full authorization.
        case unknown, notDetermined, denied, authorized, provisional
    }

    /// Flip to true once the server can deliver to APNs (see README).
    static let backendSupportsAPNs = false

    private(set) var status: Status = .unknown
    private(set) var hasDeviceToken = false
    private(set) var lastError: String?
    /// Nil until the first read; drives the mandatory notification gate.
    private(set) var authorization: NotificationAuthorization?

    var gate: NotificationGate.State { NotificationGate.state(for: authorization) }

    /// Re-read the system setting (at launch and whenever the app becomes active,
    /// so a change made in Settings — either way — is picked up).
    func refreshStatus() async {
        let wasAuthorized = status == .authorized
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined: (status, authorization) = (.notDetermined, .notDetermined)
        case .denied: (status, authorization) = (.denied, .denied)
        case .authorized: (status, authorization) = (.authorized, .authorized)
        case .provisional: (status, authorization) = (.provisional, .provisional)
        case .ephemeral: (status, authorization) = (.authorized, .ephemeral)
        @unknown default: (status, authorization) = (.unknown, .unknown)
        }
        // Turned on in Settings after a denial: register with APNs, as requestPermission does.
        if status == .authorized && !wasAuthorized && !hasDeviceToken {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    /// Opens this app's notification page in Settings. Returns false when iOS
    /// refused; opening it does not mean anything was changed — the status is
    /// re-read when the app becomes active again.
    func openSettings() async -> Bool {
        guard let url = URL(string: UIApplication.openNotificationSettingsURLString) else { return false }
        return await UIApplication.shared.open(url)
    }

    /// Ask for permission (only from an explicit user action) and register with APNs
    /// (refreshStatus registers once the new status is authorized).
    func requestPermission() async {
        do {
            _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
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
