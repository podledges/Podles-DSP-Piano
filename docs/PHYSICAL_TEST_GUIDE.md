# Physical Test Guide — Podles DSP Piano v2

**One-run field test. Read this end-to-end before you leave.**

Team size: 2-3 people. Total on-site time: ~45 minutes. You need a piano with
a reasonably open soundboard (a grand or upright with the lid open works best),
venue Wi-Fi, and everything on the pack list below.

---

## 1. Pre-Test Checklist

Do everything in this section at home or in the lab the day before. Nothing
here should be done at the venue.

### 1.1 Find out the venue Wi-Fi credentials

You need the SSID and password before you flash. If you can't get them in
advance, you'll reflash on-site (add 10 minutes and bring the USB flashing
cable regardless).

### 1.2 Flash the firmware with venue credentials

From the repo root with ESP-IDF sourced:

```bash
cd ESP_piano
idf.py menuconfig
```

Navigate to **Podles DSP Piano Config** and set:

- `CONFIG_WIFI_SSID` — venue Wi-Fi SSID
- `CONFIG_WIFI_PASSWORD` — venue Wi-Fi password
- `CONFIG_SERVER_URI` — leave as default for now: `ws://192.168.1.100:8000/stream`
  (you'll update this on-site once you know the laptop's IP)

Save and exit menuconfig, then flash:

```bash
idf.py -p COM_PORT flash monitor
```

Replace `COM_PORT` with the actual port (e.g. `COM3` on Windows, `/dev/ttyUSB0`
on Linux). Watch the serial output. You should see Wi-Fi attempting to connect.
It won't reach the server yet — that's fine. You just want to confirm the
firmware flashes cleanly and boots without a panic.

### 1.3 Verify the server starts locally

On the laptop, from the repo root:

```bash
python server/app.py --port 8000
```

In a browser, open `http://localhost:8000`. The debug page should load and
show an 88-key keyboard. Check `http://localhost:8000/health` — you should
get a JSON response with `"status": "ready"`.

Ctrl-C the server when done.

### 1.4 Test the piezo circuit on a tabletop

Tape the piezo disc to a wooden surface (a table, a bookshelf, anything solid).
With the ESP plugged in and running `idf.py monitor`, tap the surface firmly a
few times. Watch the serial output for ADC frame logs. You're looking for lines
that show non-zero PCM amplitude, something like:

```
I ws_stream: frame seq=12 samples=320 rms=1840
```

If you only see near-zero RMS values (below ~200), the piezo isn't making
contact or the wire is broken. Fix it now, not at the venue.

### 1.5 Generate fixture files (if not already present)

```bash
python tools/generate_fixtures.py
```

This writes `fixtures/cmaj_chord.wav` and `fixtures/cmaj_chord.mid`. Confirm
they exist before packing up.

### 1.6 Charge everything

- Laptop (full charge)
- Phone (mobile app)
- Any portable battery packs

### 1.7 Pack list

| Item | Notes |
|---|---|
| ESP32-S3 devkit | with piezo already wired to GPIO1 |
| USB cable (data, not charge-only) | for flashing + serial monitor |
| Laptop | fully charged, repo checked out on `feat/v2-stream-server` |
| Phone | mobile app installed |
| Piezo disc + wires | soldered joints covered with hot glue or tape |
| Mounting putty or gaffer tape | for attaching piezo to soundboard |
| Notepad/phone | for writing down IPs, signal readings, observations |
| USB power bank (optional) | if no convenient outlet near the piano |

---

## 2. On-Site Setup

Budget 15 minutes for this. Don't rush — a bad setup makes all test results
meaningless.

### Step 1: Connect the laptop to venue Wi-Fi

Connect before doing anything else. Confirm internet access loads a page.

### Step 2: Find the laptop's IP address on that network

```bash
# Windows
ipconfig
```

Look for the IPv4 address under the Wi-Fi adapter, e.g. `192.168.1.47`. Write
it down. This is `LAPTOP_IP` for the rest of this guide.

If the IP looks like `169.254.x.x`, the laptop didn't get a DHCP address.
Connect properly before continuing.

### Step 3: Reflash CONFIG_SERVER_URI with the real laptop IP

Back in `ESP_piano/`:

```bash
idf.py menuconfig
```

Set `CONFIG_SERVER_URI` to `ws://LAPTOP_IP:8000/stream`, e.g.:

```
ws://192.168.1.47:8000/stream
```

Then flash:

```bash
idf.py -p COM_PORT flash monitor
```

Keep the serial monitor running in this terminal. You'll watch it throughout
the test.

**Save the serial output to a file.** Open a second terminal and run:

```bash
idf.py -p COM_PORT monitor 2>&1 | tee esp_monitor_log.txt
```

### Step 4: Start the server

In a separate terminal, from the repo root:

```bash
python server/app.py --port 8000 2>&1 | tee server_log.txt
```

### Step 5: Verify /health

```bash
curl http://LAPTOP_IP:8000/health
```

Expected response:

```json
{"role": "laptop-server", "version": "v2.0.0", "status": "ready", ...}
```

If curl fails, check Windows Firewall. You may need to allow port 8000 for
inbound connections on public networks:

```bash
netsh advfirewall firewall add rule name="Podles 8000" dir=in action=allow protocol=TCP localport=8000
```

### Step 6: Confirm ESP connects

Watch the serial monitor. Within 30 seconds of boot you should see:

```
I wifi_sta: connected to AP, IP: 192.168.1.xxx
I ws_stream: websocket connected to ws://192.168.1.47:8000/stream
I ws_stream: hello frame sent, session_id=...
```

And on the server terminal:

```
INFO:podles.server: stream websocket accepted
```

The `rx_frames` counter in `/health` should start climbing. If it stays at 0,
the ESP isn't sending. See Section 6 (Failure Recovery).

---

## 3. Piezo Placement

Placement is the single biggest variable in audio quality. Spend 5 minutes
getting this right.

### Where to place

- **Best: near the bass bridge on the soundboard** — the large wooden plate
  inside the piano body, not the keys. On an upright, open the top lid; on a
  grand, the soundboard is visible under the strings.
- **Second best: on the curved rim of the soundboard** near the treble strings.
- **Avoid: the key bed, the music stand, or anywhere that only picks up
  mechanical key noise** rather than string vibration.

### How to attach

Use a small ball of mounting putty (Blu-Tack) or a strip of gaffer tape. The
disc must lie flat against the wood with full contact. Press firmly for a few
seconds. Don't use double-sided foam tape — it deadens the signal.

### How to verify signal quality

With the server running and the ESP streaming, watch the serial monitor while
a bandmate plays a single loud note (middle C or A4). You're looking for RMS
values that spike clearly above the idle noise floor, typically:

- Idle (no playing): RMS below 300
- Single note played firmly: RMS above 2000
- Good placement: RMS above 5000 on a strong keystroke

If a loud note only moves the RMS to 400-600, try a different spot on the
soundboard or press the piezo harder against the wood. If RMS is saturating
(near 32767), the piezo is too close to a resonant node — move it a few cm.

**Take a photo of the final placement before starting the test sequence.**

---

## 4. Test Script

Execute in order. Do not skip tests. Record the outcome of each.

### T1 — Wi-Fi and server connectivity

**What to do:** Check the serial monitor and `/health`.

**What to watch:**
- ESP serial shows `ws_stream: websocket connected`
- `/health` shows `rx_frames` increasing
- No WebSocket error messages on the server

**Record:** `rx_frames` count after 30 seconds of streaming.

**Pass:** ESP connects and `rx_frames > 0`.

---

### T2 — Audio capture

**What to do:** Play a single note loudly (A4, the A above middle C) and hold
it for 3 seconds.

**What to watch:**
- Serial monitor RMS values spike above 2000 on each keystroke
- Server `rx_frames` counter increases at ~50 frames/second (16kHz / 320
  samples per frame)

**Record:** Peak RMS seen in serial monitor. Note the piezo placement used.

**Pass:** Consistent RMS spikes above 2000 on keystroke.

---

### T3 — Single note detection

**What to do:** Play each note cleanly, one at a time, holding each for 2
seconds. Wait 1 second between notes:

- C4 (middle C)
- A4 (440 Hz)
- G4

Open `http://LAPTOP_IP:8000` in a browser on the laptop. Watch the keyboard
display light up.

**What to watch:** Correct key highlights on the debug page for each note
played.

**Record:** Which notes were detected correctly. Note the actual frequencies
shown if the piano is out of tune.

**Pass:** All 3 notes detected within 1 second of keystroke.

---

### T4 — Chord detection

**What to do:** Play a C major chord (C4 + E4 + G4) cleanly and hold for 3
seconds.

**What to watch:** All three keys light up on the debug page simultaneously
(or within a short window of each other).

**Record:** How many of the 3 chord notes were detected.

**Pass:** At least 2 of 3 chord notes detected.

---

### T5 — Latency measurement

**What to do:** In a new terminal, run the latency harness while someone plays
along with the replayed audio (or just let it run autonomously):

```bash
python tools/latency_harness.py \
  --server ws://LAPTOP_IP:8000/stream \
  --notes ws://LAPTOP_IP:8000/notes \
  --wav fixtures/cmaj_chord.wav \
  --midi fixtures/cmaj_chord.mid \
  --runs 5
```

This replays the C major chord WAV 5 times and measures the time from when
each onset frame is sent to when the server emits the corresponding `note_on`
event.

**What to watch:** Terminal output showing p50 and p95 latency in ms. Results
are saved automatically to `fixtures/latency_results.json`.

**Record:** p50 and p95 values printed at the end.

**Pass:** p50 below 300ms is acceptable for a first physical test.

---

### T6 — Reconnect test

**What to do:** Unplug the USB power from the ESP. Wait 5 seconds. Plug it
back in.

**What to watch:**
- Server logs a disconnect, then a new stream connection within 30 seconds
- `/health` `reconnects` counter increments to 1
- Browser debug page resumes showing notes after reconnect

**Record:** Time from plugging back in to first `note_on` event appearing in
the browser.

**Pass:** ESP reconnects and stream resumes without restarting the server.

---

### T7 — Mobile app

**What to do:** On the phone, open the mobile app. Confirm it's configured to
connect to `ws://LAPTOP_IP:8000/notes` (not the old SoftAP address). Play a
few notes.

**What to watch:** Notes appear on the phone screen as they're played.

**Record:** Whether notes appear on phone. Note any delay vs the browser.

**Pass:** Notes appear on the phone within 2 seconds of being played.

---

### T8 — Score matching

**What to do:** Load the Fur Elise opening bars score in the app or browser.
Play the opening phrase (E5, D#5, E5, D#5, E5, B4, D5, C5, A4). Play slowly
and deliberately.

**What to watch:** Bar matcher progress indicator advances as you play through
the phrase.

**Record:** How many bars the tracker followed correctly before losing sync.

**Pass:** Tracker follows at least 4 bars correctly.

---

### T9 — ADC capture dump

Run this while playing freely for about 60 seconds to get a raw piezo
recording. The stream synthetic tool can replay any WAV through the server,
but for a real piano capture you need the live stream logged separately.

**On the laptop**, while the ESP is streaming live, capture the raw PCM by
streaming a tone and recording what the server receives. For a real piano dump,
use the server log — the ingest module logs frame metrics. For a proper WAV
capture, pipe the ADC output at the hardware level:

If you have an audio loopback or line-in connected, record directly with:

```bash
# Record 60 seconds of system audio to WAV (requires SoX or similar)
sox -t waveaudio default -r 16000 -c 1 -b 16 fixtures/piezo_recording_venue.wav trim 0 60
```

If SoX isn't available, use Audacity on the laptop to record from the line-in
while playing. Save as `fixtures/piezo_recording_venue.wav` at 16kHz mono
16-bit PCM.

After recording, run the golden eval against it:

```bash
python tools/check_golden.py \
  --wav fixtures/piezo_recording_venue.wav \
  --midi fixtures/cmaj_chord.mid \
  --server ws://LAPTOP_IP:8000/stream \
  --notes ws://LAPTOP_IP:8000/notes
```

**Record:** precision, recall, F1 printed to stdout.

---

## 5. Data Collection Commands

Run these during or immediately after the test sequence. All output paths are
relative to the repo root.

### Server log

The server was already started with `tee`:

```bash
python server/app.py --port 8000 2>&1 | tee server_log.txt
```

`server_log.txt` is written continuously. Don't close this terminal until
teardown.

### ESP serial monitor log

```bash
idf.py -p COM_PORT monitor 2>&1 | tee esp_monitor_log.txt
```

### Latency results

```bash
python tools/latency_harness.py \
  --server ws://LAPTOP_IP:8000/stream \
  --notes ws://LAPTOP_IP:8000/notes \
  --wav fixtures/cmaj_chord.wav \
  --midi fixtures/cmaj_chord.mid \
  --runs 10
```

Output: `fixtures/latency_results.json` (written automatically).

### Synthetic tone streaming test (optional sanity check)

Stream a 440Hz tone for 5 seconds and watch for a note_on event on A4:

```bash
python tools/stream_synthetic.py \
  --server ws://LAPTOP_IP:8000/stream \
  --tone 440.0 \
  --duration 5 \
  --realtime
```

### Golden eval against a captured WAV

```bash
python tools/check_golden.py \
  --wav fixtures/piezo_recording_venue.wav \
  --midi fixtures/cmaj_chord.mid \
  --server ws://LAPTOP_IP:8000/stream \
  --notes ws://LAPTOP_IP:8000/notes
```

### Wi-Fi signal strength

```bash
# Windows
netsh wlan show interfaces
```

Look for `Signal` percentage and `Receive rate (Mbps)`. Run this from the
piano location. Record both values.

---

## 6. Failure Recovery

### ESP doesn't connect to venue Wi-Fi

**Symptom:** Serial monitor shows repeated `wifi_sta: connect failed` or stays
at `connecting...` for more than 30 seconds.

**Most likely cause:** The venue Wi-Fi blocks new device associations (captive
portal, MAC filtering, or AP isolation).

**Fix:**
1. Switch to a personal hotspot on your phone. Note the SSID and password.
2. Reflash with hotspot credentials:
   ```bash
   idf.py menuconfig   # update SSID + PASSWORD
   idf.py -p COM_PORT flash monitor
   ```
3. Connect the laptop to the same hotspot.
4. Re-run Step 2 (find new laptop IP) and Step 3 (reflash SERVER_URI).

This adds 10-15 minutes. It's worth it. Personal hotspot is more reliable than
venue Wi-Fi for device-to-device traffic anyway.

### ESP connects to Wi-Fi but can't reach the server

**Symptom:** Serial shows `wifi_sta: connected, IP: ...` but then
`ws_stream: websocket connect failed` or repeated reconnect attempts.

**Check list:**
- Is the laptop on the same network as the ESP?
- Does `curl http://LAPTOP_IP:8000/health` work from the laptop itself?
- Is Windows Firewall blocking inbound on port 8000?
  ```bash
  netsh advfirewall firewall add rule name="Podles 8000" dir=in action=allow protocol=TCP localport=8000
  ```
- Is the laptop IP the one you flashed into SERVER_URI? Confirm with `ipconfig`.

### No audio detected (RMS stays near zero)

**Symptom:** ESP is streaming, `rx_frames` is climbing, but playing notes
produces no change in RMS and no note events on the debug page.

**Check list in order:**
1. Reseat the piezo — press it firmly against the soundboard, confirm flat
   contact.
2. Try a different soundboard location — move 10-15cm toward the bridge.
3. Tap the piezo disc itself with a fingernail while watching the serial
   monitor. If RMS spikes on tapping, the disc works but placement is wrong.
   If tapping produces nothing, the wire is broken or the connection to GPIO1
   is bad.
4. Wiggle the wire at both ends (piezo joint and ESP header) — a broken solder
   joint often shows up as intermittent RMS spikes.

### Notes detected but wrong pitches

**Symptom:** The debug page lights up keys, but they're consistently wrong —
e.g. playing A4 shows G#4 or A#4.

**Most likely cause:** The piano is significantly out of tune.

**What to do:**
- Note the actual frequencies reported by the server in the debug page.
- Record the offset (e.g. "piano is ~30 cents flat — A4 reads as 433Hz").
- Don't try to compensate in the field. The transcriber uses standard MIDI
  note quantization — a heavily detuned piano will confuse it. Note it in
  your records and continue testing.
- If notes are completely wrong (off by a semitone or more consistently),
  check that the fake transcriber is running, not a stale config.

### note_on events appear but with very high latency (>500ms)

**Symptom:** Notes appear correctly but slowly. Latency harness shows p50
above 500ms.

**Check:** Is the fake transcriber running, or basic_pitch? Basic pitch adds
significant processing time. Confirm with `/health` — `transcriber` field
shows which one is active.

If basic_pitch is running and you want faster results, restart the server:

```bash
python server/app.py --port 8000 --transcriber fake 2>&1 | tee server_log.txt
```

---

## 7. Post-Test: Bringing Data Back

### Files to collect from the laptop

Copy these to a safe location before leaving the venue or closing the laptop:

| File | Where it is | What it contains |
|---|---|---|
| `fixtures/latency_results.json` | repo root | p50/p95 latency per note, all runs |
| `fixtures/piezo_recording_venue.wav` | repo root | raw piezo capture from the real piano |
| `server_log.txt` | repo root | full server stdout, all frame metrics |
| `esp_monitor_log.txt` | repo root | full ESP serial output, Wi-Fi/WS events |

Also record manually (phone notes or notepad):
- Wi-Fi signal strength (`Signal` % from `netsh wlan show interfaces`)
- Piezo placement description and the photos you took
- Piano make/model and rough tuning state
- Any deviation from expected test outcomes

### Where to put them in the repo

```
fixtures/
  latency_results.json          (overwrites if already exists)
  piezo_recording_venue.wav     (new)
fixtures/logs/
  server_log_YYYYMMDD.txt       (rename with date)
  esp_monitor_log_YYYYMMDD.txt  (rename with date)
```

### Run the golden eval back at home

With the server running locally:

```bash
python server/app.py --port 8000 2>&1 &

python tools/check_golden.py \
  --wav fixtures/piezo_recording_venue.wav \
  --midi fixtures/cmaj_chord.mid \
  --server ws://localhost:8000/stream \
  --notes ws://localhost:8000/notes
```

The tool prints precision, recall, and F1. Pass threshold is F1 >= 0.50. If
you're below that, look at the "missed" and "spurious" notes it prints — those
tell you whether the problem is sensitivity (missed notes) or false positives
(spurious notes).

### Run the conformance suite to confirm nothing regressed

```bash
pytest contracts/tests/ server/tests/ -v
```

All tests should pass. If anything fails after collecting real data, check
whether a fixture file got corrupted during the session.

---

## Quick Reference

| What | Command |
|---|---|
| Flash firmware | `idf.py -p COM_PORT flash monitor` |
| Start server | `python server/app.py --port 8000 2\>&1 \| tee server_log.txt` |
| Check health | `curl http://LAPTOP_IP:8000/health` |
| Latency test | `python tools/latency_harness.py --server ws://LAPTOP_IP:8000/stream --notes ws://LAPTOP_IP:8000/notes --wav fixtures/cmaj_chord.wav --midi fixtures/cmaj_chord.mid --runs 5` |
| Stream tone | `python tools/stream_synthetic.py --server ws://LAPTOP_IP:8000/stream --tone 440.0 --duration 5 --realtime` |
| Golden eval | `python tools/check_golden.py --wav fixtures/piezo_recording_venue.wav --midi fixtures/cmaj_chord.mid --server ws://localhost:8000/stream --notes ws://localhost:8000/notes` |
| Wi-Fi signal | `netsh wlan show interfaces` |
| Find laptop IP | `ipconfig` |
