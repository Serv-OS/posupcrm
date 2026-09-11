/* Cmd+Enter (Mac) or Ctrl+Enter sends.
 *
 * Plain Enter and Shift+Enter must stay new lines: an Enter that posted a
 * half-written note was the bug. Nothing fires while an IME is composing, where
 * Enter confirms a character rather than meaning "send".
 */
export const isSubmitKey = (e) =>
  !!e && e.key === 'Enter' && !!(e.metaKey || e.ctrlKey) && !(e.nativeEvent?.isComposing ?? e.isComposing);

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');

/** The shortcut as the person's own keyboard labels it. */
export const SUBMIT_HINT = isMac ? '⌘+Enter' : 'Ctrl+Enter';
