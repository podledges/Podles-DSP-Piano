# pyright: reportAny=false, reportUnknownMemberType=false

from __future__ import annotations

import json
import math
import struct
import sys
from pathlib import Path

from jsonschema import Draft7Validator, ValidationError

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from contracts.audio_stream_v1 import HEADER_SIZE, decode, encode_audio  # noqa: E402
from contracts.note_events_v1 import NoteEventV1  # noqa: E402

FIXTURE_DIR = Path(__file__).resolve().parent
GOLDEN_AUDIO = FIXTURE_DIR / "golden_audio_frame.bin"
GOLDEN_NOTE = FIXTURE_DIR / "golden_note_event.json"
SCHEMA = ROOT / "contracts" / "note_events_v1_schema.json"


def _golden_pcm() -> bytes:
    sample_rate = 16000
    frequency_hz = 440.0
    sample_count = 320
    amplitude = 12000
    samples = [
        int(round(amplitude * math.sin(2.0 * math.pi * frequency_hz * n / sample_rate)))
        for n in range(sample_count)
    ]
    return struct.pack(f"<{sample_count}h", *samples)


def _write_audio_fixture() -> None:
    pcm = _golden_pcm()
    frame = encode_audio(
        seq=1,
        sample_index=0,
        timestamp_ms=0,
        sample_rate=16000,
        pcm_bytes=pcm,
    )
    _ = GOLDEN_AUDIO.write_bytes(frame)

    decoded = decode(frame)
    if decoded.seq != 1:
        raise RuntimeError("golden audio seq mismatch")
    if decoded.sample_index != 0:
        raise RuntimeError("golden audio sample_index mismatch")
    if decoded.timestamp_ms != 0:
        raise RuntimeError("golden audio timestamp_ms mismatch")
    if decoded.sample_rate != 16000:
        raise RuntimeError("golden audio sample_rate mismatch")
    if decoded.channels != 1:
        raise RuntimeError("golden audio channels mismatch")
    if decoded.pcm_len != 320:
        raise RuntimeError("golden audio pcm_len mismatch")
    if decoded.pcm != pcm:
        raise RuntimeError("golden audio PCM payload mismatch")
    if len(frame) != HEADER_SIZE + (320 * 2):
        raise RuntimeError("golden audio frame length mismatch")


def _write_note_fixture() -> None:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    Draft7Validator.check_schema(schema)
    validator = Draft7Validator(schema)

    event = NoteEventV1(
        type="note_on",
        midi=69,
        onset_ms=100,
        velocity=80,
        confidence=0.95,
        source="server",
        session_id="test-session-001",
        seq=1,
    )
    payload = event.to_dict()
    validator.validate(payload)
    _ = GOLDEN_NOTE.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    invalid = dict(payload)
    invalid["midi"] = 10
    try:
        validator.validate(invalid)
    except ValidationError:
        pass
    else:
        raise RuntimeError("note_events_v1 schema accepted invalid midi example")

    round_trip = NoteEventV1.from_json(event.to_json())
    if round_trip != event:
        raise RuntimeError("golden note event JSON round trip mismatch")


def main() -> None:
    _write_audio_fixture()
    _write_note_fixture()
    print("ALL GOLDEN FIXTURES VERIFIED")


if __name__ == "__main__":
    main()
