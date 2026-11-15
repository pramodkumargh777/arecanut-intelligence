#!/usr/bin/env python3
"""Voice-over for the promo Reel (edge-tts, same voices and natural pace as the daily video).

Reads out/promo-narration.json (scripts/promo-prepare.mjs), writes public/voice/promo/<lang>/<scene>.mp3, and sets the
promo's timeline from the voice: each scene lasts as long as its line plus a short breath, rounded up to the next beat
of the 100 BPM music (never sped up). The timeline goes into out/promo-props-<lang>.json; scripts/make-music.py then
composes music to exactly that timeline, so cuts stay on the beat and the voice flows from scene to scene.
"""
import asyncio
import json
import math
import sys
from pathlib import Path

import edge_tts
from mutagen.mp3 import MP3

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tts import FPS, RATES, VOICES  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BEAT_FRAMES = 18          # 100 BPM at 30 fps
VOICE_DELAY = 6           # frames before the line starts in its scene
BREATH = 8                # frames of air after each line


async def speak_timed(text: str, voice: str, path: Path, rate: str):
    """Saves the clip and returns (seconds, [(start_seconds, word), ...]) using the service's word timings."""
    last = None
    for attempt in range(3):
        try:
            words = []
            with open(path, "wb") as f:
                async for chunk in edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary").stream():
                    if chunk["type"] == "audio":
                        f.write(chunk["data"])
                    elif chunk["type"] in ("WordBoundary", "SentenceBoundary"):
                        words.append((chunk["offset"] / 1e7, chunk["text"]))  # offsets are 100 ns ticks
            if path.stat().st_size > 0:
                return MP3(path).info.length, words
        except Exception as err:  # network hiccup or service change
            last = err
        await asyncio.sleep(2 * (attempt + 1))
    raise RuntimeError(f"edge-tts failed ({voice}): {last}")


def mark_frames(text: str, marks: list, words: list, seconds: float) -> list:
    """Frame (from the start of the clip) at which each mark phrase is spoken.

    Uses the word timings when the service gives them; otherwise estimates from the phrase's position in the text.
    """
    out = []
    anchors = []  # (char position in text, seconds)
    cursor = 0
    for t, w in words:
        pos = text.find(w, cursor)
        if pos >= 0:
            anchors.append((pos, t))
            cursor = pos + len(w)
    for m in marks:
        pos = text.find(m)
        if pos < 0:
            continue
        exact = [t for p, t in anchors if p == pos]
        if exact:
            t = exact[0]
        elif anchors:
            before = [(p, t) for p, t in anchors if p <= pos] or [(0, 0.0)]
            after = [(p, t) for p, t in anchors if p > pos] or [(len(text), seconds)]
            (p0, t0), (p1, t1) = before[-1], after[0]
            t = t0 + (t1 - t0) * (pos - p0) / max(1, p1 - p0)
        else:
            t = seconds * pos / max(1, len(text))
        out.append(round(t * FPS))
    return out


async def main() -> None:
    # A short cut's plan (out/promo-narration-30.json) is passed as the argument; its files carry the cut's suffix.
    plan_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "out" / "promo-narration.json"
    plan = json.loads(plan_path.read_text("utf-8"))
    suffix = plan.get("suffix", "")
    failed = []
    for lang, scenes in plan["langs"].items():
        try:
            out = ROOT / "public" / "voice" / "promo" / f"{lang}{suffix}"
            out.mkdir(parents=True, exist_ok=True)
            props_path = ROOT / "out" / f"promo-props-{lang}{suffix}.json"
            props = json.loads(props_path.read_text("utf-8"))
            clips, timeline = {}, []
            for scene in scenes:
                path = out / f"{scene['key']}.mp3"
                seconds, words = await speak_timed(scene["text"], VOICES[lang], path, RATES[lang])
                frames = math.ceil(seconds * FPS)
                beats = max(scene["minBeats"], math.ceil((VOICE_DELAY + frames + BREATH) / BEAT_FRAMES))
                clip = {"src": f"voice/promo/{lang}{suffix}/{scene['key']}.mp3", "frames": frames}
                if scene.get("marks"):
                    clip["marks"] = mark_frames(scene["text"], scene["marks"], words, seconds)
                    if len(clip["marks"]) != len(scene["marks"]):
                        print(f"  ! {lang} {scene['key']}: some marks not found in the text", flush=True)
                clips[scene["key"]] = clip
                timeline.append({"key": scene["key"], "frames": beats * BEAT_FRAMES})
                timed = "word timings" if words else "estimated timings"
                print(f"  {lang} {scene['key']}: {seconds:.1f}s → {beats} beats ({timed})", flush=True)
            props["voice"], props["timeline"] = clips, timeline
            props_path.write_text(json.dumps(props), "utf-8")
            total = sum(t["frames"] for t in timeline) / FPS
            print(f"✓ {lang} promo voice-over ready: {total:.0f}s ({VOICES[lang]}, {RATES[lang]})")
        except Exception as err:
            print(f"! {lang} promo voice-over failed: {err}", file=sys.stderr)
            failed.append(lang)
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
