import SwiftUI
import VEXONKit

/// Conversations the user belongs to (the server applies the chat scope).
/// Creating chats and groups stays on web / Android in this phase.
struct ConversationsView: View {
    @Environment(AppModel.self) private var app
    @State private var state: LoadState<[Conversation]> = .idle
    @State private var search = ""

    var body: some View {
        LoadStateView(
            state: state,
            isEmpty: { $0.isEmpty },
            emptyTitle: search.isEmpty ? "No conversations" : "No matches",
            emptySystemImage: "bubble.left.and.bubble.right",
            emptyMessage: search.isEmpty ? "Your class groups and chats will appear here." : nil,
            retry: load
        ) { conversations in
            List(conversations) { conversation in
                NavigationLink(value: conversation.id) {
                    ConversationRow(conversation: conversation, myId: app.user?.id)
                }
            }
            .listStyle(.plain)
        }
        .navigationTitle("Chat")
        .navigationDestination(for: String.self) { id in
            if let conversation = state.value?.first(where: { $0.id == id }) {
                ChatThreadView(conversation: conversation)
            }
        }
        .searchable(text: $search, prompt: "Search chats")
        .task(id: search) {
            // Debounce typing; a newer search cancels this task.
            if !search.isEmpty { try? await Task.sleep(nanoseconds: 300_000_000) }
            guard !Task.isCancelled else { return }
            await load()
        }
        .refreshable { await load() }
        .task {
            for await event in app.realtime.events() where ["chat:message", "chat:conversation", "chat:read", "chat:messageDeleted", "connect"].contains(event.name) {
                await load()
            }
        }
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do { state = .loaded(try await app.client.send(API.conversations(search: search))) } catch {
            let e = APIError.wrap(error)
            if e != .cancelled, state.value == nil { state = .failed(e) }
        }
    }
}

private struct ConversationRow: View {
    let conversation: Conversation
    let myId: String?

    private var other: PersonRef? { conversation.participants.first { $0.id != myId } }

    var body: some View {
        HStack(spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                Circle()
                    .fill(Theme.primary.opacity(0.15))
                    .frame(width: 44, height: 44)
                    .overlay(
                        Image(systemName: conversation.type == "private" ? "person.fill" : "person.3.fill")
                            .foregroundStyle(Theme.primary)
                    )
                if conversation.type == "private", other?.online == true {
                    Circle().fill(Theme.success).frame(width: 12, height: 12)
                        .overlay(Circle().stroke(.background, lineWidth: 2))
                        .accessibilityLabel("Online")
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(conversation.title(myId: myId)).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Spacer()
                    if let at = conversation.lastMessage?.sentAt {
                        Text(at.formatted(.relative(presentation: .named))).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                HStack {
                    Text(conversation.lastMessage?.body ?? "No messages yet")
                        .font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                    if let unread = conversation.unreadCount, unread > 0 {
                        Text("\(unread)")
                            .font(.caption2.bold()).foregroundStyle(.white)
                            .padding(.horizontal, 7).padding(.vertical, 2)
                            .background(Theme.primary, in: Capsule())
                            .accessibilityLabel("\(unread) unread")
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}
