import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HtmlMessageBody } from '../../ui/mail/HtmlMessageBody';

vi.mock('virtual:darkreader-script', () => ({
  default: '',
}));

vi.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

describe('HtmlMessageBody', () => {
  it('strips remote resources from sanitized HTML mail', () => {
    render(
      <HtmlMessageBody
        bodyContent={
          '<p style="background:url(https://tracker.example/pixel)">Hello</p><img src="https://tracker.example/pixel.png" srcset="https://tracker.example/2x.png 2x" alt="pixel"><a href="https://example.com">link</a>'
        }
        isMailDragActive={false}
        title="Message body"
      />,
    );

    const frame = screen.getByTitle('Message body') as HTMLIFrameElement;

    expect(frame.srcdoc).toContain('Hello');
    expect(frame.srcdoc).toContain('href="https://example.com"');
    expect(frame.srcdoc).not.toContain('tracker.example');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  });
});
