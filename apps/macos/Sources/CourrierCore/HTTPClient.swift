import Foundation

public protocol HTTPTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw CourrierError.invalidResponse("The server returned a non-HTTP response.")
        }
        return (data, httpResponse)
    }
}

public struct AuthorizedHTTPClient: Sendable {
    public typealias AccessTokenProvider = @Sendable (_ forceRefresh: Bool) async throws -> String

    private let transport: any HTTPTransport
    private let accessToken: AccessTokenProvider

    public init(
        transport: any HTTPTransport = URLSessionTransport(),
        accessToken: @escaping AccessTokenProvider
    ) {
        self.transport = transport
        self.accessToken = accessToken
    }

    public init(
        transport: any HTTPTransport = URLSessionTransport(),
        accessToken: @escaping @Sendable () async throws -> String
    ) {
        self.transport = transport
        self.accessToken = { _ in
            try await accessToken()
        }
    }

    public func request(
        _ url: URL,
        method: String = "GET",
        headers: [String: String] = [:],
        body: Data? = nil,
        acceptedStatus: Range<Int> = 200..<300
    ) async throws -> Data {
        let first = try await perform(
            url,
            method: method,
            headers: headers,
            body: body,
            forceRefresh: false
        )
        let result: (Data, HTTPURLResponse)
        if first.1.statusCode == 401, !acceptedStatus.contains(401) {
            result = try await perform(
                url,
                method: method,
                headers: headers,
                body: body,
                forceRefresh: true
            )
        } else {
            result = first
        }
        let (data, response) = result

        guard acceptedStatus.contains(response.statusCode) else {
            let message = ServerErrorParser.message(from: data)
            throw CourrierError.requestFailed(status: response.statusCode, message: message)
        }
        return data
    }

    private func perform(
        _ url: URL,
        method: String,
        headers: [String: String],
        body: Data?,
        forceRefresh: Bool
    ) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.setValue(
            "Bearer \(try await accessToken(forceRefresh))",
            forHTTPHeaderField: "Authorization"
        )
        request.setValue("Courrier-macOS/1", forHTTPHeaderField: "User-Agent")
        headers.forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }
        return try await transport.data(for: request)
    }

    public func json<T: Decodable>(
        _ type: T.Type,
        from url: URL,
        method: String = "GET",
        headers: [String: String] = [:],
        body: Data? = nil
    ) async throws -> T {
        let data = try await request(
            url,
            method: method,
            headers: headers,
            body: body
        )
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw CourrierError.invalidResponse(
                "The mail service returned data Courrier could not read."
            )
        }
    }

    public func jsonBody<T: Encodable>(_ value: T) throws -> Data {
        try JSONEncoder().encode(value)
    }
}

enum ServerErrorParser {
    static func message(from data: Data) -> String {
        guard !data.isEmpty else { return "The server did not provide an explanation." }
        if
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let error = object["error"] as? [String: Any]
        {
            if let message = error["message"] as? String {
                return message
            }
            if let message = error["status"] as? String {
                return message
            }
        }
        if let text = String(data: data, encoding: .utf8), !text.isEmpty {
            return String(text.prefix(600))
        }
        return "The server returned an unreadable error."
    }
}

public extension URL {
    static func courrier(
        _ base: String,
        path: String,
        queryItems: [URLQueryItem] = []
    ) throws -> URL {
        guard var components = URLComponents(string: base) else {
            throw CourrierError.configuration("Courrier has an invalid service URL.")
        }
        components.percentEncodedPath = path
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components.url else {
            throw CourrierError.configuration("Courrier could not construct a service URL.")
        }
        return url
    }
}
