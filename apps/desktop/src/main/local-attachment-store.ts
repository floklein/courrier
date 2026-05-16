import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LocalMailAttachment } from '@/lib/mail-types';
import type { LocalAttachmentFile } from '@/main/mail-provider';

export interface RegisterLocalAttachmentInput {
  path: string;
  name?: string;
  contentType?: string;
  size?: number;
}

const maxAttachmentSizeBytes = 150 * 1024 * 1024;

export class LocalAttachmentStore {
  private readonly filesById = new Map<string, LocalAttachmentFile>();

  async registerFiles(
    files: RegisterLocalAttachmentInput[],
  ): Promise<LocalMailAttachment[]> {
    const attachments: LocalMailAttachment[] = [];

    for (const file of files) {
      const registered = await this.registerFile(file);
      attachments.push(toLocalMailAttachment(registered));
    }

    return attachments;
  }

  async resolveMany(attachments: LocalMailAttachment[]) {
    const files: LocalAttachmentFile[] = [];

    for (const attachment of attachments) {
      const file = this.filesById.get(attachment.id);

      if (!file) {
        throw new Error(`Attachment is no longer available: ${attachment.name}`);
      }

      const stat = await fs.stat(file.path);

      if (!stat.isFile()) {
        throw new Error(`Attachment is not a file: ${attachment.name}`);
      }

      if (stat.size > maxAttachmentSizeBytes) {
        throw new Error(`Attachment is too large: ${attachment.name}`);
      }

      files.push({ ...file, size: stat.size });
    }

    return files;
  }

  private async registerFile(input: RegisterLocalAttachmentInput) {
    const absolutePath = path.resolve(input.path);
    const stat = await fs.stat(absolutePath);

    if (!stat.isFile()) {
      throw new Error('Only files can be attached.');
    }

    if (stat.size > maxAttachmentSizeBytes) {
      throw new Error(`${path.basename(absolutePath)} exceeds the attachment limit.`);
    }

    const file: LocalAttachmentFile = {
      id: randomUUID(),
      name: input.name?.trim() || path.basename(absolutePath),
      contentType: input.contentType?.trim() || getContentType(absolutePath),
      size: input.size ?? stat.size,
      path: absolutePath,
    };

    this.filesById.set(file.id, file);
    return file;
  }
}

function toLocalMailAttachment(file: LocalAttachmentFile): LocalMailAttachment {
  return {
    id: file.id,
    name: file.name,
    contentType: file.contentType,
    size: file.size,
  };
}

function getContentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.csv': 'text/csv',
    '.gif': 'image/gif',
    '.htm': 'text/html',
    '.html': 'text/html',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.txt': 'text/plain',
    '.webp': 'image/webp',
    '.zip': 'application/zip',
  };

  return types[extension] ?? 'application/octet-stream';
}
