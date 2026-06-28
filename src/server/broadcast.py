"""
broadcast.py - Websocket note broadcaster.
Fans out note_events_v1 JSON to all connected browser clients.
Slow clients get a per-client queue; if the queue is full the message is dropped
(client is too slow - this must never block the inference/ingest path).
"""

from __future__ import annotations

import asyncio
import json
import threading

from contracts.note_events_v1 import NoteEventV1 as NoteEvent


QUEUE_MAXSIZE = 32


class NoteBroadcaster:
    def __init__(self) -> None:
        self._clients: dict[str, asyncio.Queue[str]] = {}
        self._lock: threading.Lock = threading.Lock()

    def register(self, client_id: str) -> asyncio.Queue[str]:
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
        with self._lock:
            self._clients[client_id] = queue
        return queue

    def unregister(self, client_id: str) -> None:
        with self._lock:
            _ = self._clients.pop(client_id, None)

    def broadcast(self, note_event: NoteEvent) -> None:
        self._fan_out(note_event.to_json())

    def broadcast_status(self, msg: dict[str, object]) -> None:
        payload = {"type": "status", **msg}
        self._fan_out(json.dumps(payload, separators=(",", ":"), sort_keys=True))

    def _fan_out(self, message: str) -> None:
        with self._lock:
            queues = list(self._clients.values())

        for queue in queues:
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                pass
