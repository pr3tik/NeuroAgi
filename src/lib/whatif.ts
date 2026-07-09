// Grade thresholds match gpa.ts / scoreToGpa — keep in sync.
export const GRADE_TARGETS = [
  { label: "A",  pct: 90, gpa: 4.0 },
  { label: "A-", pct: 85, gpa: 3.7 },
  { label: "B+", pct: 80, gpa: 3.3 },
  { label: "B",  pct: 75, gpa: 3.0 },
  { label: "B-", pct: 70, gpa: 2.7 },
  { label: "C+", pct: 65, gpa: 2.3 },
  { label: "C",  pct: 60, gpa: 2.0 },
] as const;

export interface GradeCalcInput {
  id: string | number;
  pointsPossible: number | null;
  submissionScore: number | null;
  weight?: number | null;         // course-level weight % this item contributes to final grade
  weightAchieved?: number | null; // weighted score already earned (weight × score/pp)
}

export interface AssignmentGroup {
  id: string | number;
  name: string;
  weight: number;                       // 0–100, % of final grade
  assignmentIds: (string | number)[];
}

export interface GroupBreakdown {
  id: string | number;
  name: string;
  weight: number;
  currentPct: number | null;  // real grades only (Canvas-style)
  earnedPoints: number;       // real + hypo
  scoredTotal: number;        // pp of scored (real + hypo) work
  ungradedTotal: number;      // pp of truly ungraded work
}

export interface GradeCalcResult {
  currentPct: number | null;    // real grades only
  projectedPct: number | null;  // real + hypotheticals
  earnedPoints: number;
  scoredTotal: number;
  ungradedTotal: number;
  grandTotal: number;
  requiredPct: number | null;
  isPossible: boolean;
  alreadyAchieved: boolean;
  noRemainingWork: boolean;
  isWeighted: boolean;
  groups: GroupBreakdown[];
}

/**
 * Computes current grade and required score on remaining work to hit targetPct.
 *
 * If `groups` are provided and their weights sum to ~100, uses weighted Canvas-style
 * calculation. Otherwise falls back to straight points-based.
 *
 * hypotheticals: { [assignmentId]: points } — applied to ungraded assignments only.
 */
export function calcRequiredScore(
  assignments: GradeCalcInput[],
  targetPct: number,
  hypotheticals: Record<string | number, number> = {},
  groups: AssignmentGroup[] = [],
): GradeCalcResult {
  const validGroups    = groups.filter(g => g.weight > 0);
  const groupWeight    = validGroups.reduce((s, g) => s + g.weight, 0);
  const useGroups      = validGroups.length > 0 && Math.abs(groupWeight - 100) < 2;
  const useItemWeights = !useGroups && assignments.some(a => (a.weight ?? 0) > 0);

  return useGroups
    ? calcWeighted(assignments, validGroups, targetPct, hypotheticals)
    : useItemWeights
      ? calcWeightedByItem(assignments, targetPct, hypotheticals)
      : calcPointsBased(assignments, targetPct, hypotheticals);
}

// ── Points-based (no group weights) ──────────────────────────────────────────

function calcPointsBased(
  assignments: GradeCalcInput[],
  targetPct: number,
  hypotheticals: Record<string | number, number>,
): GradeCalcResult {
  const valid = assignments.filter(a => (a.pointsPossible ?? 0) > 0);

  let realEarned = 0, realTotal = 0;
  let hypoEarned = 0, hypoTotal = 0;
  let ungradedTotal = 0;

  for (const a of valid) {
    const pp = a.pointsPossible!;
    if (a.submissionScore != null) {
      realEarned += a.submissionScore;
      realTotal  += pp;
    } else if (hypotheticals[a.id] != null) {
      hypoEarned += hypotheticals[a.id];
      hypoTotal  += pp;
    } else {
      ungradedTotal += pp;
    }
  }

  const earnedPoints = realEarned + hypoEarned;
  const scoredTotal  = realTotal  + hypoTotal;
  const grandTotal   = scoredTotal + ungradedTotal;
  const currentPct   = realTotal   > 0 ? (realEarned   / realTotal)   * 100 : null;
  const projectedPct = scoredTotal > 0 ? (earnedPoints / scoredTotal) * 100 : null;

  if (ungradedTotal === 0) {
    return {
      currentPct, projectedPct, earnedPoints, scoredTotal, ungradedTotal, grandTotal,
      requiredPct: null, isPossible: false,
      alreadyAchieved: (projectedPct ?? currentPct ?? 0) >= targetPct,
      noRemainingWork: true, isWeighted: false, groups: [],
    };
  }

  const requiredPoints = (targetPct / 100) * grandTotal - earnedPoints;
  const requiredPct    = (requiredPoints / ungradedTotal) * 100;

  return {
    currentPct, projectedPct, earnedPoints, scoredTotal, ungradedTotal, grandTotal,
    requiredPct,
    isPossible:      requiredPct <= 100,
    alreadyAchieved: requiredPct <= 0,
    noRemainingWork: false, isWeighted: false, groups: [],
  };
}

// ── Weighted by item (per-assignment weights from extension, any LMS) ────────

function calcWeightedByItem(
  assignments: GradeCalcInput[],
  targetPct: number,
  hypotheticals: Record<string | number, number>,
): GradeCalcResult {
  const valid = assignments.filter(a => (a.weight ?? 0) > 0);
  const totalWeight = valid.reduce((s, a) => s + a.weight!, 0);

  let realContrib = 0, realWeightSum = 0;
  let hypoContrib = 0, hypoWeightSum = 0;
  let ungradedWeightSum = 0;
  let earnedPoints = 0, scoredTotal = 0, ungradedTotal = 0, grandTotal = 0;

  for (const a of valid) {
    const w  = a.weight!;
    const pp = a.pointsPossible ?? 0;
    grandTotal += pp;

    if (a.submissionScore != null) {
      const contrib = a.weightAchieved != null
        ? a.weightAchieved
        : pp > 0 ? w * (a.submissionScore / pp) : 0;
      realContrib    += contrib;
      realWeightSum  += w;
      earnedPoints   += a.submissionScore;
      scoredTotal    += pp;
    } else if (hypotheticals[a.id] != null) {
      const hypoScore = Math.min(hypotheticals[a.id], pp);
      hypoContrib    += pp > 0 ? w * (hypoScore / pp) : 0;
      hypoWeightSum  += w;
      earnedPoints   += hypoScore;
      scoredTotal    += pp;
    } else {
      ungradedWeightSum += w;
      ungradedTotal     += pp;
    }
  }

  const totalEarnedContrib = realContrib + hypoContrib;
  const scoredWeightSum    = realWeightSum + hypoWeightSum;

  // Re-normalize to graded work only (same as Canvas current-grade logic)
  const currentPct   = realWeightSum   > 0 ? (realContrib          / realWeightSum)   * 100 : null;
  const projectedPct = scoredWeightSum > 0 ? (totalEarnedContrib   / scoredWeightSum) * 100 : null;

  if (ungradedWeightSum <= 0) {
    return {
      currentPct, projectedPct, earnedPoints, scoredTotal,
      ungradedTotal, grandTotal,
      requiredPct: null, isPossible: false,
      alreadyAchieved: (projectedPct ?? currentPct ?? 0) >= targetPct,
      noRemainingWork: true, isWeighted: true, groups: [],
    };
  }

  // X = (target/100 × totalWeight − earned_contrib) / ungradedWeight × 100
  const requiredPct = ((targetPct / 100) * totalWeight - totalEarnedContrib) / ungradedWeightSum * 100;

  return {
    currentPct, projectedPct, earnedPoints, scoredTotal,
    ungradedTotal, grandTotal,
    requiredPct,
    isPossible:      requiredPct <= 100,
    alreadyAchieved: requiredPct <= 0,
    noRemainingWork: false, isWeighted: true, groups: [],
  };
}

// ── Weighted (Canvas group weights) ──────────────────────────────────────────

function calcWeighted(
  assignments: GradeCalcInput[],
  groups: AssignmentGroup[],
  targetPct: number,
  hypotheticals: Record<string | number, number>,
): GradeCalcResult {
  const byId = new Map(assignments.map(a => [String(a.id), a]));

  const groupStats = groups.map(g => {
    let realEarned = 0, realTotal = 0;
    let hypoEarned = 0, hypoTotal = 0;
    let ungradedTotal = 0;

    for (const aid of g.assignmentIds) {
      const a = byId.get(String(aid));
      if (!a || (a.pointsPossible ?? 0) <= 0) continue;
      const pp = a.pointsPossible!;

      if (a.submissionScore != null) {
        realEarned += a.submissionScore;
        realTotal  += pp;
      } else if (hypotheticals[aid] != null) {
        hypoEarned += hypotheticals[aid];
        hypoTotal  += pp;
      } else {
        ungradedTotal += pp;
      }
    }

    const earnedPoints = realEarned + hypoEarned;
    const scoredTotal  = realTotal  + hypoTotal;
    const groupTotal   = scoredTotal + ungradedTotal;

    return {
      id: g.id, name: g.name, weight: g.weight,
      realEarned, realTotal,
      earnedPoints, scoredTotal,
      ungradedTotal, groupTotal,
      currentPct: realTotal > 0 ? (realEarned / realTotal) * 100 : null,
    };
  });

  // Aggregates for summary pills
  const earnedPoints  = groupStats.reduce((s, g) => s + g.earnedPoints, 0);
  const scoredTotal   = groupStats.reduce((s, g) => s + g.scoredTotal, 0);
  const ungradedTotal = groupStats.reduce((s, g) => s + g.ungradedTotal, 0);
  const grandTotal    = scoredTotal + ungradedTotal;

  // Canvas-style weighted current grade: only groups with real submissions;
  // weights of those groups are re-normalized so they sum to 100.
  const withReal = groupStats.filter(g => g.realTotal > 0);
  const realWeightSum = withReal.reduce((s, g) => s + g.weight, 0);
  const currentPct = withReal.length > 0
    ? withReal.reduce((s, g) => s + (g.realEarned / g.realTotal) * (g.weight / realWeightSum) * 100, 0)
    : null;

  // Projected: same but includes hypotheticals
  const withScored = groupStats.filter(g => g.scoredTotal > 0);
  const scoredWeightSum = withScored.reduce((s, g) => s + g.weight, 0);
  const projectedPct = withScored.length > 0
    ? withScored.reduce((s, g) => s + (g.earnedPoints / g.scoredTotal) * (g.weight / scoredWeightSum) * 100, 0)
    : null;

  // Required score on remaining work (uniform X% across all ungraded):
  // Derived from: target = sum(earned_in_group/group_total * weight/100) + X/100 * sum(ungraded_in_group/group_total * weight/100)
  // → X = (target/100 - earnedContrib) / remainingContrib * 100
  const earnedContrib    = groupStats.reduce((s, g) => g.groupTotal > 0 ? s + (g.earnedPoints / g.groupTotal) * (g.weight / 100) : s, 0);
  const remainingContrib = groupStats.reduce((s, g) => g.groupTotal > 0 ? s + (g.ungradedTotal / g.groupTotal) * (g.weight / 100) : s, 0);

  const breakdown: GroupBreakdown[] = groupStats.map(g => ({
    id: g.id, name: g.name, weight: g.weight,
    currentPct: g.currentPct,
    earnedPoints: g.earnedPoints,
    scoredTotal: g.scoredTotal,
    ungradedTotal: g.ungradedTotal,
  }));

  if (ungradedTotal === 0) {
    return {
      currentPct, projectedPct, earnedPoints, scoredTotal, ungradedTotal, grandTotal,
      requiredPct: null, isPossible: false,
      alreadyAchieved: (projectedPct ?? currentPct ?? 0) >= targetPct,
      noRemainingWork: true, isWeighted: true, groups: breakdown,
    };
  }

  const requiredPct = remainingContrib > 0
    ? ((targetPct / 100) - earnedContrib) / remainingContrib * 100
    : null;

  return {
    currentPct, projectedPct, earnedPoints, scoredTotal, ungradedTotal, grandTotal,
    requiredPct,
    isPossible:      requiredPct != null && requiredPct <= 100,
    alreadyAchieved: requiredPct != null && requiredPct <= 0,
    noRemainingWork: false, isWeighted: true, groups: breakdown,
  };
}
