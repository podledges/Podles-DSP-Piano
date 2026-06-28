from __future__ import annotations

import struct
from pathlib import Path

from contracts.audio_stream_v1 import (
    HEADER_SIZE,
    MAGIC,
    TYPE_HELLO,
    decode,
    encode_audio,
    encode_hello,
)


FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def assert_decode_rejected(frame: bytes) -> None:
    try:
        _ = decode(frame)
    except ValueError:
        return
    raise AssertionError("decode() accepted an invalid audio_stream_v1 frame")


def test_round_trip_audio_frame() -> None:
    pcm = struct.pack("<8h", -32768, -12000, -1, 0, 1, 12000, 24000, 32767)

    encoded = encode_audio(
        seq=42,
        sample_index=123456789,
        timestamp_ms=9876,
        sample_rate=16000,
        pcm_bytes=pcm,
    )
    decoded = decode(encoded)

    assert decoded.magic == MAGIC
    assert decoded.seq == 42
    assert decoded.sample_index == 123456789
    assert decoded.timestamp_ms == 9876
    assert decoded.sample_rate == 16000
    assert decoded.channels == 1
    assert decoded.pcm_len == len(pcm) // 2
    assert decoded.pcm == pcm


def test_round_trip_hello_frame() -> None:
    encoded = encode_hello(seq=7, session_id="session-001")

    decoded = decode(encoded)

    assert decoded.type == TYPE_HELLO
    assert decoded.seq == 7
    assert decoded.session_id == "session-001"
    assert decoded.pcm_len == 0
    assert decoded.pcm == b""


def test_golden_audio_fixture_parity() -> None:
    decoded = decode((FIXTURES / "golden_audio_frame.bin").read_bytes())

    assert decoded.seq == 1
    assert decoded.sample_index == 0
    assert decoded.sample_rate == 16000
    assert decoded.pcm_len == 320


def test_bad_magic_rejected() -> None:
    frame = bytearray(
        encode_audio(
            seq=1,
            sample_index=0,
            timestamp_ms=0,
            sample_rate=16000,
            pcm_bytes=b"\x00\x00",
        )
    )
    frame[0:2] = struct.pack("<H", 0xDEAD)

    assert_decode_rejected(bytes(frame))


def test_truncated_frame_rejected_gracefully() -> None:
    assert_decode_rejected(b"\x00" * 10)


def test_seq_wrap_preserved() -> None:
    encoded = encode_audio(
        seq=0xFFFFFFFF,
        sample_index=0,
        timestamp_ms=0,
        sample_rate=16000,
        pcm_bytes=b"\x00\x00",
    )

    decoded = decode(encoded)

    assert decoded.seq == 0xFFFFFFFF


def test_zero_pcm_len_silence_frame() -> None:
    encoded = encode_audio(
        seq=2,
        sample_index=320,
        timestamp_ms=20,
        sample_rate=16000,
        pcm_bytes=b"",
    )

    decoded = decode(encoded)

    assert len(encoded) == HEADER_SIZE
    assert decoded.pcm_len == 0
    assert decoded.pcm == b""


def test_max_pcm_len_40ms_at_16khz() -> None:
    pcm = struct.pack("<640h", *range(640))

    decoded = decode(
        encode_audio(
            seq=3,
            sample_index=640,
            timestamp_ms=40,
            sample_rate=16000,
            pcm_bytes=pcm,
        )
    )

    assert decoded.pcm_len == 640
    assert decoded.pcm == pcm
