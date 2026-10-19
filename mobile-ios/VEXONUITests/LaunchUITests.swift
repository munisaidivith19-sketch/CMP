import XCTest

/// UI smoke tests. They launch with `-ui-testing` (in-memory secrets, so no
/// saved session) and never contact a real server or use real accounts.
final class LaunchUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testLaunchShowsSignIn() {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing"]
        app.launch()
        XCTAssertTrue(app.textFields["login.email"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["login.submit"].exists)
    }

    @MainActor
    func testEmptySubmitShowsValidationWithoutNetwork() {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing"]
        app.launch()
        let submit = app.buttons["login.submit"]
        XCTAssertTrue(submit.waitForExistence(timeout: 10))
        submit.tap()
        XCTAssertTrue(app.staticTexts["Email is required"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Password is required"].exists)
    }

    @MainActor
    func testServerSheetRejectsInvalidAddress() {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing"]
        app.launch()
        let server = app.buttons["login.server"]
        XCTAssertTrue(server.waitForExistence(timeout: 10))
        server.tap()
        let field = app.textFields["server.address"]
        XCTAssertTrue(field.waitForExistence(timeout: 3))
        field.tap()
        field.typeText("not a url")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Enter a full address starting with https://"].waitForExistence(timeout: 3))
    }
}
