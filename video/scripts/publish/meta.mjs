// Instagram (Reel and Story) and the Facebook Page (Reel), through Meta's official Graph API. Videos are uploaded
// straight from this Mac to rupload.facebook.com (resumable upload), so nothing has to be hosted anywhere.
// Needs IG_USER_ID + IG_ACCESS_TOKEN (Instagram professional account linked to the Page) and FB_PAGE_ID +
// FB_PAGE_TOKEN; `npm --workspace video run publish:setup-meta` fills all four from one Graph API Explorer token.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { env, missing, request, sleep, videoSeconds } from "./lib.mjs";

const VERSION = () => env("META_GRAPH_VERSION", "v27.0");
export const INSTAGRAM_KEYS = ["IG_USER_ID", "IG_ACCESS_TOKEN"];
export const FACEBOOK_KEYS = ["FB_PAGE_ID", "FB_PAGE_TOKEN"];
export const instagramMissing = () => missing(INSTAGRAM_KEYS);
export const facebookMissing = () => missing(FACEBOOK_KEYS);

/** A Graph API call; parameters go in the form body (captions can be long), the token in the header. */
async function graph(path, params, { token, method = "POST", label, retries = 0, host = "graph.facebook.com" }) {
  const url = `https://${host}/${VERSION()}/${path}`;
  const init = { method, headers: { Authorization: `OAuth ${token}` } };
  if (method === "GET") return (await request(`${url}?${new URLSearchParams(params)}`, init, { label, retries, timeout: 60_000 })).body;
  return (await request(url, { ...init, body: new URLSearchParams(params) }, { label, retries, timeout: 120_000 })).body;
}

/** Sends a local video to Meta's upload host. */
async function uploadBytes(uploadUrl, file, token, label) {
  await request(
    uploadUrl,
    { method: "POST", headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(statSync(file).size) }, body: readFileSync(file) },
    { label, retries: 2, timeout: 900_000 },
  );
}

/**
 * Meta's "data access" on the Page token lasts 90 days from the last sign-in, even though the token itself never
 * expires. Returns a warning when it ends within 14 days (re-run publish:setup-meta with a fresh Explorer token).
 */
export async function metaAccessWarning() {
  if (missing(["META_APP_ID", "META_APP_SECRET", "FB_PAGE_TOKEN"]).length) return null;
  const q = new URLSearchParams({ input_token: env("FB_PAGE_TOKEN"), access_token: `${env("META_APP_ID")}|${env("META_APP_SECRET")}` });
  const { body } = await request(`https://graph.facebook.com/${VERSION()}/debug_token?${q}`, {}, { label: "Meta token check", retries: 1, timeout: 30_000 });
  const data = body.data ?? {};
  if (!data.is_valid) return "Meta sign-in is no longer valid: generate a fresh token in the Graph API Explorer and run `npm --workspace video run publish:setup-meta`.";
  const ends = data.data_access_expires_at ? data.data_access_expires_at * 1000 : null;
  if (ends && ends - Date.now() < 14 * 86_400_000) {
    return `Meta data access ends on ${new Date(ends).toISOString().slice(0, 10)}: generate a fresh token in the Graph API Explorer and run \`npm --workspace video run publish:setup-meta\` (2 minutes).`;
  }
  return null;
}

export async function checkInstagram() {
  const body = await graph(env("IG_USER_ID"), { fields: "username" }, { token: env("IG_ACCESS_TOKEN"), method: "GET", label: "Instagram account", retries: 1 });
  return `@${body.username}`;
}

export async function checkFacebook() {
  const body = await graph(env("FB_PAGE_ID"), { fields: "name" }, { token: env("FB_PAGE_TOKEN"), method: "GET", label: "Facebook Page", retries: 1 });
  return body.name;
}

/** Instagram container → upload → wait until Instagram has processed it → publish. Returns the media id. */
async function instagramPublish(params, file, label) {
  const token = env("IG_ACCESS_TOKEN");
  const ig = env("IG_USER_ID");
  const container = await graph(`${ig}/media`, { ...params, upload_type: "resumable" }, { token, label: `${label} (create)` });
  await uploadBytes(container.uri ?? `https://rupload.facebook.com/ig-api-upload/${VERSION()}/${container.id}`, file, token, `${label} (upload)`);
  let status = "";
  for (let i = 0; i < 90 && status !== "FINISHED"; i++) {
    await sleep(5000);
    status = (await graph(container.id, { fields: "status_code" }, { token, method: "GET", label: `${label} (status)`, retries: 2 })).status_code;
    if (status === "ERROR" || status === "EXPIRED") throw new Error(`${label}: Instagram could not process the video (${status}).`);
  }
  if (status !== "FINISHED") throw new Error(`${label}: Instagram was still processing after 7 minutes; nothing was posted.`);
  const published = await graph(`${ig}/media_publish`, { creation_id: container.id }, { token, label: `${label} (publish)` });
  return published.id;
}

export async function postInstagramReel({ file, caption }) {
  const id = await instagramPublish({ media_type: "REELS", caption, share_to_feed: "true" }, file, "Instagram Reel");
  const link = await graph(id, { fields: "permalink" }, { token: env("IG_ACCESS_TOKEN"), method: "GET", label: "Instagram link", retries: 1 }).catch(() => ({}));
  return { id, url: link.permalink };
}

/**
 * The Story image goes up as a short still video (7 s, silent track): video Stories can be uploaded straight from this
 * Mac, while image Stories would need the picture hosted at a public address first.
 */
export async function postInstagramStory({ image }) {
  const video = image.replace(/\.png$/, "-story.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-framerate", "30", "-i", image, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "7", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", video]);
  const id = await instagramPublish({ media_type: "STORIES" }, video, "Instagram Story");
  return { id };
}

/** A Facebook Page Reel (3–90 s). Longer videos go up as a regular Page video instead. */
export async function postFacebookReel({ file, description }) {
  const token = env("FB_PAGE_TOKEN");
  const page = env("FB_PAGE_ID");
  const seconds = videoSeconds(file);
  if (seconds !== null && seconds > 90) {
    const form = new FormData();
    form.append("description", description);
    form.append("source", new Blob([readFileSync(file)], { type: "video/mp4" }), "video.mp4");
    const { body } = await request(`https://graph-video.facebook.com/${VERSION()}/${page}/videos`, { method: "POST", headers: { Authorization: `OAuth ${token}` }, body: form }, { label: "Facebook video", timeout: 900_000 });
    return { id: body.id, url: `https://www.facebook.com/${page}/videos/${body.id}`, note: `Longer than 90 s (${Math.round(seconds)} s), so posted as a Page video, not a Reel.` };
  }
  const start = await graph(`${page}/video_reels`, { upload_phase: "start" }, { token, label: "Facebook Reel (start)" });
  await uploadBytes(start.upload_url ?? `https://rupload.facebook.com/video-upload/${VERSION()}/${start.video_id}`, file, token, "Facebook Reel (upload)");
  await graph(`${page}/video_reels`, { upload_phase: "finish", video_id: start.video_id, video_state: "PUBLISHED", description }, { token, label: "Facebook Reel (publish)" });
  return { id: start.video_id, url: `https://www.facebook.com/reel/${start.video_id}` };
}
