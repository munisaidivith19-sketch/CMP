import Foundation

/// The notification authorization the app reads from `UNUserNotificationCenter`,
/// mirrored here so the gate's rules are testable without UIKit.
public enum NotificationAuthorization: Sendable, Equatable {
    case notDetermined, denied, authorized, provisional, ephemeral, unknown
}

/// Notifications are mandatory for a signed-in JNN user: without them the main
/// tabs are replaced by the "Notifications Required" screen. Sign-in and the
/// offline launch screen are never gated, so nobody is locked out of their account.
public enum NotificationGate {
    public enum State: Sendable, Equatable {
        /// Not read yet (first launch frame).
        case checking
        /// Full authorization: the app opens normally.
        case allowed
        /// iOS will still show its permission prompt.
        case canRequest
        /// Turned off by the user: only the Settings app can change it.
        case settingsOnly
    }

    public static func state(for authorization: NotificationAuthorization?) -> State {
        switch authorization {
        case nil: .checking
        // Ephemeral exists only for App Clips, which already get notifications.
        case .authorized?, .ephemeral?: .allowed
        // Provisional delivers quietly to Notification Center only, so it is not
        // treated as full authorization; iOS shows the full prompt when asked.
        case .notDetermined?, .provisional?: .canRequest
        // Denied, and any status a future iOS adds: send the user to Settings.
        case .denied?, .unknown?: .settingsOnly
        }
    }
}
