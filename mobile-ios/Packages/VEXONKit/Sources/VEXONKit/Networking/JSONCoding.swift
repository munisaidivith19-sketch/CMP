import Foundation

/// JSON coding matched to the Express/Mongoose backend: ISO-8601 dates with or
/// without fractional seconds (`2026-10-16T08:30:00.000Z`), and plain
/// `YYYY-MM-DD` day keys where the API returns calendar days.
public enum VEXONJSON {
    public static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            if let ms = try? container.decode(Double.self) {
                return Date(timeIntervalSince1970: ms / 1000)
            }
            let text = try container.decode(String.self)
            if let date = parseDate(text) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unrecognised date: \(text)")
        }
        return d
    }

    public static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(formatISO(date))
        }
        return e
    }

    /// Parses `2026-10-16T08:30:00.000Z`, `2026-10-16T08:30:00Z` and `2026-10-16`.
    public static func parseDate(_ text: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = fractional.date(from: text) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let d = plain.date(from: text) { return d }
        if text.count == 10 {
            let day = ISO8601DateFormatter()
            day.formatOptions = [.withFullDate]
            return day.date(from: text)
        }
        return nil
    }

    public static func formatISO(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: date)
    }
}

/// A Mongo reference that the API sometimes returns as a bare id string and
/// sometimes populated as an object (e.g. `trip.bus`, `bus.route`).
public enum Ref<Value: Decodable & Sendable & Identifiable>: Decodable, Sendable where Value.ID == String {
    case id(String)
    case object(Value)

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let id = try? container.decode(String.self) {
            self = .id(id)
        } else {
            self = .object(try container.decode(Value.self))
        }
    }

    public var id: String {
        switch self {
        case .id(let id): return id
        case .object(let value): return value.id
        }
    }

    public var value: Value? {
        if case .object(let v) = self { return v }
        return nil
    }
}

extension Ref: Equatable where Value: Equatable {}

/// A response body the caller does not need (`{ ok: true }`, `{ message }`, …).
public struct EmptyResponse: Decodable, Sendable, Equatable {
    public init() {}
    public init(from decoder: Decoder) throws {}
}

/// `{ total, page, limit, pages }` (server/src/utils/http.js `pageMeta`).
public struct Pagination: Decodable, Sendable, Equatable {
    public let total: Int
    public let page: Int
    public let limit: Int
    public let pages: Int

    public init(total: Int, page: Int, limit: Int, pages: Int) {
        self.total = total
        self.page = page
        self.limit = limit
        self.pages = pages
    }

    public var hasMore: Bool { page < pages }
}
