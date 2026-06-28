from __future__ import annotations

import struct
import threading

from contracts.audio_stream_v1 import HEADER_FMT, MAGIC, TYPE_GOODBYE, VERSION, encode_audio, encode_hello
from server.ingest import AudioIngest


def audio_frame(seq: int, sample_index: int, pcm: bytes = b"\x01\x00\x02\x00") -> bytes:
    return encode_audio(
        seq=seq,
        sample_index=sample_index,
        timestamp_ms=(seq * 10) & 0xFFFFFFFF,
        sample_rate=16000,
        pcm_bytes=pcm,
    )


def goodbye_frame(seq: int = 0) -> bytes:
    return struct.pack(HEADER_FMT, MAGIC, VERSION, TYPE_GOODBYE, seq, 0, 0, 0, 1, 0, 0)


def test_happy_path_emits_three_sequential_audio_chunks() -> None:
    ready: list[tuple[bytes, int]] = []
    ingest = AudioIngest(lambda pcm, sample_index: ready.append((pcm, sample_index)))

    ingest.feed(audio_frame(0, 0, b"\x01\x00"))
    ingest.feed(audio_frame(1, 1, b"\x02\x00"))
    ingest.feed(audio_frame(2, 2, b"\x03\x00"))

    assert ready == [(b"\x01\x00", 0), (b"\x02\x00", 1), (b"\x03\x00", 2)]
    assert ingest.get_metrics().frames_recv == 3


def test_hello_frame_resets_sequence_state_and_counts_resync() -> None:
    ready: list[tuple[bytes, int]] = []
    ingest = AudioIngest(lambda pcm, sample_index: ready.append((pcm, sample_index)))

    ingest.feed(audio_frame(5, 0))
    ingest.feed(encode_hello(6, "session-1"))
    ingest.feed(audio_frame(0, 0))

    metrics = ingest.get_metrics()
    assert metrics.resyncs == 1
    assert metrics.gaps == 0
    assert len(ready) == 2


def test_gap_detected_when_sequence_skips() -> None:
    ingest = AudioIngest(lambda _pcm, _sample_index: None)

    ingest.feed(audio_frame(0, 0))
    ingest.feed(audio_frame(2, 2))

    assert ingest.get_metrics().gaps == 1


def test_duplicate_sequence_is_skipped() -> None:
    ready: list[tuple[bytes, int]] = []
    ingest = AudioIngest(lambda pcm, sample_index: ready.append((pcm, sample_index)))

    ingest.feed(audio_frame(0, 0, b"\x01\x00"))
    ingest.feed(audio_frame(0, 0, b"\x02\x00"))

    metrics = ingest.get_metrics()
    assert metrics.dups == 1
    assert metrics.gaps == 0
    assert ready == [(b"\x01\x00", 0)]


def test_sequence_wrap_is_continuous() -> None:
    ingest = AudioIngest(lambda _pcm, _sample_index: None)

    ingest.feed(audio_frame(0xFFFFFFFF, 0))
    ingest.feed(audio_frame(0, 2))

    assert ingest.get_metrics().gaps == 0


def test_garbage_bytes_are_discarded_without_callback() -> None:
    ready: list[tuple[bytes, int]] = []
    ingest = AudioIngest(lambda pcm, sample_index: ready.append((pcm, sample_index)))

    ingest.feed(b"not an audio stream frame")

    assert ready == []
    assert ingest.get_metrics().frames_recv == 0


def test_truncated_frame_is_discarded_without_crashing() -> None:
    ready: list[tuple[bytes, int]] = []
    ingest = AudioIngest(lambda pcm, sample_index: ready.append((pcm, sample_index)))

    ingest.feed(audio_frame(0, 0)[:10])

    assert ready == []
    assert ingest.get_metrics().frames_recv == 0


def test_metrics_thread_safety_while_feeding() -> None:
    ready: list[tuple[bytes, int]] = []
    ingest = AudioIngest(lambda pcm, sample_index: ready.append((pcm, sample_index)))
    stop = threading.Event()

    def read_metrics() -> None:
        while not stop.is_set():
            _ = ingest.get_metrics()

    reader = threading.Thread(target=read_metrics)
    reader.start()
    try:
        for seq in range(100):
            ingest.feed(audio_frame(seq, seq * 2))
    finally:
        stop.set()
        reader.join(timeout=2)

    assert not reader.is_alive()
    assert ingest.get_metrics().frames_recv == 100
    assert len(ready) == 100


def test_goodbye_resets_sequence_state() -> None:
    ingest = AudioIngest(lambda _pcm, _sample_index: None)

    ingest.feed(audio_frame(5, 0))
    ingest.feed(goodbye_frame(6))
    ingest.feed(audio_frame(0, 0))

    metrics = ingest.get_metrics()
    assert metrics.gaps == 0
    assert metrics.frames_recv == 3


def test_sample_index_drift_is_tracked() -> None:
    ingest = AudioIngest(lambda _pcm, _sample_index: None)

    ingest.feed(audio_frame(0, 0, b"\x01\x00\x02\x00"))
    ingest.feed(audio_frame(1, 5, b"\x03\x00\x04\x00"))

    assert ingest.get_metrics().drift_samples == 3
