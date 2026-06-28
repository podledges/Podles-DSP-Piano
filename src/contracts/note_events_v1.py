"""FROZEN note_events_v1 JSON contract helpers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import cast

EVENT_TYPES = {"note_on", "note_off", "snapshot", "status"}
SOURCES = {"server", "esp_hint"}


@dataclass(frozen=True)
class NoteEventV1:
    type: str
    session_id: str
    midi: int | None = None
    onset_ms: int | None = None
    offset_ms: int | None = None
    velocity: int | None = None
    confidence: float | None = None
    source: str | None = None
    seq: int | None = None

    def __post_init__(self) -> None:
        self._validate()

    def _validate(self) -> None:
        if self.type not in EVENT_TYPES:
            raise ValueError(f"invalid note_events_v1 type: {self.type}")
        if not self.session_id:
            raise ValueError("note_events_v1 session_id must be a non-empty string")

        if self.midi is not None and not 21 <= self.midi <= 108:
            raise ValueError("note_events_v1 midi must be in range 21..108")
        if self.velocity is not None and not 0 <= self.velocity <= 127:
            raise ValueError("note_events_v1 velocity must be in range 0..127")
        if self.confidence is not None and not 0.0 <= self.confidence <= 1.0:
            raise ValueError("note_events_v1 confidence must be in range 0.0..1.0")
        if self.source is not None and self.source not in SOURCES:
            raise ValueError(f"invalid note_events_v1 source: {self.source}")
        if self.seq is not None and self.seq < 0:
            raise ValueError("note_events_v1 seq must be non-negative")

        if self.type == "note_on":
            required = {"midi": self.midi, "onset_ms": self.onset_ms, "source": self.source, "seq": self.seq}
            missing = [name for name, value in required.items() if value is None]
            if missing:
                raise ValueError(f"note_on missing required fields: {', '.join(missing)}")
        elif self.type == "note_off":
            required = {"midi": self.midi, "offset_ms": self.offset_ms, "source": self.source, "seq": self.seq}
            missing = [name for name, value in required.items() if value is None]
            if missing:
                raise ValueError(f"note_off missing required fields: {', '.join(missing)}")
        elif self.type == "snapshot":
            required = {"midi": self.midi, "source": self.source, "seq": self.seq}
            missing = [name for name, value in required.items() if value is None]
            if missing:
                raise ValueError(f"snapshot missing required fields: {', '.join(missing)}")

    def to_dict(self) -> dict[str, object]:
        payload = {
            "type": self.type,
            "midi": self.midi,
            "onset_ms": self.onset_ms,
            "offset_ms": self.offset_ms,
            "velocity": self.velocity,
            "confidence": self.confidence,
            "source": self.source,
            "session_id": self.session_id,
            "seq": self.seq,
        }
        return {key: value for key, value in payload.items() if value is not None}

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), separators=(",", ":"), sort_keys=True)

    @classmethod
    def from_json(cls, data: str | bytes) -> "NoteEventV1":
        raw = cast(object, json.loads(data))
        if not isinstance(raw, dict):
            raise ValueError("note_events_v1 JSON must decode to an object")
        raw_payload = cast(dict[object, object], raw)
        if not all(isinstance(key, str) for key in raw_payload):
            raise ValueError("note_events_v1 JSON keys must be strings")
        payload = {cast(str, key): value for key, value in raw_payload.items()}
        return cls(
            type=_required_str(payload, "type"),
            session_id=_required_str(payload, "session_id"),
            midi=_optional_int(payload, "midi"),
            onset_ms=_optional_int(payload, "onset_ms"),
            offset_ms=_optional_int(payload, "offset_ms"),
            velocity=_optional_int(payload, "velocity"),
            confidence=_optional_float(payload, "confidence"),
            source=_optional_str(payload, "source"),
            seq=_optional_int(payload, "seq"),
        )


def _required_str(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str):
        raise ValueError(f"note_events_v1 {key} must be a string")
    return value


def _optional_str(payload: dict[str, object], key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"note_events_v1 {key} must be a string")
    return value


def _optional_int(payload: dict[str, object], key: str) -> int | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"note_events_v1 {key} must be an integer")
    return value


def _optional_float(payload: dict[str, object], key: str) -> float | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"note_events_v1 {key} must be a number")
    return float(value)
