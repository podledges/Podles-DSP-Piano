from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import cast

from jsonschema import Draft7Validator, ValidationError

from contracts.note_events_v1 import NoteEventV1 as NoteEvent


CONTRACTS = Path(__file__).resolve().parents[1]
FIXTURES = CONTRACTS / "fixtures"
SCHEMA = cast(
    dict[str, object],
    json.loads((CONTRACTS / "note_events_v1_schema.json").read_text(encoding="utf-8")),
)
Draft7Validator.check_schema(SCHEMA)
VALIDATOR = Draft7Validator(SCHEMA)
VALIDATE = cast(Callable[[Mapping[str, object]], None], VALIDATOR.validate)


def load_golden_note_event() -> dict[str, object]:
    return cast(
        dict[str, object],
        json.loads((FIXTURES / "golden_note_event.json").read_text(encoding="utf-8")),
    )


def validate_event(payload: Mapping[str, object]) -> None:
    VALIDATE(payload)


def assert_schema_rejected(payload: Mapping[str, object]) -> None:
    try:
        validate_event(payload)
    except ValidationError:
        return
    raise AssertionError("schema accepted an invalid note_events_v1 payload")


def test_valid_note_on_round_trip() -> None:
    event = NoteEvent(
        type="note_on",
        midi=69,
        onset_ms=100,
        velocity=80,
        confidence=0.95,
        source="server",
        session_id="test",
        seq=1,
    )

    validate_event(event.to_dict())
    decoded = NoteEvent.from_json(event.to_json())

    assert decoded == event
    assert decoded.type == "note_on"
    assert decoded.midi == 69
    assert decoded.onset_ms == 100
    assert decoded.velocity == 80
    assert decoded.confidence == 0.95
    assert decoded.source == "server"
    assert decoded.session_id == "test"
    assert decoded.seq == 1


def test_valid_note_off() -> None:
    event = NoteEvent(type="note_off", midi=60, offset_ms=500, source="server", session_id="test", seq=2)

    validate_event(event.to_dict())
    decoded = NoteEvent.from_json(event.to_json())

    assert decoded == event


def test_valid_snapshot() -> None:
    event = NoteEvent(type="snapshot", midi=72, source="server", session_id="test", seq=3)

    validate_event(event.to_dict())
    decoded = NoteEvent.from_json(event.to_json())
    assert decoded == event


def test_valid_status() -> None:
    event = NoteEvent(type="status", session_id="x", seq=0)

    validate_event(event.to_dict())
    decoded = NoteEvent.from_json(event.to_json())
    assert decoded == event
    assert decoded.midi is None


def test_esp_hint_source_accepted() -> None:
    event = NoteEvent(type="snapshot", midi=72, source="esp_hint", session_id="test", seq=4)

    validate_event(event.to_dict())
    assert NoteEvent.from_json(event.to_json()).source == "esp_hint"


def test_schema_rejects_midi_out_of_range_low() -> None:
    payload = {
        "type": "note_on",
        "midi": 20,
        "onset_ms": 100,
        "velocity": 80,
        "confidence": 0.95,
        "source": "server",
        "session_id": "test",
        "seq": 1,
    }

    assert_schema_rejected(payload)


def test_schema_rejects_midi_out_of_range_high() -> None:
    payload = {
        "type": "note_on",
        "midi": 109,
        "onset_ms": 100,
        "velocity": 80,
        "confidence": 0.95,
        "source": "server",
        "session_id": "test",
        "seq": 1,
    }

    assert_schema_rejected(payload)


def test_schema_rejects_invalid_velocity() -> None:
    payload = {
        "type": "note_on",
        "midi": 69,
        "onset_ms": 100,
        "velocity": 128,
        "confidence": 0.95,
        "source": "server",
        "session_id": "test",
        "seq": 1,
    }

    assert_schema_rejected(payload)


def test_schema_rejects_invalid_confidence() -> None:
    payload = {
        "type": "note_on",
        "midi": 69,
        "onset_ms": 100,
        "velocity": 80,
        "confidence": 1.5,
        "source": "server",
        "session_id": "test",
        "seq": 1,
    }

    assert_schema_rejected(payload)


def test_golden_note_event_fixture_validates() -> None:
    payload = load_golden_note_event()

    validate_event(payload)

    assert payload["midi"] == 69


def test_schema_rejects_missing_source() -> None:
    payload = load_golden_note_event()
    del payload["source"]

    assert_schema_rejected(payload)
