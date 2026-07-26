using System.Net;
using System.Text.RegularExpressions;
using Courrier.Windows.Models;
using Ganss.Xss;

namespace Courrier.Windows.Services.Mail;

public sealed class MailHtmlSanitizer
{
    private static readonly string[] IncomingTags =
    [
        "a", "b", "blockquote", "br", "code", "div", "em", "h1", "h2", "h3",
        "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "s",
        "span", "strike", "strong", "table", "tbody", "td", "th", "thead", "tr",
        "u", "ul"
    ];

    private static readonly string[] IncomingAttributes =
    [
        "alt", "colspan", "height", "href", "rel", "rowspan", "src", "title", "width"
    ];

    private static readonly string[] OutgoingTags =
    [
        "a", "blockquote", "br", "em", "li", "ol", "p", "s", "strong", "u", "ul"
    ];

    private static readonly string[] OutgoingAttributes = ["href", "rel", "target"];

    public string SanitizeIncoming(string html)
    {
        return SanitizeIncoming(html, []);
    }

    public string SanitizeIncoming(
        string html,
        IReadOnlyList<MailInlineImage> inlineImages)
    {
        var images = inlineImages
            .Where(image =>
                image.Content is { Length: > 0 and <= 26_214_400 } &&
                IsSupportedRaster(image.ContentType) &&
                NormalizeContentId(image.ContentId).Length > 0)
            .GroupBy(
                image => NormalizeContentId(image.ContentId),
                StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                group => group.Key,
                group =>
                {
                    var image = group.First();
                    return
                        $"data:{image.ContentType.ToLowerInvariant()};base64,{Convert.ToBase64String(image.Content!)}";
                },
                StringComparer.OrdinalIgnoreCase);
        var replacements = new Dictionary<string, string>(StringComparer.Ordinal);
        var prepared = Regex.Replace(
            html,
            @"<img\b[^>]*>",
            match => RewriteImageTag(match.Value, images, replacements),
            RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.CultureInvariant);
        var sanitized = Create(IncomingTags, IncomingAttributes).Sanitize(prepared);
        foreach (var replacement in replacements)
        {
            sanitized = sanitized.Replace(
                replacement.Key,
                replacement.Value,
                StringComparison.Ordinal);
        }
        return sanitized;
    }

    public string SanitizeOutgoing(string html)
    {
        return Create(OutgoingTags, OutgoingAttributes).Sanitize(html);
    }

    private static HtmlSanitizer Create(
        IEnumerable<string> tags,
        IEnumerable<string> attributes)
    {
        var sanitizer = new HtmlSanitizer();
        sanitizer.AllowedTags.Clear();
        sanitizer.AllowedAttributes.Clear();
        sanitizer.AllowedCssProperties.Clear();
        sanitizer.AllowedAtRules.Clear();
        sanitizer.AllowedSchemes.Clear();
        foreach (var tag in tags)
        {
            sanitizer.AllowedTags.Add(tag);
        }
        foreach (var attribute in attributes)
        {
            sanitizer.AllowedAttributes.Add(attribute);
        }
        sanitizer.AllowedSchemes.Add("http");
        sanitizer.AllowedSchemes.Add("https");
        sanitizer.AllowedSchemes.Add("mailto");
        return sanitizer;
    }

    private static string RewriteImageTag(
        string tag,
        IReadOnlyDictionary<string, string> inlineImages,
        IDictionary<string, string> replacements)
    {
        var source = Regex.Match(
            tag,
            """\s+src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        var withoutSource = Regex.Replace(
            tag,
            """\s+src\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)""",
            string.Empty,
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        if (!source.Success)
        {
            return withoutSource;
        }
        var value = source.Groups.Cast<Group>()
            .Skip(1)
            .FirstOrDefault(group => group.Success)?
            .Value;
        value = WebUtility.HtmlDecode(value ?? string.Empty);
        if (!value.StartsWith("cid:", StringComparison.OrdinalIgnoreCase))
        {
            return withoutSource;
        }
        string contentId;
        try
        {
            contentId = NormalizeContentId(
                Uri.UnescapeDataString(value["cid:".Length..]));
        }
        catch (UriFormatException)
        {
            return withoutSource;
        }
        if (!inlineImages.TryGetValue(contentId, out var dataUrl))
        {
            return withoutSource;
        }
        var placeholder =
            $"https://courrier.invalid/inline/{Guid.NewGuid():N}";
        replacements[placeholder] = dataUrl;
        var selfClosing = withoutSource.LastIndexOf("/>", StringComparison.Ordinal);
        var end = selfClosing >= 0 ? selfClosing : withoutSource.LastIndexOf('>');
        return end < 0
            ? withoutSource
            : withoutSource.Insert(end, $" src=\"{placeholder}\"");
    }

    private static string NormalizeContentId(string value)
    {
        return value.Trim().Trim('<', '>');
    }

    private static bool IsSupportedRaster(string contentType)
    {
        return contentType.ToLowerInvariant() is
            "image/png" or
            "image/jpeg" or
            "image/gif" or
            "image/webp" or
            "image/bmp";
    }
}
