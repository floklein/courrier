import DOMPurify from 'dompurify';
import type { MailComposeRecipient } from '../mail-types';

const outgoingMailTags = [
  'a',
  'blockquote',
  'br',
  'em',
  'li',
  'ol',
  'p',
  's',
  'strong',
  'u',
  'ul',
];

const outgoingMailAttributes = ['href', 'rel', 'target'];

export function parseRecipients(value: string) {
  const entries = value
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const valid: MailComposeRecipient[] = [];
  const invalid: string[] = [];

  for (const entry of entries) {
    const recipient = parseRecipient(entry);

    if (!recipient) {
      invalid.push(entry);
      continue;
    }

    valid.push(recipient);
  }

  return { valid, invalid };
}

export function sanitizeOutgoingMailHtml(html: string) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: outgoingMailTags,
    ALLOWED_ATTR: outgoingMailAttributes,
    ALLOW_DATA_ATTR: false,
  });
}

function parseRecipient(value: string): MailComposeRecipient | undefined {
  const namedMatch = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  const name = namedMatch?.[1]?.replace(/^"|"$/g, '').trim();
  const email = (namedMatch?.[2] ?? value).trim();

  if (!isValidEmail(email)) {
    return undefined;
  }

  return name ? { name, email } : { email };
}

function isValidEmail(value: string) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}
