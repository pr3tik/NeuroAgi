// @vitest-environment node
// Board-card fence parsing — api/room-ai.ts `parseCardsFence` / `boardCardsPrompt`.
//
// The headline test is the REFERENCE one. A `reference` card tells students "the answer is
// in this file"; if the model can invent a filename there, Reggie confidently sends the
// room to a document that does not exist, and it looks authoritative because it's pinned
// to the shared board. So the server matches every reference against the titles that
// actually came back from retrieval on that turn and drops the rest — the model never
// supplies the document_id, the server attaches the real one.
//
// Everything else here is the defensive posture: model output is hostile input. Malformed
// JSON must degrade to a plain reply (never fail the turn), the fence must leave the
// transcript in every outcome, unknown kinds fall back to `note`, and the caps hold.
import { describe, it, expect } from "vitest";
import { parseCardsFence, boardCardsPrompt } from "../api/room-ai";

const REFS = [
  { document_id: "doc-a", title: "Lecture 07.pdf", heading: "7.4 Coin Change", loc: "p.16" },
  { document_id: "doc-b", title: "Problem Set 3.docx", heading: null, loc: null },
];

/** Wrap a cards payload in the fence the model is told to emit, after some prose. */
const fenced = (payload: string, prose = "Here's how I'd break that down.") =>
  `${prose}\n\n\`\`\`cards\n${payload}\n\`\`\``;

describe("parseCardsFence — a valid multi-kind fence", () => {
  const reply = fenced(JSON.stringify([
    { kind: "note", title: "Greedy fails", content: "Coin systems without the greedy-choice property break it.", x: 950, y: 500, w: 460 },
    { kind: "guide", title: "How to attack it", content: "## Step 1\n- Define the subproblem\n\n## Step 2\n- Write the recurrence", x: 1400, y: 520, w: 620 },
    { kind: "terms", title: "Key terms", terms: [{ term: "Optimal substructure", definition: "Optimal solutions contain optimal sub-solutions." }], x: 1900, y: 900, w: 420 },
    { kind: "reference", title: "Read this", why: "It works the exact {1,5,12} counterexample.", sourceTitle: "lecture 07.PDF", x: 2000, y: 1100, w: 420 },
  ]));

  it("parses every kind and strips the fence from the reply", () => {
    const out = parseCardsFence(reply, REFS);
    expect(out.reply).toBe("Here's how I'd break that down.");
    expect(out.reply).not.toContain("```");
    expect(out.cards.map(c => c.kind)).toEqual(["note", "guide", "terms", "reference"]);
  });

  it("keeps the guide's markdown body and its wider width", () => {
    const guide = parseCardsFence(reply, REFS).cards.find(c => c.kind === "guide")!;
    expect(guide.content).toContain("## Step 1");
    expect(guide.content).toContain("## Step 2");
    expect(guide.w).toBe(620);
  });

  it("carries terms through as structured entries, not markdown", () => {
    const terms = parseCardsFence(reply, REFS).cards.find(c => c.kind === "terms")!;
    expect(terms.terms).toEqual([
      { term: "Optimal substructure", definition: "Optimal solutions contain optimal sub-solutions." },
    ]);
    expect(terms.content).toBeUndefined();
  });
});

describe("parseCardsFence — reference cards may only name REAL retrieved files", () => {
  it("drops an invented sourceTitle while a real one keeps its documentId", () => {
    const reply = fenced(JSON.stringify([
      { kind: "reference", title: "Invented", why: "Trust me.", sourceTitle: "Lecture 99 — Final Review.pdf", x: 1000, y: 600 },
      { kind: "reference", title: "Real", why: "The worked counterexample lives here.", sourceTitle: "Problem Set 3.docx", x: 1500, y: 700 },
    ]));

    const { cards } = parseCardsFence(reply, REFS);
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe("Real");
    expect(cards[0].documentId).toBe("doc-b");
    expect(cards[0].sourceTitle).toBe("Problem Set 3.docx");
    // The invented filename must not survive in ANY field of the response.
    expect(JSON.stringify(cards)).not.toContain("Lecture 99");
  });

  it("matches case-insensitively and rewrites to the canonical retrieved title", () => {
    const { cards } = parseCardsFence(
      fenced(JSON.stringify([{ kind: "reference", title: "Read", why: "Section 7.4 covers it.", sourceTitle: "  lECTURE 07.pdf  " }])),
      REFS,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].sourceTitle).toBe("Lecture 07.pdf");   // server's spelling, not the model's
    expect(cards[0].documentId).toBe("doc-a");
  });

  it("accepts the 'Title — Heading' form the prompt's source list shows", () => {
    const { cards } = parseCardsFence(
      fenced(JSON.stringify([{ kind: "reference", title: "Read", why: "Right section.", sourceTitle: "Lecture 07.pdf — 7.4 Coin Change" }])),
      REFS,
    );
    expect(cards[0]?.documentId).toBe("doc-a");
  });

  it("never trusts a model-supplied documentId", () => {
    const { cards } = parseCardsFence(
      fenced(JSON.stringify([{ kind: "reference", title: "Read", why: "Here.", sourceTitle: "Problem Set 3.docx", documentId: "doc-attacker" }])),
      REFS,
    );
    expect(cards[0].documentId).toBe("doc-b");
  });

  it("drops every reference when the turn retrieved nothing", () => {
    const reply = fenced(JSON.stringify([
      { kind: "reference", title: "Read", why: "Here.", sourceTitle: "Lecture 07.pdf" },
      { kind: "note", title: "Still fine", content: "Notes don't need a source." },
    ]));
    const { cards } = parseCardsFence(reply, []);
    expect(cards.map(c => c.kind)).toEqual(["note"]);
  });

  it("drops a reference with no `why`, and one whose title is a loose substring", () => {
    const { cards } = parseCardsFence(
      fenced(JSON.stringify([
        { kind: "reference", title: "No why", sourceTitle: "Lecture 07.pdf" },
        { kind: "reference", title: "Substring", why: "Close enough?", sourceTitle: "Lecture" },
      ])),
      REFS,
    );
    expect(cards).toEqual([]);
  });
});

describe("parseCardsFence — caps and clamps", () => {
  it("trims to 4 cards", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ kind: "note", title: `N${i}`, content: "body" }));
    expect(parseCardsFence(fenced(JSON.stringify(many)), REFS).cards).toHaveLength(4);
  });

  it("a dropped card does not cost a valid one its slot", () => {
    const { cards } = parseCardsFence(
      fenced(JSON.stringify([
        { kind: "reference", title: "Invented", why: "Trust me.", sourceTitle: "Nonexistent.pdf" },
        ...Array.from({ length: 4 }, (_, i) => ({ kind: "note", title: `N${i}`, content: "body" })),
      ])),
      REFS,
    );
    expect(cards.map(c => c.title)).toEqual(["N0", "N1", "N2", "N3"]);
  });

  it("trims a terms card to 8 entries and drops half-written ones", () => {
    const terms = [
      ...Array.from({ length: 10 }, (_, i) => ({ term: `T${i}`, definition: `D${i}` })),
    ];
    terms.splice(1, 0, { term: "orphan", definition: "" } as any);
    const { cards } = parseCardsFence(fenced(JSON.stringify([{ kind: "terms", title: "Glossary", terms }])), REFS);
    expect(cards[0].terms).toHaveLength(8);
    expect(cards[0].terms!.map(t => t.term)).not.toContain("orphan");
  });

  it("clamps coordinates and width into the board", () => {
    const { cards } = parseCardsFence(
      fenced(JSON.stringify([{ kind: "note", title: "Way out", content: "body", x: 99999, y: -400, w: 9000 }])),
      REFS,
    );
    expect(cards[0]).toMatchObject({ x: 2500, y: 60, w: 640 });
  });

  it("length-clamps title, content and term strings", () => {
    const { cards } = parseCardsFence(
      fenced(JSON.stringify([
        { kind: "guide", title: "T".repeat(400), content: "C".repeat(9000) },
        { kind: "terms", title: "Glossary", terms: [{ term: "x".repeat(400), definition: "y".repeat(9000) }] },
      ])),
      REFS,
    );
    expect(cards[0].title).toHaveLength(80);
    expect(cards[0].content).toHaveLength(2400);
    expect(cards[1].terms![0].term).toHaveLength(80);
    expect(cards[1].terms![0].definition).toHaveLength(240);
  });

  it("drops cards with no title, no body, or an empty terms list", () => {
    const { cards } = parseCardsFence(
      fenced(JSON.stringify([
        { kind: "note", title: "   ", content: "orphaned body" },
        { kind: "guide", title: "Titled but empty", content: "  " },
        { kind: "terms", title: "Glossary", terms: [] },
        { kind: "quiz", title: "One option", content: "Q?", quizOptions: ["only"] },
      ])),
      REFS,
    );
    expect(cards).toEqual([]);
  });
});

describe("parseCardsFence — degradation", () => {
  it("malformed JSON yields no cards and leaves the reply text intact", () => {
    const out = parseCardsFence(fenced('[{"kind":"note", "title": "oops",,,', "Good answer, actually."), REFS);
    expect(out.cards).toEqual([]);
    expect(out.reply).toBe("Good answer, actually.");
    expect(out.reply).not.toContain("```");
    expect(out.reply).not.toContain("kind");
  });

  it("a non-array payload also strips clean", () => {
    const out = parseCardsFence(fenced('{"kind":"note","title":"t","content":"c"}', "Plain reply."), REFS);
    expect(out.cards).toEqual([]);
    expect(out.reply).toBe("Plain reply.");
  });

  it("leaves a fence-free reply untouched", () => {
    const out = parseCardsFence("Just answering the question.", REFS);
    expect(out).toEqual({ reply: "Just answering the question.", cards: [] });
  });

  it("survives a non-string reply", () => {
    expect(parseCardsFence(null as any, REFS)).toEqual({ reply: null, cards: [] });
  });

  it("treats an unknown kind as a note rather than dropping or crashing", () => {
    const { cards } = parseCardsFence(
      fenced(JSON.stringify([{ kind: "hologram", title: "Future kind", content: "still useful" }])),
      REFS,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe("note");
    expect(cards[0].content).toBe("still useful");
  });
});

describe("boardCardsPrompt", () => {
  it("describes all five kinds and keeps the caps + coordinate guidance", () => {
    const p = boardCardsPrompt(REFS);
    for (const k of ["note", "quiz", "guide", "terms", "reference"]) expect(p).toContain(`"kind":"${k}"`);
    expect(p).toContain("Max 4 cards");
    expect(p).toContain("x 900–2100");
    expect(p).toContain("y 450–1250");
    expect(p).toContain("3000×1800");
    expect(p).toContain("Never mention the fence");
  });

  it("lists the retrieved source titles verbatim, deduped", () => {
    const p = boardCardsPrompt([...REFS, { document_id: "doc-a", title: "Lecture 07.pdf" }]);
    expect(p).toContain("- Lecture 07.pdf");
    expect(p).toContain("- Problem Set 3.docx");
    expect(p.match(/- Lecture 07\.pdf/g)).toHaveLength(1);
  });

  it("forbids the reference kind outright when nothing was retrieved", () => {
    const p = boardCardsPrompt([]);
    expect(p).toContain('do NOT use the "reference" kind');
    expect(p).not.toContain("Lecture 07.pdf");
  });
});
