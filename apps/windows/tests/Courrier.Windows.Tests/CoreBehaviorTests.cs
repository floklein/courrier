using Courrier.Windows.Models;
using Courrier.Windows.Services;
using Courrier.Windows.Services.Mail;

namespace Courrier.Windows.Tests;

[TestClass]
public sealed class CoreBehaviorTests
{
    [TestMethod]
    public void RecipientParserPreservesQuotedCommas()
    {
        var result = RecipientParser.Parse(
            "\"Klein, Florent\" <florent@example.com>; ada@example.com");

        Assert.AreEqual(0, result.Invalid.Count);
        Assert.AreEqual(2, result.Valid.Count);
        Assert.AreEqual("Klein, Florent", result.Valid[0].Name);
        Assert.AreEqual("ada@example.com", result.Valid[1].Email);
    }

    [TestMethod]
    public void RecipientParserKeepsValidRecipientsBesidePartialInput()
    {
        var result = RecipientParser.Parse(
            "ada@example.com, someone@");

        Assert.AreEqual(1, result.Valid.Count);
        Assert.AreEqual("ada@example.com", result.Valid[0].Email);
        CollectionAssert.AreEqual(
            new[] { "someone@" },
            result.Invalid.ToArray());
    }

    [TestMethod]
    public void FolderOrderingPlacesKnownFoldersFirstAndNestsChildren()
    {
        var folders = new[]
        {
            new MailFolder("custom", "Projects", FolderKind.Folder, 0, 0),
            new MailFolder("child", "Alpha", FolderKind.Folder, 0, 0, "custom"),
            new MailFolder("trash", "Trash", FolderKind.Trash, 0, 0),
            new MailFolder("inbox", "Inbox", FolderKind.Inbox, 0, 0)
        };

        var result = FolderOrdering.Sort(folders);

        CollectionAssert.AreEqual(
            new[] { "inbox", "trash", "custom", "child" },
            result.Select(folder => folder.Id).ToArray());
        Assert.AreEqual(1, result[3].Depth);
    }

    [TestMethod]
    public void RelayRequiresTlsExceptExplicitLoopbackDevelopment()
    {
        Assert.IsTrue(RelayEndpointPolicy.IsAllowed(
            new Uri("https://relay.example"),
            false));
        Assert.IsFalse(RelayEndpointPolicy.IsAllowed(
            new Uri("http://relay.example"),
            true));
        Assert.IsFalse(RelayEndpointPolicy.IsAllowed(
            new Uri("http://127.0.0.1:8787"),
            false));
        Assert.IsTrue(RelayEndpointPolicy.IsAllowed(
            new Uri("http://127.0.0.1:8787"),
            true));
        Assert.AreEqual(
            "wss",
            RelayEndpointPolicy.WebSocketUri(new Uri("https://relay.example")).Scheme);
    }

    [TestMethod]
    public void ReopenedRichDraftProducesFormattedRtf()
    {
        var rtf = RichTextHtmlConverter.ToRtf(
            "<p><strong>Bold</strong> and <em>italic</em> with " +
            "<a href=\"https://example.com\">a link</a></p>");

        StringAssert.Contains(rtf, @"\b Bold\b0");
        StringAssert.Contains(rtf, @"\i italic\i0");
        StringAssert.Contains(rtf, "HYPERLINK");
        StringAssert.Contains(rtf, "https://example.com");
    }

    [TestMethod]
    public void AttachmentReconciliationRetainsOriginalAndAppendsNewFile()
    {
        var original = new ProviderAttachmentDescriptor(
            "provider-original",
            "original.pdf",
            "application/pdf",
            42);
        var requestedOriginal = new LocalAttachment(
            "local-original",
            "original.pdf",
            "application/pdf",
            42,
            "original.pdf");
        var added = new LocalAttachment(
            "local-added",
            "added.txt",
            "text/plain",
            3,
            "added.txt");

        var plan = AttachmentReconciliation.Plan(
            [original],
            [requestedOriginal, added]);

        Assert.AreEqual(0, plan.DeleteIds.Count);
        Assert.AreEqual(1, plan.Uploads.Count);
        Assert.AreEqual("local-added", plan.Uploads[0].Id);
    }
}
