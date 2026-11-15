// Posts today's daily rates to YouTube, Instagram and the Facebook Page (all free APIs), each only when it is set up
// in video/.daily.env. Called by scripts/publish-daily.sh
// after the video and Story are made; safe to run again: anything already posted for this report date is skipped, so
// a re-run after a failure retries only what failed.
//
//   node scripts/publish/run.mjs            post (default targets below)
//   node scripts/publish/run.mjs --check    verify each platform's sign-in, post nothing
//   node scripts/publish/run.mjs --dry-run  show exactly what would be posted where, post nothing
//   node scripts/publish/run.mjs --fresh    exit 10 when every target already has today's newest report (no new rates)
//   node scripts/publish/run.mjs --only instagram-story   one target only
//
// Settings (video/.daily.env): PUBLISH_TARGETS (default "youtube instagram-reel instagram-story facebook-reel"),
// YT_LANGS (default "kn"; "kn en" for both), IG_LANG / FB_LANG (default kn), YT_PRIVACY (default public),
// FORCE=1 to post even when the report date was posted.
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildYouTubeTitle, newestDate } from "../../src/data/narration.ts";
import { fetchRates } from "../../src/data/rates.ts";
import { env, readJson, root, todayIST, videoSeconds, writeJson } from "./lib.mjs";
import { checkFacebook, checkInstagram, facebookMissing, instagramMissing, metaAccessWarning, postFacebookReel, postInstagramReel, postInstagramStory } from "./meta.mjs";
import { checkYouTube, postYouTube, youtubeMissing } from "./youtube.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const STATE = join(root, "out", "publish-state.json");
// Something a person must do soon (e.g. renew Meta access); scripts/publish-daily.sh shows it as a notification.
const ATTENTION = join(root, "out", "publish-attention.txt");

async function attention() {
  const warning = await metaAccessWarning().catch(() => null);
  if (warning) {
    writeFileSync(ATTENTION, warning + "\n");
    console.log(`! ${warning}`);
  } else rmSync(ATTENTION, { force: true });
}

const PLATFORMS = {
  youtube: { name: "YouTube", missing: youtubeMissing, check: checkYouTube, setup: "npm --workspace video run publish:setup-youtube" },
  instagram: { name: "Instagram", missing: instagramMissing, check: checkInstagram, setup: "npm --workspace video run publish:setup-meta" },
  facebook: { name: "Facebook Page", missing: facebookMissing, check: checkFacebook, setup: "npm --workspace video run publish:setup-meta" },
};

/** Every post this run should make: "<kind>:<lang>". Targets whose platform is not set up are left out. */
function targets() {
  const kinds = (only ? [only] : env("PUBLISH_TARGETS", "youtube instagram-reel instagram-story facebook-reel").split(/\s+/)).filter(Boolean);
  const out = [];
  for (const kind of kinds) {
    const platform = kind.split("-")[0];
    if (!PLATFORMS[platform]) throw new Error(`Unknown target "${kind}".`);
    if (PLATFORMS[platform].missing().length) continue;
    const langs = kind === "youtube" ? env("YT_LANGS", "kn").split(/\s+/) : [env(platform === "facebook" ? "FB_LANG" : "IG_LANG", "kn")];
    for (const lang of langs.filter(Boolean)) out.push({ key: `${kind}:${lang}`, kind, platform, lang });
  }
  return out;
}

async function check() {
  await attention();
  let ok = true;
  for (const [, p] of Object.entries(PLATFORMS)) {
    const gaps = p.missing();
    if (gaps.length) {
      console.log(`– ${p.name}: not set up (needs ${gaps.join(", ")}; ${p.setup})`);
      continue;
    }
    try {
      console.log(`✓ ${p.name}: ${await p.check()}`);
    } catch (error) {
      ok = false;
      console.log(`✗ ${p.name}: ${error.message}`);
    }
  }
  return ok ? 0 : 2;
}

/** Today's made files for one language: the Reel, its caption, the Story image, and the rates they show. */
function material(newest, lang) {
  const day = join(root, "out", "daily", todayIST());
  const video = join(day, `adike-naadi-${newest}-${lang}.mp4`);
  const captionFile = join(day, `adike-naadi-${newest}-${lang}-caption.txt`);
  const storyDir = join(root, "out", "stories", todayIST());
  const stories = existsSync(storyDir) ? readdirSync(storyDir).filter((f) => f.endsWith(`-${lang}.png`)) : [];
  const story = stories.find((f) => f.includes(newest)) ?? stories[0];
  const data = JSON.parse(readFileSync(join(root, "out", `today-props-${lang}.json`), "utf8")).data;
  return {
    video: existsSync(video) ? video : null,
    caption: existsSync(captionFile) ? readFileSync(captionFile, "utf8").trim() : null,
    story: story ? join(storyDir, story) : null,
    data,
  };
}

const TAGS = {
  kn: ["ಅಡಿಕೆ ಧಾರಣೆ", "ಇಂದಿನ ಅಡಿಕೆ ಧಾರಣೆ", "adike rate today", "arecanut price today", "MAMCOS", "TSS Sirsi", "Shivamogga", "rashi", "chali", "Areca Pulse", "adikenaadi"],
  en: ["arecanut price today", "arecanut rate", "adike rate today", "MAMCOS rate", "TSS Sirsi rate", "Shivamogga arecanut price", "rashi", "chali", "supari rate", "Areca Pulse", "adikenaadi"],
};

/** What one target posts, built from today's files. */
function plan(target, m) {
  switch (target.kind) {
    case "youtube":
      return { file: m.video, run: () => postYouTube({ file: m.video, title: buildYouTubeTitle(m.data, target.lang), description: m.caption, tags: TAGS[target.lang], lang: target.lang }), text: buildYouTubeTitle(m.data, target.lang) };
    case "instagram-reel":
      return { file: m.video, run: () => postInstagramReel({ file: m.video, caption: m.caption }), text: m.caption };
    case "instagram-story":
      return { file: m.story, run: () => postInstagramStory({ image: m.story }), text: "(Story image)" };
    case "facebook-reel":
      return { file: m.video, run: () => postFacebookReel({ file: m.video, description: m.caption }), text: m.caption };
  }
}

async function main() {
  if (flag("--check")) return check();
  const all = targets();
  if (!all.length) {
    console.log("No platform is set up yet. See video/README.md, \"Posting automatically\", then run with --check.");
    return flag("--fresh") ? 0 : 1;
  }
  const state = readJson(STATE, {});

  if (flag("--fresh")) {
    const newest = newestDate(await fetchRates(AbortSignal.timeout(30_000)));
    const done = state[newest] ?? {};
    if (env("FORCE") !== "1" && all.every((t) => done[t.key])) {
      console.log(`Report ${newest} is already posted everywhere; nothing new to post.`);
      return 10;
    }
    return 0;
  }

  const narration = readJson(join(root, "out", "narration.json"), null);
  if (!narration?.newest) throw new Error("No video made today (out/narration.json missing); run the daily video first.");
  const newest = narration.newest;
  const done = (state[newest] ??= {});
  const results = [];
  for (const target of all) {
    if (done[target.key] && env("FORCE") !== "1") {
      results.push(`· ${target.key}: already posted (${done[target.key].url ?? done[target.key].id})`);
      continue;
    }
    const p = plan(target, material(newest, target.lang));
    if (!p.file) {
      results.push(`✗ ${target.key}: today's ${target.kind === "instagram-story" ? "Story image" : "video"} is missing`);
      continue;
    }
    if (flag("--dry-run")) {
      const seconds = videoSeconds(p.file);
      console.log(`\n── ${target.key} · ${p.file.replace(root, "video/")} (${(statSync(p.file).size / 1e6).toFixed(1)} MB${seconds ? `, ${seconds.toFixed(1)} s` : ""})\n${p.text}`);
      continue;
    }
    process.stdout.write(`… ${target.key}\n`);
    try {
      const result = await p.run();
      done[target.key] = { id: result.id, url: result.url, at: new Date().toISOString() };
      writeJson(STATE, prune(state));
      results.push(`✓ ${target.key}: ${result.url ?? result.id}${result.note ? ` (${result.note})` : ""}`);
    } catch (error) {
      results.push(`✗ ${target.key}: ${error.message}`);
    }
  }
  if (flag("--dry-run")) return 0;
  console.log(`\nReport ${newest}:\n${results.join("\n")}`);
  await attention();
  return results.some((r) => r.startsWith("✗")) ? 2 : 0;
}

/** Keeps the last 60 report dates. */
const prune = (state) => Object.fromEntries(Object.entries(state).sort(([a], [b]) => a.localeCompare(b)).slice(-60));

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  },
);
