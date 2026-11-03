import Foundation
import Testing
@testable import VEXONKit

@Suite("Password rule")
struct PasswordRuleTests {
    @Test("A strong password passes")
    func strong() {
        #expect(PasswordRule.problem("Campus@123") == nil)
        #expect(PasswordRule.problem("aB3$efgh") == nil)
    }

    @Test("Every missing part is refused", arguments: [
        "Ab1$", "campus@123", "CAMPUS@123", "Campus@abc", "Campus1234", "Campus 123", String(repeating: "A", count: 70) + "a1$",
    ])
    func weak(_ password: String) {
        #expect(PasswordRule.problem(password) != nil)
    }

    @Test("The forced change flag is read from the account")
    func flag() throws {
        let json = #"{"_id":"1","name":"A","role":"student","mustChangePassword":true}"#
        let user = try JSONDecoder().decode(User.self, from: Data(json.utf8))
        #expect(user.mustChangePassword == true)
    }
}
