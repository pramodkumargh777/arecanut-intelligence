// Shared helpers for the publishers. Secrets come from video/.daily.env and are only ever sent in request headers or
// bodies: never in a URL, never printed, never written anywhere but .daily.env.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../..", import.meta.url));
export const ENV_FILE = join(root, ".daily.env");
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

export const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const env = (name, fallback = "") => (process.env[name] ?? fallback).trim();
/** The names in `names` that are not set. */
export const missing = (names) => names.filter((name) => !env(name));

export const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);
export const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 1) + "\n");

/** The service's own error message, without anything from the request. */
function apiMessage(body, text) {
  if (body && typeof body === "object") {
    const e = body.error;
    return (
      (typeof e === "object" ? e.error_user_msg || e.message : e) ||
      body.error_description ||
      body.errors?.[0]?.message ||
      body.detail ||
      body.title ||
      JSON.stringify(body).slice(0, 300)
    );
  }
  return (text || "").slice(0, 300);
}

/**
 * fetch with a timeout and a readable error. `retries` re-sends only on network errors and 5xx answers; use it for
 * reads, token refreshes and byte uploads, never for the call that publishes (a retry could post twice).
 */
export async function request(url, init = {}, { label = "request", retries = 0, timeout = 300_000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (response.ok && !(body && typeof body === "object" && body.error)) return { body, text, headers: response.headers, status: response.status };
      const error = new Error(`${label}: ${apiMessage(body, text)} (HTTP ${response.status})`);
      error.status = response.status;
      if (response.status < 500) throw error;
      lastError = error;
    } catch (error) {
      if (error.status && error.status < 500) throw error;
      lastError = error.name === "TimeoutError" ? new Error(`${label}: timed out`) : error;
    }
    if (attempt < retries) await sleep(3000 * (attempt + 1));
  }
  throw lastError;
}

/** Length of a video in seconds (ffprobe), or null when ffprobe is not installed. */
export function videoSeconds(path) {
  try {
    return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { encoding: "utf8" }).trim());
  } catch {
    return null;
  }
}

/** Sets KEY="value" in video/.daily.env (replacing an existing line), keeping everything else as it is. */
export function saveEnv(key, value) {
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8").split("\n") : [];
  const line = `${key}="${value}"`;
  const at = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (at >= 0) lines[at] = line;
  else lines.splice(lines.at(-1) === "" ? lines.length - 1 : lines.length, 0, line);
  writeFileSync(ENV_FILE, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
  process.env[key] = value;
}
