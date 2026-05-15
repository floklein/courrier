import type { NavigateOptions } from '@tanstack/react-router';

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
  const pathname = currentPathnameFromHash();

  if (!pathname.startsWith('/mail')) {
    return;
  }

  navigate({
    to: '/mail/$folderId',
    params: { folderId: 'inbox' },
    replace: true,
  });
}
