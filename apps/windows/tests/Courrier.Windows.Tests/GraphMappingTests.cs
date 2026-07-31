using System.Text.Json;
using Courrier.Windows.Models;
using Courrier.Windows.Services.Mail;

namespace Courrier.Windows.Tests;

[TestClass]
public sealed class GraphMappingTests
{
    [TestMethod]
    public void MapsFolderCountsAndKind()
    {
        using var document = JsonDocument.Parse(
            """
            {
              "id": "folder-1",
              "displayName": "Inbox",
              "wellKnownName": "inbox",
              "totalItemCount": 12,
              "unreadItemCount": 3,
              "childFolderCount": 1
            }
            """);

        var folder = GraphMapping.MapFolder(document.RootElement);

        Assert.AreEqual("folder-1", folder.Id);
        Assert.AreEqual(FolderKind.Inbox, folder.Kind);
        Assert.AreEqual(3, folder.UnreadCount);
        Assert.IsTrue(folder.HasChildren);
    }

    [TestMethod]
    public void MapsHtmlMessageAndSeparatesInlineAttachments()
    {
        using var document = JsonDocument.Parse(
            """
            {
              "id": "message-1",
              "parentFolderId": "inbox-id",
              "subject": "Hello",
              "receivedDateTime": "2026-07-26T10:30:00Z",
              "isRead": false,
              "hasAttachments": true,
              "importance": "high",
              "flag": { "flagStatus": "flagged" },
              "from": {
                "emailAddress": { "name": "Ada", "address": "ada@example.com" }
              },
              "toRecipients": [
                { "emailAddress": { "name": "Lin", "address": "lin@example.com" } }
              ],
              "body": { "contentType": "html", "content": "<p>Hello</p>" },
              "attachments": [
                {
                  "@odata.type": "#microsoft.graph.fileAttachment",
                  "id": "file-1",
                  "name": "report.pdf",
                  "contentType": "application/pdf",
                  "size": 20,
                  "isInline": false
                },
                {
                  "@odata.type": "#microsoft.graph.fileAttachment",
                  "id": "inline-1",
                  "name": "logo.png",
                  "contentType": "image/png",
                  "size": 10,
                  "isInline": true,
                  "contentId": "<logo@example>"
                }
              ]
            }
            """);

        var message = GraphMapping.MapDetail(document.RootElement, "fallback");

        Assert.AreEqual("inbox-id", message.FolderId);
        Assert.AreEqual("ada@example.com", message.Sender.Email);
        Assert.AreEqual(MailBodyKind.Html, message.BodyKind);
        Assert.IsTrue(message.IsFlagged);
        Assert.IsTrue(message.IsImportant);
        Assert.AreEqual(1, message.Attachments.Count);
        Assert.AreEqual("report.pdf", message.Attachments[0].Name);
        Assert.AreEqual(1, message.InlineImages?.Count);
        Assert.AreEqual("logo@example", message.InlineImages?[0].ContentId);
    }
}
