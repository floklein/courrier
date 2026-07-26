import CourrierCore
import SwiftUI

struct DraftsView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var composer: ComposerModel
    let openDraft: (PersistedDraft) -> Void

    init(
        mailbox: MailboxStore,
        openDraft: @escaping (PersistedDraft) -> Void
    ) {
        _composer = StateObject(wrappedValue: ComposerModel(mailbox: mailbox))
        self.openDraft = openDraft
    }

    var body: some View {
        NavigationStack {
            Group {
                if composer.drafts.isEmpty {
                    ContentUnavailableView(
                        "No Drafts",
                        systemImage: "doc.text",
                        description: Text("Messages you start are saved here automatically.")
                    )
                } else {
                    List {
                        ForEach(composer.drafts) { draft in
                            Button {
                                openDraft(draft)
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(draft.subject.isEmpty ? "(No subject)" : draft.subject)
                                        .font(.headline)
                                    Text(draft.to.isEmpty ? "No recipients" : draft.to)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                    Text(draft.updatedAt, format: .relative(presentation: .named))
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button("Delete Draft", role: .destructive) {
                                    Task { await composer.deleteDraft(draft) }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Drafts")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .frame(minWidth: 520, minHeight: 380)
        .task {
            await composer.refreshDrafts()
        }
    }
}
