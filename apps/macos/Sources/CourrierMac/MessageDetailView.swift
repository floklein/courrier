import AppKit
import CourrierCore
import SwiftUI

struct MessageDetailView: View {
    @EnvironmentObject private var mailbox: MailboxStore
    @EnvironmentObject private var composeWindows: ComposeWindowRegistry
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Group {
            if mailbox.isLoadingDetail {
                ProgressView("Loading message")
            } else if let message = mailbox.selectedMessage {
                messageView(message)
            } else {
                ContentUnavailableView(
                    "Select a Message",
                    systemImage: "envelope.open",
                    description: Text("Choose a message from the list to read it.")
                )
            }
        }
    }

    private func messageView(_ message: MailMessageDetail) -> some View {
        VStack(spacing: 0) {
            messageHeader(message)
            Divider()

            if !message.attachments.isEmpty {
                attachmentStrip(message.attachments)
                Divider()
            }

            if message.bodyContentType == .html {
                SafeHTMLView(html: message.bodyContent)
            } else {
                ScrollView {
                    Text(message.bodyContent)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(22)
                }
            }
        }
        .toolbar {
            ToolbarItemGroup {
                Button {
                    respond(.reply, message)
                } label: {
                    Label("Reply", systemImage: "arrowshape.turn.up.left")
                }
                .help("Reply")

                Button {
                    respond(.forward, message)
                } label: {
                    Label("Forward", systemImage: "arrowshape.turn.up.right")
                }
                .help("Forward")

                Menu {
                    Button("Reply All") { respond(.replyAll, message) }
                    Divider()
                    Button(message.summary.isRead ? "Mark as Unread" : "Mark as Read") {
                        Task { await mailbox.markSelected(isRead: !message.summary.isRead) }
                    }
                    if mailbox.capabilities.contains(.archive) {
                        Button("Archive") {
                            Task { await mailbox.archiveSelected() }
                        }
                    }
                    Menu("Move To") {
                        ForEach(mailbox.folders.filter {
                            $0.id != message.summary.folderID
                        }) { folder in
                            Button(folder.label) {
                                Task { await mailbox.moveSelected(to: folder.id) }
                            }
                        }
                    }
                    if mailbox.capabilities.contains(.junk) {
                        Button(
                            message.summary.folderWellKnownName == "junkemail"
                                ? "Not Junk"
                                : "Mark as Junk"
                        ) {
                            Task {
                                await mailbox.markJunkSelected(
                                    isJunk: message.summary.folderWellKnownName != "junkemail"
                                )
                            }
                        }
                    }
                    Divider()
                    Button("Move to Trash", role: .destructive) {
                        Task { await mailbox.trashSelected() }
                    }
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
            }
        }
    }

    private func messageHeader(_ message: MailMessageDetail) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                Text(message.summary.subject)
                    .font(.title2.weight(.semibold))
                    .textSelection(.enabled)
                Spacer()
                Text(
                    message.summary.date,
                    format: .dateTime.year().month().day().hour().minute()
                )
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack(alignment: .top, spacing: 12) {
                MessageAvatar(address: message.summary.sender)
                    .scaleEffect(1.15)
                VStack(alignment: .leading, spacing: 3) {
                    Text(message.summary.sender.name)
                        .font(.headline)
                    Text(message.summary.sender.email)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                    Text(
                        "To \(message.summary.recipients.isEmpty ? "undisclosed recipients" : message.summary.recipients.joined(separator: ", "))"
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    if !message.summary.ccRecipients.isEmpty {
                        Text("Cc \(message.summary.ccRecipients.joined(separator: ", "))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                Spacer()

                HStack(spacing: 6) {
                    if !message.summary.isRead {
                        Label("Unread", systemImage: "circle.fill")
                            .labelStyle(.titleOnly)
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(.tint.opacity(0.12), in: Capsule())
                    }
                    if message.summary.isStarred {
                        Image(systemName: "star.fill").foregroundStyle(.yellow)
                    }
                    if message.summary.isFlagged {
                        Image(systemName: "flag.fill").foregroundStyle(.red)
                    }
                    if message.summary.isImportant {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundStyle(.orange)
                    }
                }
            }
        }
        .padding(22)
    }

    private func attachmentStrip(_ attachments: [MailAttachment]) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 10) {
                ForEach(attachments) { attachment in
                    HStack(spacing: 8) {
                        Image(systemName: "doc")
                            .foregroundStyle(.secondary)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(attachment.name)
                                .font(.caption.weight(.medium))
                                .lineLimit(1)
                            Text(
                                ByteCountFormatter.string(
                                    fromByteCount: Int64(attachment.size),
                                    countStyle: .file
                                )
                            )
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        }
                        Button {
                            Task { await openAttachment(attachment) }
                        } label: {
                            Image(systemName: "arrow.up.forward.app")
                        }
                        .buttonStyle(.borderless)
                        .help("Open")

                        Button {
                            Task { await saveAttachment(attachment) }
                        } label: {
                            Image(systemName: "square.and.arrow.down")
                        }
                        .buttonStyle(.borderless)
                        .help("Save")
                    }
                    .padding(8)
                    .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 10)
        }
    }

    private func respond(_ kind: ReplyKind, _ message: MailMessageDetail) {
        let windowID = composeWindows.register(
            .response(
                accountID: mailbox.activeAccountID,
                kind: kind,
                message: message
            )
        )
        openWindow(value: windowID)
    }

    private func saveAttachment(_ attachment: MailAttachment) async {
        do {
            let download = try await mailbox.download(attachment)
            let panel = NSSavePanel()
            panel.nameFieldStringValue = download.name
            guard panel.runModal() == .OK, let url = panel.url else { return }
            try download.data.write(to: url, options: .atomic)
        } catch {
            let alert = NSAlert(error: error)
            alert.runModal()
        }
    }

    private func openAttachment(_ attachment: MailAttachment) async {
        do {
            let download = try await mailbox.download(attachment)
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent("Courrier", isDirectory: true)
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
            let url = directory.appendingPathComponent(download.name)
            try download.data.write(to: url, options: .atomic)
            NSWorkspace.shared.open(url)
        } catch {
            let alert = NSAlert(error: error)
            alert.runModal()
        }
    }
}
