import CourrierCore
import SwiftUI

struct FolderSidebarView: View {
    @EnvironmentObject private var mailbox: MailboxStore
    let compose: () -> Void
    let showDrafts: () -> Void
    let showSettings: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            accountHeader

            if mailbox.isLoadingFolders && mailbox.folders.isEmpty {
                Spacer()
                ProgressView("Loading mailboxes")
                    .controlSize(.small)
                Spacer()
            } else {
                List(selection: $mailbox.selectedFolderID) {
                    Section {
                        ForEach(mailbox.folders) { folder in
                            FolderRow(folder: folder)
                                .tag(Optional(folder.id))
                                .dropDestination(for: String.self) { messageIDs, _ in
                                    guard !messageIDs.isEmpty else { return false }
                                    Task {
                                        for messageID in messageIDs {
                                            await mailbox.move(messageID: messageID, to: folder.id)
                                        }
                                    }
                                    return true
                                }
                        }
                    }

                    Section("On My Mac") {
                        Button(action: showDrafts) {
                            Label("Drafts", systemImage: "doc.text")
                        }
                        .buttonStyle(.plain)
                    }
                }
                .listStyle(.sidebar)
                .onChange(of: mailbox.selectedFolderID) { _, folderID in
                    Task { await mailbox.selectFolder(folderID) }
                }
            }

            Divider()

            HStack {
                Circle()
                    .fill(mailbox.liveUpdatesActive ? Color.green : Color.secondary.opacity(0.4))
                    .frame(width: 7, height: 7)
                Text(mailbox.liveUpdatesActive ? "Live updates" : "Polling for mail")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button(action: showSettings) {
                    Image(systemName: "gearshape")
                }
                .buttonStyle(.borderless)
                .help("Settings")
            }
            .padding(10)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            Button(action: compose) {
                Label("New Message", systemImage: "square.and.pencil")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(.horizontal, 10)
            .padding(.bottom, 8)
        }
    }

    private var accountHeader: some View {
        Menu {
            ForEach(mailbox.accounts) { account in
                Button {
                    Task { await mailbox.activate(accountID: account.id) }
                } label: {
                    if account.id == mailbox.activeAccountID {
                        Label(account.email, systemImage: "checkmark")
                    } else {
                        Text(account.email)
                    }
                }
            }

            Divider()

            Button("Add Microsoft Account") {
                Task { await mailbox.signIn(provider: .microsoft) }
            }
            Button("Add Google Account") {
                Task { await mailbox.signIn(provider: .google) }
            }
            Button("Manage Accounts", action: showSettings)
        } label: {
            HStack(spacing: 10) {
                AccountAvatar(account: mailbox.activeAccount)
                VStack(alignment: .leading, spacing: 1) {
                    Text(mailbox.activeAccount?.name ?? "Courrier")
                        .font(.headline)
                        .lineLimit(1)
                    Text(mailbox.activeAccount?.email ?? "")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .padding(10)
    }
}

private struct FolderRow: View {
    let folder: MailFolder

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: folder.icon.systemName)
                .frame(width: 18)
                .foregroundStyle(
                    folder.wellKnownName == "inbox" ? Color.accentColor : Color.secondary
                )
            Text(folder.label)
                .lineLimit(1)
            Spacer(minLength: 6)
            if folder.unreadCount > 0 {
                Text(folder.unreadCount, format: .number.notation(.compactName))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(folder.wellKnownName == "inbox" ? .white : .secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background {
                        if folder.wellKnownName == "inbox" {
                            Capsule().fill(Color.accentColor)
                        }
                    }
            }
        }
        .padding(.leading, CGFloat(folder.depth * 14))
        .contentShape(Rectangle())
    }
}

struct AccountAvatar: View {
    let account: MailAccount?

    var body: some View {
        ZStack {
            Circle().fill(Color.accentColor.gradient)
            Text(initials)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white)
        }
        .frame(width: 30, height: 30)
    }

    private var initials: String {
        let source = account?.name.isEmpty == false ? account?.name : account?.email
        let parts = (source ?? "C").split(whereSeparator: { $0.isWhitespace })
        return parts.prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }
}
