import Foundation
import Testing
@testable import VEXONKit

// Error-handling catalogue tests (error_handling/catalog/error_catalog.json):
// IOS-001 (no server configured), IOS-002 (network/timeout), IOS-003 (status mapping),
// IOS-004 (lockout). Synthetic data only.

@Suite("Error handling catalogue")
struct ErrorHandlingCatalogueTests {
    @Test("IOS-001 not configured has a user message and no HTTP status")
    func notConfigured() {
        let e = APIError.notConfigured
        #expect(e.status == nil)
        #expect(e.userMessage.contains("No VEXON server is configured"))
    }

    @Test("IOS-002 network and timeout are connectivity failures")
    func connectivity() {
        #expect(APIError.network.isConnectivity)
        #expect(APIError.timeout.isConnectivity)
        #expect(!APIError.server(status: 500, nil).isConnectivity)
        #expect(APIError.network.userMessage.contains("Cannot reach"))
        #expect(APIError.timeout.userMessage.contains("too long"))
    }

    @Test("IOS-003 each HTTP status maps to its category")
    func statusMapping() {
        func kind(_ s: Int) -> String {
            switch APIError.from(status: s, body: Data()) {
            case .validation: "validation"
            case .unauthorized: "unauthorized"
            case .forbidden: "forbidden"
            case .notFound: "notFound"
            case .conflict: "conflict"
            case .locked: "locked"
            case .rateLimited: "rateLimited"
            case .server: "server"
            case .http: "http"
            default: "other"
            }
        }
        #expect(kind(400) == "validation")
        #expect(kind(422) == "validation")
        #expect(kind(401) == "unauthorized")
        #expect(kind(403) == "forbidden")
        #expect(kind(404) == "notFound")
        #expect(kind(409) == "conflict")
        #expect(kind(423) == "locked")
        #expect(kind(429) == "rateLimited")
        #expect(kind(503) == "server")
        #expect(kind(418) == "http")
    }

    @Test("IOS-004 locked:true on any status is a lockout and keeps the server text")
    func lockedFlag() {
        let body = Data(#"{"message":"Too many failed attempts. Try again in 5 minute(s).","locked":true}"#.utf8)
        let e = APIError.from(status: 401, body: body)
        guard case .locked = e else { Issue.record("expected .locked, got \(e)"); return }
        #expect(e.userMessage == "Too many failed attempts. Try again in 5 minute(s).")
    }

    @Test("IOS-003 a non-JSON error body still yields a safe message")
    func nonJSONBody() {
        let e = APIError.from(status: 502, body: Data("<html>Bad gateway</html>".utf8))
        #expect(e.userMessage == "The server had a problem. Please try again shortly.")
        #expect(e.body == nil)
    }
}
