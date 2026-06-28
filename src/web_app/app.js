// app.js

// Global State
let pdfDoc = null;
let currentPageNum = 1;
let pdfCanvas = null;
let pdfContext = null;
let currentSongPages = []; // Multi-page structure: [{pageNumber: number, duration: number, notes: [...]}]
let currentSongNotes = []; // Flattened format with absolute time: [{time: seconds, midi: number, note: name, dur: seconds, hand: 'right'|'left', page: number, pageTime: number}]
let isPlaying = false;
let playStartTime = 0;
let playbackTimer = null;
let activeTimeouts = [];
let audioCtx = null;
let websocket = null;
let midiParserLoaded = false;
let volume = 0.5;

// Load MIDI library dynamically if needed
function loadMidiParser() {
    if (window.Midi || midiParserLoaded) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = "https://unpkg.com/@tonejs/midi";
        script.onload = () => {
            midiParserLoaded = true;
            addLog("Offline MIDI Parser library loaded.");
            resolve();
        };
        script.onerror = () => {
            addLog("Error loading MIDI parser library from CDN.", "error");
            reject(new Error("CDN load failed"));
        };
        document.head.appendChild(script);
    });
}

// System Logs helper
function addLog(message, type = "info") {
    const logsPanel = document.getElementById('logs-panel');
    const time = new Date().toLocaleTimeString();
    let prefix = "[INFO]";
    if (type === "error") prefix = "[ERROR]";
    if (type === "success") prefix = "[SUCCESS]";
    if (type === "ws") prefix = "[ESP32 WS]";
    
    logsPanel.innerHTML += `\n${prefix} ${time}: ${message}`;
    logsPanel.scrollTop = logsPanel.scrollHeight;
}

function updateJsonPanel() {
    const jsonPanel = document.getElementById('json-panel');
    jsonPanel.innerHTML = JSON.stringify({
        songTitle: fileNameText ? (fileNameText.textContent || "Unknown Song") : "Unknown Song",
        totalPages: pdfDoc ? pdfDoc.numPages : 1,
        pages: currentSongPages.map(page => ({
            pageNumber: page.pageNumber,
            duration: parseFloat((page.duration || 0).toFixed(2)),
            notes: page.notes.map(n => ({
                time: parseFloat(n.time.toFixed(3)),
                note: n.note,
                dur: parseFloat((n.dur || 0.5).toFixed(3)),
                hand: n.hand || 'right'
            }))
        }))
    }, null, 2);
}

// Initialise PDF.js
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// DOM Elements
const pdfDropzone = document.getElementById('pdf-dropzone');
const pdfFileInput = document.getElementById('pdf-file-input');
const fileInfoBar = document.getElementById('file-info-bar');
const fileNameText = document.getElementById('file-name-text');
const btnClearPdf = document.getElementById('btn-clear-pdf');
const geminiKeyInput = document.getElementById('gemini-key');
const btnToggleKeyVisibility = document.getElementById('toggle-key-visibility');
const btnParsePdf = document.getElementById('btn-parse-pdf');
const btnParseAllPdf = document.getElementById('btn-parse-all-pdf');
const btnPlayPause = document.getElementById('btn-play-pause');
const btnStop = document.getElementById('btn-stop');
const playIconState = document.getElementById('play-icon-state');
const volumeControl = document.getElementById('volume-control');
const espIpInput = document.getElementById('esp-ip');
const btnConnectEsp = document.getElementById('btn-connect-esp');
const connStatus = document.getElementById('conn-status');
const sheetEmpty = document.getElementById('sheet-empty');
const pdfRenderCanvas = document.getElementById('pdf-render-canvas');
const pdfPagination = document.getElementById('pdf-pagination');
const currentPageNumSpan = document.getElementById('current-page-num');
const totalPagesNumSpan = document.getElementById('total-pages-num');
const btnPrevPage = document.getElementById('btn-prev-page');
const btnNextPage = document.getElementById('btn-next-page');
const pdfLoadingOverlay = document.getElementById('pdf-loading-overlay');
const pdfLoadingOverlayText = document.getElementById('loading-overlay-text');
const waterfallCanvas = document.getElementById('waterfall-canvas');
const pianoKeysContainer = document.getElementById('piano-keys');

// Load stored API Key
if (localStorage.getItem('gemini_api_key')) {
    geminiKeyInput.value = localStorage.getItem('gemini_api_key');
}

// Save API Key on edit
geminiKeyInput.addEventListener('input', () => {
    localStorage.setItem('gemini_api_key', geminiKeyInput.value.trim());
});

btnToggleKeyVisibility.addEventListener('click', () => {
    const isPassword = geminiKeyInput.type === 'password';
    geminiKeyInput.type = isPassword ? 'text' : 'password';
    btnToggleKeyVisibility.innerHTML = `<i data-lucide="${isPassword ? 'eye-off' : 'eye'}"></i>`;
    lucide.createIcons();
});

// Setup Virtual Keyboard (MIDI 36 to 96, 5 Octaves + 1 Key)
const whiteNotesOffsets = [0, 2, 4, 5, 7, 9, 11]; // C, D, E, F, G, A, B
const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function getNoteName(midiNumber) {
    const noteName = noteNames[midiNumber % 12];
    const octave = Math.floor(midiNumber / 12) - 1;
    return `${noteName}${octave}`;
}

function isBlackKey(midiNumber) {
    const noteInOctave = midiNumber % 12;
    return [1, 3, 6, 8, 10].includes(noteInOctave);
}

function buildKeyboard() {
    pianoKeysContainer.innerHTML = '';
    for (let midi = 36; midi <= 96; midi++) {
        const key = document.createElement('div');
        key.classList.add('piano-key');
        key.setAttribute('data-midi', midi);
        key.setAttribute('data-note', getNoteName(midi));
        
        if (isBlackKey(midi)) {
            key.classList.add('black-key');
        } else {
            key.classList.add('white-key');
        }

        // Setup click listeners
        key.addEventListener('mousedown', () => triggerLocalNoteOn(midi));
        key.addEventListener('mouseup', () => triggerLocalNoteOff(midi));
        key.addEventListener('mouseleave', () => triggerLocalNoteOff(midi));

        pianoKeysContainer.appendChild(key);
    }
}

// Audio Engine (Web Audio API Synthesizer)
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function midiToFreq(midiNumber) {
    return 440 * Math.pow(2, (midiNumber - 69) / 12);
}

const activeOscillators = {};

function synthNoteOn(midiNumber) {
    initAudio();
    if (activeOscillators[midiNumber]) return; // Already sounding

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    // Smooth piano-like tone (triangle wave)
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(midiToFreq(midiNumber), audioCtx.currentTime);
    
    gainNode.gain.setValueAtTime(volume * 0.3, audioCtx.currentTime);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    activeOscillators[midiNumber] = { osc, gainNode };
}

function synthNoteOff(midiNumber) {
    if (!activeOscillators[midiNumber]) return;
    
    const { osc, gainNode } = activeOscillators[midiNumber];
    
    // Release envelope
    try {
        gainNode.gain.setValueAtTime(gainNode.gain.value, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.15);
        osc.stop(audioCtx.currentTime + 0.15);
    } catch(e) {}
    
    delete activeOscillators[midiNumber];
}

// Local UI Interactions
function triggerLocalNoteOn(midi) {
    synthNoteOn(midi);
    highlightKey(midi, 'press');
    sendMidiToESP32(0x90, midi, Math.round(volume * 127));
}

function triggerLocalNoteOff(midi) {
    synthNoteOff(midi);
    removeKeyHighlight(midi);
    sendMidiToESP32(0x80, midi, 0);
}

function highlightKey(midi, style = 'right') {
    const key = document.querySelector(`.piano-key[data-midi="${midi}"]`);
    if (key) {
        key.classList.remove('active-press', 'active-glow-right', 'active-glow-left');
        if (style === 'press') {
            key.classList.add('active-press');
        } else if (style === 'left') {
            key.classList.add('active-glow-left');
        } else {
            key.classList.add('active-glow-right');
        }
    }
}

function removeKeyHighlight(midi) {
    const key = document.querySelector(`.piano-key[data-midi="${midi}"]`);
    if (key) {
        key.classList.remove('active-press', 'active-glow-right', 'active-glow-left');
    }
}

// PDF Uploader / Drag & Drop
pdfDropzone.addEventListener('click', () => pdfFileInput.click());

pdfDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    pdfDropzone.style.borderColor = 'var(--accent-cyan)';
    pdfDropzone.style.background = 'rgba(0, 245, 212, 0.03)';
});

pdfDropzone.addEventListener('dragleave', () => {
    pdfDropzone.style.borderColor = 'rgba(255, 255, 255, 0.12)';
    pdfDropzone.style.background = 'rgba(255, 255, 255, 0.01)';
});

pdfDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    pdfDropzone.style.borderColor = 'rgba(255, 255, 255, 0.12)';
    pdfDropzone.style.background = 'rgba(255, 255, 255, 0.01)';
    if (e.dataTransfer.files.length > 0) {
        handlePdfSelection(e.dataTransfer.files[0]);
    }
});

pdfFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handlePdfSelection(e.target.files[0]);
    }
});

btnClearPdf.addEventListener('click', () => {
    pdfDoc = null;
    currentPageNum = 1;
    pdfFileInput.value = '';
    fileInfoBar.style.display = 'none';
    pdfDropzone.style.display = 'flex';
    sheetEmpty.style.display = 'flex';
    pdfRenderCanvas.style.display = 'none';
    pdfPagination.style.display = 'none';
    btnParsePdf.disabled = true;
    btnParseAllPdf.disabled = true;
    addLog("PDF file cleared.");
});

async function handlePdfSelection(file) {
    if (file.type !== 'application/pdf') {
        addLog("Invalid file type. Please upload a PDF.", "error");
        return;
    }

    fileNameText.textContent = file.name;
    pdfDropzone.style.display = 'none';
    fileInfoBar.style.display = 'flex';
    
    showOverlay("Reading PDF document...");
    
    try {
        const fileReader = new FileReader();
        fileReader.onload = async function() {
            const typedarray = new Uint8Array(this.result);
            try {
                pdfDoc = await pdfjsLib.getDocument({ data: typedarray }).promise;
                addLog(`Loaded PDF document: ${file.name} | Total pages: ${pdfDoc.numPages}`);
                totalPagesNumSpan.textContent = pdfDoc.numPages;
                currentPageNum = 1;
                currentPageNumSpan.textContent = currentPageNum;
                
                sheetEmpty.style.display = 'none';
                pdfRenderCanvas.style.display = 'block';
                pdfPagination.style.display = 'flex';
                btnParsePdf.disabled = false;
                btnParseAllPdf.disabled = false;
                
                await renderPdfPage(currentPageNum);
                hideOverlay();
            } catch (err) {
                hideOverlay();
                addLog(`Error parsing PDF: ${err.message}`, "error");
            }
        };
        fileReader.readAsArrayBuffer(file);
    } catch (err) {
        hideOverlay();
        addLog(`FileReader error: ${err.message}`, "error");
    }
}

async function renderPdfPage(pageNum) {
    if (!pdfDoc) return;
    
    showOverlay("Rendering page...");
    try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 });
        
        pdfRenderCanvas.height = viewport.height;
        pdfRenderCanvas.width = viewport.width;
        
        pdfContext = pdfRenderCanvas.getContext('2d');
        const renderContext = {
            canvasContext: pdfContext,
            viewport: viewport
        };
        
        await page.render(renderContext).promise;
        currentPageNumSpan.textContent = pageNum;
        hideOverlay();
        addLog(`Rendered page ${pageNum} on screen.`);
    } catch (err) {
        hideOverlay();
        addLog(`Error rendering page: ${err.message}`, "error");
    }
}

btnPrevPage.addEventListener('click', () => {
    if (currentPageNum <= 1) return;
    currentPageNum--;
    renderPdfPage(currentPageNum);
});

btnNextPage.addEventListener('click', () => {
    if (!pdfDoc || currentPageNum >= pdfDoc.numPages) return;
    currentPageNum++;
    renderPdfPage(currentPageNum);
});

function showOverlay(text) {
    pdfLoadingOverlayText.textContent = text;
    pdfLoadingOverlay.classList.add('active');
}

function hideOverlay() {
    pdfLoadingOverlay.classList.remove('active');
}

// Gemini API OMR Transcription helpers
async function callGeminiTranscriptionForCurrentPage(apiKey) {
    if (!pdfRenderCanvas) throw new Error("No canvas to transcribe");
    
    const base64Image = pdfRenderCanvas.toDataURL('image/jpeg', 0.85).split(',')[1];
    
    const requestBody = {
        contents: [
            {
                parts: [
                    {
                        inlineData: {
                            mimeType: "image/jpeg",
                            data: base64Image
                        }
                    },
                    {
                        text: "Transcribe all piano notes on this sheet music page into a chronological list of note events. Output a JSON object containing: 1. 'duration' (a number representing the total playing duration of this page in seconds, estimated from the tempo/measure layout), 2. a 'notes' array, where each item has: 'time' (seconds from start of page), 'note' (scientific pitch notation like C4, D#5, Bb3), and 'dur' (duration in seconds). Map notes in the treble clef to hand: 'right', and bass clef notes to hand: 'left'."
                    }
                ]
            }
        ],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    duration: { type: "NUMBER" },
                    notes: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                time: { type: "NUMBER" },
                                note: { type: "STRING" },
                                dur: { type: "NUMBER" },
                                hand: { type: "STRING", enum: ["right", "left"] }
                            },
                            required: ["time", "note", "dur"]
                        }
                    }
                },
                required: ["notes"]
            }
        }
    };
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || "API Error");
    }

    const data = await response.json();
    const jsonText = data.candidates[0].content.parts[0].text;
    return JSON.parse(jsonText);
}

function getMockPageData(pageNum) {
    const fileName = (fileNameText.textContent || "").toLowerCase();
    let notes = [];
    let duration = 8.0;
    
    if (fileName.includes("joy") || fileName.includes("beethoven") || fileName.includes("ode")) {
        duration = 8.0;
        if (pageNum === 1) {
            notes = [
                // Phrase 1 (Right Hand)
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
                // Left hand accompaniment (Chords)
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
                // Phrase 2 (Right Hand)
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
                { time: 6.0, note: "D4", dur: 0.6, hand: 'right' },
                { time: 6.5, note: "C4", dur: 0.2, hand: 'right' },
                { time: 6.8, note: "C4", dur: 0.8, hand: 'right' },
                // Left hand Phrase 2
                { time: 0.0, note: "C3", dur: 1.8, hand: 'left' },
                { time: 0.0, note: "E3", dur: 1.8, hand: 'left' },
                { time: 2.0, note: "G3", dur: 1.8, hand: 'left' },
                { time: 2.0, note: "D3", dur: 1.8, hand: 'left' },
                { time: 4.0, note: "C3", dur: 1.8, hand: 'left' },
                { time: 4.0, note: "E3", dur: 1.8, hand: 'left' },
                { time: 6.0, note: "G3", dur: 0.8, hand: 'left' },
                { time: 6.5, note: "C3", dur: 1.0, hand: 'left' }
            ];
        }
    } else if (fileName.includes("elise") || fileName.includes("fur") || fileName.includes("bagatelle")) {
        duration = 6.0;
        if (pageNum === 1) {
            notes = [
                // Theme (Right Hand)
                { time: 0.0, note: "E5", dur: 0.25, hand: 'right' },
                { time: 0.25, note: "D#5", dur: 0.25, hand: 'right' },
                { time: 0.5, note: "E5", dur: 0.25, hand: 'right' },
                { time: 0.75, note: "D#5", dur: 0.25, hand: 'right' },
                { time: 1.0, note: "E5", dur: 0.25, hand: 'right' },
                { time: 1.25, note: "B4", dur: 0.25, hand: 'right' },
                { time: 1.5, note: "D5", dur: 0.25, hand: 'right' },
                { time: 1.75, note: "C5", dur: 0.25, hand: 'right' },
                // Resolution part 1
                { time: 2.0, note: "A4", dur: 0.5, hand: 'right' },
                { time: 2.0, note: "A2", dur: 0.5, hand: 'left' },
                { time: 2.3, note: "E3", dur: 0.5, hand: 'left' },
                { time: 2.6, note: "A3", dur: 0.5, hand: 'left' },
                { time: 2.9, note: "C4", dur: 0.25, hand: 'right' },
                { time: 3.15, note: "E4", dur: 0.25, hand: 'right' },
                { time: 3.4, note: "A4", dur: 0.25, hand: 'right' },
                // Resolution part 2
                { time: 3.65, note: "B4", dur: 0.5, hand: 'right' },
                { time: 3.65, note: "E2", dur: 0.5, hand: 'left' },
                { time: 3.95, note: "E3", dur: 0.5, hand: 'left' },
                { time: 4.25, note: "G#3", dur: 0.5, hand: 'left' }
            ];
        } else {
            notes = [
                { time: 0.0, note: "E4", dur: 0.25, hand: 'right' },
                { time: 0.25, note: "G#4", dur: 0.25, hand: 'right' },
                { time: 0.5, note: "B4", dur: 0.25, hand: 'right' },
                { time: 0.75, note: "C5", dur: 0.5, hand: 'right' },
                { time: 0.75, note: "A2", dur: 0.5, hand: 'left' },
                { time: 1.05, note: "E3", dur: 0.5, hand: 'left' },
                { time: 1.35, note: "A3", dur: 0.5, hand: 'left' }
            ];
        }
    } else {
        duration = 4.0;
        notes = [
            { time: 0.0, note: "C4", dur: 0.3, hand: 'right' },
            { time: 0.3, note: "D4", dur: 0.3, hand: 'right' },
            { time: 0.6, note: "E4", dur: 0.3, hand: 'right' },
            { time: 0.9, note: "F4", dur: 0.3, hand: 'right' },
            { time: 1.2, note: "G4", dur: 0.3, hand: 'right' },
            { time: 1.5, note: "A4", dur: 0.3, hand: 'right' },
            { time: 1.8, note: "B4", dur: 0.3, hand: 'right' },
            { time: 2.1, note: "C5", dur: 0.6, hand: 'right' }
        ];
    }
    
    return { duration, notes };
}

function flattenPages() {
    currentSongNotes = [];
    let timeOffset = 0.0;
    
    const sortedPages = [...currentSongPages].filter(Boolean).sort((a, b) => a.pageNumber - b.pageNumber);
    
    sortedPages.forEach(page => {
        page.notes.forEach(item => {
            const parsedMidi = item.midi || parseNoteToMidi(item.note);
            if (parsedMidi !== null && parsedMidi >= 36 && parsedMidi <= 96) {
                currentSongNotes.push({
                    time: timeOffset + item.time,
                    pageTime: item.time,
                    page: page.pageNumber,
                    midi: parsedMidi,
                    note: item.note || getNoteName(parsedMidi),
                    dur: item.dur || 0.5,
                    hand: item.hand || 'right'
                });
            }
        });
        timeOffset += page.duration || 10.0;
    });
    
    currentSongNotes.sort((a, b) => a.time - b.time);
    
    updateJsonPanel();
    btnPlayPause.disabled = false;
    btnStop.disabled = false;
}

// Transcribe a single page (the current one)
btnParsePdf.addEventListener('click', async () => {
    const apiKey = geminiKeyInput.value.trim();
    const isMockMode = !apiKey || !apiKey.startsWith("AIzaSy") || apiKey.length < 10;

    if (!pdfRenderCanvas) return;

    showOverlay("Transcribing current page...");
    addLog(`Transcribing current Page ${currentPageNum}...`);

    try {
        let pageData;
        if (isMockMode) {
            addLog("No valid API Key detected. Running in Offline Mock/Demo Mode.");
            await new Promise(r => setTimeout(r, 1200));
            pageData = getMockPageData(currentPageNum);
        } else {
            pageData = await callGeminiTranscriptionForCurrentPage(apiKey);
        }

        let pageDuration = pageData.duration;
        if (!pageDuration || pageDuration <= 0) {
            pageDuration = Math.max(...pageData.notes.map(n => n.time + (n.dur || 0.5)), 0) + 2.0;
        }

        // Make sure currentSongPages has slots up to currentPageNum
        while (currentSongPages.length < currentPageNum) {
            currentSongPages.push({
                pageNumber: currentSongPages.length + 1,
                duration: 10.0,
                notes: []
            });
        }

        currentSongPages[currentPageNum - 1] = {
            pageNumber: currentPageNum,
            duration: pageDuration,
            notes: pageData.notes
        };

        flattenPages();
        addLog(`Page ${currentPageNum} transcribed successfully. Found ${pageData.notes.length} note events.`, "success");
    } catch (err) {
        addLog(`Transcription failed: ${err.message}`, "error");
        console.error(err);
    } finally {
        hideOverlay();
    }
});

// Transcribe all pages in sequence
btnParseAllPdf.addEventListener('click', async () => {
    if (!pdfDoc) {
        addLog("No PDF loaded.", "error");
        return;
    }

    const apiKey = geminiKeyInput.value.trim();
    const isMockMode = !apiKey || !apiKey.startsWith("AIzaSy") || apiKey.length < 10;
    const totalPages = pdfDoc.numPages;

    currentSongPages = []; // Reset current pages
    addLog(`Starting batch transcription for all ${totalPages} pages...`);

    try {
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            showOverlay(`Rendering Page ${pageNum} of ${totalPages}...`);
            currentPageNum = pageNum;
            currentPageNumSpan.textContent = pageNum;
            await renderPdfPage(pageNum);

            showOverlay(`Transcribing Page ${pageNum} of ${totalPages}...`);
            addLog(`Parsing Page ${pageNum}/${totalPages}...`);

            let pageData;
            if (isMockMode) {
                addLog(`(Mock Mode) transcribing page ${pageNum}...`);
                await new Promise(r => setTimeout(r, 1000));
                pageData = getMockPageData(pageNum);
            } else {
                pageData = await callGeminiTranscriptionForCurrentPage(apiKey);
            }

            let pageDuration = pageData.duration;
            if (!pageDuration || pageDuration <= 0) {
                pageDuration = Math.max(...pageData.notes.map(n => n.time + (n.dur || 0.5)), 0) + 2.0;
            }

            currentSongPages.push({
                pageNumber: pageNum,
                duration: pageDuration,
                notes: pageData.notes
            });

            addLog(`Page ${pageNum} transcribed. Found ${pageData.notes.length} notes.`, "success");
        }

        flattenPages();
        addLog(`Batch transcription complete! Unified ${currentSongNotes.length} notes across ${totalPages} pages.`, "success");

        // Return to Page 1
        currentPageNum = 1;
        currentPageNumSpan.textContent = 1;
        await renderPdfPage(1);

    } catch (err) {
        addLog(`Batch transcription failed: ${err.message}`, "error");
        console.error(err);
    } finally {
        hideOverlay();
    }
});

// Scientific Pitch Notation parser (e.g. C4 -> MIDI 60, D#5 -> MIDI 75)
function parseNoteToMidi(noteName) {
    if (!noteName) return null;
    const match = noteName.trim().match(/^([A-G])(#|b)?(-?\d+)$/i);
    if (!match) return null;
    
    const step = match[1].toUpperCase();
    const accidental = match[2] || '';
    const octave = parseInt(match[3]);
    
    const stepOffsets = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
    let midi = (octave + 1) * 12 + stepOffsets[step];
    
    if (accidental === '#') midi += 1;
    if (accidental === 'b' || accidental === 'flat') midi -= 1;
    
    return midi;
}

function processParsedNotes(notesList) {
    const processed = notesList.map(item => {
        return {
            time: item.time,
            midi: item.midi || parseNoteToMidi(item.note),
            note: item.note || getNoteName(item.midi),
            dur: item.dur || 0.5,
            hand: item.hand || 'right'
        };
    }).filter(note => note.midi !== null && note.midi >= 36 && note.midi <= 96);
    
    const maxTime = Math.max(...processed.map(n => n.time + n.dur), 0);
    
    currentSongPages = [{
        pageNumber: 1,
        duration: maxTime + 2.0,
        notes: processed
    }];
    
    flattenPages();
    addLog(`Song loaded: ${currentSongNotes.length} notes playable.`);
}

// Local MIDI File parser integration
document.getElementById('midi-file-input').addEventListener('change', async (e) => {
    if (e.target.files.length === 0) return;
    const file = e.target.files[0];
    
    showOverlay("Parsing MIDI file...");
    addLog(`Loading MIDI file: ${file.name}`);
    
    try {
        await loadMidiParser();
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const parsedMidi = new Midi(event.target.result);
                let extractedNotes = [];
                
                parsedMidi.tracks.forEach((track, trackIndex) => {
                    const hand = trackIndex === 0 ? 'right' : 'left';
                    track.notes.forEach(note => {
                        extractedNotes.push({
                            time: note.time,
                            midi: note.midi,
                            note: note.name,
                            dur: note.duration,
                            hand: hand
                        });
                    });
                });
                
                processParsedNotes(extractedNotes);
                addLog(`Parsed MIDI file successfully. Extracted ${currentSongNotes.length} notes.`, "success");
            } catch (err) {
                addLog(`MIDI parsing error: ${err.message}`, "error");
            } finally {
                hideOverlay();
            }
        };
        reader.readAsArrayBuffer(file);
    } catch (err) {
        hideOverlay();
        addLog(`MIDI parse setup failed: ${err.message}`, "error");
    }
});

// Load standard Demo Song (scales / chord progression)
document.getElementById('btn-load-demo').addEventListener('click', () => {
    const demo = [
        { time: 0.0, note: "C4", dur: 0.4, hand: 'right' },
        { time: 0.4, note: "E4", dur: 0.4, hand: 'right' },
        { time: 0.8, note: "G4", dur: 0.4, hand: 'right' },
        { time: 1.2, note: "C5", dur: 0.6, hand: 'right' },
        { time: 1.8, note: "G4", dur: 0.4, hand: 'right' },
        { time: 2.2, note: "E4", dur: 0.4, hand: 'right' },
        { time: 2.6, note: "C4", dur: 0.8, hand: 'right' },
        
        { time: 0.0, note: "C3", dur: 1.5, hand: 'left' },
        { time: 1.2, note: "G3", dur: 1.5, hand: 'left' },
        { time: 2.6, note: "C3", dur: 1.5, hand: 'left' }
    ];
    
    processParsedNotes(demo);
    addLog("Demo song chord progression loaded.", "success");
});

// Volume control
volumeControl.addEventListener('input', (e) => {
    volume = parseFloat(e.target.value) / 100;
});

// Playback Logic
btnPlayPause.addEventListener('click', () => {
    if (isPlaying) {
        pausePlayback();
    } else {
        startPlayback();
    }
});

btnStop.addEventListener('click', stopPlayback);

function startPlayback() {
    if (currentSongNotes.length === 0) return;
    initAudio();
    isPlaying = true;
    playStartTime = audioCtx.currentTime;
    
    playIconState.setAttribute('data-lucide', 'pause');
    lucide.createIcons();
    addLog("Started local playback + live ESP32 WS streaming.");
    
    // Reset to Page 1 on start of playback if sheet music is loaded
    if (pdfDoc && currentPageNum !== 1) {
        currentPageNum = 1;
        currentPageNumSpan.textContent = 1;
        renderPdfPage(1);
    }
    
    activeTimeouts = [];
    
    // 1. Schedule all notes
    currentSongNotes.forEach(note => {
        // Schedule sound triggers
        const triggerTimeMs = note.time * 1000;
        const offTimeMs = (note.time + note.dur) * 1000;
        
        const noteOnId = setTimeout(() => {
            synthNoteOn(note.midi);
            highlightKey(note.midi, note.hand);
            sendMidiToESP32(0x90, note.midi, 100);
        }, triggerTimeMs);
        
        const noteOffId = setTimeout(() => {
            synthNoteOff(note.midi);
            removeKeyHighlight(note.midi);
            sendMidiToESP32(0x80, note.midi, 0);
        }, offTimeMs);
        
        activeTimeouts.push(noteOnId, noteOffId);
    });
    
    // 2. Schedule page turns based on page durations
    let accumTime = 0.0;
    currentSongPages.forEach((page, idx) => {
        const pageStartMs = accumTime * 1000;
        const pageNum = page.pageNumber;
        
        // Only schedule page turn for subsequent pages
        if (pageNum > 1) {
            const pageTurnId = setTimeout(() => {
                if (currentPageNum !== pageNum) {
                    currentPageNum = pageNum;
                    currentPageNumSpan.textContent = pageNum;
                    renderPdfPage(pageNum);
                    addLog(`Auto-turned sheet music to Page ${pageNum}`);
                }
            }, pageStartMs);
            activeTimeouts.push(pageTurnId);
        }
        
        accumTime += page.duration || 10.0;
    });
}

function pausePlayback() {
    isPlaying = false;
    playIconState.setAttribute('data-lucide', 'play');
    lucide.createIcons();
    addLog("Playback paused.");
    
    activeTimeouts.forEach(clearTimeout);
    activeTimeouts = [];
    
    // Silence keys
    for (let midi = 36; midi <= 96; midi++) {
        synthNoteOff(midi);
        removeKeyHighlight(midi);
    }
}

function stopPlayback() {
    isPlaying = false;
    playIconState.setAttribute('data-lucide', 'play');
    lucide.createIcons();
    addLog("Playback stopped.");
    
    activeTimeouts.forEach(clearTimeout);
    activeTimeouts = [];
    
    for (let midi = 36; midi <= 96; midi++) {
        synthNoteOff(midi);
        removeKeyHighlight(midi);
        sendMidiToESP32(0x80, midi, 0); // note off broadcast
    }
}

// Waterfall Canvas Loop
const ctx = waterfallCanvas.getContext('2d');
function resizeWaterfall() {
    waterfallCanvas.width = waterfallCanvas.parentElement.clientWidth;
    waterfallCanvas.height = waterfallCanvas.parentElement.clientHeight;
}
window.addEventListener('resize', resizeWaterfall);
resizeWaterfall();

function drawWaterfall() {
    ctx.clearRect(0, 0, waterfallCanvas.width, waterfallCanvas.height);
    
    const keyCount = 96 - 36 + 1; // 61 keys
    const laneWidth = waterfallCanvas.width / keyCount;
    
    // Draw lane lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    for (let i = 1; i < keyCount; i++) {
        ctx.beginPath();
        ctx.moveTo(i * laneWidth, 0);
        ctx.lineTo(i * laneWidth, waterfallCanvas.height);
        ctx.stroke();
    }
    
    if (isPlaying && audioCtx) {
        const elapsed = audioCtx.currentTime - playStartTime;
        const scrollSpeed = 50; // pixels per second
        
        currentSongNotes.forEach(note => {
            const laneIndex = note.midi - 36;
            if (laneIndex >= 0 && laneIndex < keyCount) {
                const x = laneIndex * laneWidth + 1;
                const w = laneWidth - 2;
                
                // Falling physics
                const y = (note.time - elapsed) * scrollSpeed + (waterfallCanvas.height - 30);
                const h = note.dur * scrollSpeed;
                
                if (y < waterfallCanvas.height && y + h > 0) {
                    ctx.fillStyle = note.hand === 'left' ? 'rgba(157, 78, 221, 0.7)' : 'rgba(0, 245, 212, 0.7)';
                    ctx.shadowColor = note.hand === 'left' ? '#9d4edd' : '#00f5d4';
                    ctx.shadowBlur = 6;
                    
                    // Draw note block
                    ctx.fillRect(x, y, w, h);
                }
            }
        });
        
        ctx.shadowBlur = 0; // Reset shadow
    }
    
    requestAnimationFrame(drawWaterfall);
}
requestAnimationFrame(drawWaterfall);

// WebSocket for ESP32 Communication
btnConnectEsp.addEventListener('click', () => {
    const ip = espIpInput.value.trim();
    if (!ip) {
        addLog("Please enter a valid ESP32 IP address.", "error");
        return;
    }

    if (websocket && (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING)) {
        addLog("Closing existing WebSocket connection...");
        websocket.close();
        return;
    }

    addLog(`Connecting to WebSocket: ws://${ip}/ws ...`);
    btnConnectEsp.textContent = "Connecting...";
    btnConnectEsp.disabled = true;

    try {
        websocket = new WebSocket(`ws://${ip}/ws`);
        websocket.binaryType = "arraybuffer";

        websocket.onopen = () => {
            addLog("Connected to ESP32 WebSocket!", "success");
            connStatus.classList.add('connected');
            connStatus.querySelector('.status-text').textContent = "Connected";
            btnConnectEsp.textContent = "Disconnect";
            btnConnectEsp.disabled = false;
        };

        websocket.onclose = () => {
            addLog("Disconnected from ESP32 WebSocket.", "error");
            connStatus.classList.remove('connected');
            connStatus.querySelector('.status-text').textContent = "Disconnected";
            btnConnectEsp.textContent = "Connect";
            btnConnectEsp.disabled = false;
            websocket = null;
        };

        websocket.onerror = (err) => {
            addLog(`WebSocket error occurred. Verify IP and firmware server.`, "error");
            console.error(err);
        };

        websocket.onmessage = (event) => {
            // Check for binary data (from DSP note detection)
            if (event.data instanceof ArrayBuffer) {
                const view = new DataView(event.data);
                if (view.byteLength >= 3) {
                    const status = view.getUint8(0);
                    const note = view.getUint8(1);
                    const velocity = view.getUint8(2);

                    addLog(`Received ESP32 DSP note: Status=0x${status.toString(16)}, Note=${note}, Velocity=${velocity}`, "ws");

                    if (status === 0x90 && velocity > 0) {
                        highlightKey(note, 'press');
                        synthNoteOn(note);
                        
                        // Auto-release after 400ms to prevent stuck keys from edge pitch detections
                        if (window.dspTimeouts === undefined) window.dspTimeouts = {};
                        if (window.dspTimeouts[note]) clearTimeout(window.dspTimeouts[note]);
                        window.dspTimeouts[note] = setTimeout(() => {
                            removeKeyHighlight(note);
                            synthNoteOff(note);
                            delete window.dspTimeouts[note];
                        }, 400);
                    } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
                        if (window.dspTimeouts && window.dspTimeouts[note]) {
                            clearTimeout(window.dspTimeouts[note]);
                            delete window.dspTimeouts[note];
                        }
                        removeKeyHighlight(note);
                        synthNoteOff(note);
                    }
                }
            }
        };

    } catch (err) {
        addLog(`Connection failed: ${err.message}`, "error");
        btnConnectEsp.textContent = "Connect";
        btnConnectEsp.disabled = false;
    }
});

// Binary MIDI stream sender
function sendMidiToESP32(status, note, velocity) {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        const buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, status);
        view.setUint8(1, note);
        view.setUint8(2, velocity);
        websocket.send(buffer);
    }
}

// Inspector Tabs handler
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.inspector-panel').forEach(p => p.classList.remove('active'));
        
        btn.classList.add('active');
        const tabName = btn.getAttribute('data-tab');
        document.getElementById(`${tabName}-panel`).classList.add('active');
    });
});

// Initialize UI
buildKeyboard();
lucide.createIcons();
addLog("UI Elements generated successfully. Standby.");
