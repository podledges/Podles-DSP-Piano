#!/usr/bin/env python3
# pyright: reportMissingImports=false
"""Replay a WAV in realtime and measure audio onset to note_event latency."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pretty_midi  # type: ignore[reportMissingImports]
import soundfile as sf  # type: ignore[reportMissingImports]
import websockets


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from contracts.audio_stream_v1 import encode_audio  # noqa: E402
from contracts.note_events_v1 import NoteEventV1  # noqa: E402


FRAME_SAMPLES = 320
DEFAULT_MIDI_PATH = REPO_ROOT / "fixtures" / "cmaj_chord.mid"
RESULTS_PATH = REPO_ROOT / "fixtures" / "latency_results.json"


@dataclass(frozen=True)
class ExpectedOnset:
    index: int
    midi: int
    onset_seconds: float
    onset_sample: int


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    data, sample_rate = sf.read(path, dtype="int16", always_2d=True)
    if data.shape[1] == 1:
        mono = data[:, 0]
    else:
        mono = np.round(data.astype(np.int32).mean(axis=1)).astype(np.int16)
    return np.ascontiguousarray(mono), int(sample_rate)


def read_expected_onsets(path: Path, sample_rate: int) -> list[ExpectedOnset]:
    midi = pretty_midi.PrettyMIDI(str(path))
    notes = sorted(
        (note for instrument in midi.instruments for note in instrument.notes),
        key=lambda note: (note.start, note.pitch),
    )
    return [
        ExpectedOnset(
            index=index,
            midi=note.pitch,
            onset_seconds=float(note.start),
            onset_sample=round(float(note.start) * sample_rate),
        )
        for index, note in enumerate(notes)
    ]


def iter_audio_frames(samples: np.ndarray, sample_rate: int) -> Iterator[tuple[int, int, bytes]]:
    seq = 0
    for sample_index in range(0, len(samples), FRAME_SAMPLES):
        chunk = np.ascontiguousarray(samples[sample_index : sample_index + FRAME_SAMPLES])
        timestamp_ms = round((sample_index / sample_rate) * 1000)
        yield sample_index, len(chunk), encode_audio(seq, sample_index, timestamp_ms, sample_rate, chunk.tobytes())
        seq = (seq + 1) & 0xFFFFFFFF


def parse_note_event(raw: str | bytes) -> NoteEventV1 | None:
    try:
        return NoteEventV1.from_json(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


async def listen_for_notes(
    notes_uri: str,
    expected: list[ExpectedOnset],
    sent_onsets: dict[int, float],
    measurements: list[dict[str, float | int]],
    ready: asyncio.Event,
    done: asyncio.Event,
) -> None:
    seen: set[int] = set()
    async with websockets.connect(notes_uri) as ws:
        ready.set()
        async for raw in ws:
            arrived = time.perf_counter()
            event = parse_note_event(raw)
            if event is None or event.type != "note_on" or event.midi is None:
                continue

            for onset in expected:
                if onset.index in seen or onset.midi != event.midi or onset.index not in sent_onsets:
                    continue
                measurements.append(
                    {
                        "midi": onset.midi,
                        "expected_onset_ms": round(onset.onset_seconds * 1000),
                        "event_onset_ms": event.onset_ms if event.onset_ms is not None else -1,
                        "latency_ms": (arrived - sent_onsets[onset.index]) * 1000.0,
                    }
                )
                seen.add(onset.index)
                break

            if len(seen) == len(expected):
                done.set()
                return


async def stream_wav_realtime(
    stream_uri: str,
    samples: np.ndarray,
    sample_rate: int,
    expected: list[ExpectedOnset],
    sent_onsets: dict[int, float],
) -> None:
    async with websockets.connect(stream_uri) as ws:
        for sample_index, chunk_len, frame in iter_audio_frames(samples, sample_rate):
            await ws.send(frame)
            sent_at = time.perf_counter()
            frame_end = sample_index + chunk_len
            for onset in expected:
                if sample_index <= onset.onset_sample < frame_end:
                    sent_onsets.setdefault(onset.index, sent_at)
            await asyncio.sleep(chunk_len / sample_rate)


async def run_once(
    stream_uri: str,
    notes_uri: str,
    samples: np.ndarray,
    sample_rate: int,
    expected: list[ExpectedOnset],
) -> list[dict[str, float | int]]:
    sent_onsets: dict[int, float] = {}
    measurements: list[dict[str, float | int]] = []
    ready = asyncio.Event()
    done = asyncio.Event()
    listener = asyncio.create_task(
        listen_for_notes(notes_uri, expected, sent_onsets, measurements, ready, done)
    )
    try:
        await asyncio.wait_for(ready.wait(), timeout=5.0)
        await stream_wav_realtime(stream_uri, samples, sample_rate, expected, sent_onsets)
        try:
            await asyncio.wait_for(done.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            pass
    finally:
        listener.cancel()
        await asyncio.gather(listener, return_exceptions=True)
    return measurements


def summarize(latencies_ms: list[float]) -> tuple[float | None, float | None]:
    if not latencies_ms:
        return None, None
    return float(np.percentile(latencies_ms, 50)), float(np.percentile(latencies_ms, 95))


async def run_harness(args: argparse.Namespace) -> dict[str, Any]:
    samples, sample_rate = read_wav(args.wav)
    expected = read_expected_onsets(args.midi, sample_rate)
    runs: list[dict[str, Any]] = []
    all_latencies: list[float] = []

    for run_index in range(args.runs):
        measurements = await run_once(args.server, args.notes, samples, sample_rate, expected)
        run_latencies = [float(item["latency_ms"]) for item in measurements]
        all_latencies.extend(run_latencies)
        runs.append({"run": run_index + 1, "measurements": measurements})

    p50_ms, p95_ms = summarize(all_latencies)
    return {
        "wav": str(args.wav),
        "midi": str(args.midi),
        "runs": args.runs,
        "expected_notes_per_run": len(expected),
        "measurement_count": len(all_latencies),
        "p50_ms": p50_ms,
        "p95_ms": p95_ms,
        "details": runs,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Measure onset-to-note_event websocket latency")
    parser.add_argument("--server", required=True, help="audio stream websocket URI")
    parser.add_argument("--notes", required=True, help="note events websocket URI")
    parser.add_argument("--wav", type=Path, required=True, help="WAV fixture to replay")
    parser.add_argument("--midi", type=Path, default=DEFAULT_MIDI_PATH, help="MIDI fixture with expected onsets")
    parser.add_argument("--runs", type=int, default=10, help="number of realtime replay runs")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    results = asyncio.run(run_harness(args))
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.write_text(json.dumps(results, indent=2, sort_keys=True), encoding="utf-8")
    if results["p50_ms"] is None or results["p95_ms"] is None:
        print("no matching note_on events measured")
        sys.exit(1)
    print(f"p50 latency: {results['p50_ms']:.2f} ms")
    print(f"p95 latency: {results['p95_ms']:.2f} ms")
    print(f"wrote {RESULTS_PATH}")


if __name__ == "__main__":
    main()
