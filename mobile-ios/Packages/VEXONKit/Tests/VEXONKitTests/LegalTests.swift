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

    @Test("Policies are fetched without a token")
    func endpoints() {
        let doc = API.legalPolicy(.privacy)
        #expect(doc.path == "/legal/policies/privacy")
        #expect(doc.method == .get)
        #expect(!doc.authenticated)
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
