import { describe, expect, it } from 'vitest';
import { getValidatedMessagePageUrl } from './graph-client';

describe('Graph message pagination URL validation', () => {
  it('accepts next links for the selected folder messages collection', () => {
    const folderId = 'AAMkAGI2T/abc+def=';
    const nextLink =
      'https://graph.microsoft.com/v1.0/me/mailFolders/AAMkAGI2T%2Fabc%2Bdef%3D/messages?$top=25&$skiptoken=next';

    expect(getValidatedMessagePageUrl(folderId, nextLink)).toBe(nextLink);
  });

  it('rejects arbitrary Graph URLs from the renderer', () => {
    expect(() =>
      getValidatedMessagePageUrl(
        'inbox',
        'https://graph.microsoft.com/v1.0/me/messages?$top=25',
      ),
    ).toThrow('Refusing to fetch an unexpected Microsoft Graph page URL.');
  });

  it('rejects next links for a different folder', () => {
    expect(() =>
      getValidatedMessagePageUrl(
        'inbox',
        'https://graph.microsoft.com/v1.0/me/mailFolders/archive/messages?$top=25',
      ),
    ).toThrow('Refusing to fetch an unexpected Microsoft Graph page URL.');
  });
});
