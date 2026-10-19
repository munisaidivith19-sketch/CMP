import Foundation

public enum HTTPMethod: String, Sendable {
    case get = "GET", post = "POST", put = "PUT", patch = "PATCH", delete = "DELETE"
}

/// One backend call and the type its JSON decodes into. Paths are relative to
/// `/api` and match server/src/routes/index.js exactly.
public struct Endpoint<Response: Decodable & Sendable>: Sendable {
    public let method: HTTPMethod
    public let path: String
    public let query: [URLQueryItem]
    public let body: (any Encodable & Sendable)?
    /// Send the access token and refresh-and-replay once on 401.
    public let authenticated: Bool
    public let timeout: TimeInterval

    public init(
        _ method: HTTPMethod,
        _ path: String,
        query: [String: String?] = [:],
        body: (any Encodable & Sendable)? = nil,
        authenticated: Bool = true,
        timeout: TimeInterval = 20
    ) {
        self.method = method
        self.path = path
        self.query = query
            .compactMap { key, value in value.map { URLQueryItem(name: key, value: $0) } }
            .sorted { $0.name < $1.name }
        self.body = body
        self.authenticated = authenticated
        self.timeout = timeout
    }

    /// Reads are safe to retry after a dropped connection; writes are not, so a
    /// slow "Submit" can never be applied twice by the client.
    public var isIdempotent: Bool { method == .get }
}
