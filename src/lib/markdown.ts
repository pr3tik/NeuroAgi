// markdown.ts — Minimal, XSS-safe markdown→HTML for chat replies.
// Escapes &, <, > FIRST, so the output is safe to pass to dangerouslySetInnerHTML
// even though the text originates from an LLM. Handles bold, numbered/bulleted
// lists, pipe tables, and paragraph/line breaks — matching the tutor chat's renderer.

// GitHub-style pipe tables (| a | b | / |---|---| / rows…) → a real <table>.
// Must run BEFORE list/paragraph handling so the pipe rows aren't mangled into
// paragraphs (they rendered as raw "| Course | Grade |" lines in Reggie bubbles).
// Input is already entity-escaped, so cell content is safe.
function renderTables(s: string): string {
  const isRow = (l: string | undefined) => !!l && /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l: string | undefined) => !!l && /^\s*\|[\s\-:|]+\|\s*$/.test(l);
  const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
  const lines = s.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isRow(lines[i]) && isSep(lines[i + 1])) {
      const header = cells(lines[i]);
      let j = i + 2;
      const rows: string[][] = [];
      while (j < lines.length && isRow(lines[j]) && !isSep(lines[j])) { rows.push(cells(lines[j])); j++; }
      const cell = 'padding:6px 10px;border:1px solid rgba(255,255,255,0.1);text-align:left';
      const th = header.map(c => `<th style="${cell};font-weight:650">${c}</th>`).join("");
      const trs = rows.map(r => `<tr>${r.map(c => `<td style="${cell}">${c}</td>`).join("")}</tr>`).join("");
      out.push(`<div style="overflow-x:auto;margin:10px 0"><table style="border-collapse:collapse;width:100%;font-size:0.95em"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`);
      i = j - 1;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

export function renderMessageHTML(text: string): string {
  let s = (text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Tables first — pipe rows must not fall through to the paragraph/bullet passes.
  s = renderTables(s);
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
  // Paragraph + line breaks — but not INSIDE the table html we just emitted
  s = s.replace(/\n\n/g, "</p><p>");
  s = s.replace(/\n/g, "<br/>");
  return "<p>" + s + "</p>";
}
