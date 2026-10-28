import Foundation
import Testing
@testable import VEXONKit

// SYNTHETIC test data only.

@Suite("Terms and Conditions / Privacy Policy")
struct LegalTests {
    @Test("The profile's About the App section has exactly the three entries")
    func aboutEntries() {
        #expect(Legal.aboutEntries.map(\.label) == ["About the App", "Terms and Conditions", "Privacy Policy"])
        #expect(!Legal.aboutEntries.contains { $0.label.localizedCaseInsensitiveContains("history") })
    }

    @Test("user.legal decodes from sign-in; a payload without it decodes as unknown")
    func decodesLegal() throws {
        let withLegal = Fixtures.json("""
        {"_id":"65f000000000000000000001","name":"Test Student","role":"student",
         "legal":{"termsRequired":true,"termsVersion":2,"termsAcceptedVersion":1,"privacyVersion":1}}
        """)
        let user = try VEXONJSON.decoder().decode(User.self, from: withLegal)
        #expect(user.termsAcceptanceRequired)
        #expect(user.legal == LegalStatus(termsRequired: true, termsVersion: 2, termsAcceptedVersion: 1, privacyVersion: 1))

        let plain = try VEXONJSON.decoder().decode(SessionPayload.self, from: Fixtures.session())
        #expect(plain.user.legal == nil)
        #expect(!plain.user.termsAcceptanceRequired, "unknown → the server's 403 decides")
    }

    @Test("Replacing the legal status keeps the rest of the account")
    func replacingLegal() {
        let user = User(id: "u1", name: "Asha", role: .student, rollNo: "21CS001", legal: LegalStatus(termsRequired: true, termsVersion: 1))
        let accepted = user.replacingLegal(LegalStatus(termsRequired: false, termsVersion: 1, termsAcceptedVersion: 1))
        #expect(!accepted.termsAcceptanceRequired)
        #expect(accepted.id == "u1" && accepted.name == "Asha" && accepted.rollNo == "21CS001")
        #expect(LegalStatus(termsRequired: false, termsVersion: 3).markedRequired.termsRequired)
        #expect(LegalStatus(termsRequired: false, termsVersion: 3).markedRequired.termsVersion == 3)
    }

    @Test("The Terms gate and a stale version are recognised; other errors are not")
    func errorCodes() {
        #expect(Legal.isTermsRequired(.forbidden(ServerErrorBody(message: "x", code: "TERMS_ACCEPTANCE_REQUIRED"))))
        #expect(!Legal.isTermsRequired(.forbidden(ServerErrorBody(code: "POLICY_DENIED"))))
        #expect(!Legal.isTermsRequired(.unauthorized(ServerErrorBody(code: "TERMS_ACCEPTANCE_REQUIRED"))))
        #expect(Legal.isVersionChanged(.conflict(ServerErrorBody(code: "POLICY_VERSION_CHANGED"))))
        #expect(!Legal.isVersionChanged(.conflict(nil)))
    }

    @Test("A 403 TERMS_ACCEPTANCE_REQUIRED emits .termsRequired and does not sign out")
    func gateEmitsEvent() async throws {
        let store = MemorySecureStore([SecureStoreKey.refreshToken: "kept"])
        let transport = MockTransport { _ in (Fixtures.json(#"{"message":"Please accept","code":"TERMS_ACCEPTANCE_REQUIRED"}"#), 403) }
        let client = Fixtures.client(store: store, transport: transport)
        let events = client.events

        await #expect(throws: APIError.self) { try await client.send(API.buses()) }
        var saw = false
        for await event in events {
            if event == .termsRequired { saw = true; break }
            if event == .expired { break }
        }
        #expect(saw)
        #expect(store.string(for: SecureStoreKey.refreshToken) == "kept")
        #expect(transport.count(path: "/api/auth/refresh") == 0, "a 403 never triggers the refresh dance")
    }

    @Test("Policies are fetched without a token; acceptance posts only policy, version and agreement")
    func endpoints() async throws {
        let doc = API.legalPolicy(.privacy)
        #expect(doc.path == "/legal/policies/privacy")
        #expect(doc.method == .get)
        #expect(!doc.authenticated)

        let accept = API.acceptTerms(version: 3)
        #expect(accept.path == "/legal/accept")
        #expect(accept.method == .post)
        #expect(accept.authenticated)
        let body = try #require(accept.body)
        let json = try #require(try JSONSerialization.jsonObject(with: VEXONJSON.encoder().encode(body)) as? [String: Any])
        #expect(Set(json.keys) == ["policyId", "version", "agreed"])
        #expect(json["policyId"] as? String == "terms")
        #expect(json["version"] as? Int == 3)
        #expect(json["agreed"] as? Bool == true)
    }

    @Test("A policy document decodes with its effective date")
    func decodesDocument() throws {
        let data = Fixtures.json(##"{"policyId":"terms","title":"Terms and Conditions","version":2,"effectiveAt":"2026-10-22T00:00:00.000Z","requiresAcceptance":true,"content":"# A\n\nText","contentHash":"ab"}"##)
        let doc = try VEXONJSON.decoder().decode(PolicyDocument.self, from: data)
        #expect(doc.version == 2)
        #expect(Legal.formatEffective(doc.effectiveAt) == "22 October 2026")
        #expect(Legal.formatEffective(nil) == "")
    }

    @Test("Policy Markdown splits into headings, bullets and paragraphs (plain text only)")
    func blocks() {
        let text = """
        Intro line one
        continues here.

        > Note for the owner.

        ## 1. Heading
        - first
        * second

        <script>alert(1)</script>
        """
        #expect(Legal.blocks(text) == [
            .paragraph("Intro line one continues here."),
            .paragraph("Note for the owner."),
            .heading("1. Heading"),
            .bullet("first"),
            .bullet("second"),
            .paragraph("<script>alert(1)</script>"),
        ])
        #expect(Legal.blocks("#hashtag not heading") == [.paragraph("#hashtag not heading")])
    }
}
