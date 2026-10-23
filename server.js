import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

const PLAYLIST_URL =
"https://raw.githubusercontent.com/raynetv-official/RAYNE_TV/refs/heads/main/playlist.m3u";

app.get("/", (req, res) => {
res.json({
name: "RAYNE TV Backend",
status: "online",
version: "1.1"
});
});

app.get("/health", (req, res) => {
res.json({ status: "ok" });
});

app.get("/api", (req, res) => {
res.json({
name: "RAYNE TV API",
status: "online",
endpoints: ["/api", "/api/playlist"]
});
});

app.get("/api/playlist", async (req, res) => {
try {
const response = await fetch(PLAYLIST_URL, {
headers: { Accept: "application/vnd.apple.mpegurl, text/plain" }
});

if (!response.ok) {
  return res.status(502).send("Unable to load playlist");
}

const playlist = await response.text();

if (!playlist.trimStart().startsWith("#EXTM3U")) {
  return res.status(502).send("Invalid M3U playlist");
}

res.set({
  "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*"
});

return res.send(playlist);

} catch (error) {
return res.status(502).send("Playlist request failed");
}
});

app.listen(PORT, "0.0.0.0", () => {
console.log("RAYNE TV Backend running on port ${PORT}");
});
