/** Return whether a global viewer shortcut may act while this element owns focus. */
export function allowsViewerGlobalShortcut(activeElement) {
  if (!activeElement) return true;
  const tagName = String(activeElement.tagName || "").toUpperCase();
  if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tagName)) return false;
  return !activeElement.isContentEditable;
}

/** Ordinary buttons keep focus but do not own horizontal arrows. */
export function allowsViewerHorizontalArrow(event, activeElement, overlayOpen = false) {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key) || event.defaultPrevented
    || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey || overlayOpen) return false;
  if (!activeElement) return true;
  if (activeElement.isContentEditable) return false;
  const tag = String(activeElement.tagName || "").toUpperCase();
  if (["TEXTAREA", "SELECT", "AUDIO", "VIDEO"].includes(tag)) return false;
  if (tag === "INPUT" && !["button", "submit", "reset", "checkbox", "radio"].includes(String(activeElement.type).toLowerCase())) return false;
  return !activeElement.closest?.('[role="slider"], [role="spinbutton"], [role="combobox"], [role="listbox"], [role="menu"], [role="tree"]');
}

// These surfaces are conditionally mounted; native dialogs remain mounted when closed.
export const VIEWER_ARROW_OVERLAYS = 'dialog[open], [aria-modal="true"], .tag-modal-backdrop, .registry-create-backdrop, .tag-dropdown, .tag-create-popover, .context-menu, .chat-attachment-menu, .chat-options, .chat-history, .usage-menu';
