import XCTest
@testable import CourrierCore

final class CoreLogicTests: XCTestCase {
    func testRecipientParserHandlesQuotedNamesAndDeduplicates() {
        let result = RecipientParser.parse(
            #""Doe, Jane" <jane@example.com>; grace@example.com, JANE@example.com"#
        )

        XCTAssertEqual(result.invalid, [])
        XCTAssertEqual(result.valid.count, 2)
        XCTAssertEqual(result.valid[0].name, "Doe, Jane")
        XCTAssertEqual(result.valid[1].email, "grace@example.com")
    }

    func testRecipientParserReportsInvalidEntries() {
        let result = RecipientParser.parse("valid@example.com, not-an-email")

        XCTAssertEqual(result.valid.map(\.email), ["valid@example.com"])
        XCTAssertEqual(result.invalid, ["not-an-email"])
    }

    func testSubjectPrefixesAreIdempotent() {
        XCTAssertEqual(SubjectFormatter.reply("Hello"), "Re: Hello")
        XCTAssertEqual(SubjectFormatter.reply("RE: Hello"), "RE: Hello")
        XCTAssertEqual(SubjectFormatter.forward("Hello"), "Fwd: Hello")
        XCTAssertEqual(SubjectFormatter.forward("fwd: Hello"), "fwd: Hello")
    }

    func testSanitizerRemovesExecutableAndRemoteContent() {
        let input = """
        <script>alert(1)</script>
        <img src="https://tracker.example/pixel" onerror="alert(2)">
        <a href="javascript:alert(3)">Bad link</a>
        <p style="background:url(https://tracker.example)">Hello</p>
        """
        let output = HTMLSanitizer.sanitizeIncoming(input)

        XCTAssertFalse(output.localizedCaseInsensitiveContains("<script"))
        XCTAssertFalse(output.localizedCaseInsensitiveContains("onerror"))
        XCTAssertFalse(output.localizedCaseInsensitiveContains("javascript:"))
        XCTAssertFalse(output.localizedCaseInsensitiveContains("background:url"))
        XCTAssertTrue(output.contains("data-courrier-remote-image"))
        XCTAssertTrue(output.contains("Hello"))
    }

    func testOutgoingSanitizerReducesAppKitHTMLToSupportedSubset() {
        let input = """
        <html><head><style>p { color: red }</style></head><body>
        <p class="Apple-style-span"><span style="font-weight: bold">Hello</span>
        <a href="javascript:alert(1)" onclick="bad()">bad</a>
        <a href="https://example.com" style="color:red">safe</a></p>
        </body></html>
        """
        let output = HTMLSanitizer.sanitizeOutgoing(input)

        XCTAssertTrue(output.contains("<strong>Hello</strong>"))
        XCTAssertFalse(output.contains("<style"))
        XCTAssertFalse(output.contains("<span"))
        XCTAssertFalse(output.contains("javascript:"))
        XCTAssertFalse(output.contains("onclick"))
        XCTAssertTrue(output.contains(#"href="https://example.com""#))
        XCTAssertTrue(output.contains(#"rel="noopener noreferrer""#))
    }

    func testMIMEBuilderIncludesRecipientsBodyAndAttachment() {
        let raw = MIMEBuilder.build(
            from: MailAddress(name: "Ada", email: "ada@example.com"),
            message: ComposeMessage(
                to: [MailAddress(name: "Grace", email: "grace@example.com")],
                subject: "A report",
                bodyHTML: "<p>Hello</p>",
                attachments: [
                    ComposeAttachment(
                        name: "notes.txt",
                        contentType: "text/plain",
                        data: Data("Notes".utf8)
                    ),
                ]
            )
        )
        let text = String(decoding: raw, as: UTF8.self)

        XCTAssertTrue(text.contains(#"To: "Grace" <grace@example.com>"#))
        XCTAssertTrue(text.contains("Content-Type: multipart/mixed"))
        XCTAssertTrue(text.contains("filename=\"notes.txt\""))
        XCTAssertTrue(text.contains(Data("<p>Hello</p>".utf8).base64EncodedString()))
    }

    func testMIMEBuilderQuotesAndEncodesNamesAndWrapsBase64At76Characters() {
        let body = String(repeating: "Long body content. ", count: 20)
        let raw = MIMEBuilder.build(
            from: MailAddress(
                name: #"Doe, "Jane""#,
                email: "jane@example.com"
            ),
            message: ComposeMessage(
                to: [
                    MailAddress(
                        name: "Élodie Exemple",
                        email: "elodie@example.com"
                    ),
                ],
                subject: "Résumé",
                bodyHTML: body
            )
        )
        let text = String(decoding: raw, as: UTF8.self)
        let encoded = Data(body.utf8).base64EncodedString()
        let bytes = Array(encoded.utf8)
        let wrapped = stride(from: 0, to: bytes.count, by: 76).map { start in
            String(
                decoding: bytes[start..<min(start + 76, bytes.count)],
                as: UTF8.self
            )
        }.joined(separator: "\r\n")

        XCTAssertTrue(
            text.contains(#"From: "Doe, \"Jane\"" <jane@example.com>"#)
        )
        XCTAssertTrue(text.contains("To: =?UTF-8?B?"))
        XCTAssertTrue(text.contains("Subject: =?UTF-8?B?"))
        XCTAssertTrue(text.contains(wrapped))
        XCTAssertTrue(
            wrapped.components(separatedBy: "\r\n").allSatisfy {
                $0.utf8.count <= 76
            }
        )
    }

    func testLocalDraftStoreRoundTrip() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let file = directory.appendingPathComponent("drafts.json")
        let store = LocalDraftStore(fileURL: file)
        let draft = PersistedDraft(
            accountID: "google:1",
            to: "grace@example.com",
            subject: "Hello",
            bodyHTML: "<p>Draft</p>"
        )

        try await store.save(draft)
        let loaded = await store.drafts(accountID: "google:1")

        XCTAssertEqual(loaded.count, 1)
        XCTAssertEqual(loaded.first?.id, draft.id)
        XCTAssertEqual(loaded.first?.subject, "Hello")

        try await store.delete(id: draft.id)
        let remaining = await store.drafts(accountID: "google:1")
        XCTAssertTrue(remaining.isEmpty)
    }

    func testAuthorizedClientRefreshesAndRetriesOnlyOnceAfter401() async throws {
        let transport = RetryHTTPTransport()
        let tokens = RefreshTokenRecorder()
        let client = AuthorizedHTTPClient(transport: transport) { forceRefresh in
            await tokens.token(forceRefresh: forceRefresh)
        }

        let data = try await client.request(URL(string: "https://example.test/mail")!)
        let refreshFlags = await tokens.refreshFlags()
        let authorizationHeaders = await transport.authorizationHeaders()

        XCTAssertEqual(String(decoding: data, as: UTF8.self), "ok")
        XCTAssertEqual(refreshFlags, [false, true])
        XCTAssertEqual(
            authorizationHeaders,
            ["Bearer stale-token", "Bearer refreshed-token"]
        )
    }

    func testRelayEndpointPolicyRequiresEncryptionOutsideLoopback() throws {
        XCTAssertEqual(
            try RelayEndpointPolicy.httpBaseURL(
                from: URL(string: "wss://relay.example.test")!
            ).scheme,
            "https"
        )
        XCTAssertEqual(
            try RelayEndpointPolicy.webSocketBaseURL(
                from: URL(string: "https://relay.example.test")!
            ).scheme,
            "wss"
        )
        XCTAssertNoThrow(
            try RelayEndpointPolicy.webSocketBaseURL(
                from: URL(string: "http://localhost:8787")!
            )
        )
        XCTAssertNoThrow(
            try RelayEndpointPolicy.httpBaseURL(
                from: URL(string: "ws://127.0.0.1:8787")!
            )
        )
        XCTAssertThrowsError(
            try RelayEndpointPolicy.httpBaseURL(
                from: URL(string: "http://relay.example.test")!
            )
        )
        XCTAssertThrowsError(
            try RelayEndpointPolicy.webSocketBaseURL(
                from: URL(string: "ws://192.168.1.20:8787")!
            )
        )
    }
}

private actor RefreshTokenRecorder {
    private var flags: [Bool] = []

    func token(forceRefresh: Bool) -> String {
        flags.append(forceRefresh)
        return forceRefresh ? "refreshed-token" : "stale-token"
    }

    func refreshFlags() -> [Bool] {
        flags
    }
}

private actor RetryHTTPTransport: HTTPTransport {
    private var authorization: [String] = []

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        authorization.append(request.value(forHTTPHeaderField: "Authorization") ?? "")
        let status = authorization.count == 1 ? 401 : 200
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: nil
        )!
        return (Data(status == 200 ? "ok".utf8 : "expired".utf8), response)
    }

    func authorizationHeaders() -> [String] {
        authorization
    }
}
