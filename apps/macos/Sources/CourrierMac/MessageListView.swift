import CourrierCore
import SwiftUI

struct MessageListView: View {
    @EnvironmentObject private var mailbox: MailboxStore

    var body: some View {
        VStack(spacing: 0) {
            header

            if mailbox.selectedMessageIDs.count > 1 {
                bulkBar
                Divider()
            }

            if mailbox.isLoadingMessages && mailbox.messages.isEmpty {
                Spacer()
                ProgressView("Loading messages")
                    .controlSize(.small)
                Spacer()
            } else if mailbox.messages.isEmpty {
                ContentUnavailableView(
                    mailbox.searchText.isEmpty ? "No Messages" : "No Results",
                    systemImage: mailbox.searchText.isEmpty ? "tray" : "magnifyingglass",
                    description: Text(
                        mailbox.searchText.isEmpty
                            ? "This mailbox is empty."
                            : "Try another search."
                    )
                )
            } else {
                List(selection: $mailbox.selectedMessageIDs) {
                    ForEach(mailbox.messages) { message in
                        MessageRow(message: message)
                            .tag(message.id)
                            .draggable(message.id)
                            .contextMenu {
                                MessageContextMenu(message: message)
                            }
                            .task {
                                await mailbox.loadMoreIfNeeded(after: message)
                            }
                    }

                    if mailbox.isLoadingMore {
                        HStack {
                            Spacer()
                            ProgressView().controlSize(.small)
                            Spacer()
                        }
                        .listRowSeparator(.hidden)
                    }
                }
                .listStyle(.inset)
                .onChange(of: mailbox.selectedMessageIDs) { _, _ in
                    Task { await mailbox.selectionChanged() }
                }
            }
        }
        .searchable(text: $mailbox.searchText, prompt: "Search mail")
        .task(id: mailbox.searchText) {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await mailbox.applySearch()
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(mailbox.folders.first(where: {
                    $0.id == mailbox.selectedFolderID
                })?.label ?? "Mail")
                    .font(.title3.weight(.semibold))
                Text("\(mailbox.messages.count) messages")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Picker("Search scope", selection: $mailbox.searchScope) {
                Text("Folder").tag(MailSearchScope.folder)
                Text("All Mail").tag(MailSearchScope.all)
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            .fixedSize()
            .onChange(of: mailbox.searchScope) { _, _ in
                Task { await mailbox.searchScopeChanged() }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private var bulkBar: some View {
        HStack(spacing: 12) {
            Text("\(mailbox.selectedMessageIDs.count) selected")
                .font(.callout.weight(.medium))
            Spacer()
            Button {
                let markRead = mailbox.selectedSummaries.contains { !$0.isRead }
                Task { await mailbox.markSelected(isRead: markRead) }
            } label: {
                Image(systemName: "envelope.open")
            }
            .help("Toggle Read Status")

            if mailbox.capabilities.contains(.archive) {
                Button {
                    Task { await mailbox.archiveSelected() }
                } label: {
                    Image(systemName: "archivebox")
                }
                .help("Archive")
            }

            Menu {
                ForEach(mailbox.folders.filter {
                    $0.id != mailbox.selectedFolderID
                }) { folder in
                    Button(folder.label) {
                        Task { await mailbox.moveSelected(to: folder.id) }
                    }
                }
            } label: {
                Image(systemName: "folder")
            }
            .help("Move")

            Button(role: .destructive) {
                Task { await mailbox.trashSelected() }
            } label: {
                Image(systemName: "trash")
            }
            .help("Move to Trash")
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

private struct MessageRow: View {
    let message: MailMessageSummary

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            MessageAvatar(address: message.sender)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 5) {
                    Text(message.sender.name)
                        .fontWeight(message.isRead ? .regular : .semibold)
                        .lineLimit(1)
                    if message.hasAttachments {
                        Image(systemName: "paperclip")
                    }
                    if message.isStarred {
                        Image(systemName: "star.fill")
                            .foregroundStyle(.yellow)
                    }
                    if message.isFlagged {
                        Image(systemName: "flag.fill")
                            .foregroundStyle(.red)
                    }
                    if message.isImportant {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundStyle(.orange)
                    }
                    Spacer(minLength: 4)
                    Text(message.date, format: .dateTime.month(.abbreviated).day())
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .font(.caption)

                Text(message.subject)
                    .font(.callout)
                    .fontWeight(message.isRead ? .regular : .semibold)
                    .lineLimit(1)

                Text(message.preview)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)

                if let folderLabel = message.folderLabel {
                    Text(folderLabel)
                        .font(.caption2)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: 4))
                }
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }
}

private struct MessageContextMenu: View {
    @EnvironmentObject private var mailbox: MailboxStore
    let message: MailMessageSummary

    var body: some View {
        Button(message.isRead ? "Mark as Unread" : "Mark as Read") {
            select()
            Task { await mailbox.markSelected(isRead: !message.isRead) }
        }

        Divider()

        Button("Reply") { respond(.reply) }
        Button("Reply All") { respond(.replyAll) }
        Button("Forward") { respond(.forward) }

        Divider()

        if mailbox.capabilities.contains(.archive) {
            Button("Archive") {
                select()
                Task { await mailbox.archiveSelected() }
            }
        }

        Menu("Move To") {
            ForEach(mailbox.folders.filter { $0.id != message.folderID }) { folder in
                Button(folder.label) {
                    select()
                    Task { await mailbox.moveSelected(to: folder.id) }
                }
            }
        }

        if mailbox.capabilities.contains(.junk) {
            Button(message.folderWellKnownName == "junkemail" ? "Not Junk" : "Mark as Junk") {
                select()
                Task {
                    await mailbox.markJunkSelected(
                        isJunk: message.folderWellKnownName != "junkemail"
                    )
                }
            }
        }

        if mailbox.capabilities.contains(.star) {
            Button(message.isStarred ? "Remove Star" : "Add Star") {
                Task { await mailbox.toggleStar(message) }
            }
        }
        if mailbox.capabilities.contains(.flag) {
            Button(message.isFlagged ? "Clear Flag" : "Flag") {
                Task { await mailbox.toggleFlag(message) }
            }
        }
        if mailbox.capabilities.contains(.important) {
            Button(message.isImportant ? "Mark Normal" : "Mark Important") {
                Task { await mailbox.toggleImportant(message) }
            }
        }

        Divider()

        Button("Move to Trash", role: .destructive) {
            select()
            Task { await mailbox.trashSelected() }
        }
    }

    private func select() {
        mailbox.selectedMessageIDs = [message.id]
    }

    private func respond(_ kind: ReplyKind) {
        select()
        Task {
            await mailbox.selectionChanged()
            let name: Notification.Name = switch kind {
            case .reply: .courrierReply
            case .replyAll: .courrierReplyAll
            case .forward: .courrierForward
            }
            NotificationCenter.default.post(name: name, object: nil)
        }
    }
}

struct MessageAvatar: View {
    let address: MailAddress

    var body: some View {
        ZStack {
            Circle().fill(color.gradient)
            Text(initials)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white)
        }
        .frame(width: 34, height: 34)
    }

    private var initials: String {
        let source = address.name.isEmpty ? address.email : address.name
        return source
            .split(whereSeparator: { $0.isWhitespace || $0 == "-" })
            .prefix(2)
            .compactMap(\.first)
            .map(String.init)
            .joined()
            .uppercased()
    }

    private var color: Color {
        let value = address.email.lowercased().unicodeScalars.reduce(0) {
            ($0 &* 31 &+ Int($1.value)) & 0x7fff_ffff
        }
        return Color(
            hue: Double(value % 360) / 360,
            saturation: 0.55,
            brightness: 0.72
        )
    }
}
