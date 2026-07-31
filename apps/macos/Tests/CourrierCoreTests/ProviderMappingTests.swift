import XCTest
@testable import CourrierCore

final class ProviderMappingTests: XCTestCase {
    func testRoutesProviderFromAccountID() {
        XCTAssertEqual(ProviderRouting.providerID(from: "microsoft:abc"), .microsoft)
        XCTAssertEqual(ProviderRouting.providerID(from: "google:123"), .google)
        XCTAssertNil(ProviderRouting.providerID(from: "imap:example"))
        XCTAssertNil(ProviderRouting.providerID(from: ""))
    }

    func testMapsAndSortsMicrosoftFolders() {
        let inbox = MicrosoftGraphMapper.folder(
            GraphFolderDTO(
                id: "inbox-id",
                displayName: "Inbox",
                unreadItemCount: 3,
                childFolderCount: 1
            ),
            wellKnownName: "inbox"
        )
        let child = MicrosoftGraphMapper.folder(
            GraphFolderDTO(
                id: "child",
                displayName: "Receipts",
                parentFolderId: "inbox-id"
            ),
            depth: 1
        )
        let sent = MicrosoftGraphMapper.folder(
            GraphFolderDTO(id: "sent-id", displayName: "Sent"),
            wellKnownName: "sentitems"
        )

        let sorted = MicrosoftGraphMapper.sortedFolders([sent, child, inbox])

        XCTAssertEqual(sorted.map(\.id), ["inbox-id", "child", "sent-id"])
        XCTAssertEqual(sorted.first?.icon, .inbox)
        XCTAssertEqual(sorted.first?.unreadCount, 3)
    }

    func testMapsMicrosoftMessageAndFiltersInlineAttachment() {
        let message = GraphMessageDTO(
            id: "m1",
            parentFolderId: "folder",
            subject: nil,
            bodyPreview: "Preview",
            receivedDateTime: "2026-07-26T10:00:00Z",
            lastModifiedDateTime: nil,
            isRead: false,
            hasAttachments: true,
            importance: "high",
            flag: .init(flagStatus: "flagged"),
            from: .init(emailAddress: .init(name: "Ada", address: "ada@example.com")),
            toRecipients: [],
            ccRecipients: [],
            bccRecipients: [],
            replyTo: [],
            internetMessageId: "<m1@example.com>",
            conversationId: "conversation",
            body: .init(contentType: "HTML", content: "<p>Hello</p>"),
            attachments: [
                .init(
                    odataType: "#microsoft.graph.fileAttachment",
                    id: "file",
                    name: "report.pdf",
                    contentType: "application/pdf",
                    size: 42,
                    isInline: false,
                    contentBytes: nil
                ),
                .init(
                    odataType: "#microsoft.graph.fileAttachment",
                    id: "inline",
                    name: "image.png",
                    contentType: "image/png",
                    size: 10,
                    isInline: true,
                    contentBytes: nil
                ),
            ]
        )

        let detail = MicrosoftGraphMapper.detail(folderID: "folder", message: message)

        XCTAssertEqual(detail.summary.subject, "(No subject)")
        XCTAssertEqual(detail.summary.sender.email, "ada@example.com")
        XCTAssertTrue(detail.summary.isFlagged)
        XCTAssertTrue(detail.summary.isImportant)
        XCTAssertEqual(detail.bodyContentType, .html)
        XCTAssertEqual(detail.attachments.map(\.id), ["file"])
    }

    func testMapsGmailLabelsAndMessageParts() {
        let folder = GmailMapper.folder(
            GmailLabelDTO(
                id: "INBOX",
                name: "INBOX",
                messagesTotal: 12,
                messagesUnread: 4
            )
        )
        XCTAssertEqual(folder.label, "Inbox")
        XCTAssertEqual(folder.wellKnownName, "inbox")
        XCTAssertEqual(folder.icon, .inbox)

        let message = GmailMessageDTO(
            id: "gmail-id",
            threadId: "thread",
            labelIds: ["INBOX", "UNREAD", "STARRED"],
            snippet: "A short preview",
            internalDate: "1785052800000",
            payload: GmailPartDTO(
                partId: "root",
                mimeType: "multipart/mixed",
                filename: "",
                headers: [
                    GmailHeaderDTO(name: "From", value: "Ada <ada@example.com>"),
                    GmailHeaderDTO(name: "To", value: "Grace <grace@example.com>"),
                    GmailHeaderDTO(name: "Subject", value: "Hello"),
                ],
                body: nil,
                parts: [
                    GmailPartDTO(
                        partId: "body",
                        mimeType: "text/html",
                        filename: "",
                        headers: [],
                        body: GmailBodyDTO(
                            attachmentId: nil,
                            size: 12,
                            data: Data("<p>Hello</p>".utf8).base64URLForTest
                        ),
                        parts: nil
                    ),
                    GmailPartDTO(
                        partId: "attachment",
                        mimeType: "application/pdf",
                        filename: "report.pdf",
                        headers: [],
                        body: GmailBodyDTO(
                            attachmentId: "provider-attachment",
                            size: 99,
                            data: nil
                        ),
                        parts: nil
                    ),
                ]
            )
        )

        let detail = GmailMapper.detail(folderID: "INBOX", message: message)

        XCTAssertFalse(detail.summary.isRead)
        XCTAssertTrue(detail.summary.isStarred)
        XCTAssertEqual(detail.bodyContentType, .html)
        XCTAssertEqual(detail.bodyContent, "<p>Hello</p>")
        XCTAssertEqual(detail.attachments.first?.name, "report.pdf")
    }
}

private extension Data {
    var base64URLForTest: String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
