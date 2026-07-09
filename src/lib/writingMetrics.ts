// writingMetrics.ts — pure writing analysis for the Writing Evolution Tracker.
//
// Turns a piece of writing into a quantitative profile (readability, vocabulary diversity,
// sentence complexity, citation use). It's deterministic, so it's the testable backbone of
// the tracker: you compare these numbers across submissions over time to see growth. The
// optional qualitative LLM note lives in the api endpoint; everything here is pure.

export interface WritingMetrics {
  words: number;
  sentences: number;
  paragraphs: number;
  avgSentenceLength: number;  // words per sentence
  avgWordLength: number;      // characters per word
  vocabDiversity: number;     // type-token ratio, 0–1 (unique / total words)
  complexWordRatio: number;   // share of words with 3+ syllables, 0–1
  syllablesPerWord: number;
  fleschReadingEase: number;  // higher = easier (0–100ish)
  fleschKincaidGrade: number; // US grade level
  citations: number;          // detected references / citations
}

const round = (n: number, p = 2) => {
  const f = 10 ** p;
  return Math.round((Number.isFinite(n) ? n : 0) * f) / f;
};

// Standard syllable-counting heuristic (good enough for readability scores).
export function countSyllables(word: string): number {
  let w = (word ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
  w = w.replace(/^y/, "");
  const groups = w.match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

function tokenizeWords(text: string): string[] {
  return (text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? []);
}

function countSentences(text: string): number {
  const ends = text.match(/[.!?]+(?:\s|$)/g);
  const n = ends ? ends.length : 0;
  // Any non-empty text is at least one sentence even without terminal punctuation.
  return Math.max(n, text.trim() ? 1 : 0);
}

function countParagraphs(text: string): number {
  const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  return Math.max(paras.length, text.trim() ? 1 : 0);
}

// References / citations: APA-style (Author, 2020), numeric [1], and "et al.".
export function countCitations(text: string): number {
  let n = 0;
  // Parenthetical APA: (Author, 2020) / (Doe & Lee, 2019)
  n += (text.match(/\([A-Z][A-Za-z.'-]+(?:\s+(?:et al\.?|&|and)\s+[A-Z][A-Za-z.'-]+)?,?\s*\d{4}[a-z]?\)/g) ?? []).length;
  // Narrative APA: Cowan (2001) — a bare year in parens (disjoint from the pattern above).
  n += (text.match(/\(\d{4}[a-z]?\)/g) ?? []).length;
  // Numeric [1] and "et al."
  n += (text.match(/\[\d+\]/g) ?? []).length;
  n += (text.match(/\bet al\.?/gi) ?? []).length;
  return n;
}

export function analyzeWriting(text: string): WritingMetrics {
  const src = text ?? "";
  const words = tokenizeWords(src);
  const wordCount = words.length;
  const sentences = countSentences(src);
  const paragraphs = countParagraphs(src);

  if (wordCount === 0) {
    return {
      words: 0, sentences: 0, paragraphs: 0, avgSentenceLength: 0, avgWordLength: 0,
      vocabDiversity: 0, complexWordRatio: 0, syllablesPerWord: 0,
      fleschReadingEase: 0, fleschKincaidGrade: 0, citations: 0,
    };
  }

  const charCount = words.reduce((s, w) => s + w.length, 0);
  const syllableTotal = words.reduce((s, w) => s + countSyllables(w), 0);
  const complexWords = words.filter(w => countSyllables(w) >= 3).length;
  const unique = new Set(words.map(w => w.toLowerCase())).size;

  const wordsPerSentence = wordCount / sentences;
  const syllablesPerWord = syllableTotal / wordCount;

  const fleschReadingEase  = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
  const fleschKincaidGrade = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;

  return {
    words: wordCount,
    sentences,
    paragraphs,
    avgSentenceLength: round(wordsPerSentence),
    avgWordLength:     round(charCount / wordCount),
    vocabDiversity:    round(unique / wordCount),
    complexWordRatio:  round(complexWords / wordCount),
    syllablesPerWord:  round(syllablesPerWord),
    fleschReadingEase:  round(fleschReadingEase, 1),
    fleschKincaidGrade: round(Math.max(fleschKincaidGrade, 0), 1),
    citations: countCitations(src),
  };
}

export interface MetricDelta { key: string; label: string; from: number; to: number; delta: number; }

// Compare two profiles → the headline changes, so the UI can say "more varied vocabulary,
// longer sentences" etc. across submissions.
export function compareMetrics(prev: WritingMetrics, curr: WritingMetrics): MetricDelta[] {
  const keys: { key: keyof WritingMetrics; label: string }[] = [
    { key: "vocabDiversity",     label: "Vocabulary diversity" },
    { key: "fleschKincaidGrade", label: "Reading grade level" },
    { key: "avgSentenceLength",  label: "Sentence length" },
    { key: "complexWordRatio",   label: "Word complexity" },
    { key: "citations",          label: "Citations" },
    { key: "words",              label: "Length" },
  ];
  return keys.map(({ key, label }) => {
    const from = prev[key] as number, to = curr[key] as number;
    return { key, label, from, to, delta: round((to - from), 3) };
  }).filter(d => d.delta !== 0);
}
