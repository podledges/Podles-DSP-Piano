"""
ingest.py — Audio stream ingest and PCM reassembly for Podles DSP Piano v2.
Consumes audio_stream_v1 binary frames from the websocket endpoint.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable
import logging
import threading

from contracts.audio_stream_v1 import TYPE_AUDIO, TYPE_GOODBYE, TYPE_HELLO, decode


LOGGER = logging.getLogger(__name__)
UINT32_MASK = 0xFFFFFFFF


@dataclass
class IngestMetrics:
    frames_recv: int = 0
    gaps: int = 0
    dups: int = 0
    resyncs: int = 0
    drift_samples: int = 0


class AudioIngest:
    def __init__(self, on_pcm_ready: Callable[[bytes, int], None]):
        """
        on_pcm_ready(pcm_bytes: bytes, sample_index: int) called for each valid audio chunk.
        """
        self._on_pcm_ready: Callable[[bytes, int], None] = on_pcm_ready
        self._lock: threading.Lock = threading.Lock()
        self._metrics: IngestMetrics = IngestMetrics()
        self._session_id: str | None = None
        self._reset_stream_state()

    def feed(self, raw_bytes: bytes) -> None:
        """Feed a raw websocket binary message. Handles hello, audio, goodbye frames."""
        try:
            frame = decode(raw_bytes)
        except ValueError:
            LOGGER.debug("discarding invalid audio_stream_v1 frame", exc_info=True)
            return

        pcm_ready: tuple[bytes, int] | None = None
        with self._lock:
            self._metrics.frames_recv += 1

            if frame.type == TYPE_HELLO:
                self._reset_stream_state()
                self._session_id = frame.session_id
                self._metrics.resyncs += 1
                return

            if frame.type == TYPE_GOODBYE:
                LOGGER.info("audio stream goodbye received for session %s", self._session_id)
                self._reset_stream_state()
                return

            if frame.type != TYPE_AUDIO:
                return

            if self._last_seq is not None and frame.seq == self._last_seq:
                self._metrics.dups += 1
                return

            if self._is_seq_reset(frame.seq):
                self._reset_stream_state()
                self._metrics.resyncs += 1

            if self._expected_seq is not None and frame.seq != self._expected_seq:
                self._metrics.gaps += 1

            if (
                self._expected_sample_index is not None
                and frame.sample_index != self._expected_sample_index
            ):
                self._metrics.drift_samples += abs(
                    frame.sample_index - self._expected_sample_index
                )

            self._last_seq = frame.seq
            self._expected_seq = (frame.seq + 1) & UINT32_MASK
            self._expected_sample_index = frame.sample_index + (len(frame.pcm) // 2)
            pcm_ready = (frame.pcm, frame.sample_index)

        self._on_pcm_ready(*pcm_ready)

    def get_metrics(self) -> IngestMetrics:
        """Thread-safe metrics snapshot."""
        with self._lock:
            return IngestMetrics(
                frames_recv=self._metrics.frames_recv,
                gaps=self._metrics.gaps,
                dups=self._metrics.dups,
                resyncs=self._metrics.resyncs,
                drift_samples=self._metrics.drift_samples,
            )

    def reset(self) -> None:
        """Reset state for a new session."""
        with self._lock:
            self._metrics = IngestMetrics()
            self._session_id = None
            self._reset_stream_state()

    def _reset_stream_state(self) -> None:
        self._expected_seq: int | None = None
        self._last_seq: int | None = None
        self._expected_sample_index: int | None = None

    def _is_seq_reset(self, seq: int) -> bool:
        return self._expected_seq not in (None, 0) and seq == 0
