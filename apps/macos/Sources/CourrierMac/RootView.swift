import CourrierCore
import SwiftUI
import UserNotifications

struct RootView: View {
    @EnvironmentObject private var mailbox: MailboxStore
    @EnvironmentObject private var composeWindows: ComposeWindowRegistry
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings
    @State private var showsDrafts = false

    var body: some View {
        Group {
            if mailbox.accounts.isEmpty {
                WelcomeView()
            } else {
                MailWindowView(
                    compose: compose,
                    showDrafts: { showsDrafts = true },
                    showSettings: { openSettings() }
                )
            }
        }
        .task {
            await mailbox.load()
            if UserDefaults.standard.object(forKey: "notificationsEnabled") == nil {
                UserDefaults.standard.set(true, forKey: "notificationsEnabled")
            }
            if UserDefaults.standard.bool(forKey: "notificationsEnabled") {
                _ = try? await UNUserNotificationCenter.current()
                    .requestAuthorization(options: [.alert, .sound, .badge])
            }
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                await mailbox.pollForNewMail()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .courrierCompose)) { _ in
            compose()
        }
        .onReceive(NotificationCenter.default.publisher(for: .courrierReply)) { _ in
            respond(.reply)
        }
        .onReceive(NotificationCenter.default.publisher(for: .courrierReplyAll)) { _ in
            respond(.replyAll)
        }
        .onReceive(NotificationCenter.default.publisher(for: .courrierForward)) { _ in
            respond(.forward)
        }
        .onReceive(NotificationCenter.default.publisher(for: .courrierTrash)) { _ in
            Task { await mailbox.trashSelected() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .courrierArchive)) { _ in
            Task { await mailbox.archiveSelected() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .courrierToggleRead)) { _ in
            let shouldMarkRead = mailbox.selectedSummaries.contains { !$0.isRead }
            Task { await mailbox.markSelected(isRead: shouldMarkRead) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .courrierShowDrafts)) { _ in
            showsDrafts = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .courrierNewMail)) { notification in
            if let message = notification.object as? MailMessageSummary {
                NativeNotificationService.notify(message)
            }
        }
        .onReceive(
            NotificationCenter.default.publisher(for: .courrierOpenNotification)
        ) { notification in
            guard let userInfo = notification.object as? [AnyHashable: Any],
                  let messageID = userInfo["messageID"] as? String,
                  let folderID = userInfo["folderID"] as? String else {
                return
            }
            Task {
                await mailbox.openNotification(
                    folderID: folderID,
                    messageID: messageID
                )
            }
        }
        .sheet(isPresented: $showsDrafts) {
            DraftsView(mailbox: mailbox) { draft in
                showsDrafts = false
                openCompose(.draft(draft))
            }
        }
        .alert(
            "Courrier",
            isPresented: Binding(
                get: { mailbox.errorMessage != nil },
                set: { if !$0 { mailbox.clearError() } }
            )
        ) {
            Button("OK") { mailbox.clearError() }
        } message: {
            Text(mailbox.errorMessage ?? "")
        }
        .overlay(alignment: .bottom) {
            if let message = mailbox.transientMessage {
                Text(message)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(.regularMaterial, in: Capsule())
                    .shadow(radius: 8)
                    .padding(.bottom, 18)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }

    private func compose() {
        openCompose(.new(accountID: mailbox.activeAccountID))
    }

    private func respond(_ kind: ReplyKind) {
        guard let message = mailbox.selectedMessage else { return }
        openCompose(
            .response(
                accountID: mailbox.activeAccountID,
                kind: kind,
                message: message
            )
        )
    }

    private func openCompose(_ payload: ComposeWindowRegistry.Payload) {
        openWindow(value: composeWindows.register(payload))
    }
}

private struct WelcomeView: View {
    @EnvironmentObject private var mailbox: MailboxStore
    @State private var signingIn: ProviderID?

    var body: some View {
        VStack(spacing: 22) {
            Image(systemName: "envelope.badge")
                .font(.system(size: 54, weight: .light))
                .foregroundStyle(.tint)

            VStack(spacing: 7) {
                Text("Welcome to Courrier")
                    .font(.largeTitle.weight(.semibold))
                Text("A focused, native home for your Outlook and Gmail accounts.")
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 10) {
                signInButton(.microsoft, symbol: "building.2")
                signInButton(.google, symbol: "g.circle")
            }
            .frame(width: 290)

            Text("Credentials stay in your macOS Keychain.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(48)
    }

    private func signInButton(_ provider: ProviderID, symbol: String) -> some View {
        Button {
            signingIn = provider
            Task {
                await mailbox.signIn(provider: provider)
                signingIn = nil
            }
        } label: {
            HStack {
                Image(systemName: symbol)
                Text("Sign in with \(provider.displayName)")
                Spacer()
                if signingIn == provider {
                    ProgressView().controlSize(.small)
                }
            }
            .frame(maxWidth: .infinity)
        }
        .controlSize(.large)
        .disabled(signingIn != nil)
    }
}

private enum NativeNotificationService {
    static func notify(_ message: MailMessageSummary) {
        guard UserDefaults.standard.bool(forKey: "notificationsEnabled") else { return }
        let showsPreview = UserDefaults.standard.object(
            forKey: "notificationPreviewEnabled"
        ) == nil || UserDefaults.standard.bool(forKey: "notificationPreviewEnabled")
        let isSilent = UserDefaults.standard.bool(forKey: "notificationSilent")
        let content = UNMutableNotificationContent()
        content.title = message.sender.name
        content.subtitle = message.subject
        content.body = showsPreview ? message.preview : "New message"
        content.sound = isSilent ? nil : .default
        content.userInfo = [
            "messageID": message.id,
            "folderID": message.folderID,
        ]
        let request = UNNotificationRequest(
            identifier: "mail-\(message.id)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }
}
