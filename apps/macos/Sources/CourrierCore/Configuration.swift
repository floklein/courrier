import Foundation

public struct AppConfiguration: Sendable {
    public let microsoftClientID: String?
    public let googleClientID: String?
    public let googleClientSecret: String?
    public let googlePubSubTopic: String?
    public let relayPublicURL: URL?
    public let relayAdminToken: String?

    public init(
        microsoftClientID: String? = nil,
        googleClientID: String? = nil,
        googleClientSecret: String? = nil,
        googlePubSubTopic: String? = nil,
        relayPublicURL: URL? = nil,
        relayAdminToken: String? = nil
    ) {
        self.microsoftClientID = microsoftClientID?.nilIfBlank
        self.googleClientID = googleClientID?.nilIfBlank
        self.googleClientSecret = googleClientSecret?.nilIfBlank
        self.googlePubSubTopic = googlePubSubTopic?.nilIfBlank
        self.relayPublicURL = relayPublicURL
        self.relayAdminToken = relayAdminToken?.nilIfBlank
    }

    public static func load(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        workingDirectory: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    ) -> AppConfiguration {
        var values: [String: String] = [:]
        let applicationSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first?
            .appendingPathComponent("Courrier", isDirectory: true)
            .appendingPathComponent(".env")
        let bundleProjectDirectory = Bundle.main.bundleURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let candidates = [
            workingDirectory.appendingPathComponent(".env"),
            workingDirectory.appendingPathComponent("apps/macos/.env"),
            bundleProjectDirectory.appendingPathComponent(".env"),
            applicationSupport,
        ].compactMap { $0 }

        for url in candidates {
            guard let contents = try? String(contentsOf: url, encoding: .utf8) else {
                continue
            }
            values.merge(parseEnvironmentFile(contents)) { current, _ in current }
        }
        values.merge(environment) { _, environmentValue in environmentValue }

        return AppConfiguration(
            microsoftClientID: values["MICROSOFT_CLIENT_ID"],
            googleClientID: values["GOOGLE_CLIENT_ID"],
            googleClientSecret: values["GOOGLE_CLIENT_SECRET"],
            googlePubSubTopic: values["GOOGLE_PUBSUB_TOPIC"],
            relayPublicURL: values["RELAY_PUBLIC_URL"].flatMap(URL.init(string:)),
            relayAdminToken: values["RELAY_ADMIN_TOKEN"]
        )
    }

    public func clientID(for provider: ProviderID) throws -> String {
        switch provider {
        case .microsoft:
            guard let microsoftClientID else {
                throw CourrierError.configuration(
                    "Set MICROSOFT_CLIENT_ID in apps/macos/.env before signing in."
                )
            }
            return microsoftClientID
        case .google:
            guard let googleClientID else {
                throw CourrierError.configuration(
                    "Set GOOGLE_CLIENT_ID in apps/macos/.env before signing in."
                )
            }
            return googleClientID
        }
    }
}

private func parseEnvironmentFile(_ contents: String) -> [String: String] {
    var values: [String: String] = [:]
    for rawLine in contents.split(whereSeparator: \.isNewline) {
        let line = rawLine.trimmingCharacters(in: .whitespaces)
        guard !line.isEmpty, !line.hasPrefix("#"), let separator = line.firstIndex(of: "=") else {
            continue
        }
        let key = String(line[..<separator]).trimmingCharacters(in: .whitespaces)
        var value = String(line[line.index(after: separator)...])
            .trimmingCharacters(in: .whitespaces)
        if value.count >= 2,
           (value.hasPrefix("\"") && value.hasSuffix("\""))
            || (value.hasPrefix("'") && value.hasSuffix("'")) {
            value.removeFirst()
            value.removeLast()
        }
        values[key] = value
    }
    return values
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
