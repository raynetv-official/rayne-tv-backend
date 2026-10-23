import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

const PLAYLIST_URL =
  "https://raw.githubusercontent.com/raynetv-official/RAYNE_TV/refs/heads/main/playlist.m3u";

// Payagan lamang ang upstream hosts na pinagkakatiwalaan mo.
// Idagdag lang ang host kung awtorisado kang mag-proxy mula rito.
const ALLOWED_HOSTS = new Set([
  "raw.githubusercontent.com",
  "cdn.ganbaruby23.xyz",
  "cdn3.ganbaruby23.xyz"
]);

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  next();
});

app.get("/", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    name: "RAYNE TV Backend",
    status: "online",
    version: "2.0"
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api", (req, res) => {
  res.json({
    name: "RAYNE TV API",
    status: "online",
    endpoints: [
      "/api",
      "/api/playlist",
      "/api/stream?url=ENCODED_STREAM_URL"
    ]
  });
});

// I-convert ang upstream URL sa URL ng backend.
function makeProxyUrl(upstreamUrl, baseUrl) {
  return `${baseUrl}/api/stream?url=${encodeURIComponent(upstreamUrl)}`;
}

// I-rewrite ang HLS manifest, kasama ang nested playlists,
// segment URLs at URI attributes gaya ng encryption keys.
function rewriteManifest(manifest, upstreamUrl, baseUrl) {
  const upstream = new URL(upstreamUrl);
  const lines = manifest.split(/\r?\n/);

  return lines.map((line) => {
    const trimmed = line.trim();

    if (!trimmed) return line;

    // Mga URI attribute sa EXT-X-KEY, EXT-X-MAP, MEDIA, at iba pa.
    if (trimmed.startsWith("#")) {
      return line.replace(
        /URI="([^"]+)"/g,
        (_match, uri) => {
          const absolute = new URL(uri, upstream).toString();
          return `URI="${makeProxyUrl(absolute, baseUrl)}"`;
        }
      );
    }

    // Mga segment at nested playlist.
    const absolute = new URL(trimmed, upstream).toString();
    return makeProxyUrl(absolute, baseUrl);
  }).join("\n");
}

// Kunin ang playlist at palitan ang channel stream URLs.
app.get("/api/playlist", async (req, res) => {
  try {
    const response = await fetch(PLAYLIST_URL, {
      headers: { Accept: "application/vnd.apple.mpegurl, text/plain" },
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      return res.status(502).json({
        error: "Hindi makuha ang playlist",
        upstreamStatus: response.status
      });
    }

    let playlist = await response.text();

    if (!playlist.trimStart().startsWith("#EXTM3U")) {
      return res.status(502).json({ error: "Invalid M3U playlist" });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    playlist = playlist
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith("#")) return line;

        try {
          const streamUrl = new URL(trimmed);

          if (!["http:", "https:"].includes(streamUrl.protocol)) {
            return line;
          }

          if (!ALLOWED_HOSTS.has(streamUrl.hostname)) {
            console.warn("Skipped non-allowlisted stream host:", streamUrl.hostname);
            return line;
          }

          return makeProxyUrl(streamUrl.toString(), baseUrl);
        } catch {
          return line;
        }
      })
      .join("\n");

    res.set({
      "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });

    return res.status(200).send(playlist);
  } catch (error) {
    console.error("Playlist error:", error.message);
    return res.status(502).json({ error: "Playlist request failed" });
  }
});

// HLS proxy: manifest, segment, key at iba pang resource.
app.get("/api/stream", async (req, res) => {
  try {
    const rawUrl = req.query.url;

    if (typeof rawUrl !== "string" || !rawUrl) {
      return res.status(400).json({ error: "Missing url parameter" });
    }

    let upstreamUrl;

    try {
      upstreamUrl = new URL(rawUrl);
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    if (!["http:", "https:"].includes(upstreamUrl.protocol)) {
      return res.status(400).json({ error: "Unsupported protocol" });
    }

    if (!ALLOWED_HOSTS.has(upstreamUrl.hostname)) {
      return res.status(403).json({ error: "Upstream host not allowed" });
    }

    const headers = {
      "User-Agent": "RAYNE-TV/2.0",
      "Accept": "*/*"
    };

    // Ipasa ang Range request kung kailangan ng player.
    if (req.headers.range) {
      headers.Range = req.headers.range;
    }

    const response = await fetch(upstreamUrl, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(30000)
    });

    // Huwag sundan ang redirect patungo sa host na hindi pinapayagan.
    const finalUrl = new URL(response.url || upstreamUrl.toString());

    if (!ALLOWED_HOSTS.has(finalUrl.hostname)) {
      await response.body?.cancel();
      return res.status(502).json({
        error: "Upstream redirected to a non-allowlisted host"
      });
    }

    const contentType =
      response.headers.get("content-type") || "application/octet-stream";

    const looksLikeManifest =
      /mpegurl/i.test(contentType) ||
      /\.(m3u8?)(?:$|\?)/i.test(finalUrl.pathname);

    if (looksLikeManifest) {
      const manifest = await response.text();

      if (!response.ok) {
        return res.status(response.status).send(manifest);
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const rewritten = rewriteManifest(manifest, finalUrl.toString(), baseUrl);

      res.set({
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      });

      return res.status(200).send(rewritten);
    }

    res.status(response.status);

    const headersToForward = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges"
    ];

    for (const name of headersToForward) {
      const value = response.headers.get(name);
      if (value) res.set(name, value);
    }

    res.set("Cache-Control", "no-store");
    res.set("Access-Control-Allow-Origin", "*");

    if (!response.body) return res.end();

    // I-stream ang video data sa client nang hindi iniipon lahat sa memory.
    const { Readable } = await import("node:stream");
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    console.error("Stream proxy error:", error.message);

    if (!res.headersSent) {
      res.status(502).json({ error: "Stream proxy request failed" });
    } else {
      res.end();
    }
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    availableEndpoints: ["/", "/health", "/api", "/api/playlist", "/api/stream"]
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`RAYNE TV Backend running on port ${PORT}`);
});
