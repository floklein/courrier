using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.UI.Text;

namespace Courrier.Windows.Services.Mail;

public static class RichTextHtmlConverter
{
    public static string ToHtml(ITextDocument document)
    {
        document.GetText(TextGetOptions.None, out var text);
        text = text.TrimEnd('\r');
        var output = new StringBuilder();
        var previous = new TextStyle(false, false, false, null);
        for (var index = 0; index < text.Length; index++)
        {
            var range = document.GetRange(index, index + 1);
            var style = new TextStyle(
                range.CharacterFormat.Bold == FormatEffect.On,
                range.CharacterFormat.Italic == FormatEffect.On,
                range.CharacterFormat.Underline != UnderlineType.None,
                NormalizeLink(range.Link));
            if (style != previous)
            {
                CloseAll(output, previous);
                OpenAll(output, style);
            }
            AppendCharacter(output, text[index]);
            previous = style;
        }
        CloseAll(output, previous);
        return output.ToString();
    }

    public static string ToRtf(string html)
    {
        var output = new StringBuilder(@"{\rtf1\ansi\deff0 ");
        var openLinks = 0;
        foreach (Match token in Regex.Matches(
                     html,
                     "<[^>]+>|[^<]+",
                     RegexOptions.Singleline | RegexOptions.CultureInvariant))
        {
            if (!token.Value.StartsWith('<'))
            {
                AppendRtfText(output, WebUtility.HtmlDecode(token.Value));
                continue;
            }

            var tag = Regex.Match(
                token.Value,
                @"^<\s*(/?)\s*([a-zA-Z0-9]+)",
                RegexOptions.CultureInvariant);
            if (!tag.Success)
            {
                continue;
            }
            var closing = tag.Groups[1].Value.Length > 0;
            var name = tag.Groups[2].Value.ToLowerInvariant();
            if (name is "br" or "hr")
            {
                output.Append(@"\line ");
                continue;
            }
            if (name is "p" or "div" or "blockquote")
            {
                if (closing)
                {
                    output.Append(@"\par ");
                }
                continue;
            }
            if (name == "li")
            {
                output.Append(closing ? @"\par " : @"\bullet\tab ");
                continue;
            }
            if (name is "strong" or "b")
            {
                output.Append(closing ? @"\b0 " : @"\b ");
                continue;
            }
            if (name is "em" or "i")
            {
                output.Append(closing ? @"\i0 " : @"\i ");
                continue;
            }
            if (name == "u")
            {
                output.Append(closing ? @"\ul0 " : @"\ul ");
                continue;
            }
            if (name == "a")
            {
                if (closing)
                {
                    if (openLinks > 0)
                    {
                        output.Append("}}");
                        openLinks--;
                    }
                    continue;
                }
                var href = Regex.Match(
                    token.Value,
                    """href\s*=\s*["']([^"']+)["']""",
                    RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
                if (href.Success && IsAllowedLink(WebUtility.HtmlDecode(href.Groups[1].Value)))
                {
                    var link = EscapeRtfInstruction(WebUtility.HtmlDecode(href.Groups[1].Value));
                    output.Append(@"{\field{\*\fldinst HYPERLINK """);
                    output.Append(link);
                    output.Append(@"""}{\fldrslt ");
                    openLinks++;
                }
            }
        }
        while (openLinks-- > 0)
        {
            output.Append("}}");
        }
        output.Append('}');
        return output.ToString();
    }

    private static void OpenAll(StringBuilder output, TextStyle style)
    {
        if (style.Link is not null)
        {
            output.Append("<a href=\"");
            output.Append(WebUtility.HtmlEncode(style.Link));
            output.Append("\">");
        }
        if (style.Bold)
        {
            output.Append("<strong>");
        }
        if (style.Italic)
        {
            output.Append("<em>");
        }
        if (style.Underline)
        {
            output.Append("<u>");
        }
    }

    private static void CloseAll(StringBuilder output, TextStyle style)
    {
        if (style.Underline)
        {
            output.Append("</u>");
        }
        if (style.Italic)
        {
            output.Append("</em>");
        }
        if (style.Bold)
        {
            output.Append("</strong>");
        }
        if (style.Link is not null)
        {
            output.Append("</a>");
        }
    }

    private static void AppendCharacter(StringBuilder output, char character)
    {
        if (character == '\r')
        {
            return;
        }
        if (character == '\n')
        {
            output.Append("<br>");
            return;
        }
        output.Append(WebUtility.HtmlEncode(character.ToString()));
    }

    private static void AppendRtfText(StringBuilder output, string value)
    {
        foreach (var character in value)
        {
            switch (character)
            {
                case '\\':
                case '{':
                case '}':
                    output.Append('\\').Append(character);
                    break;
                case '\r':
                    break;
                case '\n':
                    output.Append(@"\line ");
                    break;
                default:
                    if (character <= 0x7f)
                    {
                        output.Append(character);
                    }
                    else
                    {
                        output.Append(@"\u").Append((short)character).Append('?');
                    }
                    break;
            }
        }
    }

    private static string EscapeRtfInstruction(string value)
    {
        return value
            .Replace(@"\", @"\\", StringComparison.Ordinal)
            .Replace("\"", "\\\"", StringComparison.Ordinal)
            .Replace("{", @"\{", StringComparison.Ordinal)
            .Replace("}", @"\}", StringComparison.Ordinal);
    }

    private static bool IsAllowedLink(string value)
    {
        return Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
               uri.Scheme is "http" or "https" or "mailto";
    }

    private static string? NormalizeLink(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }
        var match = Regex.Match(
            value,
            """HYPERLINK\s+"([^"]+)"""",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        var link = match.Success ? match.Groups[1].Value : value.Trim('"', ' ');
        return IsAllowedLink(link) ? link : null;
    }

    private readonly record struct TextStyle(
        bool Bold,
        bool Italic,
        bool Underline,
        string? Link);
}
