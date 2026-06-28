"""
fake.py - Deterministic FakeTranscriber for pipeline testing.
Emits a note_on for midi=69 (A4) whenever RMS of the PCM chunk exceeds THRESHOLD.
Emits a note_off after 3 consecutive silent chunks.
No model, no ML. Fully deterministic.
"""

from __future__ import annotations

import math
from typing import override

from contracts.note_events_v1 import NoteEventV1 as NoteEvent
from server.transcriber.base import Transcriber


THRESHOLD_RMS = 500
MIDI_A4 = 69
DEFAULT_VELOCITY = 100
DEFAULT_CONFIDENCE = 1.0
SAMPLE_RATE_HZ = 16000


class FakeTranscriber(Transcriber):
    def __init__(self) -> None:
        self._session_id: str | None = None
        self._active_note: int | None = None
        self._silent_chunks: int = 0
        self._seq: int = 0
        self._pending_events: list[NoteEvent] = []

    @override
    def start(self, session_id: str) -> None:
        self._session_id = session_id
        self._active_note = None
        self._silent_chunks = 0
        self._seq = 0
        self._pending_events = []

    @override
    def feed(self, pcm_bytes: bytes, sample_index: int) -> None:
        if self._session_id is None:
            raise RuntimeError("FakeTranscriber.start() must be called before feed()")

        rms = _rms_int16_le(pcm_bytes)
        if rms > THRESHOLD_RMS:
            if self._active_note is None:
                self._active_note = MIDI_A4
                self._pending_events.append(
                    NoteEvent(
                        type="note_on",
                        session_id=self._session_id,
                        midi=MIDI_A4,
                        onset_ms=_sample_index_to_ms(sample_index),
                        velocity=DEFAULT_VELOCITY,
                        confidence=DEFAULT_CONFIDENCE,
                        source="server",
                        seq=self._next_seq(),
                    )
                )
            self._silent_chunks = 0
            return

        if self._active_note is None:
            return

        self._silent_chunks += 1
        if self._silent_chunks >= 3:
            self._pending_events.append(
                NoteEvent(
                    type="note_off",
                    session_id=self._session_id,
                    midi=self._active_note,
                    offset_ms=_sample_index_to_ms(sample_index),
                    source="server",
                    seq=self._next_seq(),
                )
            )
            self._active_note = None
            self._silent_chunks = 0

    @override
    def poll(self) -> list[NoteEvent]:
        events = self._pending_events
        self._pending_events = []
        return events

    @override
    def stop(self) -> None:
        self._session_id = None
        self._active_note = None
        self._silent_chunks = 0
        self._pending_events = []

    def _next_seq(self) -> int:
        seq = self._seq
        self._seq += 1
        return seq


def _rms_int16_le(pcm_bytes: bytes) -> float:
    sample_count = len(pcm_bytes) // 2
    if sample_count == 0:
        return 0.0

    total = 0
    for index in range(0, sample_count * 2, 2):
        sample = int.from_bytes(pcm_bytes[index : index + 2], byteorder="little", signed=True)
        total += sample * sample
    return math.sqrt(total / sample_count)


def _sample_index_to_ms(sample_index: int) -> int:
    return max(0, round((sample_index / SAMPLE_RATE_HZ) * 1000))
