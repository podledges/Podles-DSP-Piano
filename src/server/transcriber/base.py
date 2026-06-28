"""
base.py - Abstract Transcriber interface.
All transcribers (Fake, BasicPitch, OnsetsFrames) implement this.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from contracts.note_events_v1 import NoteEventV1 as NoteEvent


class Transcriber(ABC):
    @abstractmethod
    def start(self, session_id: str) -> None:
        """Called when a new streaming session begins."""

    @abstractmethod
    def feed(self, pcm_bytes: bytes, sample_index: int) -> None:
        """Feed a chunk of int16 LE mono PCM bytes."""

    @abstractmethod
    def poll(self) -> list[NoteEvent]:
        """Return and clear any pending note events. Non-blocking."""

    @abstractmethod
    def stop(self) -> None:
        """Called when the session ends."""
