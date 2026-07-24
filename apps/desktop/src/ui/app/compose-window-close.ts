export function requestComposeWindowClose(root: ParentNode | null) {
  if (!root) {
    return false;
  }

  const cancelButton = Array.from(
    root.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
  ).find(
    (button) => !button.disabled && button.textContent?.trim() === 'Cancel',
  );

  if (!cancelButton) {
    return false;
  }

  cancelButton.click();
  return true;
}
