import { describe, it, expect, vi, afterEach } from "vitest";
import { toCSV, toAnkiTSV, deckFilename, downloadText } from "../src/lib/deckExport";

const CRLF = "\r\n";

describe("toCSV", () => {
  it("writes the Term,Definition header and one row per card", () => {
    const csv = toCSV([{ q: "Mitosis", a: "Cell division" }]);
    expect(csv).toBe(`Term,Definition${CRLF}Mitosis,Cell division${CRLF}`);
  });

  it("quotes fields containing commas", () => {
    const csv = toCSV([{ q: "Rome, Italy", a: "A city" }]);
    expect(csv.split(CRLF)[1]).toBe(`"Rome, Italy",A city`);
  });

  it("doubles embedded quotes and wraps the field (RFC 4180)", () => {
    const csv = toCSV([{ q: 'He said "hi"', a: "greeting" }]);
    expect(csv.split(CRLF)[1]).toBe(`"He said ""hi""",greeting`);
  });

  it("preserves newlines inside a field by quoting it", () => {
    const csv = toCSV([{ q: "Line one\nLine two", a: "multi" }]);
    // The quoted field keeps its raw newline, so the record spans two physical lines.
    expect(csv).toBe(`Term,Definition${CRLF}"Line one\nLine two",multi${CRLF}`);
    expect(csv).toContain('"Line one\nLine two"');
  });

  it("handles a field that is comma + quote + newline all at once", () => {
    const csv = toCSV([{ q: 'a,b"c\nd', a: "x" }]);
    expect(csv.split(CRLF)[1]).toBe(`"a,b""c\nd",x`);
  });

  it("emits an escaped title row above the header when a title is given", () => {
    const csv = toCSV([{ q: "t", a: "d" }], 'Media, "Society"');
    const [first, second] = csv.split(CRLF);
    expect(first).toBe(`"Media, ""Society"""`);
    expect(second).toBe("Term,Definition");
  });

  it("omits the title row for a blank/whitespace title", () => {
    expect(toCSV([{ q: "t", a: "d" }], "   ").split(CRLF)[0]).toBe("Term,Definition");
  });

  it("returns just the header for an empty deck", () => {
    expect(toCSV([])).toBe(`Term,Definition${CRLF}`);
    expect(toCSV(null)).toBe(`Term,Definition${CRLF}`);
    expect(toCSV(undefined)).toBe(`Term,Definition${CRLF}`);
  });

  it("treats missing q/a as empty fields rather than 'undefined'", () => {
    const csv = toCSV([{} as any]);
    expect(csv.split(CRLF)[1]).toBe(",");
  });
});

describe("toAnkiTSV", () => {
  it("writes one tab-separated card per line", () => {
    expect(toAnkiTSV([{ q: "a", a: "1" }, { q: "b", a: "2" }])).toBe("a\t1\nb\t2");
  });

  it("replaces tabs and newlines inside fields with spaces so records stay intact", () => {
    const tsv = toAnkiTSV([{ q: "one\ttwo", a: "line1\nline2\r\nline3" }]);
    expect(tsv).toBe("one two\tline1 line2 line3");
    expect(tsv.split("\n")).toHaveLength(1);
    expect(tsv.split("\t")).toHaveLength(2);
  });

  it("collapses runs of whitespace and trims the edges", () => {
    expect(toAnkiTSV([{ q: "  spaced   out  ", a: "\tdef\t" }])).toBe("spaced out\tdef");
  });

  it("does not quote or escape — plain text only", () => {
    expect(toAnkiTSV([{ q: 'He said "hi", ok', a: "y" }])).toBe('He said "hi", ok\ty');
  });

  it("returns an empty string for an empty deck", () => {
    expect(toAnkiTSV([])).toBe("");
    expect(toAnkiTSV(null)).toBe("");
  });
});

describe("deckFilename", () => {
  it("slugs a title with punctuation and an em dash", () => {
    expect(deckFilename("Media & Society — Day 5")).toBe("media-society-day-5.csv");
  });

  it("lowercases, collapses separators, and trims leading/trailing dashes", () => {
    expect(deckFilename("  ***PSYC 101:  Memory!!  ")).toBe("psyc-101-memory.csv");
  });

  it("strips diacritics", () => {
    expect(deckFilename("Café Naïve")).toBe("cafe-naive.csv");
  });

  it("honours a custom extension and normalises a leading dot", () => {
    expect(deckFilename("Bio 1", "txt")).toBe("bio-1.txt");
    expect(deckFilename("Bio 1", ".TXT")).toBe("bio-1.txt");
  });

  it("falls back to 'flashcards' for empty / unusable titles", () => {
    expect(deckFilename("")).toBe("flashcards.csv");
    expect(deckFilename(undefined)).toBe("flashcards.csv");
    expect(deckFilename("——  ")).toBe("flashcards.csv");
    expect(deckFilename("", "txt")).toBe("flashcards.txt");
  });

  it("caps the slug so the filename stays sane", () => {
    const name = deckFilename("word ".repeat(60));
    expect(name.length).toBeLessThanOrEqual(84);
    expect(name.endsWith("-.csv")).toBe(false);
  });
});

describe("downloadText", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates a blob URL, clicks an anchor, and revokes the URL", async () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    expect(downloadText("deck.csv", "text/csv", "Term,Definition\r\n")).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector("a[download]")).toBeNull(); // anchor cleaned up

    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:mock");
    vi.useRealTimers();
  });

  it("no-ops (returns false) when there is no object-URL support", () => {
    const original = URL.createObjectURL;
    // @ts-expect-error — simulating a non-browser environment
    URL.createObjectURL = undefined;
    try {
      expect(downloadText("deck.csv", "text/csv", "x")).toBe(false);
    } finally {
      URL.createObjectURL = original;
    }
  });
});
