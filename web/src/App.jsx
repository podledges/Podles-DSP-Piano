import React, { useState, useEffect, useRef } from 'react';
import { 
  Cpu, 
  Music, 
  Wifi, 
  Terminal, 
  Sliders, 
  Sparkles, 
  BookOpen, 
  Check, 
  Copy, 
  ChevronRight, 
  ArrowRight,
  Github,
  HardDrive,
  Activity,
  Layers,
  Settings
} from 'lucide-react';

// Mock list of ESP32 DSP terminal logs
const MOCK_DSP_LOGS = [
  { type: 'sys', msg: 'System Boot: ESP32-S3 Dual-Core Xtensa running at 240MHz' },
  { type: 'sys', msg: 'NVS Flash initialized successfully' },
  { type: 'wifi', msg: 'SoftAP started: SSID "ESP32-Piano-AP" IP: 192.168.4.1' },
  { type: 'dsp', msg: 'ADC Sampler init: Continuous mode, Sample Rate = 44100Hz' },
  { type: 'dsp', msg: 'FFT pipeline loaded: Size = 512, Resolution = 86.13 Hz/bin' },
  { type: 'espnow', msg: 'ESP-NOW wireless interface started on Channel 1' },
  { type: 'dsp', msg: 'Calibrating analog threshold... Ambient noise Floor: 34mV' },
  { type: 'sys', msg: 'Ready. Waiting for audio input...' },
  { type: 'dsp', msg: '► Pitch Attack: 261.63 Hz (C4), Amplitude: 184mV' },
  { type: 'espnow', msg: '→ Broadcast: noteCount=1 activeNotes=[60] amp=184' },
  { type: 'dsp', msg: '► Pitch Attack: 329.63 Hz (E4), Amplitude: 168mV' },
  { type: 'espnow', msg: '→ Broadcast: noteCount=2 activeNotes=[60, 64] amp=176' },
  { type: 'dsp', msg: '► Pitch Attack: 392.00 Hz (G4), Amplitude: 195mV' },
  { type: 'espnow', msg: '→ Broadcast: noteCount=3 activeNotes=[60, 64, 67] amp=195 (C Major)' },
  { type: 'dsp', msg: '▼ Silence threshold reached. Releasing chord.' },
  { type: 'espnow', msg: '→ Broadcast: noteCount=0 activeNotes=[] amp=0 (Note-Off)' },
  { type: 'dsp', msg: '► Pitch Attack: 440.00 Hz (A4), Amplitude: 215mV' },
  { type: 'espnow', msg: '→ Broadcast: noteCount=1 activeNotes=[69] amp=215' },
  { type: 'dsp', msg: '► Pitch Attack: 523.25 Hz (C5), Amplitude: 154mV' },
  { type: 'espnow', msg: '→ Broadcast: noteCount=2 activeNotes=[69, 72] amp=184' }
];

export default function App() {
  const [logs, setLogs] = useState(MOCK_DSP_LOGS.slice(0, 8));
  const [activeTab, setActiveTab] = useState('features');
  const [connected, setConnected] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  
  const terminalContainerRef = useRef(null);
  const logCounterRef = useRef(8);

  // Auto-scroll the terminal logs (scrolls container internally, bypassing window scrolling)
  useEffect(() => {
    if (terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Simulate incoming DSP telemetry logs
  useEffect(() => {
    const interval = setInterval(() => {
      setLogs((prev) => {
        const nextIndex = logCounterRef.current % MOCK_DSP_LOGS.length;
        logCounterRef.current += 1;
        const newLogs = [...prev, MOCK_DSP_LOGS[nextIndex]];
        // Keep last 15 logs to prevent memory overflow
        return newLogs.slice(-15);
      });
    }, 2500);

    return () => clearInterval(interval);
  }, []);

  const copyConfig = () => {
    navigator.clipboard.writeText('git clone https://github.com/NanoOpusGoonClawX/Podles-DSP-Piano.git');
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  // Setup self-playing notes waterfall
  const [fallingNotes, setFallingNotes] = useState([
    { id: 1, x: 20, y: 0, width: 30, speed: 2.2, color: 'crimson', active: false },
    { id: 2, x: 45, y: -80, width: 25, speed: 1.8, color: 'gold', active: false },
    { id: 3, x: 70, y: -160, width: 35, speed: 2.5, color: 'crimson', active: false },
    { id: 4, x: 30, y: -240, width: 20, speed: 2.0, color: 'gold', active: false },
    { id: 5, x: 60, y: -320, width: 25, speed: 2.1, color: 'crimson', active: false }
  ]);
  
  const [activeKeys, setActiveKeys] = useState({});

  useEffect(() => {
    let animationId;
    const updateWaterfall = () => {
      setFallingNotes((prevNotes) => {
        return prevNotes.map((note) => {
          let nextY = note.y + note.speed;
          let nextActive = note.active;

          // Check if hitting the key line (bottom of container, height ~320px)
          if (nextY >= 280 && !note.active) {
            nextActive = true;
            const keyIndex = Math.floor(note.x / 10);
            setActiveKeys((keys) => ({ ...keys, [keyIndex]: note.color }));
          }

          // Reset note if completely past bottom
          if (nextY > 340) {
            const keyIndex = Math.floor(note.x / 10);
            setActiveKeys((keys) => {
              const updated = { ...keys };
              delete updated[keyIndex];
              return updated;
            });
            return {
              ...note,
              y: -100 - Math.random() * 200,
              x: 10 + Math.random() * 80,
              speed: 1.5 + Math.random() * 1.5,
              active: false
            };
          }

          return { ...note, y: nextY, active: nextActive };
        });
      });
      animationId = requestAnimationFrame(updateWaterfall);
    };

    animationId = requestAnimationFrame(updateWaterfall);
    return () => cancelAnimationFrame(animationId);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col relative overflow-hidden font-sans">
      {/* Background tactile paper texture pattern */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: `radial-gradient(var(--color-foreground) 1px, transparent 0), radial-gradient(var(--color-foreground) 1px, transparent 0)`,
        backgroundSize: '24px 24px',
        backgroundPosition: '0 0, 12px 12px'
      }} />

      {/* HEADER */}
      <header className="border-b-2 border-foreground sticky top-0 bg-background/95 backdrop-blur-sm z-50 transition-all duration-normal">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 border-2 border-foreground bg-accent flex items-center justify-center rounded-[6px_14px_6px_12px] shadow-[3px_3px_0px_0px_rgba(26,22,22,1)]">
              <Music className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-serif text-xl font-bold tracking-tight">PPAP</span>
              <span className="font-mono text-[9px] block text-text-muted uppercase tracking-wider">Podles Piano Assistant</span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-6 font-mono text-xs">
            <a href="#concept" className="hover:text-accent hover:underline decoration-2 transition-all">01 // CONCEPT</a>
            <a href="#architecture" className="hover:text-accent hover:underline decoration-2 transition-all">02 // DSP SPECS</a>
            <a href="#hardware" className="hover:text-accent hover:underline decoration-2 transition-all">03 // HARDWARE</a>
            <a href="#get-started" className="hover:text-accent hover:underline decoration-2 transition-all">04 // SOURCE</a>
          </nav>

          <div className="flex items-center gap-3">
            <button 
              onClick={() => setConnected(!connected)}
              className={`font-mono text-xs px-3 py-1.5 border border-foreground transition-all flex items-center gap-2 rounded-[4px_12px_4px_12px] shadow-[2px_2px_0px_0px_rgba(26,22,22,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0px_0px_rgba(26,22,22,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${
                connected ? 'bg-accent/10 border-accent text-accent' : 'bg-surface'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-accent animate-pulse' : 'bg-text-muted'}`} />
              {connected ? 'CONNECTED (192.168.4.1)' : 'SIMULATE LINK'}
            </button>
          </div>
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="max-w-6xl mx-auto px-4 md:px-8 pt-12 md:pt-20 pb-16 flex flex-col lg:flex-row gap-12 items-center relative z-10">
        <div className="flex-1 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 border border-foreground/30 bg-surface rounded-[4px_10px_4px_10px] text-xs font-mono">
            <Cpu className="w-3.5 h-3.5 text-accent" />
            <span>ESP32-S3 Acoustic Pitch Analyzer</span>
          </div>

          <h1 className="font-serif text-5xl md:text-7xl font-bold leading-[1.05] tracking-tight">
            The physicality <br />
            of acoustic <br />
            <span className="text-accent underline decoration-3 underline-offset-4">sheet parsing.</span>
          </h1>

          <p className="font-sans text-lg text-text-muted max-w-lg leading-relaxed">
            PPAP couples low-latency acoustic DSP algorithms running on ESP32 microcontrollers with a Gemini-powered sheet music transcriber. Bypassing cloud overhead to illuminate physical keys in real-time.
          </p>

          <div className="flex flex-wrap gap-4 pt-2">
            <a 
              href="#concept"
              className="px-6 py-3 border-2 border-foreground bg-accent text-white font-serif font-bold text-lg rounded-[6px_20px_6px_20px] shadow-[4px_4px_0px_0px_rgba(26,22,22,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_rgba(26,22,22,1)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all inline-flex items-center gap-2"
            >
              Explore the Program <ArrowRight className="w-4 h-4" />
            </a>
            
            <a 
              href="#get-started"
              className="px-6 py-3 border-2 border-foreground bg-surface text-foreground font-mono text-xs rounded-[20px_6px_20px_6px] shadow-[4px_4px_0px_0px_rgba(26,22,22,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_rgba(26,22,22,1)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all inline-flex items-center gap-2"
            >
              View Hardware Code // Git
            </a>
          </div>
          
          <div className="flex items-center gap-4 text-xs font-mono text-text-muted pt-4">
            <span className="flex items-center gap-1"><Check className="w-3.5 h-3.5 text-accent" /> No Cloud Lag</span>
            <span className="text-foreground/20">|</span>
            <span className="flex items-center gap-1"><Check className="w-3.5 h-3.5 text-accent" /> ESP-NOW Protocol</span>
            <span className="text-foreground/20">|</span>
            <span className="flex items-center gap-1"><Check className="w-3.5 h-3.5 text-accent" /> Gemini Multimodal OMR</span>
          </div>
        </div>

        {/* HERO GRAPHIC - ASYMMETRIC TAC-BOARD */}
        <div className="flex-1 w-full max-w-md lg:max-w-none">
          <div className="border-2 border-foreground bg-surface rounded-[8px_40px_8px_40px] shadow-[8px_8px_0px_0px_rgba(26,22,22,1)] overflow-hidden transition-all duration-normal hover:shadow-[12px_12px_0px_0px_rgba(26,22,22,1)] hover:-translate-x-1 hover:-translate-y-1">
            {/* Header tab */}
            <div className="bg-surface-hover border-b border-foreground px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-accent" />
                <span className="font-mono text-xs font-bold text-foreground">MODULE // DSP_LOUDNESS_SPECTRUM</span>
              </div>
              <span className="font-mono text-[10px] text-text-muted">44.1 kHz // MONO</span>
            </div>

            {/* Content diagram */}
            <div className="p-6 space-y-6">
              <div className="h-48 border border-foreground/30 rounded-[4px_16px_4px_16px] bg-background-dark p-4 flex flex-col justify-between relative overflow-hidden">
                {/* Grid lines */}
                <div className="absolute inset-0 grid grid-cols-6 grid-rows-4 pointer-events-none opacity-10">
                  <div className="border-r border-b border-white" />
                  <div className="border-r border-b border-white" />
                  <div className="border-r border-b border-white" />
                  <div className="border-r border-b border-white" />
                  <div className="border-r border-b border-white" />
                  <div className="border-b border-white" />
                  <div className="border-r border-b border-white" />
                  <div className="border-r border-b border-white" />
                  <div className="border-r border-b border-white" />
                  <div className="border-r border-b border-white" />
                  <div className="border-r border-b border-white" />
                  <div className="border-b border-white" />
                </div>
                
                {/* Spectral Peaks */}
                <div className="relative w-full h-full flex items-end justify-between gap-1.5 pt-6">
                  {[20, 45, 12, 67, 85, 30, 95, 40, 15, 60, 78, 22, 55, 90, 35, 10].map((height, i) => (
                    <div key={i} className="flex-1 flex flex-col justify-end h-full">
                      <div 
                        className={`w-full rounded-[1px] transition-all duration-slow ${
                          height > 70 ? 'bg-accent' : height > 40 ? 'bg-accent-gold' : 'bg-border'
                        }`}
                        style={{ height: `${height}%` }}
                      />
                    </div>
                  ))}
                </div>

                <div className="flex justify-between items-center text-[9px] font-mono text-text-muted-dark z-10">
                  <span>0 Hz</span>
                  <span className="text-accent-gold">FFT ANALYZER</span>
                  <span>22.05 kHz</span>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-1 p-3 border border-foreground/30 rounded-[4px_12px_4px_12px] bg-background/50 font-mono text-xs space-y-1">
                  <span className="text-[10px] text-text-muted uppercase block">ACTIVE CHORD</span>
                  <span className="font-serif text-lg font-bold text-foreground">C Minor (Cm)</span>
                  <span className="text-[9px] block text-accent-gold font-mono">PITCH MATCH: 98.4%</span>
                </div>

                <div className="flex-1 p-3 border border-foreground/30 rounded-[12px_4px_12px_4px] bg-background/50 font-mono text-xs space-y-1">
                  <span className="text-[10px] text-text-muted uppercase block">ESP-NOW LATENCY</span>
                  <span className="font-serif text-lg font-bold text-accent">3.42 ms</span>
                  <span className="text-[9px] block text-text-muted font-mono">ZERO BUFFER AP MODE</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CORE CONCEPT SECTION */}
      <section id="concept" className="bg-surface border-y-2 border-foreground relative py-20">
        <div className="max-w-6xl mx-auto px-4 md:px-8">
          <div className="flex flex-col lg:flex-row gap-12 items-start">
            <div className="lg:w-1/3 space-y-4">
              <span className="font-mono text-xs text-accent uppercase tracking-wider block">01 // Product Ecosystem</span>
              <h2 className="font-serif text-4xl font-bold leading-tight">
                An analog-to-digital learning link.
              </h2>
              <p className="text-text-muted leading-relaxed">
                PPAP was designed to bridge physical piano acoustics with dynamic visual guides, eliminating standard Bluetooth lagging and complex software overhead.
              </p>
              <div className="pt-4 border-t border-dashed border-border lg:block hidden">
                <span className="font-display text-3xl text-accent-gold block">Built for purists.</span>
              </div>
            </div>

            <div className="lg:w-2/3 grid grid-cols-1 md:grid-cols-2 gap-8 w-full">
              {/* Card 1 - Asymmetric Radii */}
              <div className="border border-foreground p-6 rounded-[24px_4px_24px_4px] bg-background shadow-[4px_4px_0px_0px_rgba(220,209,186,1)] flex flex-col justify-between space-y-6 hover:-translate-y-1 transition-all">
                <div className="space-y-4">
                  <div className="w-12 h-12 rounded-[4px_12px_4px_12px] border border-foreground bg-accent/5 flex items-center justify-center text-accent">
                    <Activity className="w-6 h-6" />
                  </div>
                  <h3 className="font-serif text-2xl font-bold">1. ESP32 Analog Sampling</h3>
                  <p className="text-text-muted text-sm leading-relaxed">
                    A high-precision analog ADC sampler continuously monitors the acoustic soundboard at 44.1kHz. Real-time floating-point FFT transforms the sound into spectral density bins directly on-chip.
                  </p>
                </div>
                <div className="font-mono text-[10px] text-text-muted border-t border-border pt-4">
                  MODULE: adc_sampler.c + audio_dsp.c
                </div>
              </div>

              {/* Card 2 - Mismatched Radii */}
              <div className="border border-foreground p-6 rounded-[4px_24px_4px_24px] bg-background shadow-[4px_4px_0px_0px_rgba(220,209,186,1)] flex flex-col justify-between space-y-6 hover:-translate-y-1 transition-all">
                <div className="space-y-4">
                  <div className="w-12 h-12 rounded-[12px_4px_12px_4px] border border-foreground bg-accent-gold/10 flex items-center justify-center text-accent-gold-hover">
                    <Wifi className="w-6 h-6" />
                  </div>
                  <h3 className="font-serif text-2xl font-bold">2. ESP-NOW Key Lighting</h3>
                  <p className="text-text-muted text-sm leading-relaxed">
                    Once notes are detected, the system bypasses the Wi-Fi stack entirely. Using Espressif's connectionless ESP-NOW protocol, pitch commands flash client LEDs instantly for zero-latency guidance.
                  </p>
                </div>
                <div className="font-mono text-[10px] text-text-muted border-t border-border pt-4">
                  MODULE: network.cpp + ESP_lights
                </div>
              </div>

              {/* Card 3 - Asymmetric Rounded Left Top */}
              <div className="border border-foreground p-6 rounded-[32px_4px_4px_4px] bg-background shadow-[4px_4px_0px_0px_rgba(220,209,186,1)] flex flex-col justify-between space-y-6 hover:-translate-y-1 transition-all">
                <div className="space-y-4">
                  <div className="w-12 h-12 rounded-[16px_4px_4px_4px] border border-foreground bg-accent/5 flex items-center justify-center text-accent">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <h3 className="font-serif text-2xl font-bold">3. Gemini Sheet Music OMR</h3>
                  <p className="text-text-muted text-sm leading-relaxed">
                    Simply drop in a sheet music PDF. The program leverages Gemini's multimodal layout analysis to read complex musical notation, parsing pitches, timing details, and rests into a structured JSON database.
                  </p>
                </div>
                <div className="font-mono text-[10px] text-text-muted border-t border-border pt-4">
                  MODULE: gemini_omr_parser
                </div>
              </div>

              {/* Card 4 - Asymmetric Rounded Right Bottom */}
              <div className="border border-foreground p-6 rounded-[4px_4px_32px_4px] bg-background shadow-[4px_4px_0px_0px_rgba(220,209,186,1)] flex flex-col justify-between space-y-6 hover:-translate-y-1 transition-all">
                <div className="space-y-4">
                  <div className="w-12 h-12 rounded-[4px_4px_16px_4px] border border-foreground bg-accent-gold/10 flex items-center justify-center text-accent-gold-hover">
                    <Sliders className="w-6 h-6" />
                  </div>
                  <h3 className="font-serif text-2xl font-bold">4. Real-time Controller Panel</h3>
                  <p className="text-text-muted text-sm leading-relaxed">
                    View active falling notes, inspect processed musical JSON outputs, upload MIDI backups, adjust key volumes, or connect directly to the ESP32 IP over local WebSockets to monitor system performance.
                  </p>
                </div>
                <div className="font-mono text-[10px] text-text-muted border-t border-border pt-4">
                  MODULE: web_app / app.js
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* INTERACTIVE DEMO VIEWPORTS PREVIEW (Minimal Interaction) */}
      <section id="architecture" className="max-w-6xl mx-auto px-4 md:px-8 py-20 space-y-8">
        <div className="text-center space-y-4 max-w-2xl mx-auto">
          <span className="font-mono text-xs text-accent uppercase tracking-wider block">02 // DSP Live Preview</span>
          <h2 className="font-serif text-4xl md:text-5xl font-bold">How the Assistant Operates</h2>
          <p className="text-text-muted text-sm leading-relaxed">
            Watch the simulated live waterfall stream notes. At the same time, inspect the raw telemetry packets generated by the ESP32 DSP core.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* WATERFALL SIMULATOR */}
          <div className="lg:col-span-7 border-2 border-foreground bg-surface rounded-[8px_32px_4px_32px] overflow-hidden shadow-[6px_6px_0px_0px_rgba(26,22,22,1)] flex flex-col h-[460px]">
            <div className="bg-surface-hover border-b border-foreground px-4 py-2 flex items-center justify-between font-mono text-xs">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-accent animate-pulse" />
                <span className="font-bold">LIVE WATERFALL // PREVIEW</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 border border-foreground bg-surface rounded-[2px]">AUTO PLAYING</span>
            </div>

            {/* Canvas-like waterfall container */}
            <div className="flex-1 bg-background-dark relative overflow-hidden p-4">
              {/* Guides */}
              <div className="absolute inset-0 flex justify-between pointer-events-none px-4">
                {[...Array(10)].map((_, i) => (
                  <div key={i} className="h-full border-r border-white/5 border-dashed" style={{ width: '10%' }} />
                ))}
              </div>

              {/* Falling Note blocks */}
              {fallingNotes.map((note) => (
                <div 
                  key={note.id}
                  className={`absolute w-8 rounded-full border border-black/40 transition-all duration-75 shadow-lg ${
                    note.color === 'crimson' ? 'bg-accent' : 'bg-accent-gold'
                  }`}
                  style={{
                    left: `${note.x}%`,
                    top: `${note.y}px`,
                    height: `${note.width}px`
                  }}
                />
              ))}

              {/* Key line boundary */}
              <div className="absolute bottom-12 left-0 right-0 border-t-2 border-dashed border-accent/40 pointer-events-none" />
            </div>

            {/* Virtual piano keys row */}
            <div className="h-16 bg-surface border-t border-foreground relative px-2 flex">
              {[...Array(12)].map((_, i) => {
                // Determine layout mapping
                const isBlack = [1, 3, 6, 8, 10].includes(i % 12);
                const activeColor = activeKeys[i];
                return (
                  <div 
                    key={i} 
                    className={`flex-1 border-r border-foreground relative transition-colors duration-fast ${
                      isBlack 
                        ? 'bg-foreground h-10 z-10 -mx-1.5' 
                        : 'bg-surface h-16'
                    } ${
                      activeColor 
                        ? activeColor === 'crimson' 
                          ? 'bg-accent text-white border-accent' 
                          : 'bg-accent-gold text-white border-accent-gold'
                        : ''
                    }`}
                  />
                );
              })}
            </div>
          </div>

          {/* TELEMETRY PACKET CONSOLE */}
          <div className="lg:col-span-5 border-2 border-foreground bg-background-dark text-text-dark rounded-[32px_8px_32px_4px] overflow-hidden shadow-[6px_6px_0px_0px_rgba(26,22,22,1)] flex flex-col h-[460px]">
            <div className="bg-surface-dark border-b border-border-dark px-4 py-2 flex items-center justify-between font-mono text-xs text-text-muted-dark">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-accent" />
                <span className="font-bold">ESP32 // TELEMETRY_STREAM</span>
              </div>
              <span className="text-[9px] text-accent animate-pulse font-mono">• RECEIVING</span>
            </div>

            <div ref={terminalContainerRef} className="flex-1 p-4 font-mono text-xs overflow-y-auto space-y-2.5 selection:bg-accent selection:text-white">
              {logs.map((log, index) => (
                <div key={index} className="leading-relaxed border-b border-border-dark/30 pb-1">
                  <span className="text-text-muted-dark text-[10px] block mb-0.5">[12:11:45.{String(index * 123).padStart(3, '0')}]</span>
                  <span className={
                    log.type === 'dsp' ? 'text-accent-gold-hover' :
                    log.type === 'espnow' ? 'text-accent' :
                    log.type === 'wifi' ? 'text-blue-400' : 'text-text-dark'
                  }>
                    {log.msg}
                  </span>
                </div>
              ))}
            </div>
            
            <div className="p-3 border-t border-border-dark bg-surface-dark/50 flex justify-between items-center text-[10px] font-mono text-text-muted-dark">
              <span>RX BUFFER: 128 bytes</span>
              <span>PACKETS: {logCounterRef.current}</span>
            </div>
          </div>
        </div>
      </section>

      {/* DETAILED TECH SCHEMATIC (Strict Tactile Typography) */}
      <section id="hardware" className="bg-background border-t-2 border-foreground py-20 relative">
        <div className="max-w-6xl mx-auto px-4 md:px-8">
          <div className="border border-foreground rounded-[8px_32px_8px_32px] overflow-hidden bg-surface shadow-[6px_6px_0px_0px_rgba(26,22,22,1)]">
            <div className="p-6 md:p-10 space-y-8">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b-2 border-dashed border-border">
                <div className="space-y-1">
                  <span className="font-mono text-xs text-accent-gold-hover uppercase block">SCHEMATIC DIAGRAM v1.2</span>
                  <h3 className="font-serif text-3xl font-bold">The Signal Processing Pipeline</h3>
                </div>
                <div className="flex gap-2">
                  <span className="font-mono text-[10px] px-2.5 py-1 border border-foreground bg-surface-hover rounded-[4px]">ESP32-S3 WROOM-1</span>
                  <span className="font-mono text-[10px] px-2.5 py-1 border border-foreground bg-surface-hover rounded-[4px]">ADC1_CH1</span>
                </div>
              </div>

              {/* Blueprint Grid Layout */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-mono text-xs">
                <div className="p-5 border border-foreground/30 bg-background/50 rounded-[12px_4px_4px_4px] space-y-4">
                  <div className="flex justify-between items-center pb-2 border-b border-border">
                    <span className="font-bold text-accent">01 / ANALOG SAMPLER</span>
                    <span className="text-[9px] text-text-muted">STAGE_0</span>
                  </div>
                  <ul className="space-y-2 text-text-muted">
                    <li>• Sample Rate: <b className="text-foreground">44100 Hz</b></li>
                    <li>• ADC Resolution: <b className="text-foreground">12-bit</b></li>
                    <li>• Channel: <b className="text-foreground">GPIO_NUM_1 (ADC1)</b></li>
                    <li>• Ring Buffer size: <b className="text-foreground">1024 bytes</b></li>
                  </ul>
                  <p className="text-[10px] leading-relaxed border-t border-dashed border-border pt-2 text-text-muted">
                    Captures raw acoustic waves off the piano soundboard via a piezo or direct condenser microphone.
                  </p>
                </div>

                <div className="p-5 border border-foreground/30 bg-background/50 rounded-[4px_12px_4px_4px] space-y-4">
                  <div className="flex justify-between items-center pb-2 border-b border-border">
                    <span className="font-bold text-accent-gold-hover">02 / DSP PITCH CORE</span>
                    <span className="text-[9px] text-text-muted">STAGE_1</span>
                  </div>
                  <ul className="space-y-2 text-text-muted">
                    <li>• FFT Window size: <b className="text-foreground">512 bins</b></li>
                    <li>• Envelope detection: <b className="text-foreground">Peak-to-Peak</b></li>
                    <li>• Attack Threshold: <b className="text-foreground">35 mV (Adjustable)</b></li>
                    <li>• Chord Capacity: <b className="text-foreground">Up to 10 peaks</b></li>
                  </ul>
                  <p className="text-[10px] leading-relaxed border-t border-dashed border-border pt-2 text-text-muted">
                    Transforms raw time-domain arrays into spectral frequency amplitudes, filtering noise on-the-fly.
                  </p>
                </div>

                <div className="p-5 border border-foreground/30 bg-background/50 rounded-[4px_4px_12px_4px] space-y-4">
                  <div className="flex justify-between items-center pb-2 border-b border-border">
                    <span className="font-bold text-accent">03 / ESP-NOW SYNC</span>
                    <span className="text-[9px] text-text-muted">STAGE_2</span>
                  </div>
                  <ul className="space-y-2 text-text-muted">
                    <li>• Connection: <b className="text-foreground">Connectionless MAC</b></li>
                    <li>• Transmission Speed: <b className="text-foreground">1 Mbps</b></li>
                    <li>• Payload format: <b className="text-foreground">Struct array</b></li>
                    <li>• Broadcast Latency: <b className="text-foreground">&lt; 2.5 ms</b></li>
                  </ul>
                  <p className="text-[10px] leading-relaxed border-t border-dashed border-border pt-2 text-text-muted">
                    Direct board-to-board wireless frames sent to light modules, bypassing local router congestion entirely.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CALL TO ACTION - GIT / GET STARTED */}
      <section id="get-started" className="max-w-6xl mx-auto px-4 md:px-8 py-20 relative">
        <div className="border-2 border-foreground bg-background-dark text-text-dark rounded-[16px_40px_16px_40px] p-8 md:p-12 relative overflow-hidden shadow-[8px_8px_0px_0px_rgba(26,22,22,1)]">
          <div className="absolute top-0 right-0 w-32 h-32 border-b border-l border-white/10 pointer-events-none" style={{
            backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,0.05) 10px, rgba(255,255,255,0.05) 20px)'
          }} />

          <div className="max-w-xl space-y-6 relative z-10">
            <span className="font-mono text-xs text-accent-gold uppercase tracking-wider block">// READY FOR COMPILATION</span>
            <h2 className="font-serif text-4xl md:text-5xl font-bold text-white leading-tight">
              Bring physical guidance to your keys.
            </h2>
            <p className="text-text-muted-dark leading-relaxed text-sm">
              The PPAP source files include complete KiCad PCB schematics, the ESP32-S3 C++ firmware, and the React client controllers. Clone the repository and begin assembling your DSP visualizer.
            </p>

            <div className="space-y-3">
              <label className="font-mono text-xs text-text-muted-dark block">CLONE REPOSITORY COMMAND</label>
              <div className="flex border border-white/20 bg-black/40 rounded-[6px_16px_6px_16px] overflow-hidden p-1.5 items-center justify-between">
                <code className="font-mono text-xs px-3 text-accent-gold overflow-x-auto whitespace-nowrap scrollbar-thin mr-2">
                  git clone https://github.com/NanoOpusGoonClawX/Podles-DSP-Piano.git
                </code>
                <button 
                  onClick={copyConfig}
                  className="px-4 py-2 bg-white text-black hover:bg-accent-gold transition-colors font-mono text-xs flex items-center gap-2 rounded-[4px_12px_4px_12px]"
                >
                  {copiedText ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-green-700" />
                      <span>COPIED</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>COPY</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 pt-2">
              <a 
                href="https://github.com/NanoOpusGoonClawX/Podles-DSP-Piano" 
                target="_blank" 
                rel="noreferrer"
                className="px-5 py-2.5 bg-white text-black font-mono text-xs rounded-[4px_12px_4px_12px] hover:bg-accent hover:text-white transition-all inline-flex items-center gap-2"
              >
                <Github className="w-4 h-4" /> View Github Repository
              </a>
              <a 
                href="#hardware" 
                className="px-5 py-2.5 border border-white/30 text-white font-mono text-xs rounded-[12px_4px_12px_4px] hover:border-white transition-all inline-flex items-center gap-2"
              >
                <HardDrive className="w-4 h-4" /> Read hardware.md doc
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t-2 border-foreground bg-surface py-12 mt-auto">
        <div className="max-w-6xl mx-auto px-4 md:px-8 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 border border-foreground bg-accent flex items-center justify-center rounded-[4px_10px_4px_8px]">
              <Music className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="font-serif text-base font-bold tracking-tight">PPAP</span>
              <span className="font-mono text-[8px] block text-text-muted uppercase">ESP32 Acoustic Piano Visualizer</span>
            </div>
          </div>

          <div className="text-center md:text-right font-mono text-[10px] text-text-muted space-y-1">
            <p>© {new Date().getFullYear()} NanoOpusGoonClawX. LICENSE: MIT.</p>
            <p>Designed with tactile layout components. No SaaS gradients.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
