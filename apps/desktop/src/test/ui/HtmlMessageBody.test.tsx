import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HtmlMessageBody } from '@/ui/mail/HtmlMessageBody';

vi.mock('virtual:darkreader-script', () => ({
  default: '',
}));

vi.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

describe('HtmlMessageBody', () => {
  it('keeps safe mail images while stripping CSS image trackers', () => {
    render(
      <HtmlMessageBody
        bodyContent={
          '<p style="background:url(https://tracker.example/pixel)">Hello</p><img src="https://cdn.example/image.png" srcset="https://tracker.example/2x.png 2x" alt="pixel"><a href="https://example.com">link</a>'
        }
        isMailDragActive={false}
        title="Message body"
      />,
    );

    const frame = screen.getByTitle('Message body') as HTMLIFrameElement;

    expect(frame.srcdoc).toContain('Hello');
    expect(frame.srcdoc).toContain('href="https://example.com"');
    expect(frame.srcdoc).toContain('src="https://cdn.example/image.png"');
    expect(frame.srcdoc).not.toContain('tracker.example');
    expect(frame.srcdoc).toContain('img-src http: https: data: cid:');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.style.height).toBe('70vh');
    expect(frame.style.minHeight).toBe('320px');
  });

  it('removes unsupported image sources', () => {
    render(
      <HtmlMessageBody
        bodyContent={
          '<img src="javascript:alert(1)" alt="bad"><img src="file:///tmp/image.png" alt="local"><img src="cid:logo@example.com" alt="inline">'
        }
        isMailDragActive={false}
        title="Message body"
      />,
    );

    const frame = screen.getByTitle('Message body') as HTMLIFrameElement;

    expect(frame.srcdoc).not.toContain('javascript:');
    expect(frame.srcdoc).not.toContain('file:///tmp/image.png');
    expect(frame.srcdoc).toContain('src="cid:logo@example.com"');
  });
});
