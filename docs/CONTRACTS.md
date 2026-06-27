# FROZEN - Podles DSP Piano v2 Shared Contracts

FROZEN: `audio_stream_v1` and `note_events_v1` are Wave 0 contracts. Do not modify field order, field meaning, validation rules, or fixture values without updating the C encoder, Python decoder, JSON schema, golden fixtures, and this document together.

## audio_stream_v1

`audio_stream_v1` is the binary websocket frame format shared by firmware/server code. All integer fields are little-endian. The standard header is exactly 26 bytes. Audio PCM payload is signed int16 little-endian mono.

| Offset | Size | Field | Type | Description |
|--------|------|-------|------|-------------|
| 0 | 2 | `magic` | `uint16` | `0xAD51` (ADio Stream 1) |
| 2 | 1 | `version` | `uint8` | `0x01` |
| 3 | 1 | `type` | `uint8` | `0x00=audio_chunk`, `0x01=hello`, `0x02=goodbye` |
| 4 | 4 | `seq` | `uint32` | Monotonic per session, wraps at `0xFFFFFFFF` |
| 8 | 8 | `sample_index` | `uint64` | Absolute sample count since session start; this is the time source of truth |
| 16 | 4 | `timestamp_ms` | `uint32` | Wall-clock milliseconds since session start |
| 20 | 2 | `sample_rate` | `uint16` | Example: `16000` |
| 22 | 1 | `channels` | `uint8` | Always `1` (mono) |
| 23 | 1 | `reserved` | `uint8` | Always `0x00` |
| 24 | 2 | `pcm_len` | `uint16` | Number of int16 samples in payload |
| 26 | `pcm_len * 2` | `pcm_data` | `int16[]` | Little-endian mono PCM payload |

Total audio frame size is `26 + pcm_len * 2` bytes.

### Frame Types

| Type | Name | Payload semantics |
|------|------|-------------------|
| `0x00` | `audio_chunk` | Standard header followed by `pcm_len * 2` bytes of int16 LE PCM. |
| `0x01` | `hello` | Standard header with `pcm_len=0`, followed by a 16-byte ASCII `session_id` padded with `0x00`. Total size is 42 bytes. |
| `0x02` | `goodbye` | Standard header with `pcm_len=0` and no extra payload. |

The C encoder is in `contracts/audio_stream_v1.c` with declarations in `contracts/include/audio_stream_v1.h`. The Python mirror is `contracts/audio_stream_v1.py`. The golden binary fixture is `contracts/fixtures/golden_audio_frame.bin`.

## note_events_v1

`note_events_v1` is the JSON websocket event schema for note state reported to the browser.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string enum | Always | One of `note_on`, `note_off`, `snapshot`, `status`. |
| `midi` | integer `21..108` | `note_on`, `note_off`, `snapshot` | Piano key MIDI number. |
| `onset_ms` | integer | `note_on` | Note onset time in milliseconds. |
| `offset_ms` | integer | `note_off` | Note offset time in milliseconds. |
| `velocity` | integer `0..127` | Optional | MIDI-style velocity. |
| `confidence` | number `0.0..1.0` | Optional | Server confidence score. |
| `source` | string enum | `note_on`, `note_off`, `snapshot` | `server` or `esp_hint`. |
| `session_id` | string | Always | Current stream session identifier. |
| `seq` | integer | `note_on`, `note_off`, `snapshot` | Monotonic event sequence within the session. |

The Python dataclass is `contracts/note_events_v1.py`. The draft-7 schema is `contracts/note_events_v1_schema.json`. The golden JSON fixture is `contracts/fixtures/golden_note_event.json`.

## Note Semantics

Each note packet is an active snapshot. The browser derives `note_on` and `note_off` transitions from snapshot changes. `esp_hint` events are never authoritative; server-derived state is authoritative.

## Session Semantics

A reconnect starts a new session. The server/firmware pair must use a new `session_id`, and `seq` resets to `0` for that session. `sample_index` also starts from the beginning of the new session and remains the audio time source of truth.

## Fixture Regeneration

Regenerate and verify the frozen fixtures with:

```powershell
python contracts/fixtures/generate_golden.py
```

Successful regeneration prints:

```text
ALL GOLDEN FIXTURES VERIFIED
```
