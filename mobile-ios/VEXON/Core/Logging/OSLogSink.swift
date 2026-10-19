import OSLog
import VEXONKit

/// Routes VEXONKit diagnostics to the unified log. Messages arrive already
/// redacted (no tokens, emails or phone numbers) and are additionally marked
/// private so they are not readable from a device log without a debugger.
struct OSLogSink: LogSink {
    private let logger = Logger(subsystem: "com.vexon.campus", category: "network")

    func log(_ level: LogLevel, _ message: String) {
        switch level {
        case .debug:
            #if DEBUG
            logger.debug("\(message, privacy: .private)")
            #endif
        case .info: logger.info("\(message, privacy: .private)")
        case .warning: logger.warning("\(message, privacy: .private)")
        case .error: logger.error("\(message, privacy: .private)")
        }
    }
}

enum AppLog {
    static let app = Logger(subsystem: "com.vexon.campus", category: "app")
    static let realtime = Logger(subsystem: "com.vexon.campus", category: "realtime")
    static let location = Logger(subsystem: "com.vexon.campus", category: "location")
}
