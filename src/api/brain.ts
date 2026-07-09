/**
 * brain.js — NeuroAGI Brain DB client for the FschoolAI frontend
 *
 * ARCHITECTURE:
 * - The NeuroAGI Brain is a separate Supabase project from FschoolAI
 * - This file is the ONLY place the frontend talks to the brain DB
 * - The frontend reads brain.context_window (pre-computed every 30min by the backend)
 * - The frontend NEVER writes directly to brain.* tables
 * - All writes go through agents.messages → Supabase Realtime → signal ingestion
 *
 * REQUIRED ENV VARS (add to Vercel + .env.local):
 *   VITE_BRAIN_SUPABASE_URL=https://[brain-project-ref].supabase.co
 *   VITE_BRAIN_SUPABASE_ANON_KEY=[brain anon key]
 *
 * REQUIRED DB FIELD:
 *   public.users.brain_person_id (UUID) — the person_id in neuro.persons
 *   Johan adds this in BACKEND_GAPS.md Gap 1
 */

import { createClient } from '@supabase/supabase-js';

// ── Brain Supabase client ────────────────────────────────────────────────────
// Falls back gracefully if env vars not set yet (returns null context)
const BRAIN_URL  = import.meta.env.VITE_BRAIN_SUPABASE_URL;
const BRAIN_ANON = import.meta.env.VITE_BRAIN_SUPABASE_ANON_KEY;

export const brainSupabase = (BRAIN_URL && BRAIN_ANON)
  ? createClient(BRAIN_URL, BRAIN_ANON)
  : null;

/**
 * Load the pre-computed brain context window for a student.
 *
 * @param {string} personId — the brain person_id (from public.users.brain_person_id)
 * @returns {object|null} brain context window or null if not available
 *
 * Fields returned (when brain is active):
 *   stress_level          — 0.0–1.0 (0 = calm, 1 = high stress)
 *   momentum_state        — 'building' | 'strong' | 'declining' | 'unknown'
 *   most_urgent_deadline  — { name, hours_remaining, course, assignment_id }
 *   pending_intervention  — string message the brain wants to deliver
 *   intervention_approach — 'direct' | 'gentle' | 'motivational'
 *   confirmed_hypotheses  — string[] (e.g. "avoids starting assignments early")
 *   do_not_mention        — string[] (topics to avoid this session)
 *   voice_preferences     — string (e.g. "casual, direct, no jargon")
 *   recent_context_summary — string (last 48hr signal summary)
 *   key_insights          — string (from last reflection)
 *   sleep_hours_last_night — number | null
 *   watching_for          — string | null
 *   written_at            — ISO timestamp (when brain last refreshed)
 *   expires_at            — ISO timestamp (6h TTL)
 */
export async function loadBrainContext(personId) {
  if (!brainSupabase || !personId) return null;

  try {
    const { data, error } = await brainSupabase
      .schema('brain')
      .from('context_window')
      .select('*')
      .eq('person_id', personId)
      .maybeSingle();

    if (error || !data) return null;

    // Check if context window is expired (6h TTL)
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      console.warn('[Brain] Context window expired — brain scheduler may not be running');
      return data; // Return stale data rather than nothing — still useful
    }

    return data;
  } catch (err) {
    console.warn('[Brain] Failed to load brain context:', err.message);
    return null; // Non-fatal — Reggie works without brain context, just less personalized
  }
}

/**
 * Format brain context into a system prompt section.
 * Called by buildChatSystem() in NeuralRing.jsx
 *
 * @param {object|null} brainContext — from loadBrainContext()
 * @param {string} studentName — for personalized references
 * @returns {string} formatted brain context section for system prompt
 */
export function formatBrainContextForPrompt(brainContext, studentName = 'the student') {
  if (!brainContext) return '';

  const lines = [];

  // Stress and momentum
  if (brainContext.stress_level !== undefined && brainContext.stress_level !== null) {
    const stressLabel = brainContext.stress_level > 0.7 ? 'HIGH'
      : brainContext.stress_level > 0.4 ? 'MODERATE' : 'LOW';
    lines.push(`Stress level: ${stressLabel} (${Math.round(brainContext.stress_level * 100)}%)`);
  }
  if (brainContext.momentum_state && brainContext.momentum_state !== 'unknown') {
    lines.push(`Momentum: ${brainContext.momentum_state}`);
  }

  // Most urgent deadline
  if (brainContext.most_urgent_deadline) {
    const d = brainContext.most_urgent_deadline;
    const urgency = d.hours_remaining < 6 ? 'URGENT' : d.hours_remaining < 24 ? 'Soon' : '';
    lines.push(`Most urgent deadline: ${d.name} — ${d.hours_remaining}h remaining (${d.course})${urgency ? ` — ${urgency}` : ''}`);
  }

  // Sleep
  if (brainContext.sleep_hours_last_night !== null && brainContext.sleep_hours_last_night !== undefined) {
    if (brainContext.sleep_hours_last_night < 6) {
      lines.push(`Sleep last night: ${brainContext.sleep_hours_last_night}h (low — adjust expectations and tone)`);
    }
  }

  // Pending intervention — the brain has something it wants to say
  if (brainContext.pending_intervention) {
    lines.push(`Brain's intended message: "${brainContext.pending_intervention}" (approach: ${brainContext.intervention_approach || 'gentle'})`);
  }

  // Confirmed patterns about this student
  if (brainContext.confirmed_hypotheses?.length) {
    lines.push(`Confirmed patterns about ${studentName}:`);
    brainContext.confirmed_hypotheses.slice(0, 4).forEach(h => lines.push(`  • ${h}`));
  }

  // What NOT to mention this session
  if (brainContext.do_not_mention?.length) {
    lines.push(`Do NOT mention this session: ${brainContext.do_not_mention.join(', ')}`);
  }

  // Voice preferences
  if (brainContext.voice_preferences) {
    lines.push(`Voice/tone: ${brainContext.voice_preferences}`);
  }

  // Recent activity summary
  if (brainContext.recent_context_summary) {
    lines.push(`Last 48h: ${brainContext.recent_context_summary}`);
  }

  // Key insights from last reflection
  if (brainContext.key_insights) {
    lines.push(`Brain's key insight: ${brainContext.key_insights}`);
  }

  if (lines.length === 0) return '';

  return `\nBRAIN INTELLIGENCE (pre-computed — use this to shape your tone and response):\n${lines.join('\n')}`;
}

/**
 * Determine the best capability mode based on brain context.
 * Used to inform routing before keyword detection.
 *
 * @param {object|null} brainContext
 * @param {string} message — the student's message
 * @returns {string|null} suggested capability or null (fall back to keyword routing)
 */
export function getBrainSuggestedCapability(brainContext, message) {
  if (!brainContext) return null;

  const msg = message.toLowerCase();

  // Crisis keywords always win — non-negotiable
  const crisisWords = ['kill myself', 'suicide', 'end it', 'can\'t go on', 'want to die', 'hurt myself'];
  if (crisisWords.some(w => msg.includes(w))) return 'crisis';

  // High stress + deadline pressure + avoidance → focus mode
  // Even if the message is about a specific subject
  if (
    brainContext.stress_level > 0.7 &&
    brainContext.most_urgent_deadline?.hours_remaining < 24 &&
    brainContext.confirmed_hypotheses?.some(h =>
      h.toLowerCase().includes('avoid') || h.toLowerCase().includes('procrastinat')
    )
  ) {
    return 'focus';
  }

  // Declining momentum + absence signals → motivation
  if (
    brainContext.momentum_state === 'declining' &&
    (msg.includes('give up') || msg.includes('can\'t') || msg.includes('tired') || msg.includes('burnt'))
  ) {
    return 'motivation';
  }

  // Pending intervention with motivational approach → motivation
  if (brainContext.pending_intervention && brainContext.intervention_approach === 'motivational') {
    return 'motivation';
  }

  return null; // Fall back to keyword detection in agent-router
}
