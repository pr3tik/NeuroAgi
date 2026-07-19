// @vitest-environment node
// Regression for the RAG "binary chunks" bug: api/lms-ingest.ts sent file_type as a BARE extension
// ("ppt","jpg","docx") but extract.ts's dispatch required a leading dot (\.ppt\b, \.(jpe?g)\b), so
// legacy .ppt / images / .docx fell through to the plain-text fallback and their binary bytes were
// stored as UTF-8 mojibake. These pin the two fixes: bare-extension normalization + the binary guard.
import { describe, it, expect } from "vitest";
import { resolveExtHint, looksBinaryText } from "../api/extract.ts";

// Mirror the exact dispatch predicates in api/extract.ts's handler.
const routeOf = (ext: string): string => {
  if (ext.includes("pdf")) return "pdf";
  if (/wordprocessingml|\.docx\b/.test(ext)) return "docx";
  if (/presentationml|\.pptx\b/.test(ext)) return "pptx";
  if (/ms-powerpoint|\.ppt\b/.test(ext)) return "ppt";      // legacy OLE2
  if (/^zip$|\.zip\b|application\/zip/.test(ext)) return "zip";
  if (/image\/|\.(png|jpe?g|webp|gif|bmp|tiff?)\b/.test(ext)) return "image";
  if (/audio\/|video\/|\.(mp3|wav|m4a|mp4|mov|webm)\b/.test(ext)) return "media";
  return "text-fallback";
};

describe("resolveExtHint — bare extensions route to the real extractor (the bug)", () => {
  it("bare LMS extensions no longer fall through to the binary→text fallback", () => {
    // Before the fix these all returned "text-fallback" → mojibake in rag_chunks.
    expect(routeOf(resolveExtHint("ppt", "Chapter_01.ppt"))).toBe("ppt");
    expect(routeOf(resolveExtHint("jpg", "7.10.jpg"))).toBe("image");
    expect(routeOf(resolveExtHint("docx", "notes.docx"))).toBe("docx");
    expect(routeOf(resolveExtHint("pptx", "deck.pptx"))).toBe("pptx");
    expect(routeOf(resolveExtHint("pdf", "reading.pdf"))).toBe("pdf");
  });

  it("legacy .ppt and modern .pptx never collide", () => {
    expect(routeOf(resolveExtHint("ppt"))).toBe("ppt");
    expect(routeOf(resolveExtHint("pptx"))).toBe("pptx");
  });

  it("MIME strings pass through untouched", () => {
    expect(routeOf(resolveExtHint("image/jpeg", "x"))).toBe("image");
    expect(routeOf(resolveExtHint("application/vnd.ms-powerpoint", "x"))).toBe("ppt");
    expect(routeOf(resolveExtHint("application/pdf", "x"))).toBe("pdf");
  });

  it("falls back to the filename only when file_type is absent", () => {
    expect(routeOf(resolveExtHint("", "Chapter_01.ppt"))).toBe("ppt");
    expect(routeOf(resolveExtHint(undefined, "photo.jpeg"))).toBe("image");
  });

  it("genuine text still routes to the fallback", () => {
    expect(routeOf(resolveExtHint("txt", "notes.txt"))).toBe("text-fallback");
    expect(routeOf(resolveExtHint("md", "readme.md"))).toBe("text-fallback");
  });
});

describe("looksBinaryText — the safety net that stops garbage being ingested", () => {
  it("flags legacy-office / binary mojibake (the observed corruption)", () => {
    const garbage = "r}3������\"0uu6��}G�_���?�o�F";
    expect(looksBinaryText(garbage)).toBe(true);
  });

  it("flags content with NUL / control bytes", () => {
    expect(looksBinaryText("abc\x00\x01\x02\x03\x04\x05\x06\x07def")).toBe(true);
  });

  it("passes real prose and code through", () => {
    expect(looksBinaryText("The midterm exam is on October 24 and covers weeks 1-6.")).toBe(false);
    expect(looksBinaryText("function f(x){ return x + 1; }\nconst y = f(2);")).toBe(false);
  });

  it("tolerates the occasional accented character in clean text", () => {
    expect(looksBinaryText("Résumé critique with a TA — café, naïve, coöperate. ".repeat(4))).toBe(false);
  });

  it("does not flag empty / tiny strings", () => {
    expect(looksBinaryText("")).toBe(false);
    expect(looksBinaryText("hi")).toBe(false);
  });
});
