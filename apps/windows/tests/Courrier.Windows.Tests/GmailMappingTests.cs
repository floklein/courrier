using System.Text;
using System.Text.Json;
using Courrier.Windows.Models;
using Courrier.Windows.Services.Mail;

namespace Courrier.Windows.Tests;

[TestClass]
public sealed class GmailMappingTests
{
    [TestMethod]
    public void MapsSystemLabelsToNativeFolderKinds()
    {
        using var document = JsonDocument.Parse(
            """
            {
              "id": "TRASH",
              "name": "TRASH",
              "messagesTotal": 7,
              "messagesUnread": 2
            }
            """);

        var folder = GmailMapping.MapLabel(document.RootElement);

        Assert.AreEqual("Trash", folder.Label);
        Assert.AreEqual(FolderKind.Trash, folder.Kind);
        Assert.AreEqual("deleteditems", folder.WellKnownName);
    }

    [TestMethod]
    public void MapsMultipartMessageAndAttachment()
    {
        var html = GmailMapping.EncodeBase64Url(Encoding.UTF8.GetBytes("<p>Native mail</p>"));
        using var document = JsonDocument.Parse(
            $$"""
            {
              "id": "message-1",
              "threadId": "thread-1",
              "internalDate": "1785061800000",
              "snippet": "Native mail",
              "labelIds": ["INBOX", "UNREAD", "STARRED"],
              "payload": {
                "mimeType": "multipart/mixed",
                "headers": [
                  { "name": "From", "value": "Ada <ada@example.com>" },
                  { "name": "To", "value": "lin@example.com" },
                  { "name": "Subject", "value": "Hello" },
                  { "name": "Message-ID", "value": "<message@example.com>" }
                ],
                "parts": [
                  {
                    "mimeType": "text/html",
                    "filename": "",
                    "body": { "data": "{{html}}" }
                  },
                  {
                    "mimeType": "application/pdf",
                    "filename": "report.pdf",
                    "body": { "attachmentId": "attachment-1", "size": 42 }
                  },
                  {
                    "partId": "3",
                    "mimeType": "image/png",
                    "filename": "logo.png",
                    "headers": [
                      { "name": "Content-ID", "value": "<logo@example>" },
                      { "name": "Content-Disposition", "value": "inline" }
                    ],
                    "body": { "data": "{{GmailMapping.EncodeBase64Url(new byte[] { 1, 2, 3 })}}", "size": 3 }
                  }
                ]
              }
            }
            """);

        var message = GmailMapping.MapDetail(document.RootElement, "INBOX");

        Assert.AreEqual("Hello", message.Subject);
        Assert.AreEqual(MailBodyKind.Html, message.BodyKind);
        Assert.AreEqual("<p>Native mail</p>", message.Body);
        Assert.IsFalse(message.IsRead);
        Assert.IsTrue(message.IsStarred);
        Assert.AreEqual(1, message.Attachments.Count);
        Assert.AreEqual("attachment-1", message.Attachments[0].Id);
        Assert.AreEqual(1, message.InlineImages?.Count);
        Assert.AreEqual("logo@example", message.InlineImages?[0].ContentId);
        CollectionAssert.AreEqual(new byte[] { 1, 2, 3 }, message.InlineImages?[0].Content);
    }

    [TestMethod]
    public void ExternalInlinePartIsNotExposedAsDownloadAttachment()
    {
        using var document = JsonDocument.Parse(
            """
            {
              "id": "message-2",
              "labelIds": ["INBOX"],
              "payload": {
                "mimeType": "multipart/related",
                "headers": [],
                "parts": [
                  {
                    "partId": "1",
                    "mimeType": "image/jpeg",
                    "filename": "",
                    "headers": [
                      { "name": "Content-ID", "value": "<photo@example>" }
                    ],
                    "body": { "attachmentId": "inline-attachment", "size": 12 }
                  }
                ]
              }
            }
            """);

        var message = GmailMapping.MapDetail(document.RootElement, "INBOX");

        Assert.AreEqual(0, message.Attachments.Count);
        Assert.AreEqual("inline-attachment", message.InlineImages?[0].Id);
        Assert.IsNull(message.InlineImages?[0].Content);
    }

    [TestMethod]
    public void Base64UrlRoundTripsUtf8()
    {
        const string value = "Bonjour, Florent";
        var encoded = GmailMapping.EncodeBase64Url(Encoding.UTF8.GetBytes(value));
        Assert.AreEqual(value, GmailMapping.DecodeBase64Url(encoded));
    }
}
