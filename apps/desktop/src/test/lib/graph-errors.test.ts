import { describe, expect, it } from 'vitest';
import {
  GraphRequestError,
  isGoogleInvalidMessageIdError,
  isGraphItemNotFoundError,
  isMicrosoftSignInRequiredError,
} from '@/lib/graph-errors';

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

  it('detects typed Microsoft Graph item not found errors', () => {
    const error = new GraphRequestError({
      body: '{"error":{"code":"ErrorItemNotFound"}}',
      code: 'ErrorItemNotFound',
      message: 'Not found',
      status: 404,
    });

    expect(error.name).toBe('GraphRequestError');
    expect(error.body).toBe('{"error":{"code":"ErrorItemNotFound"}}');
    expect(isGraphItemNotFoundError(error)).toBe(true);
  });

  it('ignores typed Microsoft Graph errors with other status or code values', () => {
    expect(
      isGraphItemNotFoundError(
        new GraphRequestError({
          body: '{}',
          code: 'ErrorItemNotFound',
          message: 'Server error',
          status: 500,
        }),
      ),
    ).toBe(false);
    expect(
      isGraphItemNotFoundError(
        new GraphRequestError({
          body: '{}',
          code: 'ErrorAccessDenied',
          message: 'Denied',
          status: 404,
        }),
      ),
    ).toBe(false);
  });
});

describe('isMicrosoftSignInRequiredError', () => {
  it('detects provider sign-in required messages', () => {
    expect(
      isMicrosoftSignInRequiredError(new Error('Microsoft sign-in is required.')),
    ).toBe(true);
    expect(isMicrosoftSignInRequiredError('Google sign-in is required.')).toBe(
      true,
    );
    expect(isMicrosoftSignInRequiredError('Sign-in is required.')).toBe(true);
  });

  it('ignores unrelated messages', () => {
    expect(isMicrosoftSignInRequiredError('Refresh failed')).toBe(false);
  });
});

describe('isGoogleInvalidMessageIdError', () => {
  it('detects Google invalid message id errors', () => {
    expect(
      isGoogleInvalidMessageIdError(
        new Error('Google API request failed: Invalid id value'),
      ),
    ).toBe(true);
  });

  it('requires both the Google API prefix and invalid id detail', () => {
    expect(isGoogleInvalidMessageIdError('Invalid id value')).toBe(false);
    expect(isGoogleInvalidMessageIdError('Google API request failed: quota')).toBe(
      false,
    );
  });
});
