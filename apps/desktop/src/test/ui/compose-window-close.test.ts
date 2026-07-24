import { describe, expect, it, vi } from 'vitest';
import { requestComposeWindowClose } from '@/ui/app/compose-window-close';

describe('compose window close request', () => {
  it('invokes the enabled composer Cancel control', () => {
    const root = document.createElement('main');
    root.innerHTML = `
      <button type="button">Cc</button>
      <button type="button">Cancel</button>
      <button type="submit">Send</button>
    `;
    const cancelButton = root.querySelectorAll('button')[1];
    const onCancel = vi.fn();
    cancelButton?.addEventListener('click', onCancel);

    expect(requestComposeWindowClose(root)).toBe(true);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('keeps the window open when the composer cannot currently close', () => {
    const root = document.createElement('main');
    root.innerHTML = '<button type="button" disabled>Cancel</button>';
    const onCancel = vi.fn();
    root.querySelector('button')?.addEventListener('click', onCancel);

    expect(requestComposeWindowClose(root)).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
    expect(requestComposeWindowClose(null)).toBe(false);
  });
});
