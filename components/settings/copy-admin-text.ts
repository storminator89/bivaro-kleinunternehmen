/** Copy an explicitly requested value, including from installations served over LAN HTTP. */
export async function copyAdminText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // The browser may allow the user-initiated legacy copy path instead.
    }
  }

  const focusedElement = document.activeElement;
  const copyInput = document.createElement('textarea');
  copyInput.value = text;
  copyInput.setAttribute('readonly', '');
  copyInput.setAttribute('aria-hidden', 'true');
  copyInput.style.position = 'fixed';
  copyInput.style.left = '-9999px';
  copyInput.style.top = '0';
  document.body.appendChild(copyInput);

  try {
    copyInput.select();
    if (!document.execCommand('copy')) {
      throw new Error('Clipboard access unavailable');
    }
  } finally {
    copyInput.remove();
    if (focusedElement instanceof HTMLElement) focusedElement.focus({ preventScroll: true });
  }
}
