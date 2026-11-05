"""ANI forecasting experimentation engine.

Independent of the Worker's `monthly-baselines-v1` evaluator, which remains the published reference.
Every dataset keeps one price basis; nothing here interpolates prices or fabricates observations.
"""

import os

ENGINE_VERSION = "ani-forecasting-0.1.0"

# LightGBM (Homebrew libomp) and torch (bundled libomp) load two OpenMP runtimes on macOS; running both
# multi-threaded in one process segfaults (reproduced 2026-11-05). Single-threaded OpenMP also keeps
# results deterministic. Set before any OpenMP library initialises; an explicit value is respected.
os.environ.setdefault("OMP_NUM_THREADS", "1")
