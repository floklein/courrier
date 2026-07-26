using System.Text.RegularExpressions;
using Courrier.Windows.Models;
using MimeKit;

namespace Courrier.Windows.Services.Mail;

public static partial class RecipientParser
{
    public static (IReadOnlyList<MailRecipient> Valid, IReadOnlyList<string> Invalid) Parse(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return ([], []);
        }

        var valid = new List<MailRecipient>();
        var invalid = new List<string>();
        foreach (var entry in Split(value))
        {
            try
            {
                if (MailboxAddress.TryParse(entry, out var address) &&
                    EmailPattern().IsMatch(address.Address))
                {
                    valid.Add(new MailRecipient(
                        address.Address,
                        string.IsNullOrWhiteSpace(address.Name) ? null : address.Name));
                }
                else
                {
                    invalid.Add(entry);
                }
            }
            catch (ParseException)
            {
                invalid.Add(entry);
            }
        }

        return (valid, invalid);
    }

    private static IReadOnlyList<string> Split(string value)
    {
        var entries = new List<string>();
        var current = new System.Text.StringBuilder();
        var quoted = false;
        var escaped = false;
        var angleDepth = 0;
        foreach (var character in value)
        {
            if (escaped)
            {
                current.Append(character);
                escaped = false;
                continue;
            }

            if (character == '\\' && quoted)
            {
                current.Append(character);
                escaped = true;
                continue;
            }

            if (character == '"')
            {
                quoted = !quoted;
                current.Append(character);
                continue;
            }

            if (!quoted && character == '<')
            {
                angleDepth++;
            }
            else if (!quoted && character == '>' && angleDepth > 0)
            {
                angleDepth--;
            }

            if (!quoted && angleDepth == 0 && character is ',' or ';')
            {
                Add(entries, current);
                continue;
            }

            current.Append(character);
        }

        Add(entries, current);
        return entries;
    }

    private static void Add(ICollection<string> entries, System.Text.StringBuilder value)
    {
        var entry = value.ToString().Trim();
        if (entry.Length > 0)
        {
            entries.Add(entry);
        }
        value.Clear();
    }

    [GeneratedRegex(@"^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$", RegexOptions.IgnoreCase)]
    private static partial Regex EmailPattern();
}

