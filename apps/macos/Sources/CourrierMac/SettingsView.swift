import CourrierCore
import SwiftUI
import UserNotifications

struct SettingsView: View {
    @EnvironmentObject private var mailbox: MailboxStore
    @AppStorage("notificationsEnabled") private var notificationsEnabled = true
    @AppStorage("notificationPreviewEnabled") private var previewEnabled = true
    @AppStorage("notificationSilent") private var silentNotifications = false
    @AppStorage("appearancePreference") private var appearance = "system"

    var body: some View {
        TabView {
            accountsTab
                .tabItem { Label("Accounts", systemImage: "person.crop.circle") }

            notificationsTab
                .tabItem { Label("Notifications", systemImage: "bell") }

            appearanceTab
                .tabItem { Label("Appearance", systemImage: "paintbrush") }

            configurationTab
                .tabItem { Label("Advanced", systemImage: "gearshape.2") }
        }
        .padding(16)
    }

    private var accountsTab: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Accounts")
                .font(.title2.weight(.semibold))

            List {
                ForEach(mailbox.accounts) { account in
                    HStack(spacing: 10) {
                        AccountAvatar(account: account)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(account.name)
                                .font(.headline)
                            Text(account.email)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if account.id == mailbox.activeAccountID {
                            Text("Active")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Button("Use") {
                                Task { await mailbox.activate(accountID: account.id) }
                            }
                        }
                        Button("Sign Out", role: .destructive) {
                            Task { await mailbox.signOut(accountID: account.id) }
                        }
                    }
                    .padding(.vertical, 3)
                }
            }
            .frame(minHeight: 210)

            HStack {
                Button("Add Microsoft Account") {
                    Task { await mailbox.signIn(provider: .microsoft) }
                }
                Button("Add Google Account") {
                    Task { await mailbox.signIn(provider: .google) }
                }
            }
        }
    }

    private var notificationsTab: some View {
        Form {
            Section {
                Toggle("Enable new mail notifications", isOn: $notificationsEnabled)
                    .onChange(of: notificationsEnabled) { _, enabled in
                        if enabled {
                            Task {
                                _ = try? await UNUserNotificationCenter.current()
                                    .requestAuthorization(options: [.alert, .sound, .badge])
                            }
                        }
                    }
                Toggle("Show message preview", isOn: $previewEnabled)
                    .disabled(!notificationsEnabled)
                Toggle("Deliver silently", isOn: $silentNotifications)
                    .disabled(!notificationsEnabled)
            } header: {
                Text("New Mail")
            } footer: {
                Text(
                    "macOS notification controls in System Settings can further limit banners, sounds, and badges."
                )
            }

            Section("Delivery") {
                LabeledContent("Background mode") {
                    Text(mailbox.liveUpdatesActive ? "Relay live updates" : "Periodic polling")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
    }

    private var appearanceTab: some View {
        Form {
            Picker("Appearance", selection: $appearance) {
                Text("System").tag("system")
                Text("Light").tag("light")
                Text("Dark").tag("dark")
            }
            .pickerStyle(.radioGroup)

            Text("System follows your current macOS appearance.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .formStyle(.grouped)
    }

    private var configurationTab: some View {
        Form {
            Section("Identity Providers") {
                configurationRow(
                    "Microsoft",
                    configured: mailbox.configuration.microsoftClientID != nil
                )
                configurationRow(
                    "Google",
                    configured: mailbox.configuration.googleClientID != nil
                )
            }

            Section("Live Updates") {
                configurationRow(
                    "Relay",
                    configured: mailbox.configuration.relayPublicURL != nil
                        && mailbox.configuration.relayAdminToken != nil
                )
                configurationRow(
                    "Gmail Pub/Sub",
                    configured: mailbox.configuration.googlePubSubTopic != nil
                )
            }

            Text("Configuration is read from apps/macos/.env when Courrier launches.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .formStyle(.grouped)
    }

    private func configurationRow(_ name: String, configured: Bool) -> some View {
        LabeledContent(name) {
            Label(
                configured ? "Configured" : "Not configured",
                systemImage: configured ? "checkmark.circle.fill" : "exclamationmark.circle"
            )
            .foregroundStyle(configured ? Color.green : Color.secondary)
        }
    }
}
