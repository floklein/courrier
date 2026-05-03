import DP from 'dompurify';
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
  const entries = splitRecipientEntries(value)
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

export function serializeRecipients(
  recipients: MailComposeRecipient[],
  pendingValue = '',
) {
  return [...recipients.map(formatRecipient), pendingValue.trim()]
    .filter(Boolean)
    .join(', ');
}

export function sanitizeOutgoingMailHtml(html: string) {
  return DP.sanitize(html, {
    ALLOWED_TAGS: outgoingMailTags,
    ALLOWED_ATTR: outgoingMailAttributes,
    ALLOW_DATA_ATTR: false,
  });
}

function formatRecipient(recipient: MailComposeRecipient) {
  if (!recipient.name) {
    return recipient.email;
  }

  const escapedName = recipient.name.replaceAll('"', '\\"');
  return `"${escapedName}" <${recipient.email}>`;
}

function parseRecipient(value: string): MailComposeRecipient | undefined {
  const namedMatch = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  const name = namedMatch?.[1]?.replace(/^"|"$/g, '').replaceAll('\\"', '"').trim();
  const email = (namedMatch?.[2] ?? value).trim();

  if (!isValidEmail(email)) {
    return undefined;
  }

  return name ? { name, email } : { email };
}

function isValidEmail(value: string) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

function splitRecipientEntries(value: string) {
  const entries: string[] = [];
  let current = '';
  let isEscaped = false;
  let isQuoted = false;
  let angleDepth = 0;

  for (const character of value) {
    if (isEscaped) {
      current += character;
      isEscaped = false;
      continue;
    }

    if (character === '\\' && isQuoted) {
      current += character;
      isEscaped = true;
      continue;
    }

    if (character === '"') {
      isQuoted = !isQuoted;
      current += character;
      continue;
    }

    if (!isQuoted && character === '<') {
      angleDepth += 1;
      current += character;
      continue;
    }

    if (!isQuoted && character === '>' && angleDepth > 0) {
      angleDepth -= 1;
      current += character;
      continue;
    }

    if (!isQuoted && angleDepth === 0 && /[;,]/.test(character)) {
      entries.push(current);
      current = '';
      continue;
    }

    current += character;
  }

  entries.push(current);
  return entries;
}
