import { describe, expect, it } from 'vitest';
import {
  parseRecipients,
  sanitizeOutgoingMailHtml,
} from '../../../lib/mail/mail-compose-utils';

describe('mail compose utilities', () => {
  describe('parseRecipients', () => {
    it('parses bare emails and named recipients split by comma or semicolon', () => {
      expect(
        parseRecipients(
          'ada@example.com; Grace Hopper <grace@example.com>, "Alan Turing" <alan@example.com>',
        ),
      ).toEqual({
        valid: [
          { email: 'ada@example.com' },
          { name: 'Grace Hopper', email: 'grace@example.com' },
          { name: 'Alan Turing', email: 'alan@example.com' },
        ],
        invalid: [],
      });
    });

    it('keeps valid recipients while reporting invalid tokens', () => {
      expect(
        parseRecipients('ada@example.com, invalid-recipient; Bad <missing-at>'),
      ).toEqual({
        valid: [{ email: 'ada@example.com' }],
        invalid: ['invalid-recipient', 'Bad <missing-at>'],
      });
    });

    it('ignores empty separators', () => {
      expect(parseRecipients(' ada@example.com, ; ; grace@example.com ')).toEqual({
        valid: [{ email: 'ada@example.com' }, { email: 'grace@example.com' }],
        invalid: [],
      });
    });
  });

  describe('sanitizeOutgoingMailHtml', () => {
    it('keeps supported formatting and link attributes', () => {
      const html = sanitizeOutgoingMailHtml(
        '<p>Hello <strong>world</strong></p><ul><li>One</li></ul><a href="https://example.com" target="_blank" rel="noreferrer">site</a>',
      );

      expect(html).toContain('<p>Hello <strong>world</strong></p>');
      expect(html).toContain('<ul><li>One</li></ul>');
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noreferrer"');
    });

    it('removes executable or unsupported markup before sending', () => {
      const html = sanitizeOutgoingMailHtml(
        '<p style="color:red" data-id="1" onclick="alert(1)">Hello</p><script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://example.com"></iframe><svg><circle /></svg>',
      );

      expect(html).toContain('<p>Hello</p>');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<iframe');
      expect(html).not.toContain('<svg');
      expect(html).not.toContain('style=');
      expect(html).not.toContain('data-id=');
      expect(html).not.toContain('onclick=');
      expect(html).not.toContain('onerror=');
    });

    it('removes unsafe link targets while preserving link text', () => {
      const html = sanitizeOutgoingMailHtml(
        '<a href="javascript:alert(1)" target="_blank">open</a>',
      );

      expect(html).toContain('<a target="_blank">open</a>');
      expect(html).not.toContain('javascript:');
    });
  });
});
