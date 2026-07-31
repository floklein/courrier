import CryptoKit
import Foundation
import Network

public final class OAuthSignInService: @unchecked Sendable {
    public typealias BrowserOpener = @Sendable (URL) async -> Bool

    private let configuration: AppConfiguration
    private let repository: AccountRepository
    private let transport: any HTTPTransport
    private let openBrowser: BrowserOpener

    public init(
        configuration: AppConfiguration,
        repository: AccountRepository,
        transport: any HTTPTransport = URLSessionTransport(),
        openBrowser: @escaping BrowserOpener
    ) {
        self.configuration = configuration
        self.repository = repository
        self.transport = transport
        self.openBrowser = openBrowser
    }

    public func signIn(to provider: ProviderID) async throws -> MailAccount {
        let clientID = try configuration.clientID(for: provider)
        let server = try await LoopbackOAuthServer.start(provider: provider)
        defer { server.cancel() }

        let verifier = Self.randomURLSafeString(byteCount: 48)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncodedString()
        let state = Self.randomURLSafeString(byteCount: 24)
        let redirectURI = server.redirectURI
        let authorizationURL = try Self.authorizationURL(
            provider: provider,
            clientID: clientID,
            redirectURI: redirectURI,
            challenge: challenge,
            state: state
        )

        guard await openBrowser(authorizationURL) else {
            throw CourrierError.authentication("Courrier could not open the sign-in page.")
        }

        let callback = try await server.waitForCallback()
        let callbackItems = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
            .queryItems ?? []
        let values = Dictionary(uniqueKeysWithValues: callbackItems.map { ($0.name, $0.value ?? "") })

        if let oauthError = values["error"] {
            let description = values["error_description"] ?? oauthError
            throw CourrierError.authentication(description)
        }
        guard values["state"] == state else {
            throw CourrierError.authentication("The sign-in response did not match this request.")
        }
        guard let code = values["code"], !code.isEmpty else {
            throw CourrierError.authentication("The sign-in response did not include an authorization code.")
        }

        let tokens = try await exchangeCode(
            provider: provider,
            clientID: clientID,
            code: code,
            verifier: verifier,
            redirectURI: redirectURI
        )
        let account = try await fetchAccount(provider: provider, accessToken: tokens.accessToken)
        let credential = OAuthCredential(
            account: account,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expirationDate: Date().addingTimeInterval(TimeInterval(tokens.expiresIn))
        )
        try await repository.save(credential)
        return account
    }

    private func exchangeCode(
        provider: ProviderID,
        clientID: String,
        code: String,
        verifier: String,
        redirectURI: URL
    ) async throws -> TokenResponse {
        let endpoint: URL
        var form = [
            "client_id": clientID,
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
            "redirect_uri": redirectURI.absoluteString,
        ]

        switch provider {
        case .microsoft:
            endpoint = URL(string: "https://login.microsoftonline.com/common/oauth2/v2.0/token")!
            form["scope"] = Self.microsoftScopes.joined(separator: " ")
        case .google:
            endpoint = URL(string: "https://oauth2.googleapis.com/token")!
            if let secret = configuration.googleClientSecret {
                form["client_secret"] = secret
            }
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue(
            "application/x-www-form-urlencoded",
            forHTTPHeaderField: "Content-Type"
        )
        request.httpBody = Self.formEncoded(form)
        let (data, response) = try await transport.data(for: request)
        guard (200..<300).contains(response.statusCode) else {
            throw CourrierError.authentication(ServerErrorParser.message(from: data))
        }
        do {
            return try JSONDecoder().decode(TokenResponse.self, from: data)
        } catch {
            throw CourrierError.invalidResponse("The identity provider returned an unreadable token.")
        }
    }

    private func fetchAccount(provider: ProviderID, accessToken: String) async throws -> MailAccount {
        let url: URL
        switch provider {
        case .microsoft:
            url = URL(string: "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName")!
        case .google:
            url = URL(string: "https://openidconnect.googleapis.com/v1/userinfo")!
        }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await transport.data(for: request)
        guard (200..<300).contains(response.statusCode) else {
            throw CourrierError.authentication(ServerErrorParser.message(from: data))
        }

        switch provider {
        case .microsoft:
            let profile = try JSONDecoder().decode(MicrosoftProfile.self, from: data)
            let email = profile.mail ?? profile.userPrincipalName ?? ""
            guard !profile.id.isEmpty, !email.isEmpty else {
                throw CourrierError.invalidResponse("Microsoft did not return an account email.")
            }
            return MailAccount(
                id: "\(provider.rawValue):\(profile.id)",
                providerID: provider,
                providerAccountID: profile.id,
                email: email,
                name: profile.displayName ?? email
            )
        case .google:
            let profile = try JSONDecoder().decode(GoogleProfile.self, from: data)
            guard !profile.sub.isEmpty, !profile.email.isEmpty else {
                throw CourrierError.invalidResponse("Google did not return an account email.")
            }
            return MailAccount(
                id: "\(provider.rawValue):\(profile.sub)",
                providerID: provider,
                providerAccountID: profile.sub,
                email: profile.email,
                name: profile.name ?? profile.email
            )
        }
    }

    private static func authorizationURL(
        provider: ProviderID,
        clientID: String,
        redirectURI: URL,
        challenge: String,
        state: String
    ) throws -> URL {
        let base: String
        var items: [URLQueryItem] = [
            .init(name: "client_id", value: clientID),
            .init(name: "redirect_uri", value: redirectURI.absoluteString),
            .init(name: "response_type", value: "code"),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state", value: state),
        ]
        switch provider {
        case .microsoft:
            base = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
            items.append(.init(name: "scope", value: microsoftScopes.joined(separator: " ")))
            items.append(.init(name: "prompt", value: "select_account"))
        case .google:
            base = "https://accounts.google.com/o/oauth2/v2/auth"
            items.append(.init(name: "scope", value: googleScopes.joined(separator: " ")))
            items.append(.init(name: "access_type", value: "offline"))
            items.append(.init(name: "prompt", value: "consent"))
            items.append(.init(name: "include_granted_scopes", value: "true"))
        }
        var components = URLComponents(string: base)!
        components.queryItems = items
        guard let url = components.url else {
            throw CourrierError.configuration("Courrier could not construct the sign-in URL.")
        }
        return url
    }

    fileprivate static let microsoftScopes = [
        "offline_access", "User.Read", "People.Read", "Mail.ReadWrite", "Mail.Send",
    ]

    fileprivate static let googleScopes = [
        "openid",
        "profile",
        "email",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/contacts.readonly",
    ]

    fileprivate static func formEncoded(_ values: [String: String]) -> Data {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        let text = values
            .sorted(by: { $0.key < $1.key })
            .map { key, value in
                let escapedKey = key.addingPercentEncoding(withAllowedCharacters: allowed) ?? key
                let escapedValue = value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
                return "\(escapedKey)=\(escapedValue)"
            }
            .joined(separator: "&")
        return Data(text.utf8)
    }

    private static func randomURLSafeString(byteCount: Int) -> String {
        var generator = SystemRandomNumberGenerator()
        let bytes = (0..<byteCount).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
        return Data(bytes).base64URLEncodedString()
    }
}

public actor AccessTokenBroker {
    private let configuration: AppConfiguration
    private let repository: AccountRepository
    private let transport: any HTTPTransport

    public init(
        configuration: AppConfiguration,
        repository: AccountRepository,
        transport: any HTTPTransport = URLSessionTransport()
    ) {
        self.configuration = configuration
        self.repository = repository
        self.transport = transport
    }

    public func accessToken(
        for accountID: String,
        forceRefresh: Bool = false
    ) async throws -> String {
        guard var credential = try await repository.credential(for: accountID) else {
            throw CourrierError.authentication("This account is no longer signed in.")
        }
        if !forceRefresh, credential.expirationDate.timeIntervalSinceNow > 90 {
            return credential.accessToken
        }
        guard let refreshToken = credential.refreshToken else {
            throw CourrierError.authentication("Sign in again to refresh this account.")
        }

        let provider = credential.account.providerID
        let clientID = try configuration.clientID(for: provider)
        let endpoint: URL
        var form = [
            "client_id": clientID,
            "grant_type": "refresh_token",
            "refresh_token": refreshToken,
        ]
        switch provider {
        case .microsoft:
            endpoint = URL(string: "https://login.microsoftonline.com/common/oauth2/v2.0/token")!
            form["scope"] = OAuthSignInService.microsoftScopes.joined(separator: " ")
        case .google:
            endpoint = URL(string: "https://oauth2.googleapis.com/token")!
            if let secret = configuration.googleClientSecret {
                form["client_secret"] = secret
            }
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = OAuthSignInService.formEncoded(form)
        let (data, response) = try await transport.data(for: request)
        guard (200..<300).contains(response.statusCode) else {
            throw CourrierError.authentication(ServerErrorParser.message(from: data))
        }
        let tokens = try JSONDecoder().decode(TokenResponse.self, from: data)
        credential.accessToken = tokens.accessToken
        credential.refreshToken = tokens.refreshToken ?? refreshToken
        credential.expirationDate = Date().addingTimeInterval(TimeInterval(tokens.expiresIn))
        try await repository.save(credential)
        return credential.accessToken
    }
}

private struct TokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String?
    let expiresIn: Int

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
    }
}

private struct MicrosoftProfile: Decodable {
    let id: String
    let displayName: String?
    let mail: String?
    let userPrincipalName: String?
}

private struct GoogleProfile: Decodable {
    let sub: String
    let email: String
    let name: String?
}

private final class LoopbackOAuthServer: @unchecked Sendable {
    private let listener: NWListener
    private let provider: ProviderID
    private let queue = DispatchQueue(label: "dev.courrier.oauth-loopback")
    private let lock = NSLock()
    private var callbackContinuation: CheckedContinuation<URL, Error>?
    private var storedResult: Result<URL, Error>?
    private(set) var redirectURI: URL

    private init(listener: NWListener, provider: ProviderID) {
        self.listener = listener
        self.provider = provider
        self.redirectURI = provider == .microsoft
            ? URL(string: "http://localhost")!
            : URL(string: "http://127.0.0.1/callback")!
    }

    static func start(provider: ProviderID) async throws -> LoopbackOAuthServer {
        let listener = try NWListener(using: .tcp, on: .any)
        let server = LoopbackOAuthServer(listener: listener, provider: provider)
        try await server.begin()
        return server
    }

    func waitForCallback() async throws -> URL {
        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<URL, Error>) in
            lock.lock()
            if let storedResult {
                lock.unlock()
                continuation.resume(with: storedResult)
            } else {
                callbackContinuation = continuation
                lock.unlock()
            }
        }
    }

    func cancel() {
        listener.cancel()
    }

    private func begin() async throws {
        listener.newConnectionHandler = { [weak self] connection in
            self?.receive(connection)
        }
        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Void, Error>) in
            let gate = ContinuationGate()
            listener.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    guard gate.claim() else { return }
                    guard let self, let port = self.listener.port else {
                        continuation.resume(
                            throwing: CourrierError.authentication(
                                "Courrier could not reserve a sign-in callback port."
                            )
                        )
                        return
                    }
                    self.redirectURI = self.provider == .microsoft
                        ? URL(string: "http://localhost:\(port.rawValue)")!
                        : URL(string: "http://127.0.0.1:\(port.rawValue)/callback")!
                    continuation.resume()
                case .failed(let error):
                    guard gate.claim() else { return }
                    continuation.resume(throwing: error)
                default:
                    break
                }
            }
            listener.start(queue: queue)
        }
    }

    private func receive(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) {
            [weak self] data, _, _, error in
            guard let self else { return }
            if let error {
                connection.cancel()
                self.finish(.failure(error))
                return
            }
            guard
                let data,
                let request = String(data: data, encoding: .utf8),
                let firstLine = request.split(separator: "\r\n").first,
                firstLine.hasPrefix("GET "),
                let rawTarget = firstLine.split(separator: " ").dropFirst().first,
                let callbackURL = URL(string: String(rawTarget), relativeTo: self.redirectURI)
            else {
                self.sendResponse(connection, status: "400 Bad Request", message: "Invalid callback.")
                self.finish(.failure(CourrierError.authentication("The sign-in callback was invalid.")))
                return
            }
            self.sendResponse(
                connection,
                status: "200 OK",
                message: "Sign-in complete. You can close this tab and return to Courrier."
            )
            self.finish(.success(callbackURL.absoluteURL))
        }
    }

    private func sendResponse(_ connection: NWConnection, status: String, message: String) {
        let body = """
        <!doctype html><meta charset="utf-8"><title>Courrier</title>
        <body style="font:16px -apple-system;padding:48px;max-width:560px">
        <h1>Courrier</h1><p>\(message)</p></body>
        """
        let response = """
        HTTP/1.1 \(status)\r
        Content-Type: text/html; charset=utf-8\r
        Content-Length: \(body.utf8.count)\r
        Connection: close\r
        \r
        \(body)
        """
        connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func finish(_ result: Result<URL, Error>) {
        lock.lock()
        if let continuation = callbackContinuation {
            callbackContinuation = nil
            lock.unlock()
            continuation.resume(with: result)
        } else {
            storedResult = result
            lock.unlock()
        }
    }
}

private final class ContinuationGate: @unchecked Sendable {
    private let lock = NSLock()
    private var claimed = false

    func claim() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !claimed else { return false }
        claimed = true
        return true
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
