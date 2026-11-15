#!/usr/bin/env python3
"""Step 2 of the daily pipeline: Kannada and English voice-over with edge-tts.

edge-tts is an open-source client for Microsoft's online neural voices: fast, no GPU, no model download, so it runs
in seconds on a laptop or a free cloud runner. Note: it uses the Microsoft Edge read-aloud service without an official
licence, so Microsoft could change or stop it; the daily video is then made without voice.

Reads out/narration.json, writes public/voice/today/<lang>/<scene>.mp3 and records each clip's length in
out/today-props-<lang>.json so the video's scenes stretch to fit the voice.

  python tts.py          normal run (called by scripts/daily.sh)
  python tts.py --check  one test line per language → out/voice-test-kn.mp3, out/voice-test-en.mp3

Settings (environment):
  VOICE_KN    Kannada voice (default kn-IN-GaganNeural; female: kn-IN-SapnaNeural)
  VOICE_EN    English voice (default en-IN-PrabhatNeural; female: en-IN-NeerjaNeural)
  VOICE_RATE_KN / VOICE_RATE_EN  speaking speed (defaults -6% / -3%); VOICE_RATE sets both
  VOICE_ONLY  space-separated scenes to voice, for quick tests (e.g. "glance")
"""
import asyncio
import json
import math
import os
import sys
from pathlib import Path

import edge_tts
from mutagen.mp3 import MP3

ROOT = Path(__file__).resolve().parent.parent
VOICES = {"kn": os.environ.get("VOICE_KN", "kn-IN-GaganNeural"), "en": os.environ.get("VOICE_EN", "en-IN-PrabhatNeural")}
# A touch slower than the service default reads less rushed, especially in Kannada.
RATES = {
    "kn": os.environ.get("VOICE_RATE_KN", os.environ.get("VOICE_RATE", "-6%")),
    "en": os.environ.get("VOICE_RATE_EN", os.environ.get("VOICE_RATE", "-3%")),
}
RATE = RATES["kn"]
ONLY = set(os.environ.get("VOICE_ONLY", "").split())
FPS = 30
OUT = ROOT / "public" / "voice" / "today"


async def speak(text: str, voice: str, path: Path, rate: str = RATE) -> float:
    """Saves one clip and returns its length in seconds; retries brief network failures."""
    last = None
    for attempt in range(3):
        try:
            await edge_tts.Communicate(text, voice, rate=rate).save(str(path))
            if path.exists() and path.stat().st_size > 0:
                return MP3(path).info.length
        except Exception as err:  # network hiccup or service change
            last = err
        await asyncio.sleep(2 * (attempt + 1))
    raise RuntimeError(f"edge-tts failed ({voice}): {last}")


async def check() -> None:
    lines = {"kn": "ನಮಸ್ಕಾರ, ಇದು ಅಡಿಕೆ ನಾಡಿ. ಇಂದಿನ ಅಡಿಕೆ ಧಾರಣೆ.", "en": "Hello, this is Areca Pulse. Today's arecanut rates."}
    (ROOT / "out").mkdir(exist_ok=True)
    for lang, text in lines.items():
        path = ROOT / "out" / f"voice-test-{lang}.mp3"
        seconds = await speak(text, VOICES[lang], path, RATES[lang])
        print(f"✓ {path} ({seconds:.1f}s, {VOICES[lang]})")


async def main() -> None:
    narration = json.loads((ROOT / "out" / "narration.json").read_text("utf-8"))
    failed = []
    for lang, scenes in narration["langs"].items():
        try:
            props_path = ROOT / "out" / f"today-props-{lang}.json"
            props = json.loads(props_path.read_text("utf-8"))
            out = OUT / lang
            out.mkdir(parents=True, exist_ok=True)
            clips = {}
            for scene, sentences in scenes.items():
                if not sentences or (ONLY and scene not in ONLY):
                    continue
                path = out / f"{scene}.mp3"
                seconds = await speak(" ".join(sentences), VOICES[lang], path, RATES[lang])
                clips[scene] = {"src": f"voice/today/{lang}/{scene}.mp3", "frames": math.ceil(seconds * FPS)}
                print(f"  {lang} {scene}: {seconds:.1f}s", flush=True)
            props["voice"] = clips
            props_path.write_text(json.dumps(props), "utf-8")
            print(f"✓ {lang} voice-over ready ({len(clips)} scenes, {VOICES[lang]})")
        except Exception as err:  # one language failing must not cost the other its voice
            print(f"! {lang} voice-over failed: {err}", file=sys.stderr)
            failed.append(lang)
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(check() if "--check" in sys.argv else main())
