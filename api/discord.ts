// api/discord.js — unified Discord handler (single Vercel function)
// Routes:
//   GET  /api/discord?action=login&uid=<uid>           — start OAuth
//   GET  /api/discord?action=callback&code=&state=     — exchange code, award tokens
//   GET  /api/discord?action=post-feedback-button      — one-time: post embed+button to channel
//                     &secret=DISCORD_ADMIN_SECRET&channel_id=ID
//   POST /api/discord?action=interactions              — Discord webhook (PING/slash/button/modal)
//
// Env vars required (set in Vercel):
//   DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN,
//   DISCORD_PUBLIC_KEY     (Developer Portal → General Information → Public Key)
//   DISCORD_GUILD_ID       (right-click server → Copy Server ID)
//   DISCORD_REDIRECT_URI   (https://fschoolai.com/api/discord?action=callback)
//   APP_BASE_URL           (https://fschoolai.com)
//   DISCORD_ADMIN_SECRET   (any secret string — used to guard post-feedback-button)
//   SUPABASE_URL, SUPABASE_SERVICE_KEY

import { createClient } from "@supabase/supabase-js";
import nacl from "tweetnacl";
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireUser } from "./_auth.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const DISCORD_API = "https://discord.com/api/v10";

// Signed OAuth `state` — binds the account-link flow to the authenticated initiator so the
// callback can't be tricked into linking a Discord account to a victim's profile (the old flow
// took a plaintext uid from an unauthenticated navigation → account-linking CSRF).
function stateSecret() { return process.env.SUPABASE_SERVICE_KEY || process.env.CRON_SECRET || "discord-state-dev"; }
function signState(uid: string, exp: number) {
  return `${uid}.${exp}.${createHmac("sha256", stateSecret()).update(`${uid}.${exp}`).digest("base64url")}`;
}
function readState(state: string): string | null {
  const p = String(state || "").split(".");
  if (p.length !== 3) return null;
  const [uid, expStr, sig] = p;
  const exp = parseInt(expStr, 10);
  if (!uid || !Number.isFinite(exp) || Date.now() > exp) return null;
  const expected = createHmac("sha256", stateSecret()).update(`${uid}.${expStr}`).digest("base64url");
  try { return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? uid : null; }
  catch { return null; }
}

// Vercel: disable automatic body parsing — raw bytes required for Ed25519 verify.
export const config = { api: { bodyParser: false } };

// ── Inline token-award helper ─────────────────────────────────────────────────
// Mirrors api/token-engine.js. Keeps amounts in sync manually.
const DISCORD_AWARD_CFG = {
  discord_connected: { tokens: 5, lifetimeMax: 1    },
  feedback_given:    { tokens: 1, lifetimeMax: null },
};

async function awardPoints(userId, action) {
  const cfg = DISCORD_AWARD_CFG[action];
  if (!cfg) return { awarded: false, reason: "unknown_action" };

  if (cfg.lifetimeMax) {
    const { count, error: ltErr } = await supabase
      .from("token_events").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("action", action);
    if (ltErr) console.error(`[discord/awardPoints] lifetime-check error (${action}):`, ltErr.message);
    if ((count ?? 0) >= cfg.lifetimeMax) return { awarded: false, reason: "lifetime_limit" };
  }

  const dt = new Date().toISOString().slice(0, 10);

  const { error: evtErr } = await supabase.from("token_events").insert({
    user_id: userId, action, tokens: cfg.tokens, awarded_on: dt,
  });
  if (evtErr) console.error(`[discord/awardPoints] token_events.insert error (${action}):`, evtErr.message, "| user_id:", userId);

  const { data: userRow, error: userReadErr } = await supabase
    .from("users").select("points").eq("id", userId).maybeSingle();
  if (userReadErr) console.error(`[discord/awardPoints] users.select error (${action}):`, userReadErr.message, "| user_id:", userId);

  const newPoints = (userRow?.points ?? 0) + cfg.tokens;
  const { error: userUpdErr } = await supabase
    .from("users").update({ points: newPoints }).eq("id", userId);
  if (userUpdErr) console.error(`[discord/awardPoints] users.update (points) error (${action}):`, userUpdErr.message, "| user_id:", userId);

  const { error: lbErr } = await supabase.from("leaderboard").upsert(
    { user_id: userId, points: newPoints, updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );
  if (lbErr) console.error(`[discord/awardPoints] leaderboard.upsert error (${action}):`, lbErr.message, "| user_id:", userId);

  return { awarded: true, tokens: cfg.tokens, newPoints };
}

// ── Raw body reader — event-based, reliable on Vercel Node 18+ ESM ────────────
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end",  () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ── Feedback modal definition ─────────────────────────────────────────────────
// type 9 = MODAL response. Sent for both /feedback command and button click.
const FEEDBACK_MODAL = {
  type: 9,
  data: {
    custom_id: "feedback_modal",
    title: "FschoolAI Feedback",
    components: [
      {
        type: 1,
        components: [{
          type: 4, custom_id: "rating", style: 1,
          label: "How would you rate FschoolAI? (1–5)",
          placeholder: "5", required: true, min_length: 1, max_length: 1,
        }],
      },
      {
        type: 1,
        components: [{
          type: 4, custom_id: "working", style: 2,
          label: "What's working well for you?",
          required: true, max_length: 500,
        }],
      },
      {
        type: 1,
        components: [{
          type: 4, custom_id: "improve", style: 2,
          label: "What should we improve?",
          required: true, max_length: 500,
        }],
      },
      {
        type: 1,
        components: [{
          type: 4, custom_id: "feature", style: 2,
          label: "A feature you'd love?",
          required: false, max_length: 300,
        }],
      },
      {
        type: 1,
        components: [{
          type: 4, custom_id: "extra", style: 1,
          label: "Anything else? (optional)",
          required: false, max_length: 200,
        }],
      },
    ],
  },
};

// ── Helper: extract a field value from modal submit components ────────────────
function modalField(body, id) {
  return body.data.components
    .flatMap(row => row.components)
    .find(c => c.custom_id === id)?.value?.trim() || null;
}

export default async function handler(req, res) {
  const action = req.query.action;

  // ── GET ?action=login ─────────────────────────────────────────────────────
  // Fetched (not navigated) by the client so it carries the caller's JWT; we derive the uid from
  // the verified session and sign it into `state`, then return the OAuth URL for the client to
  // navigate to. The uid is NEVER taken from the query (that was the CSRF).
  if (action === "login") {
    const authed = await requireUser(req);
    if (!authed) return res.status(401).json({ error: "Authentication required." });
    const state = signState(authed.userId, Date.now() + 10 * 60 * 1000);   // 10 min to complete
    const params = new URLSearchParams({
      client_id:     process.env.DISCORD_CLIENT_ID,
      redirect_uri:  process.env.DISCORD_REDIRECT_URI,
      response_type: "code",
      scope:         "identify guilds.join",
      state,
      prompt:        "consent",
    });
    return res.status(200).json({ url: `https://discord.com/oauth2/authorize?${params}` });
  }

  // ── GET ?action=callback ──────────────────────────────────────────────────
  if (action === "callback") {
    const { code, state } = req.query;
    const appBase = process.env.APP_BASE_URL || "https://fschoolai.com";
    // Derive the uid from the SIGNED state (proves the flow was started by that authenticated
    // user) — never trust a plaintext state.
    const uid = readState(String(state ?? ""));
    if (!code || !uid) return res.writeHead(302, { Location: `${appBase}/?discord=error` }).end();

    try {
      const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: "authorization_code", code, redirect_uri: process.env.DISCORD_REDIRECT_URI,
        }),
      });
      if (!tokenRes.ok) throw new Error(`token exchange ${tokenRes.status}`);
      const token = await tokenRes.json();

      const meRes = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!meRes.ok) throw new Error(`users/@me ${meRes.status}`);
      const me = await meRes.json();

      const joinRes = await fetch(
        `${DISCORD_API}/guilds/${process.env.DISCORD_GUILD_ID}/members/${me.id}`,
        {
          method: "PUT",
          headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ access_token: token.access_token }),
        }
      );
      const joined = joinRes.status === 201 || joinRes.status === 204;

      const { data: existing, error: lookupErr } = await supabase
        .from("users").select("discord_user_id").eq("id", uid).maybeSingle();
      if (lookupErr) console.error("[discord/callback] users.select error:", lookupErr.message, "| uid:", uid);

      const { error: linkErr } = await supabase
        .from("users").update({ discord_user_id: me.id }).eq("id", uid);
      if (linkErr) console.error("[discord/callback] users.update (discord_user_id) error:", linkErr.message, "| uid:", uid);

      if (!existing?.discord_user_id) {
        const award = await awardPoints(uid, "discord_connected");
        console.log("[discord/callback] discord_connected award:", award);
      }

      return res.writeHead(302, { Location: `${appBase}/?discord=${joined ? "connected" : "connected_nojoin"}` }).end();
    } catch (err) {
      console.error("[discord/callback] unhandled error:", err.message);
      return res.writeHead(302, { Location: `${appBase}/?discord=error` }).end();
    }
  }

  // ── GET ?action=post-feedback-button ──────────────────────────────────────
  // One-time admin call: posts the feedback embed + button to a Discord channel.
  // Run: GET /api/discord?action=post-feedback-button&secret=SECRET&channel_id=ID
  if (action === "post-feedback-button") {
    const secret    = req.query.secret;
    const channelId = req.query.channel_id;
    if (!secret || secret !== (process.env.DISCORD_ADMIN_SECRET || "")) {
      return res.status(401).json({ error: "Unauthorized — set DISCORD_ADMIN_SECRET in Vercel env vars" });
    }
    if (!channelId) return res.status(400).json({ error: "channel_id query param required" });

    const msgRes = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: "FschoolAI Feedback",
          description: "Help us build the best academic AI — takes 30 seconds.",
          color: 0xC49A3C,
        }],
        components: [{
          type: 1,
          components: [{
            type: 2, style: 1, label: "Share Feedback", custom_id: "open_feedback",
          }],
        }],
      }),
    });

    if (!msgRes.ok) {
      const errText = await msgRes.text();
      console.error("[discord/post-feedback-button] Discord API error:", msgRes.status, errText);
      return res.status(502).json({ error: `Discord API ${msgRes.status}`, detail: errText.slice(0, 200) });
    }
    const msg = await msgRes.json();
    return res.status(200).json({ ok: true, message_id: msg.id, channel_id: channelId });
  }

  // ── POST ?action=interactions ─────────────────────────────────────────────
  if (action === "interactions") {
    const signature = req.headers["x-signature-ed25519"];
    const timestamp = req.headers["x-signature-timestamp"];
    const raw = await readRawBody(req) as Buffer;

    if (!raw.length) {
      console.error("[discord/interactions] raw body is EMPTY — bodyParser:false may be ineffective");
    }

    // Ed25519 signature verify — MUST use raw bytes before any JSON parsing.
    // .trim() guards against Vercel env var editor appending trailing newlines.
    const verified = signature && timestamp && raw.length > 0 && nacl.sign.detached.verify(
      Buffer.concat([Buffer.from(timestamp.trim()), raw]),
      Buffer.from(signature.trim(), "hex"),
      Buffer.from((process.env.DISCORD_PUBLIC_KEY || "").trim(), "hex")
    );
    if (!verified) return res.status(401).send("invalid request signature");

    const body = JSON.parse(raw.toString("utf8"));

    // ── type 1: PING → PONG ───────────────────────────────────────────────
    if (body.type === 1) return res.status(200).json({ type: 1 });

    // ── type 2: APPLICATION_COMMAND (/feedback) → open modal ─────────────
    if (body.type === 2 && body.data?.name === "feedback") {
      return res.status(200).json(FEEDBACK_MODAL);
    }

    // ── type 3: MESSAGE_COMPONENT (button click) → open modal ────────────
    if (body.type === 3 && body.data?.custom_id === "open_feedback") {
      return res.status(200).json(FEEDBACK_MODAL);
    }

    // ── type 5: MODAL_SUBMIT → save structured feedback + award token ─────
    if (body.type === 5 && body.data?.custom_id === "feedback_modal") {
      const discordId = body.member?.user?.id || body.user?.id;

      // Extract all five fields
      const ratingRaw = modalField(body, "rating");
      const working   = modalField(body, "working");
      const improve   = modalField(body, "improve");
      const feature   = modalField(body, "feature");
      const extra     = modalField(body, "extra");

      // Validate rating (1-5); accept feedback regardless, flag invalid as null
      const ratingNum = parseInt(ratingRaw, 10);
      const rating    = ratingNum >= 1 && ratingNum <= 5 ? ratingNum : null;
      if (ratingRaw && rating === null) {
        console.warn("[discord/modal] invalid rating value:", ratingRaw, "| discordId:", discordId);
      }

      // Combined content fallback (keeps legacy queries working)
      const content = [
        `Rating: ${ratingRaw ?? "—"}`,
        `Working: ${working ?? "—"}`,
        `Improve: ${improve ?? "—"}`,
        ...(feature ? [`Feature: ${feature}`] : []),
        ...(extra   ? [`Extra: ${extra}`]     : []),
      ].join("\n");

      try {
        // Look up fschool user — save regardless, token only if linked
        const { data: user, error: userLookupErr } = await supabase
          .from("users").select("id, feedback_points")
          .eq("discord_user_id", discordId).maybeSingle();
        if (userLookupErr) console.error("[discord/modal] users.select error:", userLookupErr.message, "| discordId:", discordId);

        // Write structured feedback row
        const { error: fbErr } = await supabase.from("feedback").insert({
          user_id:         user?.id ?? null,
          discord_user_id: discordId,
          content,
          rating,
          working,
          improve,
          feature,
          extra,
          points_awarded:  user ? 1 : 0,
        });
        if (fbErr) console.error("[discord/modal] feedback.insert error:", fbErr.message, "| discordId:", discordId);

        // Unlinked user — save feedback but no token
        if (!user) {
          return res.status(200).json({
            type: 4,
            data: {
              flags: 64,
              content: "Feedback recorded — link your FSchoolAI account in the app to earn tokens for future submissions.",
            },
          });
        }

        // Increment feedback_points tracking counter
        const { error: fpErr } = await supabase
          .from("users").update({ feedback_points: (user.feedback_points || 0) + 1 }).eq("id", user.id);
        if (fpErr) console.error("[discord/modal] users.update (feedback_points) error:", fpErr.message, "| user_id:", user.id);

        // Award leaderboard-visible token through engine
        const award = await awardPoints(user.id, "feedback_given");
        console.log("[discord/modal] feedback_given award result:", award);

        // Personalised thank-you — names what they gave
        const ratingLine  = rating ? `Thanks for the ${rating}/5` : "Thanks for your feedback";
        const improveNote = improve ? " and your notes on what to improve" : "";
        return res.status(200).json({
          type: 4,
          data: {
            flags: 64,
            content: `${ratingLine}${improveNote} — recorded. +1 token added to your leaderboard.`,
          },
        });
      } catch (err) {
        console.error("[discord/modal] unhandled error:", err.message);
        return res.status(200).json({
          type: 4,
          data: { flags: 64, content: "Something went wrong saving your feedback. Try again in a moment." },
        });
      }
    }

    // Unknown interaction type — acknowledge silently
    return res.status(200).json({ type: 1 });
  }

  return res.status(400).json({ error: "Unknown action. Use ?action=login, callback, interactions, or post-feedback-button" });
}
