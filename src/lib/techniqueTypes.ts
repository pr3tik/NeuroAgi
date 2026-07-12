// src/lib/techniqueTypes.ts — nickname/icon metadata for the 7 evidence-based
// teaching-technique categories in student_strategy_affinity. NOT a "learning
// styles" model — see supabase-teaching-strategies-migration.sql for why. Each
// student's affinity is an empirical per-technique success rate, not a fixed
// bucket; the nickname reflects whichever technique has demonstrably worked
// best for them once there's enough evidence (see api/_achievements.ts for the
// unlock threshold). Achievement key convention: `type_${strategy_kind}`.
import { Eye, Zap, MessageCircleQuestion, MessagesSquare, Landmark, Shuffle, Hourglass } from "lucide-react";

export interface TechniqueTypeDef {
  strategyKind: string;
  nickname: string;
  emoji: string;
  blurb: string;
  icon: any;
}

export const TECHNIQUE_TYPES: TechniqueTypeDef[] = [
  { strategyKind: "dual_coding",               nickname: "The Owl",       emoji: "🦉", blurb: "Pairs visuals with explanation",         icon: Eye },
  { strategyKind: "retrieval_practice",        nickname: "The Fox",       emoji: "🦊", blurb: "Sharp, quick recall",                     icon: Zap },
  { strategyKind: "elaborative_interrogation", nickname: "The Raven",     emoji: "🐦‍⬛", blurb: "Digs for \"why\"",                      icon: MessageCircleQuestion },
  { strategyKind: "self_explanation",          nickname: "The Parrot",    emoji: "🦜", blurb: "Explains it back in their own words",     icon: MessagesSquare },
  { strategyKind: "concrete_example",          nickname: "The Elephant",  emoji: "🐘", blurb: "Remembers via vivid, grounded examples",  icon: Landmark },
  { strategyKind: "interleaving",              nickname: "The Chameleon", emoji: "🦎", blurb: "Adapts across mixed topics",              icon: Shuffle },
  { strategyKind: "spaced_callback",           nickname: "The Tortoise",  emoji: "🐢", blurb: "Steady — wins the long game",             icon: Hourglass },
];

export const TECHNIQUE_TYPES_BY_KIND: Record<string, TechniqueTypeDef> =
  Object.fromEntries(TECHNIQUE_TYPES.map(t => [t.strategyKind, t]));

export const achievementKeyForStrategy = (strategyKind: string) => `type_${strategyKind}`;
