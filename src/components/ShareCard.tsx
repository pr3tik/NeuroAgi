// ShareCard.jsx — Social profile card with leaderboard opt-in + share action.
// Song field upgraded: iTunes Search API, album art, saves JSON to favorite_song.

import { useState, useEffect, useRef, useCallback } from "react";
import { Music, Pencil, X, Search, Check, Image as ImageIcon } from "lucide-react";
import { useApp } from "../context/AppContext";

/* Hallmark · component: card · genre: atmospheric · theme: App Shell (studied-DNA)
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: pass (46–50)
 */

const AVATAR_HUE = [
  "rgba(0,210,190,0.7)",
  "rgba(100,150,255,0.7)",
  "rgba(255,130,100,0.7)",
  "rgba(175,130,255,0.7)",
  "rgba(70,200,130,0.7)",
  "rgba(255,175,50,0.7)",
];

function nameToHue(name = "") {
  const n = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_HUE[n % AVATAR_HUE.length];
}

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: "8px",
  padding: "8px 12px",
  color: "var(--text-primary)",
  fontSize: "13px",
  outline: "none",
  fontFamily: "inherit",
  width: "100%",
  transition: "border-color 0.15s",
  boxSizing: "border-box",
};

function StatPill({ label, value }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
      <span style={{ color: "var(--text-primary)", fontSize: "17px", fontWeight: "600", letterSpacing: "-0.3px" }}>
        {value ?? "—"}
      </span>
      <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", letterSpacing: "0.5px" }}>
        {label}
      </span>
    </div>
  );
}

// Parse stored favorite_song — could be plain text (legacy) or JSON
function parseSong(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.title) return parsed; // { title, artist, artworkUrl }
  } catch (_) {}
  // Legacy plain text — treat as display string only
  return { title: raw, artist: null, artworkUrl: null, legacy: true };
}

// iTunes Search API — no key needed
async function searchiTunes(term) {
  if (!term || term.trim().length < 2) return [];
  // Always use /api/itunes serverless proxy — fixes CORS on iOS Safari, Android, all browsers
  const url = `/api/utils?fn=itunes&term=${encodeURIComponent(term)}&media=music&entity=song&limit=8&lang=en_us`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).map(t => ({
    title: t.trackName,
    artist: t.artistName,
    artworkUrl: t.artworkUrl100?.replace("100x100", "60x60") ?? t.artworkUrl60,
    artworkUrlLarge: t.artworkUrl100,
  }));
}

export default function ShareCard() {
  const { userData, updateUserField } = useApp();
  const cardRef = useRef(null);

  // ── Song state ────────────────────────────────────────────────────
  const [songData,    setSongData]    = useState(null);       // { title, artist, artworkUrl } | null
  const [searching,   setSearching]   = useState(false);      // dropdown open
  const [query,       setQuery]       = useState("");
  const [results,     setResults]     = useState([]);
  const [loading,     setLoading]     = useState(false);
  const debounceRef                   = useRef(null);
  const dropdownRef                   = useRef(null);

  // ── Other state ──────────────────────────────────────────────────
  const [optIn,  setOptIn]  = useState(Boolean(userData?.leaderboard_opt_in));
  const [copied, setCopied] = useState(false);

  // Sync from userData on load
  useEffect(() => {
    if (!userData) return;
    setSongData(parseSong(userData.favorite_song));
    setOptIn(Boolean(userData.leaderboard_opt_in));
  }, [userData]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function onClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setSearching(false);
        setQuery("");
        setResults([]);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Debounced iTunes search
  const handleQueryChange = useCallback((val) => {
    setQuery(val);
    clearTimeout(debounceRef.current);
    if (!val.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const hits = await searchiTunes(val);
        setResults(hits);
      } catch (_) {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 380);
  }, []);

  async function pickSong(track) {
    const payload = {
      title: track.title,
      artist: track.artist,
      artworkUrl: track.artworkUrlLarge ?? track.artworkUrl,
    };
    setSongData(payload);
    setSearching(false);
    setQuery("");
    setResults([]);
    await updateUserField("favorite_song", JSON.stringify(payload));
  }

  async function clearSong() {
    setSongData(null);
    await updateUserField("favorite_song", null);
  }

  // ── Derived values ──────────────────────────────────────────────
  const name      = userData?.name      ?? localStorage.getItem("fschool_name") ?? "Student";
  const school    = userData?.school    ?? "My University";
  const city      = userData?.city      ?? null;
  const country   = userData?.country   ?? null;
  const gpa       = userData?.gpa        != null ? userData.gpa.toFixed(2)      : "3.87";
  const streak    = userData?.streak     != null ? `${userData.streak}d`        : "0d";
  const studyTime = userData?.study_time != null ? `${userData.study_time}h`    : "0h";

  const location = [city, country].filter(Boolean).join(", ");
  const hue      = nameToHue(name);
  const initial  = (name?.[0] ?? "?").toUpperCase();

  // ── Opt-in toggle ───────────────────────────────────────────────
  async function handleOptInToggle() {
    const next = !optIn;
    setOptIn(next);
    await updateUserField("leaderboard_opt_in", next);
  }

  // ── Share / export ───────────────────────────────────────────────
  async function handleShare() {
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: "#0d0d0d",
        scale: 3,
        useCORS: true,
        logging: false,
      });

      const blob: any = await new Promise(res => canvas.toBlob(res, "image/png"));
      const file = new File([blob], "my-neuroagi-card.png", { type: "image/png" });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${name} · NeuroAGI` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "my-neuroagi-card.png";
        a.click();
        URL.revokeObjectURL(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      console.error("Share failed:", err);
      const text = [
        `${name} · ${school}`,
        location ? location : null,
        `GPA ${gpa}  ·  ${streak} streak  ·  ${studyTime} studied`,
        songData ? `${songData.title}${songData.artist ? ` — ${songData.artist}` : ""}` : null,
        `via NeuroAGI`,
      ].filter(Boolean).join("\n");
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  // ── Now Playing section ─────────────────────────────────────────
  function NowPlaying() {
    // Display mode: song is picked
    if (songData && !searching) {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {songData.artworkUrl && !songData.legacy ? (
            <img
              src={songData.artworkUrl}
              alt={songData.title}
              style={{
                width: 40, height: 40, borderRadius: "8px",
                objectFit: "cover", flexShrink: 0,
                boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
              }}
              onError={e => { e.currentTarget.style.display = "none"; }}
            />
          ) : (
            // Fallback for legacy plain-text entries
            <div style={{
              width: 40, height: 40, borderRadius: "8px", flexShrink: 0,
              background: "rgba(0,210,190,0.12)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Music size={18} style={{ color: "rgba(0,210,190,0.9)" }} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              color: "var(--text-primary)", fontSize: "13px", fontWeight: "500",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {songData.title}
            </p>
            {songData.artist && (
              <p style={{
                color: "rgba(255,255,255,0.35)", fontSize: "11px", marginTop: "1px",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {songData.artist}
              </p>
            )}
          </div>
          <button
            onClick={() => setSearching(true)}
            title="Change song"
            style={{
              background: "none", border: "none", padding: "4px 6px",
              color: "rgba(255,255,255,0.25)", cursor: "pointer",
              fontSize: "12px", borderRadius: "6px",
              transition: "color 0.15s, background 0.15s",
              flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.55)"; e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.25)"; e.currentTarget.style.background = "none"; }}
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={clearSong}
            title="Remove song"
            style={{
              background: "none", border: "none", padding: "4px 6px",
              color: "rgba(255,255,255,0.18)", cursor: "pointer",
              fontSize: "13px", borderRadius: "6px",
              transition: "color 0.15s, background 0.15s",
              flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,80,80,0.6)"; e.currentTarget.style.background = "rgba(255,80,80,0.05)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.18)"; e.currentTarget.style.background = "none"; }}
          >
            <X size={13} />
          </button>
        </div>
      );
    }

    // Search mode
    return (
      <div ref={dropdownRef} style={{ position: "relative" }}>
        <div style={{ position: "relative" }}>
          <span style={{
            position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
            pointerEvents: "none", opacity: 0.4, display: "flex",
          }}><Search size={13} /></span>
          <input
            autoFocus
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            onKeyDown={e => e.key === "Escape" && (setSearching(false), setQuery(""), setResults([]))}
            placeholder="Search for a song…"
            style={{ ...inputStyle, paddingLeft: "30px" }}
          />
          {loading && (
            <span style={{
              position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
              fontSize: "11px", opacity: 0.4, color: "rgba(0,210,190,0.8)",
            }}>
              ···
            </span>
          )}
        </div>

        {results.length > 0 && (
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 50,
            background: "rgba(18,18,22,0.97)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "12px",
            overflow: "hidden",
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}>
            {results.map((track, i) => (
              <button
                key={i}
                onClick={() => pickSong(track)}
                style={{
                  width: "100%", background: "none", border: "none", padding: "9px 12px",
                  display: "flex", alignItems: "center", gap: "10px",
                  cursor: "pointer", textAlign: "left",
                  borderBottom: i < results.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                  transition: "background 0.12s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                onMouseLeave={e => e.currentTarget.style.background = "none"}
              >
                {track.artworkUrl ? (
                  <img
                    src={track.artworkUrl}
                    alt=""
                    style={{ width: 36, height: 36, borderRadius: "6px", objectFit: "cover", flexShrink: 0 }}
                  />
                ) : (
                  <div style={{
                    width: 36, height: 36, borderRadius: "6px", flexShrink: 0,
                    background: "rgba(255,255,255,0.06)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px",
                  }}><Music size={16} /></div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    color: "var(--text-primary)", fontSize: "13px", fontWeight: "500",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {track.title}
                  </p>
                  <p style={{
                    color: "rgba(255,255,255,0.35)", fontSize: "11px", marginTop: "1px",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {track.artist}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Empty state */}
        {query.length >= 2 && !loading && results.length === 0 && (
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 50,
            background: "rgba(18,18,22,0.97)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "12px",
            padding: "16px 12px",
            textAlign: "center",
            color: "rgba(255,255,255,0.25)",
            fontSize: "12px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          }}>
            No results for "{query}"
          </div>
        )}
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div style={{ marginTop: "32px" }}>
      <p style={{
        fontSize: "11px", color: "var(--text-dim)",
        letterSpacing: "2px", textTransform: "uppercase", marginBottom: "14px",
      }}>
        Your Card
      </p>

      <div ref={cardRef} style={{
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(32px)",
        WebkitBackdropFilter: "blur(32px)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "20px",
        padding: "24px 20px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Teal accent stripe */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: "2px",
          background: "linear-gradient(90deg, rgba(0,210,190,0.7) 0%, rgba(0,210,190,0.1) 60%, transparent 100%)",
          borderRadius: "20px 20px 0 0",
          pointerEvents: "none",
        }} />

        {/* Ambient glow */}
        <div style={{
          position: "absolute", top: -40, right: -40, width: 180, height: 180,
          background: "radial-gradient(circle, rgba(0,210,190,0.06) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        {/* Header row */}
        <div style={{
          display: "flex", justifyContent: "space-between",
          alignItems: "flex-start", marginBottom: "20px",
        }}>
          <div style={{ flex: 1, minWidth: 0, marginRight: "12px" }}>
            <p style={{
              color: "var(--text-primary)", fontSize: "18px",
              fontWeight: "700", letterSpacing: "-0.4px",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {name}
            </p>
            <p style={{
              color: "rgba(255,255,255,0.38)", fontSize: "12px", marginTop: "2px",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {school}
            </p>
            {location && (
              <p style={{ color: "rgba(255,255,255,0.22)", fontSize: "11px", marginTop: "2px" }}>
                {location}
              </p>
            )}
          </div>

          {/* Avatar */}
          <div style={{
            width: 42, height: 42, borderRadius: "50%",
            background: `radial-gradient(circle at 35% 35%, ${hue}, rgba(0,0,0,0.3))`,
            border: `1.5px solid ${hue}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <span style={{ fontSize: "17px", fontWeight: "700", color: "#fff" }}>{initial}</span>
          </div>
        </div>

        {/* Stats row */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px",
          paddingBottom: "18px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          marginBottom: "18px",
        }}>
          <StatPill label="GPA"        value={gpa} />
          <StatPill label="Streak"     value={streak} />
          <StatPill label="Study Time" value={studyTime} />
        </div>

        {/* Now Playing */}
        <div style={{ marginBottom: "18px" }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: "8px",
          }}>
            <p style={{
              fontSize: "10px", color: "rgba(255,255,255,0.25)",
              letterSpacing: "1.5px", textTransform: "uppercase",
            }}>
              Now Playing
            </p>
            {/* Show "Add song" prompt if nothing picked and not searching */}
            {!songData && !searching && (
              <button
                onClick={() => setSearching(true)}
                style={{
                  background: "none", border: "none", padding: "2px 6px",
                  color: "rgba(0,210,190,0.5)", fontSize: "11px", cursor: "pointer",
                  fontFamily: "inherit", borderRadius: "4px",
                  transition: "color 0.15s",
                }}
                onMouseEnter={e => e.currentTarget.style.color = "rgba(0,210,190,0.85)"}
                onMouseLeave={e => e.currentTarget.style.color = "rgba(0,210,190,0.5)"}
              >
                + Add
              </button>
            )}
          </div>

          {/* Either show the song or the search UI */}
          {(!songData && !searching) ? (
            <button
              onClick={() => setSearching(true)}
              style={{
                background: "none", border: "none", padding: 0,
                color: "rgba(255,255,255,0.18)", fontSize: "13px", cursor: "pointer",
                fontFamily: "inherit", textAlign: "left", width: "100%",
              }}
            >
              Search for a song…
            </button>
          ) : (
            <NowPlaying />
          )}
        </div>

        {/* Leaderboard opt-in */}
        <div style={{
          display: "flex", justifyContent: "space-between",
          alignItems: "center", marginBottom: "18px",
        }}>
          <div>
            <p style={{ color: "var(--text-secondary)", fontSize: "13px" }}>Show on Leaderboard</p>
            <p style={{ color: "rgba(255,255,255,0.22)", fontSize: "11px", marginTop: "2px" }}>
              Visible to all users when opted in
            </p>
          </div>
          <button
            onClick={handleOptInToggle}
            style={{
              width: 44, height: 26, borderRadius: 13, border: "none", cursor: "pointer",
              background: optIn ? "rgba(0,210,190,0.7)" : "rgba(255,255,255,0.12)",
              position: "relative", flexShrink: 0,
              transition: "background 0.2s",
            }}
          >
            <div style={{
              width: 20, height: 20, borderRadius: "50%",
              background: "#fff",
              position: "absolute", top: 3,
              left: optIn ? 21 : 3,
              transition: "left 0.2s",
            }} />
          </button>
        </div>

        {/* Share button */}
        <button
          onClick={handleShare}
          style={{
            width: "100%",
            background: copied ? "rgba(0,210,190,0.15)" : "rgba(255,255,255,0.07)",
            border: `1px solid ${copied ? "rgba(0,210,190,0.3)" : "rgba(255,255,255,0.1)"}`,
            borderRadius: "12px",
            padding: "12px",
            color: copied ? "rgba(0,210,190,0.9)" : "var(--text-primary)",
            fontSize: "14px",
            fontWeight: "500",
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "background 0.2s, color 0.2s, border-color 0.2s",
          }}
        >
          {copied
            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Saved!<Check size={15} /></span>
            : <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Share Card<ImageIcon size={15} /></span>}
        </button>
      </div>
    </div>
  );
}
