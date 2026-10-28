import Testing
@testable import VEXONKit

@Suite("Mandatory notification gate")
struct NotificationGateTests {
    @Test("Only full authorization opens the app")
    func allowed() {
        #expect(NotificationGate.state(for: .authorized) == .allowed)
        #expect(NotificationGate.state(for: .ephemeral) == .allowed)
    }

    @Test("Never asked and provisional both show the prompt, not the app")
    func canRequest() {
        #expect(NotificationGate.state(for: .notDetermined) == .canRequest)
        #expect(NotificationGate.state(for: .provisional) == .canRequest)
    }

    @Test("Denied (or an unknown future status) can only be fixed in Settings")
    func settingsOnly() {
        #expect(NotificationGate.state(for: .denied) == .settingsOnly)
        #expect(NotificationGate.state(for: .unknown) == .settingsOnly)
    }

    @Test("Nothing is decided before the first read")
    func checking() {
        #expect(NotificationGate.state(for: nil) == .checking)
    }
}
