// contentConnector.ts — pure logic for the Content Connector agent.
//
// The agent links external content a student is consuming (an article, a video, a pasted
// passage) to the concepts/courses they're actually studying. The DB read, the web fetch,
// the RAG query, and the LLM call all live in api/content-connector.ts; the pieces here
// are pure so they can be unit-tested: source detection, HTML→text, prompt assembly, and
// parsing the model's structured answer.

export type SourceType = "youtube" | "url" | "text";

export function detectSourceType(input: string): SourceType {
  const s = (input ?? "").trim();
  if (/youtu\.be\/|youtube\.com\/(watch|shorts|embed)/i.test(s)) return "youtube";
  if (/^https?:\/\/\S+$/i.test(s)) return "url";
  return "text";
}

// Decode the handful of HTML entities that actually show up in readable text.
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export interface ExtractedPage { title: string; text: string; }

// Turn a fetched HTML page into a title + readable body text. Not a full readability
// engine — strips script/style/nav noise, pulls <title> / og:title, collapses whitespace,
// and caps length so we never blow the token budget downstream.
export function htmlToText(html: string, maxChars = 6000): ExtractedPage {
  const src = html ?? "";

  const ogTitle = src.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const docTitle = src.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const ogDesc = src.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1]
              ?? src.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1];

  const title = decodeEntities((ogTitle ?? docTitle ?? "").trim()).slice(0, 200);

  const body = src
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  let text = decodeEntities(body).replace(/\s+/g, " ").trim();

  // Lead with the meta description (usually the cleanest summary) when present.
  if (ogDesc) text = `${decodeEntities(ogDesc).trim()} ${text}`.trim();

  return { title, text: text.slice(0, maxChars) };
}

export interface CoursePassage { title: string; heading?: string; text: string; }
export interface Connection { concept: string; course: string; explanation: string; }
export interface ConnectionResult { summary: string; connections: Connection[] }

const SYSTEM_PROMPT =
  "You are Content Connector. You find concrete, specific links between external content a " +
  "student is consuming and the concepts or courses they are actually studying. Only assert " +
  "a connection you can justify from the material; never invent a course or a concept. If " +
  "there is no real connection, return an empty connections array. Respond with ONLY a JSON " +
  'object: {"summary": string, "connections": [{"concept": string, "course": string, "explanation": string}]}. ' +
  "`course` is the course/topic from the student's own materials (or a general subject when " +
  "they have none indexed). Keep explanations to one or two sentences.";

export function buildPrompt(
  content: string,
  title: string | undefined,
  passages: CoursePassage[],
): { system: string; user: string } {
  const grounding = passages.length
    ? passages.map((p, i) => `[${i + 1}] ${p.title}${p.heading ? " — " + p.heading : ""}:\n${p.text}`).join("\n\n")
    : "(The student has no course materials indexed yet. Connect to common university subjects by topic, and say so.)";

  const user =
    `EXTERNAL CONTENT the student is consuming${title ? ` (titled "${title}")` : ""}:\n${content}\n\n` +
    `FROM THE STUDENT'S OWN COURSE MATERIALS (most relevant passages):\n${grounding}\n\n` +
    "Identify the specific connections. Return the JSON object only.";

  return { system: SYSTEM_PROMPT, user };
}

// Parse the model's reply into a structured result. Tolerant of ```json fences and of
// surrounding prose; returns an empty result rather than throwing on anything malformed.
export function parseConnections(raw: string): ConnectionResult {
  const empty: ConnectionResult = { summary: "", connections: [] };
  if (!raw) return empty;

  // Grab the first {...} block (handles fenced code and leading/trailing prose).
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return empty;

  let obj: any;
  try { obj = JSON.parse(candidate.slice(start, end + 1)); } catch { return empty; }
  if (!obj || typeof obj !== "object") return empty;

  const connections: Connection[] = Array.isArray(obj.connections)
    ? obj.connections
        .filter((c: any) => c && (c.concept || c.course || c.explanation))
        .map((c: any) => ({
          concept:     String(c.concept ?? "").trim(),
          course:      String(c.course ?? "").trim(),
          explanation: String(c.explanation ?? "").trim(),
        }))
        .filter((c: Connection) => c.concept || c.explanation)
    : [];

  return { summary: String(obj.summary ?? "").trim(), connections };
}
