import Foundation
import VEXONKit

/// Values compiled into Info.plist from Config/*.xcconfig. Public settings only —
/// the app holds no server secrets.
enum BuildSettings {
    static var environment: AppEnvironment {
        AppEnvironment(rawValue: string("VEXONEnvironment") ?? "") ?? .production
    }

    /// Plain http is only accepted in Debug builds (LAN development servers).
    static var allowInsecureHTTP: Bool {
        string("VEXONAllowInsecureHTTP")?.uppercased() == "YES"
    }

    static var apiBaseURL: URL? {
        guard let raw = string("VEXONAPIBaseURL"), !raw.isEmpty, !raw.contains("$(") else { return nil }
        return try? ServerConfiguration.clean(raw, allowInsecureHTTP: allowInsecureHTTP).get()
    }

    static var appVersion: String {
        let short = string("CFBundleShortVersionString") ?? "?"
        let build = string("CFBundleVersion") ?? "?"
        return "\(short) (\(build))"
    }

    /// UI tests launch with `-ui-testing`: in-memory secrets, no saved session.
    static var isUITesting: Bool { ProcessInfo.processInfo.arguments.contains("-ui-testing") }

    static var serverConfiguration: ServerConfiguration {
        ServerConfiguration(environment: environment, buildBaseURL: apiBaseURL)
    }

    private static func string(_ key: String) -> String? {
        Bundle.main.object(forInfoDictionaryKey: key) as? String
    }
}
