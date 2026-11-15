// One-time YouTube sign-in. Opens Google's consent page in your browser, receives the answer on this Mac
// (127.0.0.1), and saves YT_REFRESH_TOKEN into video/.daily.env. Nothing is printed or sent anywhere else.
// Needs YT_CLIENT_ID and YT_CLIENT_SECRET in video/.daily.env first (a "Desktop app" OAuth client; README.md).
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { env, missing, request, saveEnv } from "./lib.mjs";

const gaps = missing(["YT_CLIENT_ID", "YT_CLIENT_SECRET"]);
if (gaps.length) {
  console.error(`✗ Add ${gaps.join(" and ")} to video/.daily.env first (see video/README.md, "Posting automatically").`);
  process.exit(1);
}
const state = randomBytes(16).toString("hex");
const server = createServer();
server.listen(0, "127.0.0.1", () => {
  const redirect = `http://127.0.0.1:${server.address().port}`;
  const consent = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: env("YT_CLIENT_ID"),
    redirect_uri: redirect,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    access_type: "offline",
    prompt: "consent",
    state,
  })}`;
  console.log("Opening Google sign-in in your browser… choose the account that owns the YouTube channel.");
  execFile("open", [consent]);
  server.on("request", async (req, res) => {
    const url = new URL(req.url, redirect);
    if (url.searchParams.get("state") !== state) return res.writeHead(404).end();
    const code = url.searchParams.get("code");
    try {
      if (!code) throw new Error(url.searchParams.get("error") ?? "no code returned");
      const { body } = await request("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code, client_id: env("YT_CLIENT_ID"), client_secret: env("YT_CLIENT_SECRET"), redirect_uri: redirect, grant_type: "authorization_code" }),
      }, { label: "Google sign-in" });
      if (!body.refresh_token) throw new Error("Google returned no refresh token; remove the app's access at myaccount.google.com/permissions and run this again.");
      saveEnv("YT_REFRESH_TOKEN", body.refresh_token);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("<h2>Done. YouTube is connected; you can close this tab.</h2>");
      console.log("✓ YouTube connected (saved in video/.daily.env). Check it: npm --workspace video run publish:check");
      server.close();
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" }).end("<h2>Sign-in failed. See the terminal.</h2>");
      console.error(`✗ ${error.message}`);
      server.close();
      process.exitCode = 1;
    }
  });
});
