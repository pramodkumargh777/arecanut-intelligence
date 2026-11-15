# Areca Pulse videos (Remotion)

Vertical 1080×1920 Reels/Shorts rendered from code. Two compositions:

| Composition | What it is |
|---|---|
| `DailyRates` | Daily rates Reel from the live API, in Kannada or English (`lang` prop), with an optional AI voice-over |
| `DailyRatesEN` | Same, English by default (handy in Studio) |
| `PromoReel` / `PromoReelEN` | Premium promo (about 100 s with voice) with original music, Kannada / English, real rates from the latest data |
| `BrandIntro` | 20-second brand intro, no prices |

## Daily Reels (Kannada + English): one command

```bash
npm run video:daily          # from the repo root; ~1–2 minutes
```

1. `scripts/fetch-rates.mjs`: fetches rates in Node (the API's CORS rules block the render browser) → `out/today-props-<lang>.json`, plus a Kannada and an English script built only from those rates → `out/narration.json`. **Stops if the API is unreachable**, so old rates are never posted.
2. `voice/tts.py`: speaks each script with **edge-tts** (Kannada: Gagan, English: Prabhat) → `public/voice/today/<lang>/*.mp3`. Scenes stretch to fit the voice. Sets itself up on first run (a few MB). If the voice service fails, the video is made without voice.
3. Remotion renders one video per language → `out/daily-rates-<lang>.mp4`.
4. `scripts/finish.mjs` → `out/daily/<date>/adike-naadi-<report-date>-<lang>.mp4`, `…-caption.txt` (ready to paste), `…-narration.txt`.

A macOS notification says when it's done or what failed.

## In the cloud (recommended): GitHub Actions

`.github/workflows/daily-reel.yml` runs the same command every day at 09:40 IST on GitHub's free runners (a few minutes a day). No secrets needed. Start it any time: Actions tab → "Daily rates Reel" → Run workflow. Results: the run's **Artifacts** (kept 7 days).

Optional, videos on your phone: create a bot with @BotFather in Telegram, send it any message, then add repo secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (your chat id from `https://api.telegram.org/bot<token>/getUpdates`).

## On this Mac on a schedule (optional)

`bash video/scripts/schedule-mac.sh [HH:MM]` (default 09:40); `--remove` to stop. Log: `video/out/daily/daily.log`. If it shows "Operation not permitted", give `/bin/bash` Full Disk Access or move the repo out of Desktop.

## Settings: `video/.daily.env` (optional, not committed)

```bash
LANGS="kn en"                        # which videos to make (e.g. LANGS=kn)
VOICE=off                            # make videos without voice
VOICE_KN=kn-IN-SapnaNeural           # female Kannada voice (default kn-IN-GaganNeural, male)
VOICE_EN=en-IN-NeerjaNeural          # female English voice (default en-IN-PrabhatNeural, male)
VOICE_RATE_KN=-8%                    # slower Kannada (default -6%; VOICE_RATE_EN for English, default -3%)
COPY_TO="$HOME/Library/Mobile Documents/com~apple~CloudDocs/AdikeNaadi"   # also copy Reels + captions here (iCloud → phone)
```

Background music: each daily video gets an original bed composed to its own scene timings (`scripts/make-music.py --daily`
→ `public/music/daily-<lang>.wav`), quietly under the voice. A licensed track at `video/public/music/bed.mp3` replaces it.

`RENDER_CONCURRENCY=3` (daily and promo) renders with fewer cores: slower, but a fanless Mac stays cooler.

## Promo Reel (music + voice, all features)

Three cuts of the same promo, each in Kannada and English, each with its caption (`out/promo-caption-<lang>[-30|-15].txt`):

| Command | Output | Use |
|---|---|---|
| `npm --workspace video run promo` | `out/promo-<lang>.mp4` (~105–115 s) | Full tour: YouTube, the website |
| `npm --workspace video run promo:30` | `out/promo-<lang>-30.mp4` (~26–29 s) | The Reel to post and boost |
| `npm --workspace video run promo:15` | `out/promo-<lang>-15.mp4` (~15 s) | Stories, quick ads |

Short cuts use the tighter lines in `PROMO_VOICE_SHORT` (`src/data/promoScript.ts`) and a two-line hook; their voice and
music files carry the suffix, so making one cut never changes another.

```bash
npm --workspace video run promo        # → video/out/promo-kn.mp4 and promo-en.mp4 (about 64 s each)
```

Covers every feature with the website's own names: latest rates, explore prices, price trends, compare markets, sell or
wait, market intelligence, Ask Areca Pulse, then the advanced tools (market overview, monthly trends, supply & weather,
experimental price outlook, forecast evaluation, decision tools), trust and call to action.

- Script: `src/data/promoScript.ts` (one flowing voice-over per language; linking words carry it from scene to scene). Screens: `src/PromoReel.tsx`.
- Timing follows the voice: each scene lasts as long as its line plus a breath, rounded up to the next beat (`voice/promo_tts.py`). The voice is never sped up; pace is set by `VOICE_RATE_KN` / `VOICE_RATE_EN` (defaults -6% / -3%).
- On-screen moments wait for the voice: the opening lines and the six advanced tools appear exactly when they are spoken, using the voice service's word timings (`PROMO_MARKS` in `src/data/promoScript.ts`).
- Music is then composed to that exact timeline for each language (`scripts/make-music.py --props …` → `public/music/promo-<lang>.wav`, original, no samples), so cuts land on the beat, and it sits under the voice. `public/music/promo.wav` is the default track for the voice-free version.
- Music only: `VOICE=off npm --workspace video run promo`.

## Testing and fixing locally

| Check | Command (repo root) | Time |
|---|---|---|
| Layout and wording, live preview | `npm --workspace video run snapshot:update` then `npm run video` (pick DailyRates / DailyRatesEN) | seconds |
| Voice works, hear both voices | `npm --workspace video run voice:check` → `video/out/voice-test-kn.mp3`, `voice-test-en.mp3` | seconds |
| Both videos, no voice | `VOICE=off npm run video:daily` | ~1 min |
| Everything | `npm run video:daily` | ~1–2 min |

Edit → save → Studio refreshes by itself.

## Other commands (in `video/`)

| Command | Does |
|---|---|
| `npm run studio` | Visual editor (uses the bundled snapshot; run `npm run fetch-rates` first, then load `out/today-props.json` for today's data) |
| `npm run render` | Fetch + render both languages without voice |
| `npm run render:snapshot` | Render both languages from `src/data/snapshot.json` without the API |
| `npm run fetch-rates` | Step 1 only |

## Where to change things

| Change | File |
|---|---|
| Screen text (Kannada and English) | `src/i18n.ts` |
| Voice-over wording, captions, hashtags (both languages) | `src/data/narration.ts` (`narrationKn`, `narrationEn`, `buildCaption`) |
| Which sources/varieties are fetched | `src/data/rates.ts` (`REQUESTS`) |
| Screens, layout, timing | `src/DailyRates.tsx` (`T` = minimum frames per scene) |
| Place/variety names, date format | `src/format.ts` |
| Voice engine | `voice/tts.py` |

## Rules the video keeps

- Sources are never merged; every figure shows its source, exact source label, branch and reporting date.
- TSS and TUMCOS units are labelled as assumed (₹/quintal).
- Spoken prices are rounded to ₹100 with "ಸುಮಾರು"; the screen shows exact figures. Sentences with unmapped (Latin) names are dropped rather than mispronounced.
- No sell/hold advice; the trend screen says past rates are not a forecast; the caption carries the disclaimer and, when voice is used, "ಧ್ವನಿ: AI".
- Fonts are bundled (`public/fonts/`, Noto Sans Kannada, OFL) so renders look the same on any machine.

## Licences

Remotion: free for individuals and companies of up to 3 people. edge-tts: open-source (GPL-3.0) client; the voices are Microsoft's online neural voices used through the Edge read-aloud service without an official licence, so the service may change or stop. Caption carries "ಧ್ವನಿ: AI" / "Voice: AI-generated".

## Daily Story (Instagram Stories + WhatsApp Status)

One still image a day, 1080×1920, in Kannada and English: each cooperative's latest Rashi and Chali (and TUMCOS)
rates with their dates, the change from the previous report, and adikenaadi.com. Same data and rules as the Reel.

| What | Command (repo root) |
|---|---|
| Make today's Story | `npm run story:daily` |
| Run it every morning at 09:30 | `bash video/scripts/schedule-story-mac.sh` (`--remove` to stop) |

Output: `video/out/stories/<date>/` — `adike-naadi-story-<report date>-kn.png` / `-en.png`, plus a ready-to-paste
`-whatsapp.txt` message for each. With `COPY_TO` set, both are also copied there (iCloud → phone).

Files: `src/DailyStory.tsx` (the image), `scripts/story.sh` (pipeline), `scripts/finish-story.mjs` (filing + WhatsApp
message), `scripts/schedule-story-mac.sh` (morning schedule). Instagram posting: see "Posting automatically" below.

**WhatsApp:** WhatsApp has no API for Status or Channels, so posting stays one tap on the phone: open the image →
Share → WhatsApp → My Status / your Channel / a group, and paste the `-whatsapp.txt` message (it lists the rates).

## Posting automatically: one command, every platform

```
npm run daily:publish      # from the repo root
```

Fetches today's rates → makes the Story image and the daily video (Kannada + English) → posts, through free
official APIs (X is left out: its API charges per post):

| Target | What | Language (setting) |
|---|---|---|
| `youtube` | the daily video as a YouTube Short, title + caption + tags | `YT_LANGS` (default `kn`; `"kn en"` for both) |
| `instagram-reel` | the daily video as a Reel (also on the profile grid) | `IG_LANG` (default `kn`) |
| `instagram-story` | the Story image (uploaded as a 7-second still video) | `IG_LANG` |
| `facebook-reel` | the daily video as a Page Reel (over 90 s: a Page video) | `FB_LANG` (default `kn`) |

- **Only what is set up is posted.** A platform without its keys is skipped, so you can start with one.
- **Safe to re-run.** Each post is recorded per report date in `video/out/publish-state.json`; running again posts
  only what failed. No new rates since the last post (Sunday, holiday) → nothing is made or posted. `FORCE=1` overrides.
- **Before the first real run:** `npm run daily:check` (signs in to each platform, posts nothing) and
  `npm --workspace video run publish:dry-run` (shows every file and text it would post).
- Log of each run: `video/out/publish-<date>.log`. A Mac notification says what happened.
- WhatsApp stays manual (no API): the image and message are ready in `video/out/stories/<date>/`.

### One-time setup (keys go in `video/.daily.env`, never in chat or git)

**YouTube**
1. console.cloud.google.com → new project → enable **YouTube Data API v3**.
2. OAuth consent screen: External, add yourself as a test user, then **Publish app → In production** (otherwise the
   sign-in expires every 7 days). The "unverified app" warning during sign-in is expected for your own app.
3. Credentials → Create OAuth client ID → **Desktop app**. Put `YT_CLIENT_ID="…"` and `YT_CLIENT_SECRET="…"` in
   `video/.daily.env`.
4. `npm --workspace video run publish:setup-youtube` → sign in with the channel's account → saved automatically.
5. Google locks API uploads to **private** until the project passes YouTube's API audit (free; apply via the "YouTube
   API Services – Audit and Quota Extension" form). Until then the run says so, and you make each Short public in
   YouTube Studio (one tap), or set `YT_PRIVACY="private"`.

**Facebook Page + Instagram** (one setup for both)
1. Instagram must be a Professional (Business/Creator) account linked to the Facebook Page.
2. developers.facebook.com → My Apps → Create app (Business) → add **Instagram Graph API** / Facebook Login for
   Business. Put `META_APP_ID="…"` and `META_APP_SECRET="…"` in `video/.daily.env`.
3. Graph API Explorer → your app → User token with: `pages_show_list`, `pages_read_engagement`,
   `pages_manage_posts`, `business_management`, `instagram_basic`, `instagram_content_publish` → Generate → copy it
   into `META_USER_TOKEN="…"`.
4. `npm --workspace video run publish:setup-meta` → saves the Page token (does not expire), Page ID and Instagram ID,
   and clears `META_USER_TOKEN`. With several Pages, set `FB_PAGE_ID` first.

Other settings: `PUBLISH_TARGETS` (default `"youtube instagram-reel instagram-story facebook-reel"`),
`YT_PRIVACY` (default `public`), `META_GRAPH_VERSION` (default `v27.0`), `RENDER_CONCURRENCY=3` (cooler Mac).
