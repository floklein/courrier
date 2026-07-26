import AppKit
import CourrierCore
import SwiftUI
import UserNotifications

@main
struct CourrierMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @AppStorage("appearancePreference") private var appearancePreference = "system"
    @StateObject private var mailbox: MailboxStore
    @StateObject private var composeWindows = ComposeWindowRegistry()

    init() {
        let mailbox = MailboxStore()
        _mailbox = StateObject(wrappedValue: mailbox)
    }

    var body: some Scene {
        WindowGroup("Courrier") {
            RootView()
                .environmentObject(mailbox)
                .environmentObject(composeWindows)
                .frame(minWidth: 940, minHeight: 600)
                .preferredColorScheme(preferredColorScheme)
        }
        .defaultSize(width: 1280, height: 780)
        .commands {
            CourrierCommands()
        }

        WindowGroup("New Message", for: UUID.self) { $windowID in
            if let windowID {
                ComposerSceneView(
                    mailbox: mailbox,
                    registry: composeWindows,
                    windowID: windowID,
                    payload: composeWindows.payload(for: windowID)
                )
                .environmentObject(mailbox)
                .frame(minWidth: 620, minHeight: 520)
                .preferredColorScheme(preferredColorScheme)
            }
        }
        .defaultSize(width: 720, height: 680)
        .windowResizability(.contentMinSize)

        Settings {
            SettingsView()
                .environmentObject(mailbox)
                .frame(width: 560, height: 430)
                .preferredColorScheme(preferredColorScheme)
        }
    }

    private var preferredColorScheme: ColorScheme? {
        switch appearancePreference {
        case "light": .light
        case "dark": .dark
        default: nil
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
        NSWindow.allowsAutomaticWindowTabbing = false
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        DispatchQueue.main.async {
            NotificationCenter.default.post(
                name: .courrierOpenNotification,
                object: userInfo
            )
        }
        completionHandler()
    }
}

struct CourrierCommands: Commands {
    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Message") {
                NotificationCenter.default.post(name: .courrierCompose, object: nil)
            }
            .keyboardShortcut("n", modifiers: .command)
        }

        CommandMenu("Message") {
            Button("Reply") {
                NotificationCenter.default.post(name: .courrierReply, object: nil)
            }
            .keyboardShortcut("r", modifiers: .command)

            Button("Reply All") {
                NotificationCenter.default.post(name: .courrierReplyAll, object: nil)
            }
            .keyboardShortcut("r", modifiers: [.command, .shift])

            Button("Forward") {
                NotificationCenter.default.post(name: .courrierForward, object: nil)
            }
            .keyboardShortcut("f", modifiers: [.command, .shift])

            Divider()

            Button("Archive") {
                NotificationCenter.default.post(name: .courrierArchive, object: nil)
            }
            .keyboardShortcut("e", modifiers: .command)

            Button("Move to Trash") {
                NotificationCenter.default.post(name: .courrierTrash, object: nil)
            }
            .keyboardShortcut(.delete, modifiers: .command)

            Button("Toggle Read Status") {
                NotificationCenter.default.post(name: .courrierToggleRead, object: nil)
            }
            .keyboardShortcut("u", modifiers: [.command, .shift])

            Divider()

            Button("Drafts") {
                NotificationCenter.default.post(name: .courrierShowDrafts, object: nil)
            }
            .keyboardShortcut("d", modifiers: [.command, .shift])
        }
    }
}
