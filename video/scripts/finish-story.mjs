// Files today's Story images with a ready-to-send WhatsApp message in out/stories/<date>/, and copies them to COPY_TO
// (e.g. an iCloud Drive folder you open on your phone) when that is set. WhatsApp has no API for Status or Channels,
// so posting there stays one tap on the phone: open the image, share to Status / Channel / group, paste the message.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fmtDate } from "../src/format.ts";
import { rateLines } from "../src/data/narration.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const dir = join(root, "out/stories", today);
mkdirSync(dir, { recursive: true });
const copyTo = process.env.COPY_TO;
if (copyTo) mkdirSync(copyTo, { recursive: true });

// The rates themselves are in the text too: in groups, many read the message without opening the image.
const MESSAGE = {
  kn: (date, rates) => `🌴 *ಇಂದಿನ ಅಡಿಕೆ ಧಾರಣೆ* (ಇತ್ತೀಚಿನ ವರದಿ ${date})\n\n${rates}\n\n₹/ಕ್ವಿಂಟಾಲ್ · TSS, TUMCOS ಘಟಕ ಊಹಿಸಲಾಗಿದೆ\nಎಲ್ಲಾ ಶಾಖೆಗಳ ದರ, ಏರಿಳಿತ ಮತ್ತು ಹೋಲಿಕೆ: https://adikenaadi.com\nಮಾರುಕಟ್ಟೆ ಮಾಹಿತಿ ಮಾತ್ರ, ಹಣಕಾಸು ಸಲಹೆ ಅಲ್ಲ.\nಇತರ ಬೆಳೆಗಾರರಿಗೂ ಹಂಚಿಕೊಳ್ಳಿ 🙏`,
  en: (date, rates) => `🌴 *Today's arecanut rates* (latest report ${date})\n\n${rates}\n\n₹/quintal · TSS and TUMCOS units assumed\nEvery branch, trends and comparisons: https://adikenaadi.com\nMarket information only, not financial advice.\nPlease share with other growers 🙏`,
};

let made = 0;
for (const lang of (process.env.LANGS ?? "kn en").split(/\s+/).filter(Boolean)) {
  const image = join(root, `out/story-${lang}.png`);
  if (!existsSync(image)) { console.log(`! No ${lang} Story was rendered.`); continue; }
  const data = JSON.parse(readFileSync(join(root, `out/story-props-${lang}.json`), "utf8")).data;
  const newest = data.coop.flatMap((block) => block.latest.map((quote) => quote.date)).sort().at(-1) ?? today;
  const base = `adike-naadi-story-${newest}-${lang}`;
  copyFileSync(image, join(dir, `${base}.png`));
  const language = lang === "en" ? "en" : "kn";
  writeFileSync(join(dir, `${base}-whatsapp.txt`), MESSAGE[language](fmtDate(newest, true, language), rateLines(data, language).join("\n")) + "\n");
  if (copyTo) for (const file of [`${base}.png`, `${base}-whatsapp.txt`]) copyFileSync(join(dir, file), join(copyTo, file));
  console.log(`✓ ${lang}: ${join(dir, `${base}.png`)}`);
  made++;
}
if (!made) throw new Error("No Story images were rendered.");
writeFileSync(join(dir, "latest.json"), JSON.stringify({ date: today, dir }, null, 1));
if (copyTo) console.log(`  copied to ${copyTo}`);
