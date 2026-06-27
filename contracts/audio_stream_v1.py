"""
audio_stream_v1.py - Python decoder/encoder for the audio_stream_v1 binary frame.
FROZEN - mirrors audio_stream_v1.h exactly.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import cast

MAGIC = 0xAD51
VERSION = 0x01
TYPE_AUDIO = 0x00
TYPE_HELLO = 0x01
TYPE_GOODBYE = 0x02
HEADER_FMT = "<HBBIQIHBBH"
HEADER_SIZE = struct.calcsize(HEADER_FMT)
SESSION_SIZE = 16

if HEADER_SIZE != 26:
    raise RuntimeError(f"audio_stream_v1 header size changed: {HEADER_SIZE} != 26")


@dataclass(frozen=True)
class ASV1Frame:
    magic: int
    version: int
    type: int
    seq: int
    sample_index: int
    timestamp_ms: int
    sample_rate: int
    channels: int
    reserved: int
    pcm_len: int
    pcm: bytes
    session_id: str | None = None


def _pack_header(
    frame_type: int,
    seq: int,
    sample_index: int,
    timestamp_ms: int,
    sample_rate: int,
    channels: int,
    reserved: int,
    pcm_len: int,
) -> bytes:
    return struct.pack(
        HEADER_FMT,
        MAGIC,
        VERSION,
        frame_type,
        seq,
        sample_index,
        timestamp_ms,
        sample_rate,
        channels,
        reserved,
        pcm_len,
    )


def decode(data: bytes) -> ASV1Frame:
    if len(data) < HEADER_SIZE:
        raise ValueError(f"audio_stream_v1 frame too short: {len(data)} < {HEADER_SIZE}")

    header = cast(
        tuple[int, int, int, int, int, int, int, int, int, int],
        struct.unpack_from(HEADER_FMT, data, 0),
    )
    (
        magic,
        version,
        frame_type,
        seq,
        sample_index,
        timestamp_ms,
        sample_rate,
        channels,
        reserved,
        pcm_len,
    ) = header

    if magic != MAGIC:
        raise ValueError(f"invalid audio_stream_v1 magic: 0x{magic:04X}")
    if version != VERSION:
        raise ValueError(f"unsupported audio_stream_v1 version: {version}")
    if frame_type not in (TYPE_AUDIO, TYPE_HELLO, TYPE_GOODBYE):
        raise ValueError(f"unsupported audio_stream_v1 frame type: {frame_type}")
    if channels != 1:
        raise ValueError(f"unsupported audio_stream_v1 channel count: {channels}")
    if reserved != 0:
        raise ValueError(f"audio_stream_v1 reserved byte must be 0: {reserved}")

    payload_start = HEADER_SIZE
    payload_end = payload_start + (pcm_len * 2)
    if len(data) < payload_end:
        raise ValueError(
            f"audio_stream_v1 PCM payload truncated: {len(data)} < {payload_end}"
        )

    pcm = data[payload_start:payload_end]
    session_id = None

    if frame_type == TYPE_HELLO:
        if pcm_len != 0:
            raise ValueError("audio_stream_v1 hello frames must have pcm_len=0")
        session_end = payload_end + SESSION_SIZE
        if len(data) != session_end:
            raise ValueError(
                f"audio_stream_v1 hello frame must be {session_end} bytes, got {len(data)}"
            )
        session_raw = data[payload_end:session_end]
        session_id = session_raw.split(b"\x00", 1)[0].decode("ascii")
    elif len(data) != payload_end:
        raise ValueError(f"audio_stream_v1 frame has trailing bytes: {len(data) - payload_end}")

    return ASV1Frame(
        magic=magic,
        version=version,
        type=frame_type,
        seq=seq,
        sample_index=sample_index,
        timestamp_ms=timestamp_ms,
        sample_rate=sample_rate,
        channels=channels,
        reserved=reserved,
        pcm_len=pcm_len,
        pcm=pcm,
        session_id=session_id,
    )


def encode_audio(
    seq: int,
    sample_index: int,
    timestamp_ms: int,
    sample_rate: int,
    pcm_bytes: bytes,
) -> bytes:
    if len(pcm_bytes) % 2 != 0:
        raise ValueError("audio_stream_v1 PCM payload must contain complete int16 samples")
    pcm_len = len(pcm_bytes) // 2
    if pcm_len > 0xFFFF:
        raise ValueError("audio_stream_v1 PCM payload exceeds uint16 sample count")
    return _pack_header(TYPE_AUDIO, seq, sample_index, timestamp_ms, sample_rate, 1, 0, pcm_len) + pcm_bytes


def encode_hello(seq: int, session_id: str) -> bytes:
    session_bytes = session_id.encode("ascii")
    if len(session_bytes) > SESSION_SIZE - 1:
        raise ValueError("audio_stream_v1 session_id must be ASCII and at most 15 chars")
    header = _pack_header(TYPE_HELLO, seq, 0, 0, 0, 1, 0, 0)
    return header + session_bytes.ljust(SESSION_SIZE, b"\x00")
