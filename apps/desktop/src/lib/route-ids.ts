const encodedPrefix = 'id_';
const readableRouteIds = new Set([
  'inbox',
  'drafts',
  'sentitems',
  'archive',
  'deleteditems',
  'junkemail',
]);

export function encodeRouteId(id: string) {
  if (readableRouteIds.has(id)) {
    return id;
  }

  return `${encodedPrefix}${bytesToBase64Url(new TextEncoder().encode(id))}`;
}

export function decodeRouteId(routeId: string | undefined) {
  if (!routeId) {
    return undefined;
  }

  if (!routeId.startsWith(encodedPrefix)) {
    return routeId;
  }

  return new TextDecoder().decode(
    base64UrlToBytes(routeId.slice(encodedPrefix.length)),
  );
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function base64UrlToBytes(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
