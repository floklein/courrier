import type { NavigateOptions } from '@tanstack/react-router';
import { parseMailPath } from './mail-utils';

function currentPathnameFromHash(): string {
  const raw = window.location.hash.replace(/^#/, '');
  const path = raw.split('?')[0] ?? '';

  if (!path || path === '/') {
    return '/';
  }

  return path.startsWith('/') ? path : `/${path}`;
}

export function resetMailRouteAfterActiveAccountChanged(
  navigate: (opts: NavigateOptions) => void,
) {
  const { messageId } = parseMailPath(currentPathnameFromHash());

  if (!messageId) {
    return;
  }

  navigate({
    to: '/mail/$folderId',
    params: { folderId: 'inbox' },
    replace: true,
  });
}
