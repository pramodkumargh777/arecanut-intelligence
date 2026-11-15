// YouTube Shorts through the official YouTube Data API (videos.insert, resumable upload). A vertical video under three
// minutes is a Short automatically. Needs YT_CLIENT_ID, YT_CLIENT_SECRET (a Desktop OAuth client) and YT_REFRESH_TOKEN
// (written by `npm --workspace video run publish:setup-youtube`).
//
// Google rule: uploads from an API project that has not passed YouTube's API audit are locked to private. Until the
// audit is approved, videos arrive private; make them public in YouTube Studio, or set YT_PRIVACY=private meanwhile.
import { readFileSync, statSync } from "node:fs";
import { env, missing, request } from "./lib.mjs";

export const YOUTUBE_KEYS = ["YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN"];
export const youtubeMissing = () => missing(YOUTUBE_KEYS);

async function accessToken() {
  try {
    const { body } = await request(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: env("YT_CLIENT_ID"), client_secret: env("YT_CLIENT_SECRET"), refresh_token: env("YT_REFRESH_TOKEN"), grant_type: "refresh_token" }),
      },
      { label: "YouTube sign-in", retries: 2, timeout: 30_000 },
    );
    return body.access_token;
  } catch (error) {
    if (/invalid_grant|expired|revoked/i.test(error.message)) {
      throw new Error("YouTube sign-in has expired or was revoked. Run `npm --workspace video run publish:setup-youtube` again (and set the Google app to \"In production\" so it stops expiring every 7 days).");
    }
    throw error;
  }
}

export async function checkYouTube() {
  const token = await accessToken();
  const { body } = await request("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${token}` } }, { label: "YouTube channel", retries: 1, timeout: 30_000 });
  const channel = body.items?.[0]?.snippet?.title;
  if (!channel) throw new Error("This Google account has no YouTube channel.");
  return channel;
}

/** Uploads one Short; returns { id, url, note }. */
export async function postYouTube({ file, title, description, tags, lang }) {
  const token = await accessToken();
  const privacy = env("YT_PRIVACY", "public");
  const meta = {
    snippet: { title, description, tags, categoryId: "27", defaultLanguage: lang, defaultAudioLanguage: lang },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false, embeddable: true },
  };
  const size = statSync(file).size;
  const session = await request(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(size), "X-Upload-Content-Type": "video/mp4" },
      body: JSON.stringify(meta),
    },
    { label: "YouTube upload start", timeout: 60_000 },
  );
  const location = session.headers.get("location");
  if (!location) throw new Error("YouTube upload start: no upload address returned.");
  // The upload address is a one-time session URL; the bytes can be re-sent to it safely if the network drops.
  const { body } = await request(location, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: readFileSync(file) }, { label: "YouTube upload", retries: 2, timeout: 900_000 });
  const locked = privacy !== "private" && body.status?.privacyStatus === "private";
  return {
    id: body.id,
    url: `https://youtube.com/shorts/${body.id}`,
    note: locked ? "YouTube kept it private (API project not yet audited): make it public in YouTube Studio." : undefined,
  };
}
