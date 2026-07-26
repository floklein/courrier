using Courrier.Windows.Models;

namespace Courrier.Windows.Services.Mail;

public static class FolderOrdering
{
    private static readonly FolderKind[] KindOrder =
    [
        FolderKind.Inbox,
        FolderKind.Drafts,
        FolderKind.Sent,
        FolderKind.Archive,
        FolderKind.Junk,
        FolderKind.Trash,
        FolderKind.Starred,
        FolderKind.Important,
        FolderKind.Folder
    ];

    public static IReadOnlyList<MailFolder> Sort(IEnumerable<MailFolder> folders)
    {
        var source = folders.ToList();
        var byId = source.ToDictionary(folder => folder.Id);
        var children = source
            .Where(folder =>
                folder.ParentFolderId is not null &&
                byId.ContainsKey(folder.ParentFolderId))
            .GroupBy(folder => folder.ParentFolderId!)
            .ToDictionary(group => group.Key, group => group.ToList());
        var roots = source
            .Where(folder =>
                folder.ParentFolderId is null ||
                !byId.ContainsKey(folder.ParentFolderId))
            .ToList();
        var output = new List<MailFolder>();
        var visited = new HashSet<string>(StringComparer.Ordinal);

        void Visit(MailFolder folder, int depth)
        {
            if (!visited.Add(folder.Id))
            {
                return;
            }

            output.Add(folder with { Depth = depth });
            if (children.TryGetValue(folder.Id, out var nested))
            {
                foreach (var child in SortSiblings(nested))
                {
                    Visit(child, depth + 1);
                }
            }
        }

        foreach (var root in SortSiblings(roots))
        {
            Visit(root, 0);
        }

        foreach (var orphan in SortSiblings(source.Where(folder => !visited.Contains(folder.Id))))
        {
            Visit(orphan, 0);
        }

        return output;
    }

    private static IEnumerable<MailFolder> SortSiblings(IEnumerable<MailFolder> folders)
    {
        return folders
            .OrderBy(folder => Array.IndexOf(KindOrder, folder.Kind))
            .ThenBy(folder => folder.Label, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(folder => folder.Id, StringComparer.Ordinal);
    }
}

