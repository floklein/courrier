import Foundation

public enum HTMLSanitizer {
    private static let blockedElements = [
        "script", "iframe", "object", "embed", "form", "input", "button",
        "textarea", "select", "option", "link", "meta", "base", "video", "audio"
    ]

    public static func sanitizeIncoming(_ html: String) -> String {
        var result = html

        for element in blockedElements {
            result = replace(
                result,
                pattern: #"<\#(element)\b[^>]*>[\s\S]*?</\#(element)\s*>"#,
                with: ""
            )
            result = replace(
                result,
                pattern: #"<\#(element)\b[^>]*/?\s*>"#,
                with: ""
            )
        }

        result = replace(
            result,
            pattern: #"\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)"#,
            with: ""
        )
        result = replace(
            result,
            pattern: #"\s+(?:srcset|formaction)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)"#,
            with: ""
        )
        result = replace(
            result,
            pattern: #"\s+style\s*=\s*(["'])[^"']*(?:url\s*\(|expression\s*\()[^"']*\1"#,
            with: ""
        )
        result = replace(
            result,
            pattern: #"\s+(href|src)\s*=\s*(["'])\s*(?:javascript|vbscript):[^"']*\2"#,
            with: ""
        )
        result = replace(
            result,
            pattern: #"\s+src\s*=\s*(["'])https?://[^"']*\1"#,
            with: #" src="" data-courrier-remote-image="blocked""#
        )
        return result
    }

    public static func sanitizeOutgoing(_ html: String) -> String {
        var result = html
        result = replace(
            result,
            pattern: #"<(?:head|style|script|iframe|object|embed|form|meta|link|base)\b[^>]*>[\s\S]*?</(?:head|style|script|iframe|object|embed|form|meta|link|base)\s*>"#,
            with: ""
        )
        result = replace(
            result,
            pattern: #"<(?:meta|link|base|input|button)\b[^>]*/?\s*>"#,
            with: ""
        )
        if let body = firstCapture(
            result,
            pattern: #"<body\b[^>]*>([\s\S]*)</body\s*>"#
        ) {
            result = body
        }
        result = replace(result, pattern: #"<\s*b\b[^>]*>"#, with: "<strong>")
        result = replace(result, pattern: #"</\s*b\s*>"#, with: "</strong>")
        result = replace(result, pattern: #"<\s*i\b[^>]*>"#, with: "<em>")
        result = replace(result, pattern: #"</\s*i\s*>"#, with: "</em>")
        result = replace(result, pattern: #"<\s*strike\b[^>]*>"#, with: "<s>")
        result = replace(result, pattern: #"</\s*strike\s*>"#, with: "</s>")
        result = convertStyledSpans(result)
        result = replace(
            result,
            pattern: #"</?(?!(?:a|blockquote|br|em|li|ol|p|s|strong|u|ul)\b)[a-zA-Z][^>]*>"#,
            with: ""
        )

        let simpleTags = ["blockquote", "br", "em", "li", "ol", "p", "s", "strong", "u", "ul"]
        for tag in simpleTags {
            result = replace(
                result,
                pattern: #"<\#(tag)\b[^>]*>"#,
                with: "<\(tag)>"
            )
        }
        result = sanitizeOutgoingLinks(result)
        result = replace(
            result,
            pattern: #"\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)"#,
            with: ""
        )
        return result
    }

    public static func document(for html: String) -> String {
        let sanitized = sanitizeIncoming(html)
        return """
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="color-scheme" content="light dark">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src 'none'; media-src 'none'; connect-src 'none'; frame-src 'none';">
          <style>
            :root { color-scheme: light dark; }
            body {
              margin: 0;
              padding: 20px 24px 36px;
              overflow-wrap: anywhere;
              font: 15px/1.55 -apple-system, BlinkMacSystemFont, sans-serif;
              color: CanvasText;
              background: Canvas;
            }
            img { max-width: 100%; height: auto; }
            blockquote { border-left: 3px solid color-mix(in srgb, CanvasText 20%, transparent); margin-left: 0; padding-left: 14px; }
            pre { white-space: pre-wrap; }
            a { color: LinkText; }
          </style>
        </head>
        <body>\(sanitized)</body>
        </html>
        """
    }

    public static func plainTextToHTML(_ text: String) -> String {
        escape(text).replacingOccurrences(of: "\n", with: "<br>")
    }

    public static func escape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }

    private static func replace(_ input: String, pattern: String, with replacement: String) -> String {
        guard let expression = try? NSRegularExpression(
            pattern: pattern,
            options: [.caseInsensitive]
        ) else {
            return input
        }
        let range = NSRange(input.startIndex..., in: input)
        return expression.stringByReplacingMatches(
            in: input,
            range: range,
            withTemplate: replacement
        )
    }

    private static func firstCapture(_ input: String, pattern: String) -> String? {
        guard let expression = try? NSRegularExpression(
            pattern: pattern,
            options: [.caseInsensitive]
        ) else {
            return nil
        }
        let range = NSRange(input.startIndex..., in: input)
        guard let match = expression.firstMatch(in: input, range: range),
              let capture = Range(match.range(at: 1), in: input) else {
            return nil
        }
        return String(input[capture])
    }

    private static func convertStyledSpans(_ input: String) -> String {
        guard let expression = try? NSRegularExpression(
            pattern: #"<span\b([^>]*)>([^<]*)</span\s*>"#,
            options: [.caseInsensitive]
        ) else {
            return input
        }
        var result = input
        while true {
            let range = NSRange(result.startIndex..., in: result)
            guard let match = expression.firstMatch(in: result, range: range),
                  let fullRange = Range(match.range, in: result),
                  let attributeRange = Range(match.range(at: 1), in: result),
                  let contentRange = Range(match.range(at: 2), in: result) else {
                break
            }
            let attributes = String(result[attributeRange]).lowercased()
            var content = String(result[contentRange])
            if attributes.contains("font-weight: bold")
                || attributes.contains("font-weight:bold")
                || attributes.contains("font-weight: 700") {
                content = "<strong>\(content)</strong>"
            }
            if attributes.contains("font-style: italic")
                || attributes.contains("font-style:italic") {
                content = "<em>\(content)</em>"
            }
            if attributes.contains("text-decoration: underline")
                || attributes.contains("text-decoration:underline") {
                content = "<u>\(content)</u>"
            }
            result.replaceSubrange(fullRange, with: content)
        }
        result = replace(result, pattern: #"</?span\b[^>]*>"#, with: "")
        return result
    }

    private static func sanitizeOutgoingLinks(_ input: String) -> String {
        guard let expression = try? NSRegularExpression(
            pattern: #"<a\b([^>]*)>"#,
            options: [.caseInsensitive]
        ) else {
            return input
        }
        var result = input
        let matches = expression.matches(
            in: input,
            range: NSRange(input.startIndex..., in: input)
        )
        for match in matches.reversed() {
            guard let fullRange = Range(match.range, in: result),
                  let attributeRange = Range(match.range(at: 1), in: result) else {
                continue
            }
            let attributes = String(result[attributeRange])
            let href = firstCapture(
                attributes,
                pattern: #"\bhref\s*=\s*["']([^"']+)["']"#
            )
            let safeHref: String?
            if let href,
               let url = URL(string: href),
               ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") {
                safeHref = href
            } else {
                safeHref = nil
            }
            let replacement = safeHref.map {
                #"<a href="\#(escapeAttribute($0))" target="_blank" rel="noopener noreferrer">"#
            } ?? "<a>"
            result.replaceSubrange(fullRange, with: replacement)
        }
        return result
    }

    private static func escapeAttribute(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }
}
