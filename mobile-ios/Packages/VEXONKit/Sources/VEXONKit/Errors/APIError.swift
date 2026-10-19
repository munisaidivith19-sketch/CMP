import Foundation

/// The backend's error body (server/src/middleware/error.js):
/// `{ message, errors?: [{ field, message }], ...extra }`.
/// Extra keys used by the app: `locked`, `remainingAttempts` (sign-in) and
/// `code` (e.g. `trip_not_active`).
public struct ServerErrorBody: Decodable, Sendable, Equatable {
    public struct FieldError: Decodable, Sendable, Equatable {
        public let field: String?
        public let message: String
    }

    public let message: String?
    public let errors: [FieldError]?
    public let locked: Bool?
    public let remainingAttempts: Int?
    public let code: String?
    public let reason: String?

    public init(message: String? = nil, errors: [FieldError]? = nil, locked: Bool? = nil, remainingAttempts: Int? = nil, code: String? = nil, reason: String? = nil) {
        self.message = message
        self.errors = errors
        self.locked = locked
        self.remainingAttempts = remainingAttempts
        self.code = code
        self.reason = reason
    }
}

/// Every way a request can fail, mapped into categories the UI can act on.
public enum APIError: Error, Sendable, Equatable {
    /// No server address is configured for this build / device.
    case notConfigured
    /// The device could not reach the server (offline, DNS, TLS, connection refused).
    case network
    /// The server did not answer in time.
    case timeout
    /// The calling task was cancelled (view disappeared, newer search, …). Never shown to the user.
    case cancelled
    /// 401 — the session is missing, expired or revoked.
    case unauthorized(ServerErrorBody?)
    /// 403 — signed in, but this role may not do this. Enforced by the server.
    case forbidden(ServerErrorBody?)
    /// 404.
    case notFound(ServerErrorBody?)
    /// 409 — a conflict such as an inactive trip or duplicate.
    case conflict(ServerErrorBody?)
    /// 400 / 422 — input rejected, usually with per-field messages.
    case validation(ServerErrorBody?)
    /// 423 or `locked: true` — account temporarily locked after failed sign-ins.
    case locked(ServerErrorBody?)
    /// 429.
    case rateLimited(ServerErrorBody?)
    /// 5xx.
    case server(status: Int, ServerErrorBody?)
    /// Any other non-2xx status.
    case http(status: Int, ServerErrorBody?)
    /// The server answered 2xx but the body did not match the expected model.
    case decoding(String)

    /// Build the error for a non-2xx response.
    public static func from(status: Int, body: Data) -> APIError {
        let decoded = try? JSONDecoder().decode(ServerErrorBody.self, from: body)
        if decoded?.locked == true { return .locked(decoded) }
        switch status {
        case 400, 422: return .validation(decoded)
        case 401: return .unauthorized(decoded)
        case 403: return .forbidden(decoded)
        case 404: return .notFound(decoded)
        case 409: return .conflict(decoded)
        case 423: return .locked(decoded)
        case 429: return .rateLimited(decoded)
        case 500...599: return .server(status: status, decoded)
        default: return .http(status: status, decoded)
        }
    }

    public var body: ServerErrorBody? {
        switch self {
        case .unauthorized(let b), .forbidden(let b), .notFound(let b), .conflict(let b),
             .validation(let b), .locked(let b), .rateLimited(let b):
            return b
        case .server(_, let b), .http(_, let b):
            return b
        case .notConfigured, .network, .timeout, .cancelled, .decoding:
            return nil
        }
    }

    public var status: Int? {
        switch self {
        case .unauthorized: return 401
        case .forbidden: return 403
        case .notFound: return 404
        case .conflict: return 409
        case .validation: return 422
        case .locked: return 423
        case .rateLimited: return 429
        case .server(let s, _), .http(let s, _): return s
        case .notConfigured, .network, .timeout, .cancelled, .decoding: return nil
        }
    }

    /// Connectivity failures (worth a retry / an "offline" state), as opposed to answers from the server.
    public var isConnectivity: Bool {
        switch self {
        case .network, .timeout: return true
        default: return false
        }
    }

    /// Message for the user. Server-written messages are shown as-is (they are
    /// written for users); everything else gets a plain, non-technical sentence.
    public var userMessage: String {
        if let text = body?.message, !text.isEmpty { return text }
        switch self {
        case .notConfigured: return "No VEXON server is configured. Set the server address on the sign-in screen."
        case .network: return "Cannot reach the VEXON server — check your internet connection."
        case .timeout: return "The server is taking too long — please try again."
        case .cancelled: return ""
        case .unauthorized: return "Your session has ended. Please sign in again."
        case .forbidden: return "You do not have permission to do this."
        case .notFound: return "This item was not found or is no longer available."
        case .conflict: return "This action conflicts with the current state. Refresh and try again."
        case .validation: return "Please check the details you entered."
        case .locked: return "Account temporarily locked due to multiple failed sign-in attempts."
        case .rateLimited: return "Too many requests — please wait a moment and try again."
        case .server: return "The server had a problem. Please try again shortly."
        case .http: return "Something went wrong."
        case .decoding: return "The server sent an unexpected response. Please update the app or try again."
        }
    }

    /// Per-field validation messages, keyed by field path.
    public var fieldErrors: [String: String] {
        guard let errors = body?.errors else { return [:] }
        var out: [String: String] = [:]
        for e in errors { if let f = e.field, out[f] == nil { out[f] = e.message } }
        return out
    }
}

extension APIError: LocalizedError {
    public var errorDescription: String? { userMessage }
}
