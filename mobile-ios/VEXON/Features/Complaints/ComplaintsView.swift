import SwiftUI
import VEXONKit

/// A student's grievances: list (paged), file a new one, cancel an open one.
/// Escalation, authority review and attachments remain on web / Android for now.
struct ComplaintsView: View {
    @Environment(AppModel.self) private var app
    @State private var items: [Complaint] = []
    @State private var page: Pagination?
    @State private var state: LoadState<Void> = .idle
    @State private var showNew = false
    @State private var cancelling: String?
    @State private var actionError: String?

    var body: some View {
        LoadStateView(
            state: state,
            isEmpty: { _ in items.isEmpty },
            emptyTitle: "No grievances",
            emptySystemImage: "exclamationmark.bubble",
            emptyMessage: "Grievances you file will appear here with their status.",
            retry: { await load(reset: true) }
        ) { _ in
            List {
                ForEach(items) { complaint in
                    ComplaintRow(complaint: complaint)
                        .swipeActions {
                            if complaint.isCancellable {
                                Button("Cancel", role: .destructive) { Task { await cancel(complaint) } }
                                    .disabled(cancelling != nil)
                            }
                        }
                        .onAppear {
                            if complaint.id == items.last?.id { Task { await load(reset: false) } }
                        }
                }
            }
        }
        .navigationTitle("Grievances")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showNew = true } label: { Label("New grievance", systemImage: "square.and.pencil") }
                    .accessibilityIdentifier("complaints.new")
            }
        }
        .sheet(isPresented: $showNew) {
            NewComplaintView { await load(reset: true) }
        }
        .alert("Could not cancel", isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
        .refreshable { await load(reset: true) }
        .task { await load(reset: true) }
        .task {
            for await event in app.realtime.events() where event.name == "complaint:updated" { await load(reset: true) }
        }
    }

    private func load(reset: Bool) async {
        if !reset, let page, !page.hasMore { return }
        if reset && items.isEmpty { state = .loading }
        let next = reset ? 1 : (page?.page ?? 0) + 1
        do {
            let result = try await app.client.send(API.complaints(page: next))
            items = reset ? result.complaints : items + result.complaints.filter { c in !items.contains { $0.id == c.id } }
            page = result.pagination
            state = .loaded(())
        } catch {
            let e = APIError.wrap(error)
            if e != .cancelled && items.isEmpty { state = .failed(e) }
        }
    }

    private func cancel(_ complaint: Complaint) async {
        guard cancelling == nil else { return }
        cancelling = complaint.id
        defer { cancelling = nil }
        do {
            _ = try await app.client.send(API.cancelComplaint(id: complaint.id))
            await load(reset: true)
        } catch {
            let e = APIError.wrap(error)
            if e != .cancelled { actionError = e.userMessage }
        }
    }
}

private struct ComplaintRow: View {
    let complaint: Complaint

    private var color: Color {
        switch complaint.status {
        case "RESOLVED", "CLOSED": return Theme.success
        case "CANCELLED": return .secondary
        case "ESCALATED", "NOT_RESOLVED": return Theme.danger
        default: return Theme.info
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(ComplaintCatalog.label(complaint.category)).font(.subheadline.weight(.semibold))
                if let sub = complaint.subCategory { Text("· \(ComplaintCatalog.label(sub))").font(.subheadline).foregroundStyle(.secondary) }
                Spacer()
                StatusPill(text: complaint.statusLabel, color: color)
            }
            if let text = complaint.description {
                Text(text).font(.footnote).lineLimit(3)
            }
            HStack {
                if let code = complaint.complaintCode { Text(code).font(.caption.monospaced()) }
                if let created = complaint.createdAt { Text(created.formatted(date: .abbreviated, time: .shortened)).font(.caption) }
                if complaint.anonymous == true { Label("Anonymous", systemImage: "eye.slash").font(.caption) }
            }
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

struct NewComplaintView: View {
    let onCreated: () async -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var draft = NewComplaint(category: "academics", subCategory: nil, escalateTo: "faculty", description: "", anonymous: false)
    @State private var submitting = false
    @State private var error: String?

    private var subcategories: [String] { ComplaintCatalog.subcategories[draft.category] ?? [] }
    private var authorities: [String] { ComplaintCatalog.escalateTo[draft.category] ?? [] }

    var body: some View {
        NavigationStack {
            Form {
                Section("Category") {
                    Picker("Category", selection: $draft.category) {
                        ForEach(ComplaintCatalog.categories, id: \.self) { Text(ComplaintCatalog.label($0)).tag($0) }
                    }
                    if !subcategories.isEmpty {
                        Picker("Subcategory", selection: Binding(get: { draft.subCategory ?? "" }, set: { draft.subCategory = $0.isEmpty ? nil : $0 })) {
                            Text("Choose…").tag("")
                            ForEach(subcategories, id: \.self) { Text(ComplaintCatalog.label($0)).tag($0) }
                        }
                    }
                    Picker("Send to", selection: $draft.escalateTo) {
                        ForEach(authorities, id: \.self) { Text(ComplaintCatalog.label($0)).tag($0) }
                    }
                }
                Section {
                    TextField("Describe what happened", text: $draft.description, axis: .vertical)
                        .lineLimit(5...12)
                        .accessibilityIdentifier("complaint.description")
                } header: {
                    Text("Details")
                } footer: {
                    Text("\(draft.description.count)/2000 · at least 10 characters")
                }
                Section {
                    Toggle("Submit anonymously", isOn: $draft.anonymous)
                } footer: {
                    Text("Your identity is hidden from the authority handling it. Senior administrators may still see it where college policy requires.")
                }
                if let error {
                    Text(error).foregroundStyle(Theme.danger)
                }
            }
            .navigationTitle("New grievance")
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: draft.category) { _, category in
                draft.subCategory = nil
                draft.escalateTo = ComplaintCatalog.escalateTo[category]?.first ?? ""
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(submitting) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") { Task { await submit() } }
                        .disabled(submitting)
                        .accessibilityIdentifier("complaint.submit")
                }
            }
            .interactiveDismissDisabled(submitting)
        }
    }

    /// One request at a time — the button is disabled while sending, so a slow
    /// network cannot create duplicate grievances. Writes are never auto-retried.
    private func submit() async {
        guard !submitting else { return }
        if let problem = draft.validationError() {
            error = problem
            return
        }
        submitting = true
        defer { submitting = false }
        do {
            _ = try await app.client.send(API.createComplaint(draft))
            await onCreated()
            dismiss()
        } catch {
            let e = APIError.wrap(error)
            if e != .cancelled { self.error = e.userMessage }
        }
    }
}
