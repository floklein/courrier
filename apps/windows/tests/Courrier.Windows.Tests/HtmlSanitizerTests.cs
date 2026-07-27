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

        Assert.IsFalse(result.Contains("script", StringComparison.Ordinal));
        Assert.IsFalse(result.Contains("onerror", StringComparison.Ordinal));
        Assert.IsFalse(result.Contains("tracker.example", StringComparison.Ordinal));
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
        Assert.IsFalse(result.Contains("<div", StringComparison.Ordinal));
        Assert.IsFalse(result.Contains("iframe", StringComparison.Ordinal));
        Assert.IsFalse(result.Contains("javascript:", StringComparison.Ordinal));
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
        Assert.IsFalse(result.Contains("tracker.example", StringComparison.Ordinal));
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

        Assert.IsFalse(result.Contains("src=", StringComparison.Ordinal));
        Assert.IsFalse(result.Contains("data:", StringComparison.Ordinal));
    }
}
