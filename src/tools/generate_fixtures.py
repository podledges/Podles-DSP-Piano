#!/usr/bin/env python3
# pyright: reportMissingImports=false
"""Generate golden WAV and MIDI fixtures for the stream harnesses."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pretty_midi  # type: ignore[reportMissingImports]
import soundfile as sf  # type: ignore[reportMissingImports]


REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = REPO_ROOT / "fixtures"
WAV_PATH = FIXTURE_DIR / "cmaj_chord.wav"
MIDI_PATH = FIXTURE_DIR / "cmaj_chord.mid"

SAMPLE_RATE = 16_000
DURATION_SECONDS = 2.0
FREQUENCIES_HZ = (261.63, 329.63, 392.00)
MIDI_NOTES = (60, 64, 67)
VELOCITY = 80
PEAK_AMPLITUDE = 0.80


def generate_chord(sample_rate: int = SAMPLE_RATE, duration: float = DURATION_SECONDS) -> np.ndarray:
    sample_count = int(round(sample_rate * duration))
    t = np.arange(sample_count, dtype=np.float64) / sample_rate
    waveform = sum(np.sin(2.0 * np.pi * freq * t) for freq in FREQUENCIES_HZ)
    waveform /= max(float(np.max(np.abs(waveform))), 1.0)
    return np.round(waveform * PEAK_AMPLITUDE * np.iinfo(np.int16).max).astype(np.int16)


def write_wav(path: Path = WAV_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, generate_chord(), SAMPLE_RATE, subtype="PCM_16")
    return path


def write_midi(path: Path = MIDI_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    midi = pretty_midi.PrettyMIDI(initial_tempo=120)
    piano = pretty_midi.Instrument(program=pretty_midi.instrument_name_to_program("Acoustic Grand Piano"))
    for pitch in MIDI_NOTES:
        piano.notes.append(
            pretty_midi.Note(
                velocity=VELOCITY,
                pitch=pitch,
                start=0.0,
                end=DURATION_SECONDS,
            )
        )
    midi.instruments.append(piano)
    midi.write(str(path))
    return path


def main() -> None:
    wav_path = write_wav()
    midi_path = write_midi()
    print(f"wrote {wav_path}")
    print(f"wrote {midi_path}")


if __name__ == "__main__":
    main()
