from __future__ import annotations

import asyncio
import importlib
import json
import struct
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Protocol, cast

from jsonschema import Draft7Validator

from contracts.note_events_v1 import NoteEventV1 as NoteEvent
from server.transcriber.fake import FakeTranscriber


ROOT = Path(__file__).resolve().parents[2]
SCHEMA = cast(
    dict[str, object],
    json.loads((ROOT / "contracts" / "note_events_v1_schema.json").read_text(encoding="utf-8")),
)
Draft7Validator.check_schema(SCHEMA)
VALIDATOR = Draft7Validator(SCHEMA)
VALIDATE = cast(Callable[[Mapping[str, object]], None], VALIDATOR.validate)


class NoteBroadcasterType(Protocol):
    def register(self, client_id: str) -> asyncio.Queue[str]: ...

    def unregister(self, client_id: str) -> None: ...

    def broadcast(self, note_event: NoteEvent) -> None: ...

    def broadcast_status(self, msg: dict[str, object]) -> None: ...


NoteBroadcaster = cast(
    type[NoteBroadcasterType],
    getattr(importlib.import_module("server.broadcast"), "NoteBroadcaster"),
)


def pcm_chunk(value: int, samples: int = 320) -> bytes:
    return struct.pack(f"<{samples}h", *([value] * samples))


def note_on(session_id: str = "test-session", seq: int = 0) -> NoteEvent:
    return NoteEvent(
        type="note_on",
        session_id=session_id,
        midi=69,
        onset_ms=0,
        velocity=100,
        confidence=1.0,
        source="server",
        seq=seq,
    )


def test_fake_transcriber_emits_note_on_on_loud_pcm() -> None:
    transcriber = FakeTranscriber()
    transcriber.start("test-session")

    transcriber.feed(pcm_chunk(1000), sample_index=0)
    events = transcriber.poll()

    assert len(events) == 1
    assert events[0].type == "note_on"
    assert events[0].midi == 69
    assert events[0].source == "server"


def test_fake_transcriber_emits_note_off_after_three_silent_chunks() -> None:
    transcriber = FakeTranscriber()
    transcriber.start("test-session")

    transcriber.feed(pcm_chunk(1000), sample_index=0)
    assert [event.type for event in transcriber.poll()] == ["note_on"]
    transcriber.feed(pcm_chunk(0), sample_index=320)
    transcriber.feed(pcm_chunk(0), sample_index=640)
    assert transcriber.poll() == []
    transcriber.feed(pcm_chunk(0), sample_index=960)

    events = transcriber.poll()

    assert len(events) == 1
    assert events[0].type == "note_off"
    assert events[0].midi == 69


def test_fake_transcriber_no_double_note_on() -> None:
    transcriber = FakeTranscriber()
    transcriber.start("test-session")

    transcriber.feed(pcm_chunk(1000), sample_index=0)
    transcriber.feed(pcm_chunk(1000), sample_index=320)
    transcriber.feed(pcm_chunk(1000), sample_index=640)

    events = transcriber.poll()

    assert [event.type for event in events] == ["note_on"]


def test_fake_transcriber_session_id_in_events() -> None:
    transcriber = FakeTranscriber()
    transcriber.start("test-session")

    transcriber.feed(pcm_chunk(1000), sample_index=0)
    transcriber.feed(pcm_chunk(0), sample_index=320)
    transcriber.feed(pcm_chunk(0), sample_index=640)
    transcriber.feed(pcm_chunk(0), sample_index=960)

    events = transcriber.poll()
    assert events
    assert all(event.session_id == "test-session" for event in events)


def test_fake_transcriber_events_validate_against_schema() -> None:
    transcriber = FakeTranscriber()
    transcriber.start("test-session")

    transcriber.feed(pcm_chunk(1000), sample_index=0)
    transcriber.feed(pcm_chunk(0), sample_index=320)
    transcriber.feed(pcm_chunk(0), sample_index=640)
    transcriber.feed(pcm_chunk(0), sample_index=960)

    events = transcriber.poll()
    assert [event.type for event in events] == ["note_on", "note_off"]
    for event in events:
        VALIDATE(event.to_dict())


def test_note_broadcaster_fan_out() -> None:
    broadcaster = NoteBroadcaster()
    client_a = broadcaster.register("client-a")
    client_b = broadcaster.register("client-b")

    broadcaster.broadcast(note_on())


    assert json.loads(client_a.get_nowait()) == note_on().to_dict()
    assert json.loads(client_b.get_nowait()) == note_on().to_dict()


def test_note_broadcaster_slow_client_drop() -> None:
    broadcaster = NoteBroadcaster()
    slow_client = broadcaster.register("slow-client")
    fast_client = broadcaster.register("fast-client")

    for seq in range(32):
        slow_client.put_nowait(note_on(seq=seq).to_json())

    broadcaster.broadcast(note_on(seq=33))

    assert slow_client.qsize() == 32
    assert json.loads(fast_client.get_nowait()) == note_on(seq=33).to_dict()
