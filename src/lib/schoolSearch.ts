// University search — local dataset, no network round trip.
// src/data/universities.json bundles ~4k schools across North America, South
// America, and China (Hipo/university-domains-list, MIT licensed, filtered to
// those regions). Loaded as its own lazy chunk on first search so it doesn't
// bloat the initial bundle; fields are minified (n/c/s/d) to keep it small.

// Strips diacritics so "Sao Paulo" matches "São Paulo", "Bogota" matches "Bogotá", etc.
// Built from char codes (rather than a literal regex range) to avoid embedding
// raw combining-mark characters in the source file.
const COMBINING_MARKS = new RegExp(
  "[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]",
  "g"
);
function normalize(s: string) {
  return s.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

let universitiesPromise: Promise<any[]> | null = null;
function loadUniversities() {
  if (!universitiesPromise) {
    universitiesPromise = import("../data/universities.json").then((m: any) =>
      m.default.map((u: any) => ({
        ...u,
        _n: normalize(u.n),
        _s: normalize(u.s || ""),
        _c: normalize(u.c || ""),
      }))
    );
  }
  return universitiesPromise;
}

// Common acronyms students actually type that don't appear as substrings of
// the official name (e.g. "MIT" isn't in "Massachusetts Institute of Technology").
// Maps to a substring that uniquely narrows to the intended school.
const SCHOOL_ALIASES: Record<string, string> = {
  mit:     "massachusetts institute of technology",
  ucla:    "university of california, los angeles",
  ucsd:    "university of california, san diego",
  ucsb:    "university of california, santa barbara",
  ucb:     "university of california, berkeley",
  cal:     "university of california, berkeley",
  nyu:     "new york university",
  usc:     "university of southern california",
  upenn:   "university of pennsylvania",
  penn:    "university of pennsylvania",
  gatech:  "georgia institute of technology",
  caltech: "california institute of technology",
  cmu:     "carnegie mellon university",
  ubc:     "university of british columbia",
  utexas:  "university of texas at austin",
  umich:   "university of michigan",
};

export async function searchSchools(query: string) {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return [];

  const list = await loadUniversities();
  const q = normalize(trimmed);
  const aliasTarget = SCHOOL_ALIASES[q];

  // Rank: exact name > alias hit > name starts with query > a word in the
  // name starts with query > substring anywhere in name > match on state/country.
  const scored: { u: any; score: number }[] = [];
  for (const u of list) {
    let score;
    if (u._n === q) score = 0;
    else if (aliasTarget && u._n === aliasTarget) score = 0.5;
    else if (u._n.startsWith(q)) score = 1;
    else if (u._n.split(/\s+/).some((w: string) => w.startsWith(q))) score = 2;
    else if (u._n.includes(q)) score = 3;
    else if (u._s.includes(q) || u._c.includes(q)) score = 4;
    else continue;
    scored.push({ u, score });
  }
  scored.sort((a, b) => a.score - b.score || a.u.n.length - b.u.n.length);

  return scored.slice(0, 8).map(({ u }) => ({
    name:      u.n,
    city:      u.s || "",
    country:   u.c || "",
    continent: "",
    status:    "needsVerification",
    loginUrl:  "",
    tokenFlow: "",
    domain:    u.d || "",
    isCustom:  false,
  }));
}

// Auto-detect the university behind a Canvas base URL by matching the hostname
// against the dataset's domains. Canvas instances live on school subdomains
// (q.utoronto.ca, canvas.ubc.ca), so we try each suffix of the hostname, most
// specific first: "q.utoronto.ca" → exact miss → "utoronto.ca" → University of
// Toronto. If only campus subdomains match (scar.utoronto.ca, utm.utoronto.ca)
// we can't tell which campus the student is on, so fall back to the shortest
// (most general) name rather than guessing a campus.
export async function schoolFromCanvasUrl(url: string): Promise<string | null> {
  if (!url) return null;
  let hostname: string;
  try {
    hostname = new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  const list = await loadUniversities();

  // Exact match on progressively shorter suffixes (never the bare TLD).
  for (let i = 0; i <= parts.length - 2; i++) {
    const candidate = parts.slice(i).join(".");
    const hit = list.find((u: any) => u.d === candidate);
    if (hit) return hit.n;
  }
  // No exact entry — collect entries under the registrable suffix (campus
  // subdomains) and take the most general name.
  for (let i = 0; i <= parts.length - 2; i++) {
    const suffix = "." + parts.slice(i).join(".");
    const hits = list.filter((u: any) => u.d?.endsWith(suffix));
    if (hits.length) {
      hits.sort((a: any, b: any) => a.n.length - b.n.length);
      return hits[0].n;
    }
  }
  return null;
}
