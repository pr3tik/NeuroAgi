// Pipe tables in chat replies — team-reported: "| Course | Grade |" rows rendered as
// raw text in Reggie bubbles. renderMessageHTML must emit a real <table>.
import { describe, it, expect } from "vitest";
import { renderMessageHTML } from "../src/lib/markdown";

const TABLE = [
  "| Course | Name | Grade |",
  "|--------|------|-------|",
  "| MDSB20H3 | Media, Science and Technology Studies | — |",
  "| MDSC26H3 | Media, Technology & Disability Justice | — |",
].join("\n");

describe("renderMessageHTML — pipe tables", () => {
  it("renders a pipe table as a real <table> (no raw pipes leaking)", () => {
    const out = renderMessageHTML(TABLE);
    expect(out).toContain("<table");
    expect((out.match(/<th /g) ?? []).length).toBe(3);
    expect((out.match(/<tr>/g) ?? []).length).toBe(3);       // 1 header row + 2 body rows
    expect(out).not.toMatch(/\| Course/);                     // no raw header line
    expect(out).toContain("MDSC26H3");
  });

  it("keeps escaping (cells can't inject HTML) and leaves normal text alone", () => {
    const out = renderMessageHTML("| a | b |\n|---|---|\n| <img x> | ok |");
    expect(out).toContain("&lt;img x&gt;");
    const plain = renderMessageHTML("just a | pipe in a sentence");
    expect(plain).not.toContain("<table");
  });

  it("renders text around the table normally", () => {
    const out = renderMessageHTML("Here are your grades:\n\n" + TABLE + "\n\nLet me know!");
    expect(out).toContain("<table");
    expect(out).toContain("Here are your grades:");
    expect(out).toContain("Let me know!");
  });
});
