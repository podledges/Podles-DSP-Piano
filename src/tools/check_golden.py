#!/usr/bin/env python3
# pyright: reportMissingImports=false
"""Compare server note_on detections against a golden MIDI fixture."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import mir_eval.transcription  # type: ignore[reportMissingImports]
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
ONSET_TOLERANCE_SECONDS = 0.05
PASS_F1 = 0.50


@dataclass(frozen=True)
class NoteTuple:
    midi: int
    onset_seconds: float
    offset_seconds: float


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    data, sample_rate = sf.read(path, dtype="int16", always_2d=True)
    if data.shape[1] == 1:
        mono = data[:, 0]
    else:
        mono = np.round(data.astype(np.int32).mean(axis=1)).astype(np.int16)
    return np.ascontiguousarray(mono), int(sample_rate)


def read_reference_notes(path: Path) -> list[NoteTuple]:
    midi = pretty_midi.PrettyMIDI(str(path))
    notes = sorted(
        (note for instrument in midi.instruments for note in instrument.notes),
        key=lambda note: (note.start, note.pitch),
    )
    return [NoteTuple(note.pitch, float(note.start), float(note.end)) for note in notes]


def iter_audio_frames(samples: np.ndarray, sample_rate: int) -> Iterator[tuple[int, bytes]]:
    seq = 0
    for sample_index in range(0, len(samples), FRAME_SAMPLES):
        chunk = np.ascontiguousarray(samples[sample_index : sample_index + FRAME_SAMPLES])
        timestamp_ms = round((sample_index / sample_rate) * 1000)
        yield len(chunk), encode_audio(seq, sample_index, timestamp_ms, sample_rate, chunk.tobytes())
        seq = (seq + 1) & 0xFFFFFFFF


def parse_note_event(raw: str | bytes) -> NoteEventV1 | None:
    try:
        return NoteEventV1.from_json(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


async def collect_note_on_events(notes_uri: str, detected: list[NoteTuple], ready: asyncio.Event) -> None:
    async with websockets.connect(notes_uri) as ws:
        ready.set()
        async for raw in ws:
            event = parse_note_event(raw)
            if event is None or event.type != "note_on" or event.midi is None or event.onset_ms is None:
                continue
            onset_seconds = event.onset_ms / 1000.0
            detected.append(NoteTuple(event.midi, onset_seconds, onset_seconds + 2.0))


async def stream_wav(stream_uri: str, samples: np.ndarray, sample_rate: int) -> None:
    async with websockets.connect(stream_uri) as ws:
        for chunk_len, frame in iter_audio_frames(samples, sample_rate):
            await ws.send(frame)
            await asyncio.sleep(chunk_len / sample_rate)


async def collect_detections(stream_uri: str, notes_uri: str, wav_path: Path) -> list[NoteTuple]:
    samples, sample_rate = read_wav(wav_path)
    detected: list[NoteTuple] = []
    ready = asyncio.Event()
    listener = asyncio.create_task(collect_note_on_events(notes_uri, detected, ready))
    try:
        await asyncio.wait_for(ready.wait(), timeout=5.0)
        await stream_wav(stream_uri, samples, sample_rate)
        await asyncio.sleep(2.0)
    finally:
        listener.cancel()
        await asyncio.gather(listener, return_exceptions=True)
    return detected


def notes_to_mir_eval(notes: list[NoteTuple]) -> tuple[np.ndarray, np.ndarray]:
    if not notes:
        return np.empty((0, 2)), np.empty((0,))
    intervals = np.array([[note.onset_seconds, note.offset_seconds] for note in notes], dtype=np.float64)
    pitches = np.array([pretty_midi.note_number_to_hz(note.midi) for note in notes], dtype=np.float64)
    return intervals, pitches


def find_missed_and_spurious(
    reference: list[NoteTuple], detected: list[NoteTuple]
) -> tuple[list[NoteTuple], list[NoteTuple]]:
    matched_detected: set[int] = set()
    missed: list[NoteTuple] = []

    for ref in reference:
        match_index = next(
            (
                index
                for index, det in enumerate(detected)
                if index not in matched_detected
                and det.midi == ref.midi
                and abs(det.onset_seconds - ref.onset_seconds) <= ONSET_TOLERANCE_SECONDS
            ),
            None,
        )
        if match_index is None:
            missed.append(ref)
        else:
            matched_detected.add(match_index)

    spurious = [det for index, det in enumerate(detected) if index not in matched_detected]
    return missed, spurious


def format_notes(notes: list[NoteTuple]) -> str:
    if not notes:
        return "none"
    return ", ".join(f"midi={note.midi}@{round(note.onset_seconds * 1000)}ms" for note in notes)


def score(reference: list[NoteTuple], detected: list[NoteTuple]) -> tuple[float, float, float, float]:
    ref_intervals, ref_pitches = notes_to_mir_eval(reference)
    est_intervals, est_pitches = notes_to_mir_eval(detected)
    return mir_eval.transcription.precision_recall_f1_overlap(
        ref_intervals,
        ref_pitches,
        est_intervals,
        est_pitches,
        onset_tolerance=ONSET_TOLERANCE_SECONDS,
        offset_ratio=None,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare websocket note detections with a MIDI fixture")
    parser.add_argument("--wav", type=Path, required=True, help="WAV fixture to stream")
    parser.add_argument("--midi", type=Path, required=True, help="golden MIDI fixture")
    parser.add_argument("--server", required=True, help="audio stream websocket URI")
    parser.add_argument("--notes", required=True, help="note events websocket URI")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    reference = read_reference_notes(args.midi)
    detected = asyncio.run(collect_detections(args.server, args.notes, args.wav))
    precision, recall, f1, _overlap = score(reference, detected)
    missed, spurious = find_missed_and_spurious(reference, detected)

    print(f"precision: {precision:.3f}")
    print(f"recall: {recall:.3f}")
    print(f"F1: {f1:.3f}")
    print(f"missed: {format_notes(missed)}")
    print(f"spurious: {format_notes(spurious)}")
    sys.exit(0 if f1 >= PASS_F1 else 1)


if __name__ == "__main__":
    main()
