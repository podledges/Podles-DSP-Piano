const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Import scoring modules
const { FullScoreProgressTracker } = require('../final_bar_matching/full_score_progress_tracker');
const { normalizeDraftFullScore, parseNoteNameToMidi } = require('../final_bar_matching/score_normalizer');

const app = express();
app.use(cors());
app.use(express.json());

// Setup uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Keep clean filename
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}_${sanitized}`);
  }
});
const upload = multer({ storage });

// Server state
let activePdfPath = null;
let activePdfName = null;
let currentDraftScore = {
  scoreId: 'active-score',
  pages: []
};
let tracker = null;
let trackerStartTime = null;

// Track active WebSocket connections
const clients = new Set();

// Broadcast JSON to all WebSocket clients
function broadcastJson(data) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      client.send(msg);
    }
  }
}

// Broadcast binary to all WebSocket clients
function broadcastBinary(buffer) {
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      client.send(buffer);
    }
  }
}

// Map note name (e.g. C4, E#5) to MIDI
const noteToMidiMap = {
  'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6,
  'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
};
function getMidiFromScientificPitch(pitch) {
  const match = pitch.trim().match(/^([A-G][#b]?)(-?\d+)$/i);
  if (!match) return null;
  const noteName = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
  const octave = parseInt(match[2], 10);
  const step = noteToMidiMap[noteName];
  if (step === undefined) return null;
  return (octave + 1) * 12 + step;
}

// Helper to feed a note to progress tracker and check page turn
function processNoteInput(midiNote) {
  if (!tracker) {
    console.log(`[Tracker] No active tracker to feed note ${midiNote}`);
    return;
  }

  const timestamp = trackerStartTime ? (Date.now() - trackerStartTime) : 0;
  console.log(`[Tracker] Feeding note ${midiNote} at ${timestamp}ms`);
  
  try {
    const result = tracker.acceptObservedEvent({
      timestampMs: timestamp,
      midi: [midiNote]
    });

    console.log(`[Tracker] Next event index: ${tracker.nextEventIndex} / ${tracker.flatEvents.length}`);

    // Scan for PAGE_END_REACHED
    let events = [];
    if (result.type === 'TRACKER_EVENTS') {
      events = result.events;
    } else if (result) {
      events = [result];
    }

    for (const ev of events) {
      if (ev.type === 'PAGE_END_REACHED') {
        const nextPageIndex = ev.pageIndex + 1; // move to next page
        const nextPageNumber = nextPageIndex + 1;
        console.log(`[Tracker] Page turn detected! Moving to page index ${nextPageIndex}`);
        broadcastJson({
          type: 'PAGE_TURN',
          pageIndex: nextPageIndex,
          pageNumber: nextPageNumber
        });
      } else if (ev.type === 'SCORE_COMPLETED') {
        console.log('[Tracker] Score completed!');
        broadcastJson({
          type: 'SCORE_COMPLETED'
        });
      }
    }
  } catch (err) {
    console.error('[Tracker Error]', err.message);
  }
}

// REST Endpoints
app.post('/upload-pdf', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  activePdfPath = req.file.path;
  activePdfName = req.file.originalname;

  // Reset score structure
  currentDraftScore = {
    scoreId: activePdfName,
    pages: []
  };
  tracker = null;
  trackerStartTime = null;

  console.log(`[PDF] Uploaded successfully: ${activePdfName} at ${activePdfPath}`);

  res.json({
    message: 'PDF uploaded successfully',
    filename: req.file.filename,
    url: `/uploads/${req.file.filename}`,
    originalName: activePdfName
  });
});

app.post('/transcribe', async (req, res) => {
  const pageNumber = parseInt(req.body.pageNumber, 10) || 1;
  const apiKey = req.body.apiKey || process.env.GEMINI_API_KEY;

  console.log(`[Transcription] Request for page ${pageNumber}. API Key provided: ${!!apiKey}`);

  let duration = 8.0;
  let notes = [];

  // For the hackathon, we always fabricate/mock the OMR transcription
  console.log(`[OMR Fabricate] Fabricating mockup data for page ${pageNumber}.`);
  const mock = getMockTranscription(activePdfName || 'sheet.pdf', pageNumber);
  duration = mock.duration;
  notes = mock.notes;

  // Update server state with the transcribed page
  const pageIndex = pageNumber - 1;
  currentDraftScore.pages[pageIndex] = {
    pageIndex,
    pageNumber,
    duration,
    notes
  };

  // Re-normalize score and update progress tracker
  const normResult = normalizeDraftFullScore(currentDraftScore);
  if (normResult.ok) {
    tracker = new FullScoreProgressTracker(normResult.score);
    trackerStartTime = Date.now();
    console.log(`[Tracker] Initialized tracker for score: ${currentDraftScore.scoreId} with ${tracker.flatEvents.length} events.`);
  } else {
    console.warn(`[Tracker Warning] Score normalization failed: ${normResult.error}`);
  }

  res.json({
    scoreId: currentDraftScore.scoreId,
    pageNumber,
    duration,
    notes
  });
});

app.post('/sim-note', (req, res) => {
  const { note, velocity = 100 } = req.body;
  if (note === undefined) {
    return res.status(400).json({ error: 'Missing note parameter' });
  }

  let midiNote = null;
  if (typeof note === 'number') {
    midiNote = note;
  } else if (typeof note === 'string') {
    midiNote = getMidiFromScientificPitch(note) || parseNoteNameToMidi(note);
  }

  if (midiNote === null || midiNote < 0 || midiNote > 127) {
    return res.status(400).json({ error: `Invalid note format: ${note}` });
  }

  console.log(`[Sim Endpoint] Playing simulated note: ${note} (Midi: ${midiNote}), Velocity: ${velocity}`);

  // Broadcast note locally & repeat to other connected clients
  broadcastJson({
    type: 'NOTE_PLAYED',
    midi: midiNote,
    note: typeof note === 'string' ? note : null,
    hand: 'right',
    source: 'sim'
  });
  
  const binaryBuffer = Buffer.from([0x90, midiNote, velocity]);
  broadcastBinary(binaryBuffer);

  // Feed note to tracker
  processNoteInput(midiNote);

  res.json({ success: true, midi: midiNote });
});

// Mock/fabricated transcription generator
function getMockTranscription(fileName, pageNum) {
  const lowerName = fileName.toLowerCase();
  let duration = 8.0;
  let notes = [];

  if (lowerName.includes('ode') || lowerName.includes('joy') || lowerName.includes('beethoven')) {
    if (pageNum === 1) {
      notes = [
        { time: 0.0, note: "E4", dur: 0.4, hand: 'right' },
        { time: 0.5, note: "E4", dur: 0.4, hand: 'right' },
        { time: 1.0, note: "F4", dur: 0.4, hand: 'right' },
        { time: 1.5, note: "G4", dur: 0.4, hand: 'right' },
        { time: 2.0, note: "G4", dur: 0.4, hand: 'right' },
        { time: 2.5, note: "F4", dur: 0.4, hand: 'right' },
        { time: 3.0, note: "E4", dur: 0.4, hand: 'right' },
        { time: 3.5, note: "D4", dur: 0.4, hand: 'right' },
        { time: 4.0, note: "C4", dur: 0.4, hand: 'right' },
        { time: 4.5, note: "C4", dur: 0.4, hand: 'right' },
        { time: 5.0, note: "D4", dur: 0.4, hand: 'right' },
        { time: 5.5, note: "E4", dur: 0.4, hand: 'right' },
        { time: 6.0, note: "E4", dur: 0.6, hand: 'right' },
        { time: 6.5, note: "D4", dur: 0.2, hand: 'right' },
        { time: 6.8, note: "D4", dur: 0.8, hand: 'right' },
        // Chords/accompaniment
        { time: 0.0, note: "C3", dur: 1.8, hand: 'left' },
        { time: 0.0, note: "E3", dur: 1.8, hand: 'left' },
        { time: 2.0, note: "G3", dur: 1.8, hand: 'left' },
        { time: 2.0, note: "D3", dur: 1.8, hand: 'left' },
        { time: 4.0, note: "C3", dur: 1.8, hand: 'left' },
        { time: 4.0, note: "E3", dur: 1.8, hand: 'left' },
        { time: 6.0, note: "G3", dur: 1.5, hand: 'left' },
        { time: 6.0, note: "B2", dur: 1.5, hand: 'left' }
      ];
    } else {
      notes = [
        { time: 0.0, note: "D4", dur: 0.4, hand: 'right' },
        { time: 0.5, note: "D4", dur: 0.4, hand: 'right' },
        { time: 1.0, note: "E4", dur: 0.4, hand: 'right' },
        { time: 1.5, note: "C4", dur: 0.4, hand: 'right' },
        { time: 2.0, note: "D4", dur: 0.4, hand: 'right' },
        { time: 2.5, note: "E4", dur: 0.2, hand: 'right' },
        { time: 2.7, note: "F4", dur: 0.2, hand: 'right' },
        { time: 3.0, note: "E4", dur: 0.4, hand: 'right' },
        { time: 3.5, note: "C4", dur: 0.4, hand: 'right' },
        { time: 4.0, note: "D4", dur: 0.4, hand: 'right' },
        { time: 4.5, note: "E4", dur: 0.2, hand: 'right' },
        { time: 4.7, note: "F4", dur: 0.2, hand: 'right' },
        { time: 5.0, note: "E4", dur: 0.4, hand: 'right' },
        { time: 5.5, note: "D4", dur: 0.4, hand: 'right' },
        { time: 6.0, note: "C4", dur: 0.4, hand: 'right' },
        { time: 6.5, note: "D4", dur: 0.4, hand: 'right' },
        { time: 7.0, note: "G3", dur: 0.8, hand: 'right' }
      ];
    }
  } else {
    // Return standard dummy notes
    const basePitches = ["C4", "E4", "G4", "C5"];
    notes = Array.from({ length: 12 }, (_, i) => ({
      time: i * 0.6,
      note: basePitches[i % basePitches.length],
      dur: 0.4,
      hand: i % 2 === 0 ? 'right' : 'left'
    }));
  }

  return { duration, notes };
}

// Create HTTP server
const server = http.createServer(app);

// Setup WebSockets
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws) => {
  console.log('[WebSocket] Client connected');
  clients.add(ws);

  ws.on('message', (message, isBinary) => {
    // Repeater logic
    if (isBinary) {
      // Received MIDI binary data from client (ESP32 sim or actual)
      const view = new DataView(message.buffer || message);
      if (view.byteLength >= 3) {
        const statusByte = view.getUint8(0);
        const note = view.getUint8(1);
        const velocity = view.getUint8(2);

        console.log(`[WebSocket RX Binary] Status: 0x${statusByte.toString(16)}, Note: ${note}, Vel: ${velocity}`);

        if (statusByte === 0x90 && velocity > 0) {
          // Feed into progress tracker
          processNoteInput(note);
        }

        // Broadcast to all other connected clients
        broadcastBinary(message);
      }
    } else {
      // Received text (JSON)
      try {
        const text = message.toString();
        const data = JSON.parse(text);
        console.log('[WebSocket RX JSON]', data);
        
        if (data.type === 'SIM_NOTE') {
          let midiNote = data.midi;
          if (midiNote === undefined && data.note) {
            midiNote = getMidiFromScientificPitch(data.note) || parseNoteNameToMidi(data.note);
          }
          if (midiNote !== undefined && midiNote !== null) {
            processNoteInput(midiNote);
            // Broadcast so other apps highlight keys
            broadcastJson({
              type: 'NOTE_PLAYED',
              midi: midiNote,
              hand: 'right',
              note: data.note || null
            });
            // Also send binary representation
            const buf = Buffer.from([0x90, midiNote, 100]);
            broadcastBinary(buf);
          }
        }
      } catch (err) {
        console.error('[WebSocket text parse error]', err.message);
      }
    }
  });

  ws.on('close', () => {
    console.log('[WebSocket] Client disconnected');
    clients.delete(ws);
  });
});

// Run server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`================================================`);
  console.log(`Piano learning assistant Laptop Server active!`);
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`WebSocket Server ready at ws://localhost:${PORT}`);
  console.log(`================================================`);
});
