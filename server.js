import express from "express";
const app = express(); const PORT = process.env.PORT || 3000;
const PLAYLIST_URL = "https://raw.githubusercontent.com/raynetv-official/RAYNE_TV/refs/heads/main/playlist.m3u";
app.disable("x-powered-by");
app.get("/", (req, res) => { res.set("Cache-Control", "no-store"); res.json({ name: "RAYNE TV Backend", status: "online", version: "1.2" }); });
app.get("/health", (req, res) => { res.json({ status: "ok" }); });
app.get("/api", (req, res) => { res.set("Cache-Control", "no-store"); res.json({ name: "RAYNE TV API", status: "online", version: "1.2", endpoints: ["/api", "/api/playlist"] }); });
app.options("/api/playlist", (req, res) => { res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }); res.sendStatus(204); });
app.get("/api/playlist", async (req, res) => { try { const upstream = await fetch(PLAYLIST_URL, { headers: { Accept: "application/vnd.apple.mpegurl, text/plain" }, signal: AbortSignal.timeout(15000) });
if (!upstream.ok) {
  console.error("Playlist source returned:", upstream.status);
  return res.status(502).json({
    error: "Unable to load playlist",
    upstreamStatus: upstream.status
  });
}

const playlist = await upstream.text();

if (!playlist.trimStart().startsWith("#EXTM3U")) {
  console.error("Playlist source did not return valid M3U");
  return res.status(502).json({
    error: "Invalid M3U playlist"
  });
}

res.set({
  "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*"
});

return res.status(200).send(playlist);
} catch (error) { console.error("Playlist fetch failed:", error.message); return res.status(502).json({ error: "Playlist request failed" }); } });
app.use((req, res) => { res.status(404).json({ error: "Endpoint not found", availableEndpoints: ["/", "/health", "/api", "/api/playlist"] }); });
app.listen(PORT, "0.0.0.0", () => { console.log(RAYNE TV Backend running on port ${PORT}); });
