import { describe, it, expect } from "vitest";
import { detectSourceType, htmlToText, buildPrompt, parseConnections } from "../src/lib/contentConnector";

describe("detectSourceType", () => {
  it("detects YouTube links (watch / youtu.be / shorts)", () => {
    expect(detectSourceType("https://www.youtube.com/watch?v=abc")).toBe("youtube");
    expect(detectSourceType("https://youtu.be/abc")).toBe("youtube");
    expect(detectSourceType("https://youtube.com/shorts/xyz")).toBe("youtube");
  });
  it("detects generic web URLs", () => {
    expect(detectSourceType("https://example.com/article")).toBe("url");
    expect(detectSourceType("http://blog.test/post")).toBe("url");
  });
  it("treats anything else as pasted text", () => {
    expect(detectSourceType("Newton's second law says F = ma")).toBe("text");
    expect(detectSourceType("")).toBe("text");
  });
});

describe("htmlToText", () => {
  const html = `
    <html><head>
      <title>SpaceX Raptor Engine</title>
      <meta property="og:description" content="How the Raptor uses thrust and mass flow." />
    </head><body>
      <script>var x = 1 < 2;</script>
      <style>.a{color:red}</style>
      <p>The engine produces thrust via F = ma &amp; conservation of momentum.</p>
    </body></html>`;

  it("pulls the title and strips script/style/tags", () => {
    const { title, text } = htmlToText(html);
    expect(title).toBe("SpaceX Raptor Engine");
    expect(text).not.toMatch(/<script|<style|var x/);
    expect(text).toContain("thrust");
    expect(text).toContain("F = ma & conservation"); // entity decoded
  });
  it("leads with the meta description when present", () => {
    expect(htmlToText(html).text.startsWith("How the Raptor uses thrust")).toBe(true);
  });
  it("caps length", () => {
    const big = "<p>" + "word ".repeat(5000) + "</p>";
    expect(htmlToText(big, 500).text.length).toBeLessThanOrEqual(500);
  });
});

describe("buildPrompt", () => {
  it("includes the content and the grounding passages", () => {
    const { system, user } = buildPrompt("Some rocket video", "Rockets 101", [
      { title: "Physics 201", heading: "Newton's Laws", text: "F = ma" },
    ]);
    expect(system).toMatch(/Content Connector/);
    expect(user).toContain("Some rocket video");
    expect(user).toContain('titled "Rockets 101"');
    expect(user).toContain("Physics 201");
  });
  it("notes when the student has no indexed materials", () => {
    const { user } = buildPrompt("text", undefined, []);
    expect(user).toMatch(/no course materials indexed/i);
  });
});

describe("parseConnections", () => {
  it("parses a clean JSON object", () => {
    const r = parseConnections('{"summary":"s","connections":[{"concept":"F=ma","course":"Physics 201","explanation":"e"}]}');
    expect(r.summary).toBe("s");
    expect(r.connections).toHaveLength(1);
    expect(r.connections[0]).toEqual({ concept: "F=ma", course: "Physics 201", explanation: "e" });
  });
  it("handles ```json fences and surrounding prose", () => {
    const raw = 'Here you go:\n```json\n{"summary":"x","connections":[{"concept":"a","course":"b","explanation":"c"}]}\n```';
    expect(parseConnections(raw).connections).toHaveLength(1);
  });
  it("drops empty connection entries", () => {
    const r = parseConnections('{"summary":"","connections":[{"concept":"","course":"","explanation":""},{"concept":"real","course":"x","explanation":"y"}]}');
    expect(r.connections).toHaveLength(1);
    expect(r.connections[0].concept).toBe("real");
  });
  it("returns an empty result on malformed / non-JSON output", () => {
    expect(parseConnections("no json here").connections).toEqual([]);
    expect(parseConnections("").connections).toEqual([]);
    expect(parseConnections("{ broken").connections).toEqual([]);
  });
});
