#!/usr/bin/env node
/**
 * Dev-only mock of the JSON2Video API (json2video.com/docs/v2), used to test the
 * video pipeline without spending render credits or holding a real key.
 *
 *   node tools/mock-video.mjs            # listens on 20130
 *   JSON2VIDEO_API_KEY=test-key JSON2VIDEO_BASE_URL=http://127.0.0.1:20130/v2/movies npm run dev
 *
 * Implements exactly what the app uses:
 *   POST /v2/movies           → { success, project, timestamp }   (validates the body)
 *   GET  /v2/movies?project=  → { success, movie: { status, url, duration, size } }
 *
 * The first two status calls answer `queued`/`running`, the third answers `done`,
 * so the polling path is exercised for real.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 20130);
const KEY = process.env.MOCK_KEY ?? "test-key";
const polls = new Map();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (url.pathname !== "/v2/movies") {
    return json(res, 404, { message: "not found" });
  }
  if (req.headers["x-api-key"] !== KEY) {
    return json(res, 401, { message: "You exceeded the quota of movies in your plan. Please upgrade your plan to continue." });
  }

  if (req.method === "GET") {
    const project = url.searchParams.get("project") ?? "";
    if (!project) return json(res, 400, { message: "No project id" });
    const count = (polls.get(project) ?? 0) + 1;
    polls.set(project, count);
    if (count < 3) {
      return json(res, 200, { success: true, movie: { status: count === 1 ? "queued" : "running" } });
    }
    return json(res, 200, {
      success: true,
      movie: {
        status: "done",
        url: `https://assets.json2video.com/mock/${project}.mp4`,
        duration: 9,
        size: { width: 1280, height: 720 },
      },
    });
  }

  if (req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let movie;
      try {
        movie = JSON.parse(body);
      } catch {
        return json(res, 400, { message: "Error parsing movie JSON or the movie was empty" });
      }
      if (!movie || typeof movie !== "object") {
        return json(res, 400, { message: "No valid movie JSON received" });
      }
      if (!Array.isArray(movie.scenes) || movie.scenes.length === 0) {
        return json(res, 400, { message: "The movie has no scenes" });
      }
      const bad = movie.scenes.find((scene) => !Array.isArray(scene.elements) || scene.elements.length === 0);
      if (bad) return json(res, 400, { message: "A scene has no elements" });
      const project = `MOCK${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      polls.set(project, 0);
      console.log(`[mock-video] accepted project=${project} scenes=${movie.scenes.length} resolution=${movie.resolution}`);
      return json(res, 200, { success: true, project, timestamp: new Date().toISOString() });
    });
    return;
  }

  return json(res, 405, { message: "method not allowed" });
});

server.listen(PORT, "127.0.0.1", () => console.log(`[mock-video] JSON2Video mock on http://127.0.0.1:${PORT}/v2/movies`));
