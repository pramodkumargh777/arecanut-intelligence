#!/usr/bin/env python3
"""Original background music for the promo Reel, composed to its timeline: 100 BPM, D major, cinematic-ambient.

Fully synthesised (no samples, no licence questions). Structure follows the scenes:
soft pads + riser → impact on the logo → plucked arpeggio → beat and bass under the features → lift with shimmer for
the advanced tools → beat drops out for trust → final chord rings out under the call to action.

  python3 scripts/make-music.py                                   → public/music/promo.wav (default timeline)
  python3 scripts/make-music.py --props out/promo-props-kn.json   → public/music/promo-kn.wav, timed to that voice-over
                                                                    (and sets "promoMusic" in the props file)
  python3 scripts/make-music.py --daily out/today-props-kn.json    → public/music/daily-kn.wav, the bed for the daily video
                                                                    (sets "music"): opens on the rates, beat under the
                                                                    sources, lift on the trend chart, rings out on the end
Needs numpy. Scene starts are whole beats, so every cut lands on the beat.
"""
import argparse
import json
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SR, BPM, FPS = 44100, 100, 30
BEAT = 60 / BPM
BAR = 4 * BEAT
# Default timeline in bars (matches PROMO_TIMELINE in src/data/promoScript.ts) for the voice-free version.
DEFAULT = [("hook", 2), ("logo", 2), ("latest", 2), ("explore", 2), ("trends", 2), ("compare", 2), ("sellwait", 2),
           ("intel", 2), ("ask", 2), ("advanced", 4), ("trust", 2), ("cta", 2.5)]

ap = argparse.ArgumentParser()
ap.add_argument("--props")
ap.add_argument("--daily")
args = ap.parse_args()
# Daily scene lengths: same rule as sceneDurations() in src/DailyRates.tsx.
DAILY_MIN = {"glance": 90, "mamcos": 195, "tss": 165, "others": 165, "trend": 150, "cta": 90}
DAILY_VOICE_DELAY = 5
if args.daily:
    args.props = args.daily
props = json.loads(Path(args.props).read_text("utf-8")) if args.props else None
if args.daily:
    voice = props.get("voice") or {}
    # The 30-second cut has no "others" or "trend" scene: they take no time.
    short = props.get("cut") == "30"
    frames = {k: 0 if short and k in ("others", "trend") else (max(60, voice[k]["frames"] + DAILY_VOICE_DELAY + 10) if k in voice else m)
              for k, m in DAILY_MIN.items()}
    t, at = 0.0, {}
    for k, f in frames.items():
        at[k] = t
        t += f / FPS
    # The promo's sections mapped onto the daily scenes; a very short "logo" makes the impact land as the video opens.
    scenes = [("hook", 0.05), ("logo", at["mamcos"] - 0.05), ("latest", at["trend"] - at["mamcos"]), ("explore", 0), ("trends", 0),
              ("compare", 0), ("sellwait", 0), ("intel", 0), ("ask", 0), ("advanced", at["cta"] - at["trend"]), ("trust", 0),
              ("cta", t - at["cta"])]
    lang = props.get("lang", "kn")
    out_path = ROOT / "public" / "music" / f"daily-{lang}{'-30' if short else ''}.wav"
elif props and props.get("timeline"):
    scenes = [(s["key"], s["frames"] / FPS) for s in props["timeline"]]
    lang = props.get("lang", "kn")
    cut = props.get("cut", "full")
    out_path = ROOT / "public" / "music" / f"promo-{lang}{'' if cut == 'full' else '-' + cut}.wav"
else:
    scenes = [(k, b * BAR) for k, b in DEFAULT]
    out_path = ROOT / "public" / "music" / "promo.wav"

start, t0 = {}, 0.0
for key, dur in scenes:
    start[key] = t0
    t0 += dur
DUR = t0 + 0.5
# Short cuts leave some sections out: no logo → the impact lands on the first feature; no advanced/trust → the beat
# runs until the final chord.
FINAL = start["cta"]
BEAT_IN = start.get("latest", start.get("logo", 0.0))
HIT = start.get("logo", BEAT_IN)
LIFT, BEAT_OUT = start.get("advanced", FINAL), start.get("trust", FINAL)
N = int(SR * DUR)
rng = np.random.default_rng(7)
midi = lambda m: 440.0 * 2 ** ((m - 69) / 12)
CHORDS = [[50, 57, 61, 64, 66], [47, 54, 57, 62, 64], [43, 50, 54, 57, 59], [45, 52, 54, 59, 62]]  # Dmaj9 Bm11 Gmaj9 A6sus
ROOTS = [38, 35, 31, 33]


def env(n, a, r):
    e = np.ones(n)
    ri = min(int(r * SR), n)
    ai = min(int(a * SR), n - ri)
    e[:ai] = np.linspace(0, 1, ai)
    e[n - ri:] *= np.linspace(1, 0, ri)
    return e


def place(buf, at, sig):
    i = int(at * SR)
    j = min(N, i + sig.shape[1])
    if 0 <= i < N:
        buf[:, i:j] += sig[:, : j - i]


def stereo(sig, pan=0.0):
    return np.vstack([sig * np.cos((pan + 1) * np.pi / 4), sig * np.sin((pan + 1) * np.pi / 4)])


def chord_at(t):
    return int(t // BAR) % 4


mix = np.zeros((2, N))
pad = np.zeros((2, N))

# Pads: a chord per bar until the final chord, which holds to the end.
bar_times = list(np.arange(0, FINAL, BAR)) + [FINAL]
for k, bt in enumerate(bar_times):
    final = k == len(bar_times) - 1
    chord = CHORDS[0] if final else CHORDS[chord_at(bt)]
    length = (DUR - bt) if final else min(BAR, FINAL - bt) + 1.6
    n = int(length * SR)
    if n <= 0:
        continue
    tt = np.arange(n) / SR
    sl, sr_ = np.zeros(n), np.zeros(n)
    for note in chord:
        f0 = midi(note + 12 if note < 52 else note)
        for h, amp in [(1, 1.0), (2, 0.42), (3, 0.2), (4, 0.09), (5, 0.04)]:
            sl += amp * np.sin(2 * np.pi * f0 * h * 0.9975 * tt + rng.uniform(0, 6.28))
            sr_ += amp * np.sin(2 * np.pi * f0 * h * 1.0025 * tt + rng.uniform(0, 6.28))
    bright = float(np.clip(0.35 + 0.65 * (bt / max(HIT, 0.1)), 0.35, 1.0))
    place(pad, bt, np.vstack([sl, sr_]) * env(n, 2.0 if bt == 0 else 0.9, 4.0 if final else 1.6) * 0.035 * bright)

# Riser into the logo, impact on it.
rise_len = min(BAR, HIT)
n = int(rise_len * SR)
if n > 0:
    noise = np.convolve(rng.standard_normal(n), np.ones(6) / 6, mode="same")
    sweep = np.sin(2 * np.pi * np.cumsum(np.linspace(180, 900, n)) / SR)
    place(mix, HIT - rise_len, stereo((noise * 0.05 + sweep * 0.03) * np.linspace(0, 1, n) ** 2.4))
n = int(2.2 * SR)
tt = np.arange(n) / SR
boom = np.sin(2 * np.pi * (58 * tt - 20 * (1 - np.exp(-tt * 6)) / 6)) * np.exp(-tt * 2.2)
place(mix, HIT, stereo(boom * 0.55 + rng.standard_normal(n) * np.exp(-tt * 9) * 0.08))

# Plucked arpeggio from the logo to the final chord.
i, tm = 0, HIT
while tm < FINAL + BAR / 2:
    note = sorted(CHORDS[chord_at(tm)])[[1, 2, 3, 4, 3, 2][i % 6]] + 12
    n = int(0.9 * SR)
    tt = np.arange(n) / SR
    f0 = midi(note)
    pl = (np.sin(2 * np.pi * f0 * tt) + 0.35 * np.sin(4 * np.pi * f0 * tt) + 0.12 * np.sin(6 * np.pi * f0 * tt)) * np.exp(-tt * 5.5)
    pl *= np.minimum(1, tt / 0.004)
    vel = 0.055 * (1.0 if i % 2 == 0 else 0.75) * (0.6 if tm < BEAT_IN else 1.0)
    place(mix, tm, stereo(pl * vel, -0.45 if i % 2 == 0 else 0.45))
    i += 1
    tm += BEAT / 2

# Beat, bass and hats under the features; shimmer in the lift; pads ducked by the kick.
duck = np.ones(N)
tb = BEAT_IN
while tb < BEAT_OUT - 1e-6:
    n = int(0.45 * SR)
    tt = np.arange(n) / SR
    place(mix, tb, stereo(np.sin(2 * np.pi * (45 * tt + 65 * (1 - np.exp(-tt * 30)) / 30)) * np.exp(-tt * 9) * 0.42))
    k0, dl = int(tb * SR), int(0.35 * SR)
    dl = min(dl, N - k0)
    duck[k0:k0 + dl] = np.minimum(duck[k0:k0 + dl], 1 - 0.45 * np.exp(-np.arange(dl) / SR * 9))
    f0 = midi(ROOTS[chord_at(tb)])
    n2 = int(BEAT * SR)
    t2 = np.arange(n2) / SR
    place(mix, tb + 0.02, stereo((np.sin(2 * np.pi * f0 * t2) + 0.25 * np.sin(4 * np.pi * f0 * t2)) * env(n2, 0.01, 0.12) * 0.12))
    if tb >= BEAT_IN + 2 * BAR:
        n3 = int(0.08 * SR)
        place(mix, tb + BEAT / 2, stereo(np.diff(rng.standard_normal(n3 + 1)) * np.exp(-np.arange(n3) / SR * 60) * 0.03, 0.2))
    if tb >= LIFT:
        for q in (1, 3):
            n4 = int(0.05 * SR)
            place(mix, tb + q * BEAT / 4, stereo(np.diff(rng.standard_normal(n4 + 1)) * np.exp(-np.arange(n4) / SR * 90) * 0.018, -0.3))
    tb += BEAT
mix += pad * duck

# Reverb, master, write.
ir_len = int(2.4 * SR)
tt = np.arange(ir_len) / SR
size = 1 << int(np.ceil(np.log2(N + ir_len)))
wet = np.zeros_like(mix)
for ch in range(2):
    ir = rng.standard_normal(ir_len) * np.exp(-tt * 2.6)
    ir[: int(0.012 * SR)] = 0
    ir /= np.sqrt(np.sum(ir ** 2))
    wet[ch] = np.fft.irfft(np.fft.rfft(mix[ch], size) * np.fft.rfft(ir, size), size)[:N]
out = np.tanh((mix * 0.82 + wet * 0.32) * 1.6) / 1.6
fi, fo = int(0.3 * SR), int(2.0 * SR)
out[:, :fi] *= np.linspace(0, 1, fi)
out[:, -fo:] *= np.linspace(1, 0, fo) ** 1.5
out *= 10 ** (-1 / 20) / np.max(np.abs(out))
out_path.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(out_path), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((out.T * 32767).astype("<i2").tobytes())
if args.daily:
    props["music"] = f"music/{out_path.name}"
    Path(args.daily).write_text(json.dumps(props), "utf-8")
elif props is not None and args.props:
    props["promoMusic"] = f"music/{out_path.name}"
    Path(args.props).write_text(json.dumps(props), "utf-8")
print(f"✓ {out_path.relative_to(ROOT)} ({DUR:.1f}s, {BPM} BPM)")
