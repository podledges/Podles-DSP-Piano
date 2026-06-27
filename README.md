# 🎹 Piano Learning Assistant: Two-Device Architecture

This project is a **Piano Learning Assistant** implementing a two-device offline client-server architecture:
1. **Mobile Client (React Native Expo):** A mobile app that displays sheet music PDFs, transcribes pages, visualizes live piano keypresses on a virtual keyboard, and turns pages automatically.
2. **Laptop Server (Node.js + Express + WebSockets):** A local server that hosts sheet music PDFs, simulates Gemini AI OMR transcription, runs the music alignment tracker, and repeats MIDI/event telemetry in real time.

---

## 🏗️ Architecture Overview

```
 ┌──────────────────────────────────────┐
 │             Mobile Client            │
 │         (React Native Expo)          │
 └──────────────────┬───────────────────┘
                    │
         HTTP API   │   WebSocket
       (Port 8080)  │  (MIDI/Events)
                    ▼
 ┌──────────────────────────────────────┐
 │             Laptop Server            │
 │           (Node.js + Express)        │
 └──────────────────┬───────────────────┘
                    │
          Require   │
                    ▼
 ┌──────────────────────────────────────┐
 │         final_bar_matching/          │
 │       (Core Scoring & Tracker)       │
 └──────────────────────────────────────┘
```

### 1. The Mobile Client (`/mobile`)
- **Laptop Server Mode:** Configured to point to the Laptop Server (default: `localhost:8080`).
- **PDF Uploading:** Selected sheets are uploaded to the server's `/upload-pdf` endpoint, and loaded in a WebView pointing to the server-hosted URL.
- **Page Transcription:** Sends a request to `/transcribe` to get a JSON array of note events for the active page.
- **WebSocket Synchronization:** Connects to `ws://<server-ip>:8080/ws`. It listens for real-time keypress triggers (`NOTE_PLAYED`) and automated page turns (`PAGE_TURN`).
- **Offline Simulator Mode:** A fallback toggle that runs everything locally (hardcoded timers) without connecting to the server.

### 2. The Laptop Server (`/server`)
- **Static File Hosting:** Exposes uploaded PDFs under `server/uploads/` via HTTP static file serving.
- **Mock/Fabricated OMR:** Since OMR (Optical Music Recognition) is resource-heavy, the server runs a **fabricated fallback OMR transcription** to make the app fully functional offline. It returns the correct notes for *Ode to Joy* or mock C-major scales for arbitrary PDFs.
- **Stateful Score Progress Tracker:** Integrates the modules in `/final_bar_matching` (`FullScoreProgressTracker` and `normalizeDraftFullScore`). When notes are played, they are evaluated by the tracker to check if the performer has finished playing the current page.
- **WebSocket Repeater:**
  - If a client presses a key, it sends a binary MIDI packet (`[0x90, note, velocity]`) to the server. The server repeats it to all other clients.
  - If a client triggers `/sim-note`, the server broadcasts JSON (`NOTE_PLAYED`) and binary packets.
  - If the tracker detects the end of a page, the server broadcasts a JSON control event (`PAGE_TURN`).

---

## 📡 Protocol & API Contract (For LLMs & Developers)

If you are passing this to another LLM, here is the exact interface specification.

### 1. REST Endpoints

#### Upload PDF
- **Endpoint:** `POST /upload-pdf`
- **Body:** `multipart/form-data` containing key `file` (the PDF).
- **Response:**
  ```json
  {
    "message": "PDF uploaded successfully",
    "filename": "1719468000_ode_sheet.pdf",
    "url": "/uploads/1719468000_ode_sheet.pdf",
    "originalName": "ode_sheet.pdf"
  }
  ```

#### Transcribe Page
- **Endpoint:** `POST /transcribe`
- **Body:**
  ```json
  {
    "pageNumber": 1,
    "pdfName": "ode_sheet.pdf"
  }
  ```
- **Response:**
  ```json
  {
    "scoreId": "ode_sheet.pdf",
    "pageNumber": 1,
    "duration": 8.0,
    "notes": [
      { "time": 0.0, "note": "E4", "dur": 0.4, "hand": "right" },
      { "time": 0.5, "note": "E4", "dur": 0.4, "hand": "right" }
    ]
  }
  ```

#### Simulate Note Input
- **Endpoint:** `POST /sim-note`
- **Body:**
  ```json
  {
    "note": 64, // MIDI pitch value (e.g. 64 for E4) or scientific string "E4"
    "velocity": 100
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "midi": 64
  }
  ```

### 2. WebSocket Telemetry Events (`ws://<ip>:8080/ws`)

#### JSON Message: Note Played (Server ➔ Client)
Used to highlight keys on the mobile virtual keyboard.
```json
{
  "type": "NOTE_PLAYED",
  "midi": 64,
  "hand": "right",
  "note": "E4"
}
```

#### JSON Message: Page Turn (Server ➔ Client)
Automatically turns the active page on the mobile reader when the tracker detects page completion.
```json
{
  "type": "PAGE_TURN",
  "pageIndex": 1, // 0-indexed index of the next page
  "pageNumber": 2 // 1-indexed number of the next page
}
```

#### Binary Message: Raw MIDI Packet (Bidirectional)
Standard ESP32 hardware client emulator bytes.
- Size: 3 bytes
  - Byte 0: `0x90` (Note On) or `0x80` (Note Off)
  - Byte 1: MIDI Pitch value (0-127)
  - Byte 2: Velocity (0-127)

---

## 🚀 Quickstart Guide

### 1. Launch the Laptop Server
```bash
# Navigate to the server folder
cd server

# Install dependencies (Express, CORS, WS, Multer)
npm install

# Run the server
npm start
```
*The server will run on `http://localhost:8080` / `ws://localhost:8080`.*

### 2. Launch the Mobile Client
```bash
# Navigate to the mobile folder
cd mobile

# Start the Expo Go development server
npx expo start
```
- Open Expo Go on your mobile device and scan the QR code to load the app.
- Toggle **LAPTOP SERVER LINK** mode in the app.
- Change the **Laptop Server Address** to your laptop's local IP and port (e.g., `192.168.1.100:8080`). You can find your laptop's IP by running `ipconfig` (Windows) or `ifconfig` (macOS/Linux).
- Press **Connect**.

---

## ⚡ How to Demo

1. **Load/Upload Sheet Music:** Load a sheet music PDF named `ode_to_joy_sheet_music.pdf` (either via **Upload PDF** or **Load Mock**).
2. **Initialize Tracker:** Click **Transcribe Page** to request the page notes structure. This compiles the page notes and registers them with the Server Progress Tracker.
3. **Simulate Playback:**
   - Tap notes on the virtual piano in the mobile app, OR
   - Send simulated note triggers to the server using `curl` or Postman:
     ```bash
     curl -X POST http://localhost:8080/sim-note -H "Content-Type: application/json" -d "{\"note\":\"E4\"}"
     ```
   - Watch the logs in the telemetry console. When you play the final notes of the page, the server will broadcast the `PAGE_TURN` event, and the mobile app's viewer will instantly flip to Page 2!
