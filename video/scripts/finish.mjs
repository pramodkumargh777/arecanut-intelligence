// Last step of the daily pipeline: files each language's Reel with its caption and narration in out/daily/<today>/,
// and copies them to COPY_TO (e.g. an iCloud Drive folder you can open on your phone) when that is set.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCaption } from "../src/data/narration.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
// CUT=30: files the 30-second Story cut as adike-naadi-<date>-<lang>-30.mp4.
const suf = process.env.CUT === "30" ? "-30" : "";
const narration = JSON.parse(readFileSync(join(root, `out/narration${suf}.json`), "utf8"));
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const dir = join(root, "out/daily", today);
mkdirSync(dir, { recursive: true });
const copyTo = process.env.COPY_TO;
if (copyTo) mkdirSync(copyTo, { recursive: true });

let made = 0;
for (const lang of Object.keys(narration.langs)) {
  const video = join(root, `out/daily-rates-${lang}${suf}.mp4`);
  if (!existsSync(video)) { console.log(`! No ${lang} video was rendered.`); continue; }
  const props = JSON.parse(readFileSync(join(root, `out/today-props-${lang}${suf}.json`), "utf8"));
  const withVoice = Boolean(props.voice && Object.keys(props.voice).length);
  const base = `adike-naadi-${narration.newest}-${lang}${suf}`;
  copyFileSync(video, join(dir, `${base}.mp4`));
  writeFileSync(join(dir, `${base}-caption.txt`), buildCaption(props.data, withVoice, lang) + "\n");
  writeFileSync(join(dir, `${base}-narration.txt`), Object.values(narration.langs[lang]).flat().join("\n") + "\n");
  if (copyTo) for (const f of [`${base}.mp4`, `${base}-caption.txt`]) copyFileSync(join(dir, f), join(copyTo, f));
  console.log(`✓ ${lang}: ${join(dir, `${base}.mp4`)}${withVoice ? " (with voice)" : " (no voice)"}`);
  made++;
}
if (!made) throw new Error("No videos were rendered.");
if (copyTo) console.log(`  copied to ${copyTo}`);
