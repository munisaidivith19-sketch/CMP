import SwiftUI
import VEXONKit

/// Study materials the account may read (a student: their department, current
/// semester and every earlier one). Every material shows by default; the
/// semester, subject and category dropdowns narrow the list on the server.
/// Uploading stays on web / Android.
struct StudyMaterialsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var openURL
    @State private var semester: Int?
    @State private var subjectId: String?
    @State private var category: String?
    @State private var filters: StudyMaterialFilters?
    @State private var state: LoadState<StudyMaterialsPage> = .idle

    private var isFiltered: Bool { semester != nil || subjectId != nil || category != nil }

    private var subjects: [SubjectRef] {
        (filters?.subjects ?? []).filter { semester == nil || $0.semester == semester }
    }

    var body: some View {
        List {
            Section {
                Picker("Semester", selection: $semester) {
                    Text("All semesters").tag(Int?.none)
                    ForEach(filters?.semesterOptions ?? Array(1...8), id: \.self) { Text("Semester \($0)").tag(Int?.some($0)) }
                }
                Picker("Subject", selection: $subjectId) {
                    Text("All subjects").tag(String?.none)
                    ForEach(subjects) { Text($0.display).tag(String?.some($0.id)) }
                }
                Picker("Category", selection: $category) {
                    Text("All categories").tag(String?.none)
                    ForEach(StudyMaterialCategory.allCases) { Text($0.label).tag(String?.some($0.rawValue)) }
                }
                if isFiltered {
                    Button("Show all materials") {
                        semester = nil
                        subjectId = nil
                        category = nil
                    }
                }
            }
            .pickerStyle(.menu)

            switch state {
            case .idle, .loading:
                Section { ProgressView().frame(maxWidth: .infinity) }
            case .failed(let error):
                Section { ErrorStateView(error: error) { await load() } }
            case .loaded(let page):
                Section(page.total == 1 ? "1 material" : "\(page.total) materials") {
                    if page.items.isEmpty {
                        Text(isFiltered ? "No materials match these filters." : "Materials for your class will appear here once uploaded.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(page.items) { material in
                        row(material)
                    }
                }
            }
        }
        .navigationTitle("Study Materials")
        .refreshable { await load() }
        .onChange(of: semester) {
            // A subject from another semester no longer fits the list.
            if let subjectId, !subjects.contains(where: { $0.id == subjectId }) { self.subjectId = nil }
        }
        .task { await loadFilters() }
        .task(id: "\(semester ?? 0)|\(subjectId ?? "")|\(category ?? "")") { await load() }
    }

    private func row(_ material: StudyMaterial) -> some View {
        Button {
            if let url = fileURL(material) { openURL(url) }
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(material.title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                    Spacer()
                    StatusPill(text: StudyMaterialCategory.label(for: material.category), color: Theme.primary)
                }
                Text(material.subjectLine).font(.caption).foregroundStyle(.secondary)
                if let description = material.description, !description.isEmpty {
                    Text(description).font(.footnote).foregroundStyle(.secondary).lineLimit(3)
                }
                if let name = material.file?.name {
                    Label(name, systemImage: "arrow.down.doc").font(.caption.weight(.semibold)).foregroundStyle(Theme.primary)
                }
            }
            .padding(.vertical, 2)
        }
        .disabled(fileURL(material) == nil)
        .accessibilityHint("Opens the file")
    }

    private func fileURL(_ material: StudyMaterial) -> URL? {
        guard let path = material.file?.url else { return nil }
        // Resolve against the server actually in use (it may be overridden on the device).
        return ServerConfiguration(environment: BuildSettings.environment, buildBaseURL: URL(string: app.serverAddress)).assetURL(path)
    }

    private func loadFilters() async {
        filters = try? await app.client.send(API.studyMaterialFilters())
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do {
            state = .loaded(try await app.client.send(API.studyMaterials(semester: semester, subjectId: subjectId, category: category)))
        } catch {
            let e = APIError.wrap(error)
            if e != .cancelled { state = .failed(e) }
        }
    }
}
