import { decodeRouteId } from '../route-ids';

export function parseMailPath(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);

  return {
    folderId:
      parts[0] === 'mail' && parts[1]
        ? decodeRouteId(parts[1]) ?? 'inbox'
        : 'inbox',
    messageId: parts[0] === 'mail' ? decodeRouteId(parts[2]) : undefined,
  };
}

export function getInitials(name: string) {
  const initials = name
    .split(/[\s-]+/)
    .map((part) => part.match(/\p{L}/u)?.[0])
    .filter(Boolean);

  return [initials[0], initials.length > 1 ? initials.at(-1) : undefined]
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function formatMailDate(value: string, style: 'short' | 'long') {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  if (style === 'short') {
    return formatShortMailDate(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(date);
}

function formatShortMailDate(date: Date) {
  const now = new Date();

  if (isSameLocalDay(date, now)) {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  const dayMonth = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
  }).format(date);

  if (date.getFullYear() !== now.getFullYear()) {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  const weekday = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
  }).format(date);

  return `${weekday} ${dayMonth}`;
}

function isSameLocalDay(date: Date, otherDate: Date) {
  return (
    date.getFullYear() === otherDate.getFullYear() &&
    date.getMonth() === otherDate.getMonth() &&
    date.getDate() === otherDate.getDate()
  );
}
