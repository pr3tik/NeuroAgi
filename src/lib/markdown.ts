// markdown.ts — Minimal, XSS-safe markdown→HTML for chat replies.
// Escapes &, <, > FIRST, so the output is safe to pass to dangerouslySetInnerHTML
// even though the text originates from an LLM. Handles bold, numbered/bulleted
// lists, and paragraph/line breaks — matching the tutor chat's renderer.
export function renderMessageHTML(text: string): string {
  let s = (text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Headings (#, ##, ### …) → bold heading line
  s = s.replace(/^#{1,6}\s+(.+)$/gm, '<p style="font-weight:650;margin:12px 0 4px">$1</p>');
  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Numbered list items
  s = s.replace(/^(\d+)\.\s+(.+)$/gm, '<p style="margin:3px 0;padding-left:2px">$1. $2</p>');
  // Bullet items (allow indentation — nested bullets flatten to one level)
  s = s.replace(/^\s*[-•]\s+(.+)$/gm, "<li>$1</li>");
  // Wrap runs of <li> in <ul>
  s = s.replace(/(<li>[\s\S]*?<\/li>)/g, m => (m.startsWith("<ul>") ? m : "<ul>" + m + "</ul>"));
  s = s.replace(/<\/ul>\s*<ul>/g, ""); // merge adjacent lists
  // Paragraph + line breaks
  s = s.replace(/\n\n/g, "</p><p>");
  s = s.replace(/\n/g, "<br/>");
  return "<p>" + s + "</p>";
}
