"""
basic_pitch.py - Spotify basic-pitch polyphonic transcriber.

Loads the ICASSP 2022 model ONCE in __init__, then accumulates streamed int16
LE PCM in feed(). Once at least 2s (32000 samples at 16kHz) is buffered, the
window is resampled 16kHz -> 22050Hz and run through basic-pitch inference. The
resulting note events are converted to note_events_v1 note_on events and queued
for poll(). After each inference the buffer slides, keeping the last 1s for
overlap so notes straddling a window boundary are not missed.

basic-pitch's predict() consumes a file path (not an array) and returns note
events as tuples: (start_time_s, end_time_s, pitch_midi, amplitude, pitch_bends).
"""

from __future__ import annotations

import tempfile
from collections.abc import Sequence
from pathlib import Path
from typing import cast, override

import numpy as np
from numpy.typing import NDArray
from scipy.io import wavfile
from scipy.signal import resample_poly

from contracts.note_events_v1 import NoteEventV1 as NoteEvent
from server.transcriber.base import Transcriber


# basic-pitch note event: (start_time_s, end_time_s, pitch_midi, amplitude, pitch_bends)
NoteEventTuple = tuple[float, float, int, float, "list[int] | None"]

INPUT_SAMPLE_RATE_HZ = 16000
MODEL_SAMPLE_RATE_HZ = 22050
WINDOW_SAMPLES = 2 * INPUT_SAMPLE_RATE_HZ  # 32000 samples == 2s of 16kHz audio
OVERLAP_SAMPLES = 1 * INPUT_SAMPLE_RATE_HZ  # keep last 1s for cross-window notes
INT16_FULL_SCALE = 32768.0

MIDI_MIN = 21
MIDI_MAX = 108
VELOCITY_MIN = 1
VELOCITY_MAX = 127
SOURCE_SERVER = "server"


class BasicPitchTranscriber(Transcriber):
    def __init__(self) -> None:
        try:
            from basic_pitch.inference import Model, predict
        except ImportError as import_error:
            raise ImportError(
                "BasicPitchTranscriber requires the 'basic-pitch' package. "
                "Install it with `pip install basic-pitch`."
            ) from import_error

        self._predict = predict
        self._model = Model(_resolve_model_path())

        self._session_id: str | None = None
        self._buffer: NDArray[np.float32] = _empty_buffer()
        self._buffer_start_ms: int = 0
        self._seq: int = 0
        self._pending_events: list[NoteEvent] = []

    @override
    def start(self, session_id: str) -> None:
        self._session_id = session_id
        self._buffer = _empty_buffer()
        self._buffer_start_ms = 0
        self._seq = 0
        self._pending_events = []

    @override
    def feed(self, pcm_bytes: bytes, sample_index: int) -> None:
        if self._session_id is None:
            raise RuntimeError("BasicPitchTranscriber.start() must be called before feed()")

        if self._buffer.size == 0:
            self._buffer_start_ms = _sample_index_to_ms(sample_index)

        chunk = np.frombuffer(pcm_bytes, dtype="<i2").astype(np.float32) / INT16_FULL_SCALE
        self._buffer = np.concatenate((self._buffer, chunk))

        while self._buffer.size >= WINDOW_SAMPLES:
            self._run_inference(self._buffer[:WINDOW_SAMPLES])
            self._slide_buffer()

    @override
    def poll(self) -> list[NoteEvent]:
        events = self._pending_events
        self._pending_events = []
        return events

    @override
    def stop(self) -> None:
        self._session_id = None
        self._buffer = _empty_buffer()
        self._buffer_start_ms = 0
        self._pending_events = []

    def _run_inference(self, window: NDArray[np.float32]) -> None:
        if self._session_id is None:
            return

        resampled = resample_poly(window, MODEL_SAMPLE_RATE_HZ, INPUT_SAMPLE_RATE_HZ).astype(np.float32)
        note_events = self._predict_window(resampled)

        for start_time_s, _end_time_s, pitch_midi, amplitude, *_ in note_events:
            midi = int(pitch_midi)
            if not MIDI_MIN <= midi <= MIDI_MAX:
                continue

            onset_ms = self._buffer_start_ms + max(0, round(float(start_time_s) * 1000))
            self._pending_events.append(
                NoteEvent(
                    type="note_on",
                    session_id=self._session_id,
                    midi=midi,
                    onset_ms=onset_ms,
                    velocity=_amplitude_to_velocity(float(amplitude)),
                    confidence=_amplitude_to_confidence(float(amplitude)),
                    source=SOURCE_SERVER,
                    seq=self._next_seq(),
                )
            )

    def _predict_window(self, resampled: NDArray[np.float32]) -> Sequence[NoteEventTuple]:
        with tempfile.TemporaryDirectory() as tmp_dir:
            wav_path = Path(tmp_dir) / "window.wav"
            wavfile.write(str(wav_path), MODEL_SAMPLE_RATE_HZ, resampled)
            _model_output, _midi_data, note_events = self._predict(wav_path, self._model)
        return cast("Sequence[NoteEventTuple]", note_events)

    def _slide_buffer(self) -> None:
        consumed = self._buffer.size - OVERLAP_SAMPLES if self._buffer.size > OVERLAP_SAMPLES else self._buffer.size
        self._buffer_start_ms += _samples_to_ms(consumed)
        self._buffer = self._buffer[consumed:]

    def _next_seq(self) -> int:
        seq = self._seq
        self._seq += 1
        return seq


def _resolve_model_path() -> Path:
    """Pick the first model backend available on this system.

    The bundled TensorFlow saved_model fails to load under newer TensorFlow
    builds, so the ONNX variant is preferred when onnxruntime is present.
    """
    from basic_pitch import (
        ICASSP_2022_MODEL_PATH,
        ONNX_PRESENT,
        TFLITE_PRESENT,
        FilenameSuffix,
        build_icassp_2022_model_path,
    )

    if ONNX_PRESENT:
        onnx_path = build_icassp_2022_model_path(FilenameSuffix.onnx)
        if onnx_path.exists():
            return onnx_path
    if TFLITE_PRESENT:
        tflite_path = build_icassp_2022_model_path(FilenameSuffix.tflite)
        if tflite_path.exists():
            return tflite_path
    return Path(ICASSP_2022_MODEL_PATH)


def _empty_buffer() -> NDArray[np.float32]:
    return np.zeros(0, dtype=np.float32)


def _amplitude_to_velocity(amplitude: float) -> int:
    velocity = round(_clamp_unit(amplitude) * VELOCITY_MAX)
    return max(VELOCITY_MIN, min(VELOCITY_MAX, velocity))


def _amplitude_to_confidence(amplitude: float) -> float:
    return _clamp_unit(amplitude)


def _clamp_unit(value: float) -> float:
    return max(0.0, min(1.0, value))


def _sample_index_to_ms(sample_index: int) -> int:
    return max(0, round((sample_index / INPUT_SAMPLE_RATE_HZ) * 1000))


def _samples_to_ms(samples: int) -> int:
    return round((samples / INPUT_SAMPLE_RATE_HZ) * 1000)
