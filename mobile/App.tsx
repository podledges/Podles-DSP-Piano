import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import { WebView } from 'react-native-webview';

// Interface for telemetry logs
interface LogEntry {
  id: string;
  time: string;
  type: 'SYS' | 'WS_RX' | 'WS_TX' | 'ERR';
  msg: string;
}

// Key Constants
const WHITE_KEY_WIDTH = 46;
const BLACK_KEY_WIDTH = 28;
const KEYBOARD_HEIGHT = 160;

export default function App() {
  const [ip, setIp] = useState<string>('localhost:8080');
  const [status, setStatus] = useState<'DISCONNECTED' | 'CONNECTING' | 'CONNECTED'>('DISCONNECTED');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeKeys, setActiveKeys] = useState<{ [midi: number]: 'left' | 'right' | 'local' }>({});
  const [isDemoMode, setIsDemoMode] = useState<boolean>(true);
  const [isDemoPlaying, setIsDemoPlaying] = useState<boolean>(false);

  // PDF & Mock OMR states
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState<number>(1);
  const [pdfCurrentPage, setPdfCurrentPage] = useState<number>(1);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [transcribedData, setTranscribedData] = useState<any>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const logScrollRef = useRef<ScrollView | null>(null);
  const keyTimeouts = useRef<{ [midi: number]: any }>({});
  const demoIntervalRef = useRef<any>(null);
  const demoSequenceIndex = useRef<number>(0);

  // Ode to Joy melody (transposed to C4 - E5 range for virtual piano visualization)
  const DEMO_MELODY = [
    64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62,
    64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60,
    62, 62, 64, 60, 62, 64, 65, 64, 60, 62, 64, 65, 64, 62, 60, 62, 67,
    64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60
  ];

  // Helper to add system logs
  const addLog = (msg: string, type: LogEntry['type'] = 'SYS') => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
      '.' + String(new Date().getMilliseconds()).padStart(3, '0');
    
    setLogs((prev) => {
      const newLogs = [...prev, { id: Math.random().toString(), time, type, msg }];
      return newLogs.slice(-20); // Keep last 20 logs
    });
  };

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logScrollRef.current) {
      setTimeout(() => {
        logScrollRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
  }, [logs]);

  // Clean up timeouts/intervals on unmount
  useEffect(() => {
    return () => {
      Object.values(keyTimeouts.current).forEach(clearTimeout);
      if (demoIntervalRef.current) {
        clearInterval(demoIntervalRef.current);
      }
    };
  }, []);

  const handleModeChange = (demo: boolean) => {
    if (demo === isDemoMode) return;
    
    stopDemoSong();
    setIsDemoMode(demo);
    
    if (demo) {
      stopDemoSong();
      setIsDemoMode(demo);
      disconnectEsp();
      setStatus('DISCONNECTED');
      addLog('Switched to Mock Demo Mode (Offline Simulator)', 'SYS');
    } else {
      stopDemoSong();
      setIsDemoMode(demo);
      setStatus('DISCONNECTED');
      addLog('Switched to Laptop Server Mode (Connecting to server)', 'SYS');
    }
  };

  const handlePickPdf = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        
        if (isDemoMode) {
          setPdfUri(file.uri);
          setPdfName(file.name);
          setPdfCurrentPage(1);
          setPdfPageCount(3);
          setTranscribedData(null);
          addLog(`Selected PDF loaded locally (Demo Mode): ${file.name}`, 'SYS');
        } else {
          addLog(`Selected PDF: ${file.name}. Uploading to laptop server...`, 'SYS');
          
          // Create FormData
          const formData = new FormData();
          formData.append('file', {
            uri: Platform.OS === 'ios' ? file.uri.replace('file://', '') : file.uri,
            name: file.name,
            type: 'application/pdf'
          } as any);

          const response = await fetch(`http://${ip}/upload-pdf`, {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            throw new Error(`Upload failed: ${response.statusText}`);
          }

          const data = await response.json();
          addLog(`PDF Uploaded successfully!`, 'SYS');

          const serverPdfUri = `http://${ip}${data.url}`;
          setPdfUri(serverPdfUri);
          setPdfName(file.name);
          setPdfCurrentPage(1);
          setPdfPageCount(3);
          setTranscribedData(null);
        }
      }
    } catch (err: any) {
      addLog(`Error picking/uploading PDF: ${err.message}`, 'ERR');
      console.error(err);
    }
  };

  const handleLoadMockSheet = () => {
    setPdfUri('MOCK_URI');
    setPdfName('ode_to_joy_sheet_music.pdf');
    setPdfCurrentPage(1);
    setPdfPageCount(2);
    setTranscribedData(null);
    addLog('Loaded Mock PDF: ode_to_joy_sheet_music.pdf', 'SYS');
  };

  const handleTranscribePage = async () => {
    if (!pdfUri) {
      addLog('Please upload or load a PDF sheet first.', 'ERR');
      return;
    }

    setIsTranscribing(true);

    if (isDemoMode) {
      addLog(`System: Sending page ${pdfCurrentPage} image to Gemini AI (Offline Simulation)...`, 'SYS');
      setTimeout(() => {
        setIsTranscribing(false);
        
        let notes: any[] = [];
        if (pdfName && pdfName.includes('ode')) {
          if (pdfCurrentPage === 1) {
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
              { time: 6.8, note: "D4", dur: 0.8, hand: 'right' }
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
          const pitches = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"];
          notes = Array.from({ length: 10 }, (_, idx) => ({
            time: idx * 0.8,
            note: pitches[Math.floor(Math.random() * pitches.length)],
            dur: 0.5,
            hand: Math.random() > 0.5 ? 'right' : 'left'
          }));
        }

        const responseObj = {
          scoreId: pdfName || "transcribed-sheet",
          pageNumber: pdfCurrentPage,
          duration: 8.0,
          notes: notes
        };

        setTranscribedData(responseObj);
        addLog(`[Gemini AI] Transcribed Page ${pdfCurrentPage} successfully!`, 'SYS');
        addLog(`OMR Output:\n${JSON.stringify(responseObj, null, 2)}`, 'WS_RX');
      }, 1500);
    } else {
      addLog(`System: Requesting page ${pdfCurrentPage} transcription from laptop server...`, 'SYS');
      try {
        const response = await fetch(`http://${ip}/transcribe`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pageNumber: pdfCurrentPage,
            pdfName: pdfName
          }),
        });

        if (!response.ok) {
          throw new Error(`Server transcription failed: ${response.statusText}`);
        }

        const responseObj = await response.json();
        setTranscribedData(responseObj);
        addLog(`[Laptop Server OMR] Transcribed Page ${pdfCurrentPage} successfully!`, 'SYS');
        addLog(`OMR Output:\n${JSON.stringify(responseObj, null, 2)}`, 'WS_RX');
      } catch (err: any) {
        addLog(`Server Transcription Error: ${err.message}`, 'ERR');
        console.error(err);
      } finally {
        setIsTranscribing(false);
      }
    }
  };

  const startDemoSong = () => {
    if (isDemoPlaying) return;
    setIsDemoPlaying(true);
    addLog('Simulating audio: Starting Ode to Joy...', 'SYS');
    demoSequenceIndex.current = 0;

    if (demoIntervalRef.current) {
      clearInterval(demoIntervalRef.current);
    }

    let lastNote = -1;
    demoIntervalRef.current = setInterval(() => {
      if (lastNote !== -1) {
        const noteToRelease = lastNote;
        setActiveKeys((prev) => {
          const updated = { ...prev };
          delete updated[noteToRelease];
          return updated;
        });
      }

      if (demoSequenceIndex.current >= DEMO_MELODY.length) {
        demoSequenceIndex.current = 0;
      }

      const currentNote = DEMO_MELODY[demoSequenceIndex.current];
      demoSequenceIndex.current++;

      // Press note in right hand (represented in gold highlight)
      setActiveKeys((prev) => ({ ...prev, [currentNote]: 'right' }));
      addLog(`RX Note (MOCK): Status=0x90, Note=${currentNote}, Velocity=100`, 'WS_RX');
      lastNote = currentNote;

      if (keyTimeouts.current[currentNote]) {
        clearTimeout(keyTimeouts.current[currentNote]);
      }
      keyTimeouts.current[currentNote] = setTimeout(() => {
        setActiveKeys((prev) => {
          const updated = { ...prev };
          delete updated[currentNote];
          return updated;
        });
      }, 450);
    }, 600); // 100 BPM
  };

  const stopDemoSong = () => {
    if (demoIntervalRef.current) {
      clearInterval(demoIntervalRef.current);
      demoIntervalRef.current = null;
    }
    setIsDemoPlaying(false);
    setActiveKeys({});
    addLog('Simulating audio: Stopped song.', 'SYS');
  };

  // Connect to ESP32 WebSocket
  const connectEsp = () => {
    if (isDemoMode) {
      addLog('Cannot connect to server in Demo Mode. Switch to Laptop Server Mode first.', 'ERR');
      return;
    }

    if (wsRef.current) {
      addLog('Closing existing WebSocket connection...');
      wsRef.current.close();
      return;
    }

    if (!ip.trim()) {
      addLog('Please enter a valid server address (IP:PORT).', 'ERR');
      return;
    }

    addLog(`Connecting to ws://${ip}/ws ...`, 'SYS');
    setStatus('CONNECTING');

    try {
      const ws = new WebSocket(`ws://${ip}/ws`);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        setStatus('CONNECTED');
        addLog('Successfully connected to Laptop Server!', 'SYS');
      };

      ws.onclose = () => {
        setStatus('DISCONNECTED');
        addLog('Connection to server closed.', 'SYS');
        wsRef.current = null;
      };

      ws.onerror = (e) => {
        setStatus('DISCONNECTED');
        addLog('WebSocket error occurred. Verify server address and connection.', 'ERR');
        console.error(e);
        wsRef.current = null;
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'NOTE_PLAYED') {
              const note = data.midi;
              const hand = data.hand || 'right';
              addLog(`RX Note (JSON): Midi=${note}, Hand=${hand}`, 'WS_RX');
              
              setActiveKeys((prev) => ({ ...prev, [note]: hand }));
              if (keyTimeouts.current[note]) {
                clearTimeout(keyTimeouts.current[note]);
              }
              keyTimeouts.current[note] = setTimeout(() => {
                setActiveKeys((prev) => {
                  const updated = { ...prev };
                  delete updated[note];
                  return updated;
                });
              }, 400);
            } else if (data.type === 'PAGE_TURN') {
              const pageNum = data.pageNumber;
              addLog(`RX Event: PAGE_TURN to page ${pageNum}`, 'WS_RX');
              setPdfCurrentPage(pageNum);
            } else if (data.type === 'SCORE_COMPLETED') {
              addLog(`RX Event: SCORE_COMPLETED!`, 'WS_RX');
            }
          } catch (err: any) {
            addLog(`WS Message Parse Error: ${err.message}`, 'ERR');
          }
        } else if (event.data instanceof ArrayBuffer) {
          const view = new DataView(event.data);
          if (view.byteLength >= 3) {
            const statusByte = view.getUint8(0);
            const note = view.getUint8(1);
            const velocity = view.getUint8(2);

            addLog(`RX Note: Status=0x${statusByte.toString(16).toUpperCase()}, Note=${note}, Velocity=${velocity}`, 'WS_RX');

            if (statusByte === 0x90 && velocity > 0) {
              setActiveKeys((prev) => ({ ...prev, [note]: 'right' }));

              if (keyTimeouts.current[note]) {
                clearTimeout(keyTimeouts.current[note]);
              }
              keyTimeouts.current[note] = setTimeout(() => {
                setActiveKeys((prev) => {
                  const updated = { ...prev };
                  delete updated[note];
                  return updated;
                });
              }, 400);
            } else if (statusByte === 0x80 || (statusByte === 0x90 && velocity === 0)) {
              if (keyTimeouts.current[note]) {
                clearTimeout(keyTimeouts.current[note]);
              }
              setActiveKeys((prev) => {
                const updated = { ...prev };
                delete updated[note];
                return updated;
              });
            }
          }
        }
      };

      wsRef.current = ws;
    } catch (err: any) {
      setStatus('DISCONNECTED');
      addLog(`Connection failed: ${err.message}`, 'ERR');
    }
  };

  const disconnectEsp = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
  };

  // Send binary MIDI message to ESP32
  const sendMidiToESP32 = (statusByte: number, note: number, velocity: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const buffer = new Uint8Array([statusByte, note, velocity]);
      wsRef.current.send(buffer.buffer);
      addLog(`TX Note: Status=0x${statusByte.toString(16).toUpperCase()}, Note=${note}, Velocity=${velocity}`, 'WS_TX');
    }
  };

  // Local Key Press Handlers
  const handleKeyPress = (midi: number) => {
    setActiveKeys((prev) => ({ ...prev, [midi]: 'local' }));
    if (isDemoMode) {
      addLog(`TX Note (MOCK): Status=0x90, Note=${midi}, Velocity=100`, 'WS_TX');
      // Simulate DSP board echoing note back to visual keyboard over network
      setTimeout(() => {
        setActiveKeys((prev) => ({ ...prev, [midi]: 'right' }));
        addLog(`RX Note (MOCK): Status=0x90, Note=${midi}, Velocity=100`, 'WS_RX');
      }, 80);
    } else {
      sendMidiToESP32(0x90, midi, 100);
    }
  };

  const handleKeyRelease = (midi: number) => {
    setActiveKeys((prev) => {
      const updated = { ...prev };
      delete updated[midi];
      return updated;
    });
    if (isDemoMode) {
      addLog(`TX Note (MOCK): Status=0x80, Note=${midi}, Velocity=0`, 'WS_TX');
      setTimeout(() => {
        addLog(`RX Note (MOCK): Status=0x80, Note=${midi}, Velocity=0`, 'WS_RX');
      }, 80);
    } else {
      sendMidiToESP32(0x80, midi, 0);
    }
  };

  // Keyboard mapping definitions (MIDI 60 to 76)
  const whiteKeys = [
    { midi: 60, name: 'C4' },
    { midi: 62, name: 'D4' },
    { midi: 64, name: 'E4' },
    { midi: 65, name: 'F4' },
    { midi: 67, name: 'G4' },
    { midi: 69, name: 'A4' },
    { midi: 71, name: 'B4' },
    { midi: 72, name: 'C5' },
    { midi: 74, name: 'D5' },
    { midi: 76, name: 'E5' },
  ];

  const blackKeys = [
    { midi: 61, name: 'C#4', leftOffset: 1 * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2 },
    { midi: 63, name: 'D#4', leftOffset: 2 * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2 },
    { midi: 66, name: 'F#4', leftOffset: 4 * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2 },
    { midi: 68, name: 'G#4', leftOffset: 5 * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2 },
    { midi: 70, name: 'A#4', leftOffset: 6 * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2 },
    { midi: 73, name: 'C#5', leftOffset: 8 * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2 },
    { midi: 75, name: 'D#5', leftOffset: 9 * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2 },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>DSP PIANO LINK</Text>
            <Text style={styles.subtitle}>Mobile Controller // TypeScript</Text>
          </View>
          <View style={[styles.badge, isDemoMode ? styles.badgeDemo : styles.badgeLive]}>
            <Text style={[styles.badgeText, !isDemoMode && styles.badgeTextLive]}>
              {isDemoMode ? 'DEMO MODE' : 'LIVE LINK'}
            </Text>
          </View>
        </View>

        {/* MODE SELECTOR */}
        <View style={styles.modeContainer}>
          <TouchableOpacity
            style={[styles.modeButton, isDemoMode && styles.modeButtonActive]}
            onPress={() => handleModeChange(true)}
          >
            <Text style={[styles.modeButtonText, isDemoMode && styles.modeButtonTextActive]}>
              MOCK DEMO MODE
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeButton, !isDemoMode && styles.modeButtonActive]}
            onPress={() => handleModeChange(false)}
          >
            <Text style={[styles.modeButtonText, !isDemoMode && styles.modeButtonTextActive]}>
              LAPTOP SERVER LINK
            </Text>
          </TouchableOpacity>
        </View>

        {/* CONNECTION / DEMO CONTROL PANEL */}
        <View style={styles.panel}>
          {isDemoMode ? (
            <View>
              <Text style={styles.panelTitle}>1. Simulated Audio Input Controls</Text>
              <View style={styles.demoControlsRow}>
                <View style={styles.demoInfo}>
                  <Text style={styles.demoInfoTitle}>Mock Mode Active</Text>
                  <Text style={styles.demoInfoText}>
                    Simulating ESP32 pitch detection. Tap the piano or start the song loop to test.
                  </Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.button,
                    isDemoPlaying ? styles.buttonDisconnect : styles.buttonConnect
                  ]}
                  onPress={isDemoPlaying ? stopDemoSong : startDemoSong}
                >
                  <Text style={[styles.buttonText, !isDemoPlaying && styles.buttonTextConnect]}>
                    {isDemoPlaying ? 'Stop Song' : 'Play Song'}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.statusContainer}>
                <View style={[styles.statusDot, styles.statusDotConnected]} />
                <Text style={styles.statusText}>
                  Status: <Text style={styles.statusHighlight}>DEMO (MOCKED)</Text>
                </Text>
              </View>
            </View>
          ) : (
            <View>
              <Text style={styles.panelTitle}>1. WebSocket Link</Text>
              <View style={styles.connectionRow}>
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Laptop Server Address</Text>
                  <TextInput
                    style={styles.input}
                    value={ip}
                    onChangeText={setIp}
                    placeholder="localhost:8080"
                    placeholderTextColor="#5A626A"
                    autoCapitalize="none"
                  />
                </View>

                <TouchableOpacity
                  style={[
                    styles.button,
                    status === 'CONNECTED' ? styles.buttonDisconnect : styles.buttonConnect
                  ]}
                  onPress={status === 'CONNECTED' ? disconnectEsp : connectEsp}
                  disabled={status === 'CONNECTING'}
                >
                  <Text style={[styles.buttonText, status !== 'CONNECTED' && styles.buttonTextConnect]}>
                    {status === 'CONNECTED' ? 'Disconnect' : status === 'CONNECTING' ? 'Linking...' : 'Connect'}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.statusContainer}>
                <View
                  style={[
                    styles.statusDot,
                    status === 'CONNECTED'
                      ? styles.statusDotConnected
                      : status === 'CONNECTING'
                      ? styles.statusDotConnecting
                      : styles.statusDotDisconnected
                  ]}
                />
                <Text style={styles.statusText}>
                  Status: <Text style={styles.statusHighlight}>{status}</Text>
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* 2. SHEET MUSIC VIEWPORT */}
        <View style={styles.panel}>
          <View style={styles.sheetHeaderRow}>
            <Text style={styles.panelTitle}>2. Sheet Music PDF</Text>
            <View style={styles.sheetActionButtons}>
              <TouchableOpacity style={styles.btnSmall} onPress={handlePickPdf}>
                <Text style={styles.btnSmallText}>Upload PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnSmallSecondary} onPress={handleLoadMockSheet}>
                <Text style={styles.btnSmallTextSecondary}>Load Mock</Text>
              </TouchableOpacity>
            </View>
          </View>

          {pdfUri ? (
            <View style={styles.sheetViewerWrapper}>
              <View style={styles.pdfArea}>
                {pdfUri === 'MOCK_URI' ? (
                  <View style={styles.sheetMockContainer}>
                    <View style={styles.sheetMockHeader}>
                      <Text style={styles.sheetMockTitle}>{pdfName}</Text>
                      <Text style={styles.sheetMockPageInfo}>Page {pdfCurrentPage} of {pdfPageCount}</Text>
                    </View>
                    
                    <View style={styles.staffContainer}>
                      <Text style={styles.clefSymbol}>𝄞</Text>
                      <View style={styles.staffLine} />
                      <View style={styles.staffLine} />
                      <View style={styles.staffLine} />
                      <View style={styles.staffLine} />
                      <View style={styles.staffLine} />
                      
                      {pdfCurrentPage === 1 ? (
                        <View style={styles.notesContainer}>
                          <View style={[styles.noteCircle, { left: 45, top: 12 }]}><Text style={styles.noteLabelInside}>E4</Text></View>
                          <View style={[styles.noteCircle, { left: 85, top: 12 }]}><Text style={styles.noteLabelInside}>E4</Text></View>
                          <View style={[styles.noteCircle, { left: 125, top: 8 }]}><Text style={styles.noteLabelInside}>F4</Text></View>
                          <View style={[styles.noteCircle, { left: 165, top: 4 }]}><Text style={styles.noteLabelInside}>G4</Text></View>
                          <View style={[styles.noteCircle, { left: 205, top: 4 }]}><Text style={styles.noteLabelInside}>G4</Text></View>
                        </View>
                      ) : (
                        <View style={styles.notesContainer}>
                          <View style={[styles.noteCircle, { left: 45, top: 16 }]}><Text style={styles.noteLabelInside}>D4</Text></View>
                          <View style={[styles.noteCircle, { left: 85, top: 16 }]}><Text style={styles.noteLabelInside}>D4</Text></View>
                          <View style={[styles.noteCircle, { left: 125, top: 12 }]}><Text style={styles.noteLabelInside}>E4</Text></View>
                          <View style={[styles.noteCircle, { left: 165, top: 20 }]}><Text style={styles.noteLabelInside}>C4</Text></View>
                          <View style={[styles.noteCircle, { left: 205, top: 16 }]}><Text style={styles.noteLabelInside}>D4</Text></View>
                        </View>
                      )}
                    </View>

                    <View style={[styles.staffContainer, { marginTop: 30 }]}>
                      <Text style={styles.clefSymbol}>𝄢</Text>
                      <View style={styles.staffLine} />
                      <View style={styles.staffLine} />
                      <View style={styles.staffLine} />
                      <View style={styles.staffLine} />
                      <View style={styles.staffLine} />
                      
                      {pdfCurrentPage === 1 ? (
                        <View style={styles.notesContainer}>
                          <View style={[styles.noteCircle, { left: 45, top: 8 }]}><Text style={styles.noteLabelInside}>C3</Text></View>
                          <View style={[styles.noteCircle, { left: 45, top: 16 }]}><Text style={styles.noteLabelInside}>E3</Text></View>
                          <View style={[styles.noteCircle, { left: 165, top: 0 }]}><Text style={styles.noteLabelInside}>G3</Text></View>
                          <View style={[styles.noteCircle, { left: 165, top: 12 }]}><Text style={styles.noteLabelInside}>D3</Text></View>
                        </View>
                      ) : (
                        <View style={styles.notesContainer}>
                          <View style={[styles.noteCircle, { left: 45, top: 4 }]}><Text style={styles.noteLabelInside}>F3</Text></View>
                          <View style={[styles.noteCircle, { left: 45, top: 12 }]}><Text style={styles.noteLabelInside}>A3</Text></View>
                          <View style={[styles.noteCircle, { left: 165, top: 8 }]}><Text style={styles.noteLabelInside}>E3</Text></View>
                          <View style={[styles.noteCircle, { left: 165, top: 16 }]}><Text style={styles.noteLabelInside}>G3</Text></View>
                        </View>
                      )}
                    </View>
                  </View>
                ) : (
                  <WebView
                    source={{ uri: pdfUri }}
                    style={styles.pdfWebView}
                    originWhitelist={['*']}
                    allowFileAccess={true}
                    allowFileAccessFromFileURLs={true}
                    allowUniversalAccessFromFileURLs={true}
                  />
                )}
              </View>

              <View style={styles.pdfControlsRow}>
                <View style={styles.pdfPagination}>
                  <TouchableOpacity 
                    style={[styles.btnPage, pdfCurrentPage === 1 && styles.btnPageDisabled]} 
                    onPress={() => setPdfCurrentPage(p => Math.max(1, p - 1))}
                    disabled={pdfCurrentPage === 1}
                  >
                    <Text style={styles.btnPageText}>◀</Text>
                  </TouchableOpacity>
                  <Text style={styles.pdfPageIndicator}>
                    Page {pdfCurrentPage} / {pdfPageCount}
                  </Text>
                  <TouchableOpacity 
                    style={[styles.btnPage, pdfCurrentPage === pdfPageCount && styles.btnPageDisabled]} 
                    onPress={() => setPdfCurrentPage(p => Math.min(pdfPageCount, p + 1))}
                    disabled={pdfCurrentPage === pdfPageCount}
                  >
                    <Text style={styles.btnPageText}>▶</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity 
                  style={[styles.btnTranscribe, isTranscribing && styles.btnTranscribeActive]} 
                  onPress={handleTranscribePage}
                  disabled={isTranscribing}
                >
                  {isTranscribing ? (
                    <ActivityIndicator size="small" color="#161414" />
                  ) : (
                    <Text style={styles.btnTranscribeText}>Transcribe Page (MOCK AI)</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.pdfEmptyState}>
              <Text style={styles.pdfEmptyText}>No sheet music loaded. Upload a PDF or load the mock sheet.</Text>
            </View>
          )}
        </View>

        {/* TELEMETRY CONSOLE PANEL */}
        <View style={[styles.panel, styles.telemetryPanel]}>
          <View style={styles.telemetryHeader}>
            <Text style={styles.panelTitle}>3. Live Telemetry Console</Text>
            <TouchableOpacity onPress={() => setLogs([])}>
              <Text style={styles.clearLogsText}>Clear Logs</Text>
            </TouchableOpacity>
          </View>
          
          <ScrollView
            ref={logScrollRef}
            style={styles.logContainer}
            contentContainerStyle={styles.logContent}
          >
            {logs.length === 0 ? (
              <Text style={styles.emptyLogText}>
                {isDemoMode 
                  ? '[Ready] Mock Mode is active. Play a song or press keys to see logs...'
                  : '[Ready] Awaiting telemetry or WebSocket connection...'}
              </Text>
            ) : (
              logs.map((log) => (
                <View key={log.id} style={styles.logRow}>
                  <Text style={styles.logTime}>[{log.time}]</Text>
                  <Text
                    style={[
                      styles.logType,
                      log.type === 'WS_RX'
                        ? styles.logRx
                        : log.type === 'WS_TX'
                        ? styles.logTx
                        : log.type === 'ERR'
                        ? styles.logErr
                        : styles.logSys
                    ]}
                  >
                    {log.type}
                  </Text>
                  <Text style={styles.logMsg}>{log.msg}</Text>
                </View>
              ))
            )}
          </ScrollView>
        </View>

        {/* PIANO KEYBOARD SECTION */}
        <View style={styles.keyboardPanel}>
          <Text style={styles.keyboardTitle}>4. Interactive Keyboard</Text>
          
          <View style={styles.keyboardWrapper}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.keyboardScrollContainer}
            >
              <View style={styles.keyboard}>
                {/* White Keys */}
                {whiteKeys.map((key) => {
                  const isActive = activeKeys[key.midi];
                  return (
                    <View
                      key={key.midi}
                      style={[
                        styles.whiteKey,
                        isActive === 'right' && styles.whiteKeyActiveRx,
                        isActive === 'local' && styles.whiteKeyActiveLocal,
                      ]}
                      onTouchStart={() => handleKeyPress(key.midi)}
                      onTouchEnd={() => handleKeyRelease(key.midi)}
                    >
                      <Text style={styles.keyLabel}>{key.name}</Text>
                    </View>
                  );
                })}

                {/* Black Keys */}
                {blackKeys.map((key) => {
                  const isActive = activeKeys[key.midi];
                  return (
                    <View
                      key={key.midi}
                      style={[
                        styles.blackKey,
                        { left: key.leftOffset },
                        isActive === 'right' && styles.blackKeyActiveRx,
                        isActive === 'local' && styles.blackKeyActiveLocal,
                      ]}
                      onTouchStart={() => handleKeyPress(key.midi)}
                      onTouchEnd={() => handleKeyRelease(key.midi)}
                    >
                      <Text style={styles.blackKeyLabel}>{key.name.slice(0, 2)}</Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#161414', // --color-background-dark
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2e2a2a', // --color-border-dark
    paddingBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#ece7e7', // --color-text-dark
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 10,
    color: '#a8a29e', // --color-text-muted-dark
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgeDemo: {
    backgroundColor: '#c5a059', // --color-accent-gold
  },
  badgeLive: {
    backgroundColor: '#c82333', // --color-accent
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#161414', // dark text on gold badge
  },
  badgeTextLive: {
    color: '#ece7e7', // light text on crimson badge
  },
  modeContainer: {
    flexDirection: 'row',
    backgroundColor: '#1f1a1a', // --color-surface-dark
    borderRadius: 6,
    padding: 4,
    borderWidth: 1,
    borderColor: '#2e2a2a', // --color-border-dark
    marginBottom: 14,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 4,
  },
  modeButtonActive: {
    backgroundColor: '#c5a059', // --color-accent-gold
  },
  modeButtonText: {
    color: '#a8a29e', // --color-text-muted-dark
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  modeButtonTextActive: {
    color: '#161414', // dark text on gold background
  },
  panel: {
    backgroundColor: '#1f1a1a', // --color-surface-dark
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2e2a2a', // --color-border-dark
    marginBottom: 14,
  },
  panelTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ece7e7', // --color-text-dark
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  connectionRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  demoControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  demoInfo: {
    flex: 1,
  },
  demoInfoTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ece7e7',
    marginBottom: 2,
  },
  demoInfoText: {
    fontSize: 11,
    color: '#a8a29e',
    lineHeight: 14,
  },
  inputContainer: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 11,
    color: '#a8a29e', // --color-text-muted-dark
    marginBottom: 6,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#161414', // --color-background-dark
    borderWidth: 1,
    borderColor: '#2e2a2a', // --color-border-dark
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#ece7e7', // --color-text-dark
    fontSize: 14,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    height: 42,
    minWidth: 100,
  },
  buttonConnect: {
    backgroundColor: '#c5a059', // --color-accent-gold
  },
  buttonDisconnect: {
    backgroundColor: '#c82333', // --color-accent (Crimson)
  },
  buttonText: {
    color: '#ece7e7', // --color-text-dark for disconnect/default
    fontSize: 13,
    fontWeight: '700',
  },
  buttonTextConnect: {
    color: '#161414', // Dark text on gold button
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotDisconnected: {
    backgroundColor: '#c82333', // --color-accent (Crimson)
  },
  statusDotConnecting: {
    backgroundColor: '#c5a059', // --color-accent-gold (for transition)
    opacity: 0.6,
  },
  statusDotConnected: {
    backgroundColor: '#c5a059', // --color-accent-gold
  },
  statusText: {
    fontSize: 12,
    color: '#a8a29e', // --color-text-muted-dark
    fontWeight: '600',
  },
  statusHighlight: {
    color: '#ece7e7', // --color-text-dark
    fontWeight: '700',
  },
  telemetryPanel: {
    flex: 1,
    minHeight: 180,
  },
  telemetryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  clearLogsText: {
    fontSize: 11,
    color: '#c5a059', // --color-accent-gold
    fontWeight: '600',
  },
  logContainer: {
    flex: 1,
    backgroundColor: '#161414', // --color-background-dark
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2e2a2a', // --color-border-dark
    padding: 8,
  },
  logContent: {
    paddingBottom: 8,
  },
  emptyLogText: {
    color: '#a8a29e', // --color-text-muted-dark
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    opacity: 0.6,
  },
  logRow: {
    flexDirection: 'row',
    marginBottom: 6,
    alignItems: 'flex-start',
  },
  logTime: {
    color: '#a8a29e', // --color-text-muted-dark
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    marginRight: 6,
    opacity: 0.6,
  },
  logType: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    width: 48,
    marginRight: 6,
  },
  logRx: {
    color: '#c5a059', // --color-accent-gold
  },
  logTx: {
    color: '#c82333', // --color-accent (Crimson)
  },
  logSys: {
    color: '#a8a29e', // --color-text-muted-dark
  },
  logErr: {
    color: '#c82333', // --color-accent (Crimson)
  },
  logMsg: {
    flex: 1,
    color: '#ece7e7', // --color-text-dark
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  keyboardPanel: {
    marginTop: 'auto',
    marginBottom: 4,
  },
  keyboardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ece7e7', // --color-text-dark
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  keyboardWrapper: {
    backgroundColor: '#1f1a1a', // --color-surface-dark
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#2e2a2a', // --color-border-dark
  },
  keyboardScrollContainer: {
    paddingRight: 10,
  },
  keyboard: {
    flexDirection: 'row',
    position: 'relative',
    height: KEYBOARD_HEIGHT,
  },
  whiteKey: {
    width: WHITE_KEY_WIDTH,
    height: KEYBOARD_HEIGHT,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#161414',
    borderRadius: 4,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 8,
  },
  whiteKeyActiveRx: {
    backgroundColor: '#c5a059', // --color-accent-gold
  },
  whiteKeyActiveLocal: {
    backgroundColor: '#c82333', // --color-accent (Crimson)
  },
  keyLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#161414',
  },
  blackKey: {
    position: 'absolute',
    width: BLACK_KEY_WIDTH,
    height: KEYBOARD_HEIGHT * 0.6,
    backgroundColor: '#161414',
    borderWidth: 1,
    borderColor: '#2e2a2a',
    borderRadius: 3,
    zIndex: 10,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 6,
  },
  blackKeyActiveRx: {
    backgroundColor: '#c5a059', // --color-accent-gold
  },
  blackKeyActiveLocal: {
    backgroundColor: '#c82333', // --color-accent (Crimson)
  },
  blackKeyLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: '#ece7e7',
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sheetActionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  btnSmall: {
    backgroundColor: '#c5a059',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  btnSmallSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#2e2a2a',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  btnSmallText: {
    color: '#161414',
    fontSize: 11,
    fontWeight: '700',
  },
  btnSmallTextSecondary: {
    color: '#ece7e7',
    fontSize: 11,
    fontWeight: '700',
  },
  sheetViewerWrapper: {
    width: '100%',
  },
  pdfArea: {
    height: 220,
    backgroundColor: '#ffffff',
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2e2a2a',
  },
  pdfWebView: {
    flex: 1,
  },
  sheetMockContainer: {
    flex: 1,
    backgroundColor: '#f7f4eb', // warm cream background from token.css
    padding: 12,
    justifyContent: 'center',
  },
  sheetMockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#dcd1ba',
    paddingBottom: 4,
    marginBottom: 16,
  },
  sheetMockTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    fontSize: 13,
    fontWeight: 'bold',
    color: '#1a1616',
  },
  sheetMockPageInfo: {
    fontSize: 9,
    fontFamily: 'monospace',
    color: '#685f5d',
  },
  staffContainer: {
    height: 48,
    position: 'relative',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  clefSymbol: {
    position: 'absolute',
    left: 4,
    top: 4,
    fontSize: 34,
    color: '#1a1616',
    zIndex: 1,
  },
  staffLine: {
    height: 1,
    backgroundColor: '#1a1616',
    width: '100%',
    opacity: 0.8,
  },
  notesContainer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  noteCircle: {
    position: 'absolute',
    width: 18,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#1a1616',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-15deg' }],
  },
  noteLabelInside: {
    color: '#f7f4eb',
    fontSize: 8,
    fontWeight: 'bold',
  },
  pdfControlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  pdfPagination: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btnPage: {
    width: 28,
    height: 28,
    backgroundColor: '#1f1a1a',
    borderWidth: 1,
    borderColor: '#2e2a2a',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPageDisabled: {
    opacity: 0.3,
  },
  btnPageText: {
    color: '#ece7e7',
    fontSize: 10,
  },
  pdfPageIndicator: {
    color: '#a8a29e',
    fontSize: 11,
    fontWeight: '600',
  },
  btnTranscribe: {
    flex: 1,
    backgroundColor: '#c5a059',
    height: 32,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnTranscribeActive: {
    backgroundColor: '#a8a29e',
    opacity: 0.5,
  },
  btnTranscribeText: {
    color: '#161414',
    fontSize: 11,
    fontWeight: '700',
  },
  pdfEmptyState: {
    height: 120,
    backgroundColor: '#161414',
    borderWidth: 1,
    borderColor: '#2e2a2a',
    borderStyle: 'dashed',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  pdfEmptyText: {
    color: '#a8a29e',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
});
