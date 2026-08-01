/** Return whether a global viewer shortcut may act while this element owns focus. */
export function allowsViewerGlobalShortcut(activeElement) {
  if (!activeElement) return true;
  const tagName = String(activeElement.tagName || "").toUpperCase();
  if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tagName)) return false;
  return !activeElement.isContentEditable;
}
