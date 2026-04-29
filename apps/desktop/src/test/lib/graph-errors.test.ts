import { describe, expect, it } from 'vitest';
import { isGraphItemNotFoundError } from '../../lib/graph-errors';

describe('isGraphItemNotFoundError', () => {
  it('detects Microsoft Graph item not found errors', () => {
    expect(
      isGraphItemNotFoundError(
        new Error(
          'Microsoft Graph request failed: 404 {"error":{"code":"ErrorItemNotFound","message":"The specified object was not found in the store."}}',
        ),
      ),
    ).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isGraphItemNotFoundError(new Error('Network failed'))).toBe(false);
  });
});
