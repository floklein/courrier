import Foundation

public struct RecipientParseResult: Equatable, Sendable {
    public let valid: [MailAddress]
    public let invalid: [String]

    public init(valid: [MailAddress], invalid: [String]) {
        self.valid = valid
        self.invalid = invalid
    }
}

public enum RecipientParser {
    public static func parse(_ value: String) -> RecipientParseResult {
        var valid: [MailAddress] = []
        var invalid: [String] = []

        for entry in split(value).map({ $0.trimmingCharacters(in: .whitespacesAndNewlines) })
        where !entry.isEmpty {
            if let address = parseOne(entry) {
                if !valid.contains(where: { $0.email.caseInsensitiveCompare(address.email) == .orderedSame }) {
                    valid.append(address)
                }
            } else {
                invalid.append(entry)
            }
        }

        return RecipientParseResult(valid: valid, invalid: invalid)
    }

    public static func serialize(_ recipients: [MailAddress]) -> String {
        recipients.map { address in
            guard !address.name.isEmpty else { return address.email }
            let escapedName = address.name.replacingOccurrences(of: "\"", with: "\\\"")
            return "\"\(escapedName)\" <\(address.email)>"
        }.joined(separator: ", ")
    }

    private static func parseOne(_ value: String) -> MailAddress? {
        let pattern = #"^\s*(.*?)\s*<([^<>]+)>\s*$"#
        let range = NSRange(value.startIndex..., in: value)
        let expression = try? NSRegularExpression(pattern: pattern)
        let match = expression?.firstMatch(in: value, range: range)
        let email: String
        var name = ""

        if let match,
           let emailRange = Range(match.range(at: 2), in: value),
           let nameRange = Range(match.range(at: 1), in: value) {
            email = String(value[emailRange]).trimmingCharacters(in: .whitespaces)
            name = String(value[nameRange])
                .trimmingCharacters(in: CharacterSet(charactersIn: "\" "))
                .replacingOccurrences(of: "\\\"", with: "\"")
        } else {
            email = value.trimmingCharacters(in: .whitespaces)
        }

        guard isValidEmail(email) else { return nil }
        return MailAddress(name: name, email: email)
    }

    private static func isValidEmail(_ value: String) -> Bool {
        value.range(
            of: #"^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$"#,
            options: .regularExpression
        ) != nil
    }

    private static func split(_ value: String) -> [String] {
        var entries: [String] = []
        var current = ""
        var isQuoted = false
        var isEscaped = false
        var angleDepth = 0

        for character in value {
            if isEscaped {
                current.append(character)
                isEscaped = false
                continue
            }
            if character == "\\", isQuoted {
                current.append(character)
                isEscaped = true
                continue
            }
            if character == "\"" {
                isQuoted.toggle()
                current.append(character)
                continue
            }
            if character == "<", !isQuoted {
                angleDepth += 1
                current.append(character)
                continue
            }
            if character == ">", !isQuoted, angleDepth > 0 {
                angleDepth -= 1
                current.append(character)
                continue
            }
            if (character == "," || character == ";"), !isQuoted, angleDepth == 0 {
                entries.append(current)
                current = ""
                continue
            }
            current.append(character)
        }
        entries.append(current)
        return entries
    }
}

public enum SubjectFormatter {
    public static func reply(_ subject: String) -> String {
        prefixed(subject, prefix: "Re:")
    }

    public static func forward(_ subject: String) -> String {
        prefixed(subject, prefix: "Fwd:")
    }

    private static func prefixed(_ subject: String, prefix: String) -> String {
        let trimmed = subject.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.lowercased().hasPrefix(prefix.lowercased()) {
            return trimmed
        }
        return "\(prefix) \(trimmed)"
    }
}
