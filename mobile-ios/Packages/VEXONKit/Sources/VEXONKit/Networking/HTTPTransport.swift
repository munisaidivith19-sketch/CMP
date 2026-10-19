import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The raw HTTP layer, behind a protocol so the API client can be tested with a
/// scripted transport and no network.
public protocol HTTPTransport: Sendable {
    /// Perform the request. Must throw `APIError.network`, `.timeout` or
    /// `.cancelled` for transport failures; any HTTP status is a normal return.
    func send(_ request: URLRequest) async throws -> (Data, Int)
}

/// URLSession-backed transport. Cancelling the calling task cancels the request.
public final class URLSessionTransport: HTTPTransport, @unchecked Sendable {
    private let session: URLSession

    public init(session: URLSession? = nil) {
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.ephemeral // no on-disk cache of personal data
            config.timeoutIntervalForRequest = 20
            config.timeoutIntervalForResource = 60
            #if canImport(Darwin)
            config.waitsForConnectivity = false // read-only in swift-corelibs-foundation
            #endif
            config.requestCachePolicy = .reloadIgnoringLocalCacheData
            config.httpCookieStorage = nil // mobile sessions use Bearer + body refresh token, never cookies
            config.httpShouldSetCookies = false
            self.session = URLSession(configuration: config)
        }
    }

    public func send(_ request: URLRequest) async throws -> (Data, Int) {
        final class TaskBox: @unchecked Sendable {
            var task: URLSessionDataTask?
            let lock = NSLock()
            func set(_ t: URLSessionDataTask) { lock.lock(); task = t; lock.unlock() }
            func cancel() { lock.lock(); task?.cancel(); lock.unlock() }
        }
        let box = TaskBox()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<(Data, Int), Error>) in
                let task = session.dataTask(with: request) { data, response, error in
                    if let error {
                        continuation.resume(throwing: Self.map(error))
                        return
                    }
                    guard let http = response as? HTTPURLResponse else {
                        continuation.resume(throwing: APIError.network)
                        return
                    }
                    continuation.resume(returning: (data ?? Data(), http.statusCode))
                }
                box.set(task)
                if Task.isCancelled { task.cancel() }
                task.resume()
            }
        } onCancel: {
            box.cancel()
        }
    }

    static func map(_ error: Error) -> APIError {
        guard let urlError = error as? URLError else { return .network }
        switch urlError.code {
        case .cancelled: return .cancelled
        case .timedOut: return .timeout
        default: return .network
        }
    }
}
