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
        // Ties (same timestamp) are broken by id, so the order never flips between merges.
        messages = byId.values.sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model: ChatThreadModel

    init(conversation: Conversation) {
        self.conversation = conversation
        _model = State(initialValue: ChatThreadModel(conversationId: conversation.id))
    }

    var body: some View {
        LoadStateView(state: model.state, retry: { await model.loadLatest(client: app.client) }) { _ in
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 10) {
                        if model.hasOlder {
                            Button {
                                Task { await model.loadOlder(client: app.client) }
                            } label: {
                                Text(model.loadingOlder ? "Loading…" : "Load earlier messages")
                                    .font(.footnote.weight(.semibold))
                                    .padding(.horizontal, 14)
                                    .frame(minHeight: 44)
                                    .frosted(in: Capsule())
                            }
                            .buttonStyle(.pressable)
                            .disabled(model.loadingOlder)
                        }
                        ForEach(model.messages) { message in
                            MessageBubble(message: message, mine: message.sender.id == app.user?.id, showSender: conversation.type != "private")
                                .id(message.id)
                                .transition(.opacity.combined(with: .scale(scale: 0.92, anchor: message.sender.id == app.user?.id ? .bottomTrailing : .bottomLeading)))
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .animation(reduceMotion ? Motion.reduced : Motion.smooth, value: model.messages.last?.id)
                }
                // Open on the newest message and stay there as the keyboard and new messages arrive.
                .defaultScrollAnchor(.bottom)
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: model.messages.last?.id) { _, last in
                    if let last { withAnimation(reduceMotion ? Motion.reduced : Motion.smooth) { proxy.scrollTo(last, anchor: .bottom) } }
                }
            }
        }
        // The composer is an inset, not an overlay: the last message always rests above it.
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        .screenBackground()
        .navigationTitle(conversation.title(myId: app.user?.id))
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.loadLatest(client: app.client) }
        .onAppear { app.openConversationId = conversation.id }
        .onDisappear { if app.openConversationId == conversation.id { app.openConversationId = nil } }
        .task { await live() }
    }

    private var canSend: Bool { !model.sending && NewChatMessage.validated(model.draft) != nil }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let error = model.sendError {
                Text(error).font(.caption).foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 8)
            }
            HStack(alignment: .bottom, spacing: 6) {
                TextField("Message", text: $model.draft, axis: .vertical)
                    .lineLimit(1...5)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 11)
                    .accessibilityIdentifier("chat.input")
                Button {
                    Task { await model.send(client: app.client) }
                } label: {
                    Group {
                        if model.sending {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: "arrow.up").font(.body.weight(.bold)).foregroundStyle(.white)
                        }
                    }
                    .frame(width: 36, height: 36)
                    .background(Theme.heroGradient, in: Circle())
                    .opacity(canSend || model.sending ? 1 : 0.4)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.pressable)
                .disabled(!canSend)
                .animation(Motion.snappy, value: canSend)
                .accessibilityLabel("Send")
            }
        }
        .padding(.leading, 4)
        .glass(cornerRadius: 24)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
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

    /// Rounded, with a tighter corner on the sender's side.
    private var shape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: 18,
            bottomLeadingRadius: mine ? 18 : 6,
            bottomTrailingRadius: mine ? 6 : 18,
            topTrailingRadius: 18,
            style: .continuous
        )
    }

    var body: some View {
        HStack {
            if mine { Spacer(minLength: 40) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
                if showSender, !mine, let name = message.sender.value?.name {
                    Text(name).font(.caption2.weight(.semibold)).foregroundStyle(Theme.primary)
                }
                text
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

    @ViewBuilder private var text: some View {
        let label = Text(message.deletedAt != nil ? "This message was deleted" : (message.body ?? ""))
            .italic(message.deletedAt != nil)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        if mine {
            label
                .foregroundStyle(.white)
                .background(Theme.heroGradient, in: shape)
        } else {
            label
                .foregroundStyle(Color.primary)
                .frosted(in: shape)
        }
    }
}
