"""
test_basic_pitch.py - Tolerance tests for BasicPitchTranscriber.

Feeds the golden C-major chord fixture (C4+E4+G4, 2s, 16kHz int16 mono) through
the streaming feed()/poll() interface and asserts the model detects all three
notes within +-1 semitone. The model is loaded once per test; these tests are
skipped if the 'basic-pitch' package is not installed.
"""

from __future__ import annotations

import json
import wave
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import cast

import pytest
from jsonschema import Draft7Validator

from contracts.note_events_v1 import NoteEventV1 as NoteEvent
from server.transcriber.base import Transcriber


ROOT = Path(__file__).resolve().parents[2]
FIXTURE_WAV = ROOT / "fixtures" / "cmaj_chord.wav"
CHUNK_SAMPLES = 320  # 20ms at 16kHz, matches the firmware framing batch size

SCHEMA = cast(
    dict[str, object],
    json.loads((ROOT / "contracts" / "note_events_v1_schema.json").read_text(encoding="utf-8")),
)
Draft7Validator.check_schema(SCHEMA)
VALIDATOR = Draft7Validator(SCHEMA)
VALIDATE = cast(Callable[[Mapping[str, object]], None], VALIDATOR.validate)

C4_TOLERANCE = {59, 60, 61}
E4_TOLERANCE = {63, 64, 65}
G4_TOLERANCE = {66, 67, 68}

basic_pitch = pytest.importorskip("basic_pitch", reason="basic-pitch package not installed")

from server.transcriber.basic_pitch import BasicPitchTranscriber  # noqa: E402


def _read_pcm_bytes(wav_path: Path) -> bytes:
    with wave.open(str(wav_path), "rb") as wav_file:
        assert wav_file.getframerate() == 16000
        assert wav_file.getnchannels() == 1
        assert wav_file.getsampwidth() == 2
        return wav_file.readframes(wav_file.getnframes())


def _feed_fixture(transcriber: BasicPitchTranscriber, session_id: str = "test-basic-pitch") -> list[NoteEvent]:
    pcm = _read_pcm_bytes(FIXTURE_WAV)
    transcriber.start(session_id)

    sample_index = 0
    for offset in range(0, len(pcm), CHUNK_SAMPLES * 2):
        chunk = pcm[offset : offset + CHUNK_SAMPLES * 2]
        transcriber.feed(chunk, sample_index)
        sample_index += len(chunk) // 2

    return transcriber.poll()


def test_basic_pitch_model_loads() -> None:
    transcriber = BasicPitchTranscriber()
    assert isinstance(transcriber, Transcriber)


def test_basic_pitch_detects_cmaj_chord() -> None:
    transcriber = BasicPitchTranscriber()
    events = _feed_fixture(transcriber)

    assert events, "expected at least one note_on event for the C-major chord"
    detected = {event.midi for event in events if event.type == "note_on" and event.midi is not None}

    assert detected & C4_TOLERANCE, f"C4 (60+-1) not detected; got {sorted(detected)}"
    assert detected & E4_TOLERANCE, f"E4 (64+-1) not detected; got {sorted(detected)}"
    assert detected & G4_TOLERANCE, f"G4 (67+-1) not detected; got {sorted(detected)}"


def test_basic_pitch_events_have_server_source() -> None:
    transcriber = BasicPitchTranscriber()
    events = _feed_fixture(transcriber)

    assert events
    assert all(event.source == "server" for event in events)


def test_basic_pitch_events_validate_against_schema() -> None:
    transcriber = BasicPitchTranscriber()
    events = _feed_fixture(transcriber)

    assert events
    for event in events:
        VALIDATE(event.to_dict())


def test_basic_pitch_poll_clears_after_first_call() -> None:
    transcriber = BasicPitchTranscriber()
    first = _feed_fixture(transcriber)

    assert first
    assert transcriber.poll() == []
