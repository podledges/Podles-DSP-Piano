# ⚡ RUNTHIS — T19: Onsets & Frames Realtime on RTX 3070

**WHO**: Run this on the team laptop with the RTX 3070 GPU.
**WHY**: Validate that Magenta Onsets & Frames realtime transcription works on Windows + CUDA and measure latency vs our basic-pitch baseline.
**WHEN**: Before the physical piano test. Post results back to the repo when done.

---

## What you are testing

The laptop server can use two transcription models:
- **basic-pitch** (default) — easy install, ~2s latency window
- **Onsets & Frames realtime** (this task) — piano-specific, true streaming inference, p95 < 150ms target on GPU

This script validates the O&F path works on your machine and measures actual latency.

---

## Step 1 — Prerequisites

Make sure you have:
- Python 3.10 or 3.11 (O&F TF stack may not support 3.13 — use a venv)
- CUDA toolkit installed (check: `nvidia-smi`)
- The repo cloned and on the right branch:

```bash
git clone https://github.com/NanoOpusGoonClawX/Podles-DSP-Piano.git
cd Podles-DSP-Piano
git checkout feat/v2-stream-server
```

---

## Step 2 — Set up a Python 3.11 venv for O&F

```bash
# Windows PowerShell
python3.11 -m venv .venv-onsets
.venv-onsets\Scripts\Activate.ps1

# Install base server deps first
pip install -r server/requirements.txt

# Install Magenta + TensorFlow GPU (this is the heavy part)
pip install magenta tensorflow[and-cuda]
# OR if tensorflow[and-cuda] fails:
pip install tensorflow-gpu magenta
```

If `magenta` install fails, try:
```bash
pip install "magenta @ git+https://github.com/magenta/magenta.git"
```

---

## Step 3 — Verify GPU is visible

```bash
python -c "import tensorflow as tf; print('GPUs:', tf.config.list_physical_devices('GPU'))"
```

Expected output: `GPUs: [PhysicalDevice(name='/physical_device:GPU:0', type='GPU')]`

If you see an empty list, check CUDA/cuDNN versions match TF requirements.

---

## Step 4 — Download the Onsets & Frames realtime model

```bash
# The realtime model checkpoint (lightweight TFLite version)
python -c "
from magenta.models.onsets_frames_transcription import audio_label_data_utils
print('Magenta imported OK')
"

# If the above works, download the realtime checkpoint:
# (Magenta downloads it automatically on first use to ~/.magenta/)
```

---

## Step 5 — Run the server with O&F

```bash
# From repo root, with the venv active:
python server/app.py --port 8000 --transcriber onsets_frames
```

Expected startup output:
```
[INFO] Loading Onsets & Frames realtime model...
[INFO] GPU: /physical_device:GPU:0
[INFO] Transcriber ready: onsets_frames
[INFO] Server ready on port 8000
```

If O&F fails to load, it falls back to FakeTranscriber with a warning — note this in your results.

---

## Step 6 — Run the latency test

Open a second terminal (venv active):

```bash
# Stream the golden C-major chord WAV and measure onset→event latency
python tools/latency_harness.py \
  --server ws://localhost:8000/stream \
  --notes ws://localhost:8000/notes \
  --wav fixtures/cmaj_chord.wav \
  --runs 20

# Results saved to fixtures/latency_results.json
```

---

## Step 7 — Run the golden accuracy test

```bash
python tools/check_golden.py \
  --server ws://localhost:8000/stream \
  --notes ws://localhost:8000/notes \
  --wav fixtures/cmaj_chord.wav \
  --midi fixtures/cmaj_chord.mid
```

Expected: F1 ≥ 0.5 (ideally ≥ 0.7 with O&F on a clean WAV)

---

## Step 8 — Post results back

Copy these files into the repo and push to a new branch called `results/t19-onsets-frames`:

```bash
git checkout -b results/t19-onsets-frames

# Copy your results
cp fixtures/latency_results.json fixtures/t19_latency_results.json

# Create a short results file
cat > T19_RESULTS.md << 'EOF'
# T19 Results — Onsets & Frames on RTX 3070

## Environment
- Python version:
- TensorFlow version:
- CUDA version:
- GPU: RTX 3070

## O&F model loaded successfully: YES / NO
## Fallback to FakeTranscriber: YES / NO

## Latency (from fixtures/t19_latency_results.json)
- p50: ___ ms
- p95: ___ ms
- Target was: < 150ms p95

## Golden eval (C major chord)
- Precision: ___
- Recall: ___
- F1: ___
- Target was: F1 >= 0.5

## Notes / Issues
(anything that went wrong or observations)
EOF

git add T19_RESULTS.md fixtures/t19_latency_results.json
git commit -m "results(t19): Onsets & Frames latency + accuracy on RTX 3070"
git push origin results/t19-onsets-frames
```

Then open a PR or just notify the team that the branch is pushed.

---

## If O&F won't install on Windows

Known issues:
- `magenta` requires Python ≤ 3.11 — use a 3.11 venv
- Some `tensorflow-gpu` versions need specific CUDA/cuDNN — check the [TF compatibility table](https://www.tensorflow.org/install/source_windows#gpu)
- WSL2 with Ubuntu is a reliable fallback if native Windows install keeps failing

If you cannot get O&F running after 30 minutes of debugging, run the test with basic-pitch instead and note it in T19_RESULTS.md:

```bash
python server/app.py --port 8000 --transcriber basic_pitch
```

Then run the same latency + golden tests and record basic-pitch results.

---

## Expected results summary

| Metric | basic-pitch baseline | O&F target |
|--------|---------------------|------------|
| p95 latency | ~2000ms (2s window) | < 150ms |
| C major F1 | ≥ 0.5 | ≥ 0.7 |
| GPU required | No | Yes (RTX 3070) |

---

**When done: push `results/t19-onsets-frames` branch to the repo and signal the team.**
