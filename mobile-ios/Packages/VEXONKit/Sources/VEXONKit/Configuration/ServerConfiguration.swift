import Foundation

/// Which backend build the app talks to. The base URL for each comes from the
/// build configuration (Config/*.xcconfig → Info.plist `VEXONAPIBaseURL`), never
/// from source code, so one codebase serves development, testing and production.
public enum AppEnvironment: String, Sendable, CaseIterable {
    case development
    case testing
    case production
}

/// Where the VEXON backend lives — a port of the Android app's `ServerConfig`.
///
/// Resolution order (same as Android):
///  1. A server address saved on the device (sign-in screen → "Server"), so one
///     build can point at a deployed URL or a tunnel without rebuilding.
///  2. The build-time address from the xcconfig.
///
/// All requests go to `<base>/api/...`; Socket.IO connects to `<base>`.
public struct ServerConfiguration: Sendable, Equatable {
    public let environment: AppEnvironment
    public let buildBaseURL: URL?
    public private(set) var overrideBaseURL: URL?

    public init(environment: AppEnvironment, buildBaseURL: URL?, overrideBaseURL: URL? = nil) {
        self.environment = environment
        self.buildBaseURL = buildBaseURL
        self.overrideBaseURL = overrideBaseURL
    }

    /// The effective server root (no trailing slash, no `/api`), or nil when nothing is configured.
    public var baseURL: URL? { overrideBaseURL ?? buildBaseURL }

    public var isOverridden: Bool { overrideBaseURL != nil }

    public mutating func setOverride(_ url: URL?) {
        overrideBaseURL = url
    }

    /// `<base>/api<path>` with query items; nil if no server is configured.
    public func apiURL(path: String, query: [URLQueryItem] = []) -> URL? {
        guard let base = baseURL else { return nil }
        let normalizedPath = path.hasPrefix("/") ? path : "/" + path
        guard var components = URLComponents(url: base.appendingPathComponent("api"), resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.percentEncodedPath += normalizedPath.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? normalizedPath
        if !query.isEmpty {
            // URLComponents.queryItems leaves "&", "=" and "+" unescaped inside values,
            // which would split a search such as "Route 5 & Main". Encode strictly.
            components.percentEncodedQuery = query.map { item in
                "\(Self.encodeQuery(item.name))=\(Self.encodeQuery(item.value ?? ""))"
            }.joined(separator: "&")
        }
        return components.url
    }

    private static let queryValueAllowed: CharacterSet = {
        var set = CharacterSet.urlQueryAllowed
        set.remove(charactersIn: "&=+?/;#")
        return set
    }()

    static func encodeQuery(_ text: String) -> String {
        text.addingPercentEncoding(withAllowedCharacters: queryValueAllowed) ?? text
    }

    /// Turn a server-relative upload path ("/uploads/x.png") into a full URL.
    public func assetURL(_ path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("https://") || path.hasPrefix("http://") { return URL(string: path) }
        guard let base = baseURL else { return nil }
        return URL(string: base.absoluteString + (path.hasPrefix("/") ? path : "/" + path))
    }

    /// Normalise user input the way the Android app does: trim, drop trailing
    /// slashes and a trailing `/api`. Production builds accept only https.
    public static func clean(_ raw: String, allowInsecureHTTP: Bool) -> Result<URL, ServerAddressError> {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasSuffix("/") { text.removeLast() }
        if text.lowercased().hasSuffix("/api") { text.removeLast(4) }
        while text.hasSuffix("/") { text.removeLast() }
        guard let url = URL(string: text),
              let scheme = url.scheme?.lowercased(),
              let host = url.host, !host.isEmpty,
              url.query == nil, url.fragment == nil
        else { return .failure(.invalid) }
        switch scheme {
        case "https": return .success(url)
        case "http": return allowInsecureHTTP ? .success(url) : .failure(.insecure)
        default: return .failure(.invalid)
        }
    }
}

public enum ServerAddressError: Error, Equatable, Sendable {
    case invalid
    case insecure

    public var message: String {
        switch self {
        case .invalid: return "Enter a full address starting with https://"
        case .insecure: return "This build only connects to https:// servers"
        }
    }
}
