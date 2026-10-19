import Foundation
import Security
import VEXONKit

/// Keychain-backed `SecureStore` — the iOS counterpart of the Android app's
/// Keystore-encrypted SecureStore. Items are readable after the first unlock
/// (so a session can be restored when the app relaunches) and never leave this
/// device (not synced to iCloud Keychain, not restored to another phone).
final class KeychainStore: SecureStore, @unchecked Sendable {
    private let service: String
    private let lock = NSLock()

    init(service: String = Bundle.main.bundleIdentifier ?? "com.vexon.campus") {
        self.service = service
    }

    func string(for key: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func set(_ value: String?, for key: String) {
        lock.lock(); defer { lock.unlock() }
        let query = baseQuery(key)
        guard let value else {
            SecItemDelete(query as CFDictionary)
            return
        }
        let data = Data(value.utf8)
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add.merge(update) { _, new in new }
            SecItemAdd(add as CFDictionary, nil)
        }
    }

    private func baseQuery(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecAttrSynchronizable as String: false,
        ]
    }
}
