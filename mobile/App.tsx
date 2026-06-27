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
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

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
  const [ip, setIp] = useState<string>('192.168.4.1');
  const [status, setStatus] = useState<'DISCONNECTED' | 'CONNECTING' | 'CONNECTED'>('DISCONNECTED');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeKeys, setActiveKeys] = useState<{ [midi: number]: 'left' | 'right' | 'local' }>({});

  const wsRef = useRef<WebSocket | null>(null);
  const logScrollRef = useRef<ScrollView | null>(null);
  const keyTimeouts = useRef<{ [midi: number]: any }>({});

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

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      Object.values(keyTimeouts.current).forEach(clearTimeout);
    };
  }, []);

  // Connect to ESP32 WebSocket
  const connectEsp = () => {
    if (wsRef.current) {
      addLog('Closing existing WebSocket connection...');
      wsRef.current.close();
      return;
    }

    if (!ip.trim()) {
      addLog('Please enter a valid IP address.', 'ERR');
      return;
    }

    addLog(`Connecting to ws://${ip}/ws ...`, 'SYS');
    setStatus('CONNECTING');

    try {
      const ws = new WebSocket(`ws://${ip}/ws`);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        setStatus('CONNECTED');
        addLog('Successfully connected to ESP32!', 'SYS');
      };

      ws.onclose = () => {
        setStatus('DISCONNECTED');
        addLog('Connection closed.', 'SYS');
        wsRef.current = null;
      };

      ws.onerror = (e) => {
        setStatus('DISCONNECTED');
        addLog('WebSocket error occurred. Verify IP and connection.', 'ERR');
        console.error(e);
        wsRef.current = null;
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const view = new DataView(event.data);
          if (view.byteLength >= 3) {
            const statusByte = view.getUint8(0);
            const note = view.getUint8(1);
            const velocity = view.getUint8(2);

            addLog(`RX Note: Status=0x${statusByte.toString(16).toUpperCase()}, Note=${note}, Velocity=${velocity}`, 'WS_RX');

            if (statusByte === 0x90 && velocity > 0) {
              // Highlight key (simulate right hand cyan highlight)
              setActiveKeys((prev) => ({ ...prev, [note]: 'right' }));

              // Auto release key after 400ms to avoid sticky pitch detections
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
    sendMidiToESP32(0x90, midi, 100);
  };

  const handleKeyRelease = (midi: number) => {
    setActiveKeys((prev) => {
      const updated = { ...prev };
      delete updated[midi];
      return updated;
    });
    sendMidiToESP32(0x80, midi, 0);
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
          <View style={styles.badge}>
            <Text style={styles.badgeText}>EXPO GO</Text>
          </View>
        </View>

        {/* CONNECTION PANEL */}
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>1. WebSocket Link</Text>
          <View style={styles.connectionRow}>
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>ESP32 IP Address</Text>
              <TextInput
                style={styles.input}
                value={ip}
                onChangeText={setIp}
                placeholder="192.168.4.1"
                placeholderTextColor="#5A626A"
                keyboardType="numeric"
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
              <Text style={styles.buttonText}>
                {status === 'CONNECTED' ? 'Disconnect' : status === 'CONNECTING' ? 'Linking...' : 'Connect'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Connection Status indicator */}
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

        {/* TELEMETRY CONSOLE PANEL */}
        <View style={[styles.panel, styles.telemetryPanel]}>
          <View style={styles.telemetryHeader}>
            <Text style={styles.panelTitle}>2. Live Telemetry Console</Text>
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
              <Text style={styles.emptyLogText}>[Ready] Awaiting telemetry or WebSocket connection...</Text>
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
          <Text style={styles.keyboardTitle}>3. Interactive Keyboard</Text>
          
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
    backgroundColor: '#121416',
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
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2C3136',
    paddingBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 10,
    color: '#8A929A',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  badge: {
    backgroundColor: '#00f5d4',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#121416',
  },
  panel: {
    backgroundColor: '#1A1D20',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2C3136',
    marginBottom: 16,
  },
  panelTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  connectionRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  inputContainer: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 11,
    color: '#8A929A',
    marginBottom: 6,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#121416',
    borderWidth: 1,
    borderColor: '#2C3136',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 14,
  },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    height: 42,
  },
  buttonConnect: {
    backgroundColor: '#00f5d4',
  },
  buttonDisconnect: {
    backgroundColor: '#FF3B30',
  },
  buttonText: {
    color: '#121416',
    fontSize: 14,
    fontWeight: '700',
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
    backgroundColor: '#FF3B30',
  },
  statusDotConnecting: {
    backgroundColor: '#FFCC00',
  },
  statusDotConnected: {
    backgroundColor: '#00f5d4',
  },
  statusText: {
    fontSize: 12,
    color: '#8A929A',
    fontWeight: '600',
  },
  statusHighlight: {
    color: '#FFFFFF',
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
    color: '#00f5d4',
    fontWeight: '600',
  },
  logContainer: {
    flex: 1,
    backgroundColor: '#121416',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2C3136',
    padding: 8,
  },
  logContent: {
    paddingBottom: 8,
  },
  emptyLogText: {
    color: '#5A626A',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  logRow: {
    flexDirection: 'row',
    marginBottom: 6,
    alignItems: 'flex-start',
  },
  logTime: {
    color: '#5A626A',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    marginRight: 6,
  },
  logType: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    width: 48,
    marginRight: 6,
  },
  logRx: {
    color: '#00f5d4',
  },
  logTx: {
    color: '#9E00FF',
  },
  logSys: {
    color: '#8A929A',
  },
  logErr: {
    color: '#FF3B30',
  },
  logMsg: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  keyboardPanel: {
    marginTop: 'auto',
    marginBottom: 10,
  },
  keyboardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  keyboardWrapper: {
    backgroundColor: '#1A1D20',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#2C3136',
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
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#121416',
    borderRadius: 4,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 8,
  },
  whiteKeyActiveRx: {
    backgroundColor: '#00f5d4',
  },
  whiteKeyActiveLocal: {
    backgroundColor: '#FF9500',
  },
  keyLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#121416',
  },
  blackKey: {
    position: 'absolute',
    width: BLACK_KEY_WIDTH,
    height: KEYBOARD_HEIGHT * 0.6,
    backgroundColor: '#121416',
    borderWidth: 1,
    borderColor: '#2C3136',
    borderRadius: 3,
    zIndex: 10,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 6,
  },
  blackKeyActiveRx: {
    backgroundColor: '#00f5d4',
  },
  blackKeyActiveLocal: {
    backgroundColor: '#FF9500',
  },
  blackKeyLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
