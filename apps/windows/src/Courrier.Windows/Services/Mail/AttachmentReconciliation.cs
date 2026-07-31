using Courrier.Windows.Models;

namespace Courrier.Windows.Services.Mail;

public static class AttachmentReconciliation
{
    public static AttachmentReconciliationPlan Plan(
        IReadOnlyList<ProviderAttachmentDescriptor> existing,
        IReadOnlyList<LocalAttachment> requested)
    {
        var unmatchedExisting = existing.ToList();
        var uploads = new List<LocalAttachment>();
        foreach (var attachment in requested)
        {
            var signature = Signature(
                attachment.Name,
                attachment.ContentType,
                attachment.Size);
            var existingIndex = unmatchedExisting.FindIndex(item =>
                Signature(item.Name, item.ContentType, item.Size) == signature);
            if (existingIndex >= 0)
            {
                unmatchedExisting.RemoveAt(existingIndex);
            }
            else
            {
                uploads.Add(attachment);
            }
        }
        return new AttachmentReconciliationPlan(
            unmatchedExisting.Select(item => item.Id).ToList(),
            uploads);
    }

    private static string Signature(string name, string contentType, long size)
    {
        return $"{name}\u001f{contentType}\u001f{size}";
    }
}

public sealed record ProviderAttachmentDescriptor(
    string Id,
    string Name,
    string ContentType,
    long Size);

public sealed record AttachmentReconciliationPlan(
    IReadOnlyList<string> DeleteIds,
    IReadOnlyList<LocalAttachment> Uploads);
