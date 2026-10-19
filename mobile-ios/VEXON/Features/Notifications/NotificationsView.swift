import SwiftUI
import VEXONKit

/// In-app notifications (GET /notifications), updated live by the socket's
/// `notification` event. Works whether or not push notifications are available.
struct NotificationsView: View {
    @Environment(AppModel.self) private var app
    @State private var items: [AppNotification] = []
    @State private var unread = 0
    @State private var page = 0
    @State private var hasMore = false
    @State private var state: LoadState<Void> = .idle

    var body: some View {
        LoadStateView(
            state: state,
            isEmpty: { _ in items.isEmpty },
            emptyTitle: "You’re all caught up",
            emptySystemImage: "bell",
            emptyMessage: "Notifications about classes, buses, chats and approvals appear here.",
            retry: { await load(reset: true) }
        ) { _ in
            List {
                ForEach(items) { item in
                    Button {
                        Task { await markRead(item) }
                    } label: {
                        NotificationRow(item: item)
                    }
                    .buttonStyle(.plain)
                    .onAppear {
                        if item.id == items.last?.id, hasMore { Task { await load(reset: false) } }
                    }
                }
            }
            .listStyle(.plain)
        }
        .navigationTitle("Notifications")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Mark all as read") { Task { await markAllRead() } }
                        .disabled(unread == 0)
                    NavigationLink("Notification settings") { NotificationSettingsView() }
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
            }
        }
        .refreshable { await load(reset: true) }
        .task { await load(reset: true) }
        .task {
            for await event in app.realtime.events() where event.name == "notification" || event.name == "connect" {
                await load(reset: true)
            }
        }
    }

    private func load(reset: Bool) async {
        if reset && items.isEmpty { state = .loading }
        do {
            let result = try await app.client.send(API.notifications(page: reset ? 1 : page + 1))
            items = reset ? result.items : items + result.items.filter { n in !items.contains { $0.id == n.id } }
            page = result.page
            hasMore = result.hasMore
            unread = result.unread
            state = .loaded(())
        } catch {
            let e = APIError.wrap(error)
            if e != .cancelled, items.isEmpty { state = .failed(e) }
        }
    }

    private func markRead(_ item: AppNotification) async {
        guard !item.read else { return }
        if (try? await app.client.send(API.markNotificationRead(id: item.id))) != nil { await load(reset: true) }
    }

    private func markAllRead() async {
        if (try? await app.client.send(API.markAllNotificationsRead())) != nil { await load(reset: true) }
    }
}

private struct NotificationRow: View {
    let item: AppNotification

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(item.read ? Color.clear : Theme.primary)
                .frame(width: 8, height: 8)
                .padding(.top, 6)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title).font(.subheadline.weight(item.read ? .regular : .semibold))
                if let message = item.message, !message.isEmpty {
                    Text(message).font(.footnote).foregroundStyle(.secondary)
                }
                if let created = item.createdAt {
                    Text(created.formatted(.relative(presentation: .named))).font(.caption2).foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint(item.read ? "" : "Unread. Double-tap to mark as read.")
    }
}

/// Optional categories and reminder lead time (server-side preferences), plus
/// the device's push permission.
struct NotificationSettingsView: View {
    @Environment(AppModel.self) private var app
    @State private var prefs: LoadState<NotificationPreferences> = .idle
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                switch app.push.status {
                case .authorized:
                    Label("Allowed on this iPhone", systemImage: "checkmark.circle")
                case .denied:
                    Label("Turned off in iOS Settings", systemImage: "bell.slash")
                default:
                    Button("Allow notifications") { Task { await app.push.requestPermission() } }
                }
                if !PushManager.backendSupportsAPNs {
                    Text("Push delivery to iPhone is not enabled on the college server yet. You’ll still see every notification here and live while the app is open.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            } header: {
                Text("Push notifications")
            }

            switch prefs {
            case .idle, .loading:
                ProgressView()
            case .failed(let e):
                Text(e.userMessage).foregroundStyle(.secondary)
            case .loaded(let p):
                Section("Optional alerts") {
                    ForEach(p.optional, id: \.self) { category in
                        Toggle(ComplaintCatalog.label(category), isOn: Binding(
                            get: { !p.disabled.contains(category) },
                            set: { on in Task { await update(p, category: category, enabled: on) } }
                        ))
                        .disabled(saving)
                    }
                }
                Section("Class reminders") {
                    Picker("Remind me before class", selection: Binding(
                        get: { p.reminderMinutes },
                        set: { minutes in Task { await save(disabled: p.disabled, minutes: minutes) } }
                    )) {
                        ForEach(p.reminderChoices, id: \.self) { Text("\($0) minutes").tag($0) }
                    }
                    .disabled(saving)
                }
            }
            if let error { Text(error).foregroundStyle(Theme.danger) }
        }
        .navigationTitle("Notification settings")
        .task {
            await app.push.refreshStatus()
            await load()
        }
    }

    private func load() async {
        do { prefs = .loaded(try await app.client.send(API.notificationPreferences())) } catch {
            let e = APIError.wrap(error)
            if e != .cancelled { prefs = .failed(e) }
        }
    }

    private func update(_ p: NotificationPreferences, category: String, enabled: Bool) async {
        var disabled = p.disabled.filter { $0 != category }
        if !enabled { disabled.append(category) }
        await save(disabled: disabled, minutes: p.reminderMinutes)
    }

    private func save(disabled: [String], minutes: Int) async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        do {
            prefs = .loaded(try await app.client.send(API.updateNotificationPreferences(disabled: disabled, reminderMinutes: minutes)))
            error = nil
        } catch {
            let e = APIError.wrap(error)
            if e != .cancelled { self.error = e.userMessage }
        }
    }
}
