import Foundation
import Security

public struct OAuthCredential: Codable, Sendable {
    public let account: MailAccount
    public var accessToken: String
    public var refreshToken: String?
    public var expirationDate: Date

    public init(
        account: MailAccount,
        accessToken: String,
        refreshToken: String?,
        expirationDate: Date
    ) {
        self.account = account
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expirationDate = expirationDate
    }
}

public protocol CredentialVault: Sendable {
    func save(_ credential: OAuthCredential) throws
    func load(accountID: String) throws -> OAuthCredential?
    func delete(accountID: String) throws
}

public final class KeychainCredentialVault: CredentialVault, @unchecked Sendable {
    private let service: String

    public init(service: String = "dev.courrier.macos.oauth") {
        self.service = service
    }

    public func save(_ credential: OAuthCredential) throws {
        let data = try JSONEncoder().encode(credential)
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: credential.account.id,
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(base as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var insertion = base
            attributes.forEach { insertion[$0.key] = $0.value }
            let addStatus = SecItemAdd(insertion as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw KeychainError(status: addStatus)
            }
        } else if status != errSecSuccess {
            throw KeychainError(status: status)
        }
    }

    public func load(accountID: String) throws -> OAuthCredential? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: accountID,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess, let data = item as? Data else {
            throw KeychainError(status: status)
        }
        return try JSONDecoder().decode(OAuthCredential.self, from: data)
    }

    public func delete(accountID: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: accountID,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status: status)
        }
    }
}

private struct KeychainError: LocalizedError {
    let status: OSStatus

    var errorDescription: String? {
        let text = SecCopyErrorMessageString(status, nil) as String?
        return "Keychain operation failed: \(text ?? String(status))"
    }
}

public actor AccountRepository {
    private static let accountListKey = "courrier.accounts"

    private let vault: any CredentialVault
    private let defaults: UserDefaults

    public init(
        vault: any CredentialVault = KeychainCredentialVault(),
        defaults: UserDefaults = .standard
    ) {
        self.vault = vault
        self.defaults = defaults
    }

    public func accounts() -> [MailAccount] {
        guard let data = defaults.data(forKey: Self.accountListKey) else {
            return []
        }
        return (try? JSONDecoder().decode([MailAccount].self, from: data)) ?? []
    }

    public func credential(for accountID: String) throws -> OAuthCredential? {
        try vault.load(accountID: accountID)
    }

    public func save(_ credential: OAuthCredential) throws {
        try vault.save(credential)
        var storedAccounts = accounts()
        storedAccounts.removeAll { $0.id == credential.account.id }
        storedAccounts.append(credential.account)
        storedAccounts.sort {
            $0.email.localizedCaseInsensitiveCompare($1.email) == .orderedAscending
        }
        defaults.set(try JSONEncoder().encode(storedAccounts), forKey: Self.accountListKey)
    }

    public func remove(accountID: String) throws {
        try vault.delete(accountID: accountID)
        let storedAccounts = accounts().filter { $0.id != accountID }
        defaults.set(try JSONEncoder().encode(storedAccounts), forKey: Self.accountListKey)
    }
}
