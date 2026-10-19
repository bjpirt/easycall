/** Escapes text for use in HTML content or a double-quoted attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/[&"<>]/g, (c) => `&#${String(c.charCodeAt(0))};`);
}
