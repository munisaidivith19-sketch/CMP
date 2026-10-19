import SwiftUI
import VEXONKit

/// Message history for one conversation, with live updates.
///
/// Joins the `chat:<id>` socket room only after the server checks membership
/// (`chat:join` ack); the room is re-joined after every reconnect and left
/// when the screen closes.
@MainActor
@Observable
final class ChatThreadModel {
    let conversationId: String
    private(set) var messages: [ChatMessage] = []
    private(set) var state: LoadState<Void> = .idle
    private(set) var hasOlder = false
    private(set) var loadingOlder = false
    private(set) var sending = false
    var draft = ""
    var sendError: String?

    init(conversationId: String) { self.conversationId = conversationId }

    func loadLatest(client: APIClient) async {
        if messages.isEmpty { state = .loading }
        do {
            let page = try await client.send(API.messages(conversationId: conversationId))
            merge(page.messages)
            hasOlder = page.pagination.hasMore
            state = .loaded(())
            _ = try? await client.send(API.markConversationRead(id: conversationId))
        } catch {
            let e = APIError.wrap(error)
            if e != .cancelled, messages.isEmpty { state = .failed(e) }
        }
    }

    func loadOlder(client: APIClient) async {
        guard hasOlder, !loadingOlder, let oldest = messages.first?.createdAt else { return }
        loadingOlder = true
        defer { loadingOlder = false }
        if let page = try? await client.send(API.messages(conversationId: conversationId, before: oldest)) {
            merge(page.messages)
            hasOlder = page.pagination.hasMore
        }
    }

    /// Insert or replace by id, keep chronological order — safe against the same
    /// message arriving via both the socket and a refetch.
    func merge(_ incoming: [ChatMessage]) {
        var byId = Dictionary(messages.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
        for m in incoming { byId[m.id] = m }
        messages = byId.values.sorted { $0.createdAt < $1.createdAt }
    }

    func handle(_ event: RealtimeEvent) {
        guard event.name == "chat:message", let e = event.decode(ChatMessageEvent.self), e.conversationId == conversationId else { return }
        merge([e.message])
    }

    func send(client: APIClient) async {
        guard !sending, let message = NewChatMessage.validated(draft) else { return }
        sending = true
        sendError = nil
        defer { sending = false }
        do {
            _ = try await client.send(API.sendMessage(conversationId: conversationId, message))
            draft = ""
            await loadLatest(client: client)
        } catch {
            let e = APIError.wrap(error)
            if e != .cancelled { sendError = e.userMessage } // draft kept so nothing is lost
        }
    }
}

struct ChatThreadView: View {
    let conversation: Conversation
    @Environment(AppModel.self) private var app
    @State private var model: ChatThreadModel

    init(conversation: Conversation) {
        self.conversation = conversation
        _model = State(initialValue: ChatThreadModel(conversationId: conversation.id))
    }

    var body: some View {
        VStack(spacing: 0) {
            LoadStateView(state: model.state, retry: { await model.loadLatest(client: app.client) }) { _ in
                ScrollViewReader { proxy in
                    List {
                        if model.hasOlder {
                            Button(model.loadingOlder ? "Loading…" : "Load earlier messages") {
                                Task { await model.loadOlder(client: app.client) }
                            }
                            .frame(maxWidth: .infinity)
                        }
                        ForEach(model.messages) { message in
                            MessageBubble(message: message, mine: message.sender.id == app.user?.id, showSender: conversation.type != "private")
                                .listRowSeparator(.hidden)
                                .id(message.id)
                        }
                    }
                    .listStyle(.plain)
                    .onChange(of: model.messages.last?.id) { _, last in
                        if let last { withAnimation { proxy.scrollTo(last, anchor: .bottom) } }
                    }
                }
            }
            composer
        }
        .navigationTitle(conversation.title(myId: app.user?.id))
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.loadLatest(client: app.client) }
        .task { await live() }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let error = model.sendError {
                Text(error).font(.caption).foregroundStyle(Theme.danger)
            }
            HStack(alignment: .bottom) {
                TextField("Message", text: $model.draft, axis: .vertical)
                    .lineLimit(1...5)
                    .padding(10)
                    .background(.background.secondary, in: RoundedRectangle(cornerRadius: 18))
                    .accessibilityIdentifier("chat.input")
                Button {
                    Task { await model.send(client: app.client) }
                } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.title)
                }
                .frame(minWidth: 44, minHeight: 44)
                .disabled(model.sending || NewChatMessage.validated(model.draft) == nil)
                .accessibilityLabel("Send")
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.bar)
    }

    /// Room membership for this screen's lifetime; re-joined after every reconnect.
    private func live() async {
        let realtime = app.realtime
        let id = conversation.id
        if realtime.isConnected { _ = await realtime.emitWithAck("chat:join", id) }
        for await event in realtime.events() {
            if event.name == "connect" {
                _ = await realtime.emitWithAck("chat:join", id)
                await model.loadLatest(client: app.client) // catch up on anything missed while offline
            } else {
                model.handle(event)
            }
        }
        realtime.emit("chat:leave", id)
    }
}

private struct MessageBubble: View {
    let message: ChatMessage
    let mine: Bool
    let showSender: Bool

    var body: some View {
        HStack {
            if mine { Spacer(minLength: 40) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
                if showSender, !mine, let name = message.sender.value?.name {
                    Text(name).font(.caption2.weight(.semibold)).foregroundStyle(Theme.primary)
                }
                Text(message.deletedAt != nil ? "This message was deleted" : (message.body ?? ""))
                    .italic(message.deletedAt != nil)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .foregroundStyle(mine ? .white : .primary)
                    .background(mine ? Theme.primary : Color.secondary.opacity(0.15), in: RoundedRectangle(cornerRadius: 16))
                if message.attachment?.url != nil {
                    Label("Attachment — open on the web app", systemImage: "paperclip").font(.caption2).foregroundStyle(.secondary)
                }
                Text(message.createdAt.formatted(date: .omitted, time: .shortened))
                    .font(.caption2).foregroundStyle(.secondary)
            }
            if !mine { Spacer(minLength: 40) }
        }
        .accessibilityElement(children: .combine)
    }
}
