#!/usr/bin/env python3
"""
app.py — Podles DSP Piano v2 Laptop Server
Central brain: receives ESP32 audio stream, transcribes notes, serves browser/mobile.

Endpoints:
  GET  /            → serves index.html (debug page)
  GET  /health      → JSON health status
  WS   /stream      → receives audio_stream_v1 binary frames from ESP32-S3
  WS   /notes       → pushes note_events_v1 JSON to browser/mobile clients
  GET  /static/{f}  → serves server/static/ files

Usage:
  python server/app.py [--port 8000] [--transcriber fake|basic_pitch] [--nodejs-uri ws://localhost:8080]

Architecture:
  ESP32-S3 (STA) → /stream websocket → AudioIngest → Transcriber → NoteBroadcaster → /notes websocket
                                                                                       ↑
                                                Mobile App / Browser connects here ────┘

  Optional Node.js bridge forwards detected note_on events as 3-byte MIDI packets to ws://localhost:8080.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import importlib.util
import logging
import sys
import threading
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, cast


if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from contracts.audio_stream_v1 import TYPE_GOODBYE, TYPE_HELLO, decode
from contracts.note_events_v1 import NoteEventV1 as NoteEvent
from server.broadcast import NoteBroadcaster
from server.ingest import AudioIngest
from server.transcriber.base import Transcriber
from server.transcriber.fake import FakeTranscriber


LOGGER = logging.getLogger("podles.server")
VERSION = "v2.0.0"
POLL_INTERVAL_SECONDS = 0.020
STATIC_DIR = Path(__file__).resolve().parent / "static"
INDEX_HTML = STATIC_DIR / "index.html"


class NodeJsBridge:
    """Forwards detected MIDI notes to the Node.js score-tracking server as 3-byte binary packets."""

    def __init__(self, uri: str) -> None:
        self._uri = uri
        self._ws: Any | None = None
        self._lock = asyncio.Lock()
        self._enabled = bool(uri)

    async def connect(self) -> None:
        if not self._enabled:
            return
        try:
            import websockets

            self._ws = await websockets.connect(self._uri)
            LOGGER.info("NodeJsBridge connected to %s", self._uri)
        except Exception as exc:
            LOGGER.warning("NodeJsBridge: could not connect to %s: %s", self._uri, exc)
            self._ws = None

    async def send_note(self, midi: int, velocity: int) -> None:
        if not self._enabled or self._ws is None:
            return
        try:
            _ = self._lock
            await self._ws.send(bytes([0x90, midi & 0x7F, velocity & 0x7F]))
        except Exception as exc:
            LOGGER.warning("NodeJsBridge: send failed (%s), reconnecting", exc)
            self._ws = None
            await self.connect()

    async def close(self) -> None:
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None


class ServerRuntime:
    def __init__(self, transcriber: Transcriber, transcriber_name: str) -> None:
        self.transcriber: Transcriber = transcriber
        self.transcriber_name: str = transcriber_name
        self.broadcaster: NoteBroadcaster = NoteBroadcaster()
        self.nodejs_bridge: NodeJsBridge | None = None
        self.ingest: AudioIngest = AudioIngest(self.feed_pcm)
        self.port: int | None = None

        self._transcriber_lock: threading.Lock = threading.Lock()
        self._active_session_id: str | None = None
        self._stream_connections: int = 0
        self._reconnects: int = 0
        self._metrics_lock: threading.Lock = threading.Lock()

    def feed_pcm(self, pcm_bytes: bytes, sample_index: int) -> None:
        with self._transcriber_lock:
            if self._active_session_id is None:
                self._start_session_locked(_new_session_id())
            self.transcriber.feed(pcm_bytes, sample_index)

    def start_session(self, session_id: str | None) -> None:
        with self._transcriber_lock:
            self._start_session_locked(session_id or _new_session_id())

    def stop_session(self) -> None:
        with self._transcriber_lock:
            self.transcriber.stop()
            self._active_session_id = None

    def poll_events(self) -> list[NoteEvent]:
        with self._transcriber_lock:
            return list(self.transcriber.poll())

    def record_stream_connect(self) -> None:
        with self._metrics_lock:
            if self._stream_connections > 0:
                self._reconnects += 1
            self._stream_connections += 1

    def health(self) -> dict[str, object]:
        metrics = self.ingest.get_metrics()
        with self._metrics_lock:
            reconnects = self._reconnects
        return {
            "role": "laptop-server",
            "version": VERSION,
            "status": "ready",
            "transcriber": self.transcriber_name,
            "rx_frames": metrics.frames_recv,
            "gaps": metrics.gaps,
            "reconnects": reconnects,
        }

    def _start_session_locked(self, session_id: str) -> None:
        if self._active_session_id is not None:
            self.transcriber.stop()
        self.transcriber.start(session_id)
        self._active_session_id = session_id


def create_app(transcriber_name: str = "fake", nodejs_uri: str = "") -> FastAPI:
    runtime = ServerRuntime(*load_transcriber(transcriber_name))
    if nodejs_uri:
        runtime.nodejs_bridge = NodeJsBridge(nodejs_uri)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
        if runtime.nodejs_bridge:
            await runtime.nodejs_bridge.connect()
        poll_task = asyncio.create_task(_poll_notes(runtime), name="note-poll")
        LOGGER.info("Server ready on port %s", runtime.port if runtime.port is not None else "unknown")
        try:
            yield
        finally:
            _ = poll_task.cancel()
            try:
                await poll_task
            except asyncio.CancelledError:
                pass
            if runtime.nodejs_bridge:
                await runtime.nodejs_bridge.close()
            runtime.stop_session()

    app = FastAPI(title="Podles DSP Piano v2 Laptop Server", version=VERSION, lifespan=lifespan)
    app.state.runtime = runtime
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(INDEX_HTML)

    @app.get("/health")
    async def health() -> dict[str, object]:
        return cast(ServerRuntime, app.state.runtime).health()

    @app.websocket("/stream")
    async def stream_audio(websocket: WebSocket) -> None:
        await websocket.accept()
        state = cast(ServerRuntime, app.state.runtime)
        state.record_stream_connect()

        try:
            while True:
                raw_bytes = await websocket.receive_bytes()
                _handle_stream_control_frame(state, raw_bytes)
                state.ingest.feed(raw_bytes)
        except WebSocketDisconnect:
            state.stop_session()
        except Exception:
            LOGGER.exception("stream websocket failed")
            state.stop_session()
            raise

    @app.websocket("/notes")
    async def notes(websocket: WebSocket) -> None:
        await websocket.accept()
        state = cast(ServerRuntime, app.state.runtime)
        client_id = uuid.uuid4().hex
        queue = state.broadcaster.register(client_id)
        try:
            while True:
                await websocket.send_text(await queue.get())
        except WebSocketDisconnect:
            pass
        finally:
            state.broadcaster.unregister(client_id)

    return app


async def _poll_notes(runtime: ServerRuntime) -> None:
    while True:
        for event in runtime.poll_events():
            runtime.broadcaster.broadcast(event)
            if runtime.nodejs_bridge and hasattr(event, 'type') and event.type == 'note_on':
                midi = getattr(event, 'midi', None)
                velocity = getattr(event, 'velocity', None) or 80
                if midi is not None:
                    await runtime.nodejs_bridge.send_note(int(midi), int(velocity))
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


def _handle_stream_control_frame(runtime: ServerRuntime, raw_bytes: bytes) -> None:
    try:
        frame = decode(raw_bytes)
    except ValueError:
        return

    if frame.type == TYPE_HELLO:
        runtime.start_session(frame.session_id)
    elif frame.type == TYPE_GOODBYE:
        runtime.stop_session()


def load_transcriber(name: str) -> tuple[Transcriber, str]:
    if name == "fake":
        return FakeTranscriber(), "fake"
    if name != "basic_pitch":
        raise ValueError(f"unsupported transcriber: {name}")

    try:
        adapter_module = importlib.import_module("server.transcriber.basic_pitch")
        adapter_cls = getattr(adapter_module, "BasicPitchTranscriber")
        transcriber = adapter_cls()
    except (AttributeError, ImportError) as adapter_error:
        if importlib.util.find_spec("basic_pitch") is None:
            LOGGER.warning("basic_pitch unavailable; falling back to fake")
        else:
            LOGGER.warning(
                "basic_pitch is installed, but "
                + "server.transcriber.basic_pitch.BasicPitchTranscriber is unavailable; "
                + "falling back to fake: %s",
                adapter_error,
            )
        return FakeTranscriber(), "fake"

    return cast(Transcriber, transcriber), "basic_pitch"


def _new_session_id() -> str:
    return f"server-{uuid.uuid4().hex[:8]}"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Podles DSP Piano v2 laptop server")
    _ = parser.add_argument("--port", type=int, default=8000)
    _ = parser.add_argument("--transcriber", choices=("fake", "basic_pitch"), default="fake")
    _ = parser.add_argument(
        "--nodejs-uri",
        default="",
        help="WebSocket URI of the Node.js server (e.g. ws://localhost:8080). Empty = disabled.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
    args = parse_args(argv)
    port = int(args.port)
    transcriber_name = str(args.transcriber)
    server_app = create_app(transcriber_name, nodejs_uri=args.nodejs_uri)
    cast(ServerRuntime, server_app.state.runtime).port = port
    uvicorn.run(server_app, host="0.0.0.0", port=port)


app = create_app()


if __name__ == "__main__":
    main()
