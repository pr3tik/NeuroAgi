// gpa.ts — shared GPA helpers so the percentage→4.0 ladder lives in one place.
// Mirrors the server-side scoreToGpa in api/canvasSync.ts (keep them in sync).

export function scoreToGpa(pct: number): number {
  if (pct >= 90) return 4.0;
  if (pct >= 85) return 3.7;
  if (pct >= 80) return 3.3;
  if (pct >= 75) return 3.0;
  if (pct >= 70) return 2.7;
  if (pct >= 65) return 2.3;
  if (pct >= 60) return 2.0;
  return 1.0;
}

// Average the scored courses (currentScore preferred, finalScore fallback) → GPA, or
// null when no course carries a score. Used as a client-side fallback for the dashboard
// GPA widget when users.gpa was never persisted (e.g. extension sync, or a load/sync
// race that dropped the computed value).
export function coursesToGpa(courses: any[] | null | undefined): number | null {
  if (!courses?.length) return null;
  const scored = courses.filter(c => c?.currentScore != null || c?.finalScore != null);
  if (!scored.length) return null;
  const avg = scored.reduce((s, c) => s + (c.currentScore ?? c.finalScore), 0) / scored.length;
  return scoreToGpa(avg);
}
