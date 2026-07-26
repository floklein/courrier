import CourrierCore
import SwiftUI

struct MailWindowView: View {
    @EnvironmentObject private var mailbox: MailboxStore
    let compose: () -> Void
    let showDrafts: () -> Void
    let showSettings: () -> Void

    var body: some View {
        NavigationSplitView {
            FolderSidebarView(
                compose: compose,
                showDrafts: showDrafts,
                showSettings: showSettings
            )
            .navigationSplitViewColumnWidth(min: 190, ideal: 220, max: 300)
        } content: {
            MessageListView()
                .navigationSplitViewColumnWidth(min: 320, ideal: 390, max: 520)
        } detail: {
            MessageDetailView()
        }
        .navigationSplitViewStyle(.balanced)
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button(action: compose) {
                    Label("New Message", systemImage: "square.and.pencil")
                }
                .help("New Message")
            }

            ToolbarItem {
                Button {
                    Task { await mailbox.refresh() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .help("Refresh")
                .disabled(mailbox.isLoadingMessages || mailbox.isPerformingAction)
            }
        }
    }
}
