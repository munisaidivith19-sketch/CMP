import Foundation

/// Small secret storage (the app implements it with the Keychain,
/// `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`). Holds only the refresh
/// token and the saved server address — the access token lives in memory.
public protocol SecureStore: Sendable {
    func string(for key: String) -> String?
    func set(_ value: String?, for key: String)
}

public enum SecureStoreKey {
    public static let refreshToken = "vexon.refreshToken"
    public static let serverURL = "vexon.serverUrl"
}

/// In-memory store for tests and previews.
public final class MemorySecureStore: SecureStore, @unchecked Sendable {
    private var values: [String: String]
    private let lock = NSLock()

    public init(_ values: [String: String] = [:]) { self.values = values }

    public func string(for key: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        return values[key]
    }

    public func set(_ value: String?, for key: String) {
        lock.lock(); defer { lock.unlock() }
        values[key] = value
    }
}
