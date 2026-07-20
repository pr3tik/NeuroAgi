// Focus-music search — proxies the public iTunes Search API (no key) and returns
// a simplified track list with 30s previews playable via `new Audio(previewUrl)`.
//
//   GET /api/music?term=lofi%20study&limit=15
//   → { tracks: [{ title, artist, previewUrl, artwork }] }
//
// Routed (no leading underscore) so it works on Vercel; a matching dev proxy in
// vite.config.js runs this same handler under `npm run dev`.

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const term = String(req.query?.term ?? "lofi study").slice(0, 120) || "lofi study";
  const limit = Math.min(25, Math.max(1, parseInt(String(req.query?.limit ?? "15"), 10) || 15));

  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=${limit}`;
    const upstream = await fetch(url);
    if (!upstream.ok) return res.status(502).json({ error: `iTunes ${upstream.status}` });
    const data: any = await upstream.json();
    const tracks = (data?.results || [])
      .filter((t: any) => t?.previewUrl)
      .map((t: any) => ({
        title: t.trackName,
        artist: t.artistName,
        previewUrl: t.previewUrl,
        artwork: (t.artworkUrl100 || t.artworkUrl60 || "").replace("100x100", "200x200"),
      }));
    res.setHeader("Cache-Control", "public, s-maxage=600");
    return res.status(200).json({ tracks });
  } catch (err: any) {
    return res.status(502).json({ error: err?.message ?? "music search failed" });
  }
}
