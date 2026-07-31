import Foundation
import XCTest
@testable import CourrierCore

final class ProviderDraftRegressionTests: XCTestCase {
    func testGraphDraftUpdateClearsRecipientsPreservesInlinePartsAndUsesModifiedDate() async throws {
        let responseJSON = Data(
            """
            {
              "id": "draft-1",
              "subject": "Updated",
              "lastModifiedDateTime": "2026-07-26T10:11:12.123Z",
              "toRecipients": [],
              "ccRecipients": [],
              "bccRecipients": [],
              "body": {"contentType": "HTML", "content": "<p>Updated</p>"},
              "attachments": [
                {
                  "@odata.type": "#microsoft.graph.fileAttachment",
                  "id": "inline-signature",
                  "name": "signature.png",
                  "contentType": "image/png",
                  "size": 12,
                  "isInline": true
                }
              ]
            }
            """.utf8
        )
        let transport = RecordingTransport { request in
            let data = request.httpMethod == "GET" ? responseJSON : Data()
            return (data, Self.response(for: request, status: request.httpMethod == "GET" ? 200 : 204))
        }
        let provider = MicrosoftGraphProvider(
            account: microsoftAccount,
            client: AuthorizedHTTPClient(transport: transport) { "token" }
        )

        let saved = try await provider.saveDraft(
            DraftSaveRequest(
                providerDraftID: "draft-1",
                message: ComposeMessage(
                    to: [],
                    cc: [],
                    bcc: [],
                    subject: "Updated",
                    bodyHTML: "<p>Updated</p>"
                )
            )
        )

        let requests = await transport.recordedRequests()
        let patch = try XCTUnwrap(requests.first { $0.httpMethod == "PATCH" })
        let body = try XCTUnwrap(patch.httpBody)
        let payload = try XCTUnwrap(
            JSONSerialization.jsonObject(with: body) as? [String: Any]
        )
        XCTAssertEqual((payload["toRecipients"] as? [Any])?.count, 0)
        XCTAssertEqual((payload["ccRecipients"] as? [Any])?.count, 0)
        XCTAssertEqual((payload["bccRecipients"] as? [Any])?.count, 0)
        XCTAssertFalse(requests.contains { $0.httpMethod == "DELETE" })

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        XCTAssertEqual(
            saved.updatedAt.timeIntervalSince1970,
            try XCTUnwrap(
                formatter.date(from: "2026-07-26T10:11:12.123Z")
            ).timeIntervalSince1970,
            accuracy: 0.001
        )
    }

    func testGmailRefusesToReplaceDraftWithInlineMIMEContent() async throws {
        let responseJSON = Data(
            """
            {
              "id": "draft-1",
              "message": {
                "id": "message-1",
                "threadId": "thread-1",
                "payload": {
                  "mimeType": "multipart/related",
                  "headers": [],
                  "parts": [
                    {
                      "mimeType": "text/html",
                      "filename": "",
                      "headers": [],
                      "body": {"size": 14, "data": "PHA-SGVsbG88L3A-"}
                    },
                    {
                      "mimeType": "image/png",
                      "filename": "signature.png",
                      "headers": [
                        {"name": "Content-Disposition", "value": "inline"},
                        {"name": "Content-ID", "value": "<signature>"}
                      ],
                      "body": {"attachmentId": "inline-1", "size": 12}
                    }
                  ]
                }
              }
            }
            """.utf8
        )
        let transport = RecordingTransport { request in
            (responseJSON, Self.response(for: request, status: 200))
        }
        let provider = GmailProvider(
            account: googleAccount,
            client: AuthorizedHTTPClient(transport: transport) { "token" }
        )

        do {
            _ = try await provider.saveDraft(
                DraftSaveRequest(
                    providerDraftID: "draft-1",
                    message: ComposeMessage(
                        to: [MailAddress(email: "reader@example.com")],
                        subject: "Updated",
                        bodyHTML: "<p>Updated</p>"
                    )
                )
            )
            XCTFail("Expected Gmail inline MIME protection to refuse the update.")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("cannot safely update"))
            XCTAssertTrue(error.localizedDescription.contains("inline images"))
        }

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.httpMethod), ["GET"])
    }

    private var microsoftAccount: MailAccount {
        MailAccount(
            id: "microsoft:test",
            providerID: .microsoft,
            providerAccountID: "test",
            email: "writer@example.com",
            name: "Writer"
        )
    }

    private var googleAccount: MailAccount {
        MailAccount(
            id: "google:test",
            providerID: .google,
            providerAccountID: "test",
            email: "writer@example.com",
            name: "Writer"
        )
    }

    private static func response(
        for request: URLRequest,
        status: Int
    ) -> HTTPURLResponse {
        HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
    }
}

private actor RecordingTransport: HTTPTransport {
    typealias Responder =
        @Sendable (URLRequest) throws -> (Data, HTTPURLResponse)

    private let responder: Responder
    private var requests: [URLRequest] = []

    init(responder: @escaping Responder) {
        self.responder = responder
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        return try responder(request)
    }

    func recordedRequests() -> [URLRequest] {
        requests
    }
}
