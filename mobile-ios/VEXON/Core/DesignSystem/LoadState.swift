import SwiftUI
import VEXONKit

/// The state of one remote resource on screen.
enum LoadState<Value> {
    case idle
    case loading
    case loaded(Value)
    case failed(APIError)

    var value: Value? {
        if case .loaded(let v) = self { return v }
        return nil
    }

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }
}

extension APIError {
    /// Wrap any thrown error for display. Cancellation is reported as `.cancelled`
    /// and callers ignore it (the view went away or a newer request replaced it).
    static func wrap(_ error: Error) -> APIError {
        if let api = error as? APIError { return api }
        if error is CancellationError { return .cancelled }
        return .network
    }
}

/// Renders loading / error / empty / content for a `LoadState`, with retry.
struct LoadStateView<Value, Content: View>: View {
    let state: LoadState<Value>
    var isEmpty: (Value) -> Bool = { _ in false }
    var emptyTitle = "Nothing here yet"
    var emptySystemImage = "tray"
    var emptyMessage: String?
    let retry: () async -> Void
    @ViewBuilder let content: (Value) -> Content

    var body: some View {
        switch state {
        case .idle, .loading:
            ProgressView("Loading…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("loading")
        case .failed(let error):
            ErrorStateView(error: error, retry: retry)
        case .loaded(let value):
            if isEmpty(value) {
                ContentUnavailableView {
                    Label(emptyTitle, systemImage: emptySystemImage)
                } description: {
                    if let emptyMessage { Text(emptyMessage) }
                }
            } else {
                content(value)
            }
        }
    }
}

struct ErrorStateView: View {
    let error: APIError
    let retry: () async -> Void
    @State private var retrying = false

    private var icon: String {
        switch error {
        case .network, .timeout: return "wifi.exclamationmark"
        case .forbidden: return "lock"
        case .notConfigured: return "server.rack"
        default: return "exclamationmark.triangle"
        }
    }

    private var title: String {
        switch error {
        case .network, .timeout: return "You’re offline"
        case .forbidden: return "Not available for your account"
        case .notFound: return "Not found"
        default: return "Something went wrong"
        }
    }

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: icon)
        } description: {
            Text(error.userMessage)
        } actions: {
            if case .forbidden = error {
                EmptyView()
            } else {
                Button {
                    retrying = true
                    Task {
                        await retry()
                        retrying = false
                    }
                } label: {
                    if retrying { ProgressView() } else { Text("Try again") }
                }
                .buttonStyle(.borderedProminent)
                .disabled(retrying)
                .accessibilityIdentifier("retry")
            }
        }
    }
}
