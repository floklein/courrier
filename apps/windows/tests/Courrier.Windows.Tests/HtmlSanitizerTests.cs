using Courrier.Windows.Models;
using Courrier.Windows.Services.Mail;

namespace Courrier.Windows.Tests;

[TestClass]
public sealed class HtmlSanitizerTests
{
    [TestMethod]
    public void IncomingMailRemovesScriptsEventsAndRemoteImages()
    {
        var sanitizer = new MailHtmlSanitizer();

        var result = sanitizer.SanitizeIncoming(
            "<script>alert(1)</script><img src=\"https://tracker.example/pixel\" onerror=\"alert(2)\" alt=\"image\"><p style=\"background:url(https://tracker.example)\">Hello</p>");

        StringAssert.DoesNotContain(result, "script");
        StringAssert.DoesNotContain(result, "onerror");
        StringAssert.DoesNotContain(result, "tracker.example");
        StringAssert.Contains(result, "Hello");
        StringAssert.Contains(result, "alt=\"image\"");
    }

    [TestMethod]
    public void OutgoingMailUsesComposerAllowlist()
    {
        var sanitizer = new MailHtmlSanitizer();

        var result = sanitizer.SanitizeOutgoing(
            "<div><strong>Hello</strong><iframe src=\"https://example.com\"></iframe><a href=\"javascript:alert(1)\">bad</a></div>");

        StringAssert.Contains(result, "<strong>Hello</strong>");
        StringAssert.DoesNotContain(result, "<div");
        StringAssert.DoesNotContain(result, "iframe");
        StringAssert.DoesNotContain(result, "javascript:");
    }

    [TestMethod]
    public void IncomingMailResolvesKnownCidAndStillBlocksRemoteImages()
    {
        var sanitizer = new MailHtmlSanitizer();
        var inline = new MailInlineImage(
            "inline-1",
            "logo@example",
            "image/png",
            new byte[] { 1, 2, 3 });

        var result = sanitizer.SanitizeIncoming(
            "<img src=\"cid:%3Clogo@example%3E\"><img src=\"https://tracker.example/pixel\">",
            [inline]);

        StringAssert.Contains(result, "src=\"data:image/png;base64,AQID\"");
        StringAssert.DoesNotContain(result, "tracker.example");
    }

    [TestMethod]
    public void IncomingMailRejectsUnsupportedInlineImageTypes()
    {
        var sanitizer = new MailHtmlSanitizer();
        var inline = new MailInlineImage(
            "inline-1",
            "vector@example",
            "image/svg+xml",
            System.Text.Encoding.UTF8.GetBytes("<svg onload=\"alert(1)\" />"));

        var result = sanitizer.SanitizeIncoming(
            "<img src=\"cid:vector@example\">",
            [inline]);

        StringAssert.DoesNotContain(result, "src=");
        StringAssert.DoesNotContain(result, "data:");
    }
}
