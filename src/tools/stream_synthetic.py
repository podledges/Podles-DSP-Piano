#!/usr/bin/env python3
# pyright: reportMissingImports=false
"""Stream synthetic audio_stream_v1 PCM frames over a websocket."""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import soundfile as sf  # type: ignore[reportMissingImports]
import websockets


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from contracts.audio_stream_v1 import encode_audio  # noqa: E402


SAMPLE_RATE = 16_000
FRAME_SAMPLES = 320
DEFAULT_TONE_HZ = 440.0


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    data, sample_rate = sf.read(path, dtype="int16", always_2d=True)
    if data.shape[1] == 1:
        mono = data[:, 0]
    else:
        mono = np.round(data.astype(np.int32).mean(axis=1)).astype(np.int16)
    return np.ascontiguousarray(mono), int(sample_rate)


def generate_tone(frequency_hz: float, duration_seconds: float, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    sample_count = int(round(duration_seconds * sample_rate))
    t = np.arange(sample_count, dtype=np.float64) / sample_rate
    wave = np.sin(2.0 * np.pi * frequency_hz * t) * 0.50
    return np.round(wave * np.iinfo(np.int16).max).astype(np.int16)


def iter_audio_frames(samples: np.ndarray, sample_rate: int) -> Iterator[tuple[int, bytes]]:
    seq = 0
    for sample_index in range(0, len(samples), FRAME_SAMPLES):
        chunk = np.ascontiguousarray(samples[sample_index : sample_index + FRAME_SAMPLES])
        timestamp_ms = round((sample_index / sample_rate) * 1000)
        frame = encode_audio(seq, sample_index, timestamp_ms, sample_rate, chunk.tobytes())
        yield sample_index, frame
        seq = (seq + 1) & 0xFFFFFFFF


async def stream_audio(uri: str, samples: np.ndarray, sample_rate: int, realtime: bool = False) -> tuple[int, int, float]:
    frames_sent = 0
    bytes_sent = 0
    started = time.perf_counter()
    async with websockets.connect(uri) as ws:
        for sample_index, frame in iter_audio_frames(samples, sample_rate):
            await ws.send(frame)
            frames_sent += 1
            bytes_sent += len(frame)
            if realtime:
                await asyncio.sleep(min(FRAME_SAMPLES, len(samples) - sample_index) / sample_rate)
    return frames_sent, bytes_sent, time.perf_counter() - started


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stream audio_stream_v1 frames to a websocket server")
    parser.add_argument("--server", required=True, help="websocket URI, e.g. ws://localhost:8000/stream")
    parser.add_argument("--wav", type=Path, help="WAV file to stream")
    parser.add_argument("--tone", type=float, help="generated sine tone frequency in Hz")
    parser.add_argument("--duration", type=float, default=5.0, help="generated tone duration in seconds")
    parser.add_argument("--realtime", action="store_true", help="sleep between frames to match audio time")
    return parser.parse_args()


def load_audio(args: argparse.Namespace) -> tuple[np.ndarray, int]:
    if args.wav:
        return read_wav(args.wav)
    tone_hz = args.tone if args.tone is not None else DEFAULT_TONE_HZ
    return generate_tone(tone_hz, args.duration), SAMPLE_RATE


def main() -> None:
    args = parse_args()
    samples, sample_rate = load_audio(args)
    frames_sent, bytes_sent, elapsed = asyncio.run(
        stream_audio(args.server, samples, sample_rate, realtime=args.realtime)
    )
    print(f"frames sent: {frames_sent}")
    print(f"bytes sent: {bytes_sent}")
    print(f"elapsed: {elapsed:.3f}s")


if __name__ == "__main__":
    main()
