import { describe, expect, it } from 'vitest';
import { decodeRouteId, encodeRouteId } from '../../lib/route-ids';

describe('mail route ids', () => {
  it('encodes opaque Outlook ids without path separators', () => {
    const id = 'AAMkAGI2T/abc+def=';

    const encoded = encodeRouteId(id);

    expect(encoded).not.toContain('/');
    expect(decodeRouteId(encoded)).toBe(id);
  });

  it('keeps legacy well-known route ids readable', () => {
    expect(encodeRouteId('inbox')).toBe('inbox');
    expect(decodeRouteId('inbox')).toBe('inbox');
  });
});
