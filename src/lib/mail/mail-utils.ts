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
  return name
    .split(' ')
    .map((part) => part[0])
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

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: style === 'short' ? 'medium' : 'full',
    timeStyle: style === 'short' ? undefined : 'short',
  }).format(date);
}
