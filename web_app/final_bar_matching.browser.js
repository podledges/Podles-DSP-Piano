// GENERATED FILE - DO NOT EDIT DIRECTLY
// Source: scripts/build_final_bar_matching_browser_bundle.js
(function(global) {
    "use strict";
    var modules = {
        0: {
            filename: "final_bar_matching/score_normalizer.js",
            deps: {"./score_preprocessor":1},
            factory: function(require, module, exports) {
                "use strict";
                
                const { parseScoreNotes, DEFAULT_GROUPING_TOLERANCE } = require("./score_preprocessor");
                
                const DEFAULT_DRAFT_EVENT_GROUPING_TOLERANCE = DEFAULT_GROUPING_TOLERANCE;
                
                function isObject(value) {
                    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
                }
                
                function isFiniteNumber(value) {
                    return typeof value === "number" && Number.isFinite(value);
                }
                
                function parseNoteNameToMidi(noteName) {
                    if (typeof noteName !== "string") {
                        return null;
                    }
                
                    const match = noteName.trim().match(/^([A-G])(#|b)?(-?\d+)$/i);
                    if (!match) {
                        return null;
                    }
                
                    const stepOffsets = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
                    const step = match[1].toUpperCase();
                    const accidental = match[2] || "";
                    const octave = Number.parseInt(match[3], 10);
                    let midi = (octave + 1) * 12 + stepOffsets[step];
                
                    if (accidental === "#") midi += 1;
                    if (accidental.toLowerCase() === "b") midi -= 1;
                
                    if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
                        return null;
                    }
                
                    return midi;
                }
                
                function normaliseMidiFromNote(note) {
                    if (!isObject(note)) {
                        return null;
                    }
                
                    if (Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127) {
                        return note.midi;
                    }
                
                    return parseNoteNameToMidi(note.note);
                }
                
                function makeGeneratedId(...parts) {
                    return parts.join("-");
                }
                
                function sourceCopy(value) {
                    return JSON.parse(JSON.stringify(value));
                }
                
                function normaliseNote(note, context, warnings) {
                    if (!isObject(note)) {
                        warnings.push(`${context.path} ignored: note must be an object`);
                        return null;
                    }
                
                    const midi = normaliseMidiFromNote(note);
                    if (midi === null) {
                        warnings.push(`${context.path} ignored: note requires valid midi or note name`);
                        return null;
                    }
                
                    return {
                        noteId: note.noteId ?? makeGeneratedId(context.eventId, "note", context.noteIndex + 1),
                        noteIndex: context.noteIndex,
                        midi,
                        note: note.note ?? null,
                        durSec: isFiniteNumber(note.dur) ? note.dur : isFiniteNumber(note.duration) ? note.duration : null,
                        hand: note.hand ?? null,
                        source: sourceCopy(note)
                    };
                }
                
                function normaliseExplicitEvent(event, context, warnings) {
                    if (!isObject(event)) {
                        warnings.push(`${context.path} ignored: event must be an object`);
                        return null;
                    }
                
                    const rawNotes = Array.isArray(event.notes) ? event.notes : [];
                    if (rawNotes.length === 0 && Array.isArray(event.midi)) {
                        const uniqueMidi = Array.from(new Set(event.midi.filter(Number.isInteger))).sort((a, b) => a - b);
                        rawNotes.push(...uniqueMidi.map((midi) => ({ midi })));
                    }
                
                    if (rawNotes.length === 0) {
                        warnings.push(`${context.path} ignored: event must contain notes or midi`);
                        return null;
                    }
                
                    const eventId = event.eventId ?? event.chordId ?? makeGeneratedId(context.barId, "event", context.eventIndex + 1);
                    const notes = rawNotes
                        .map((note, noteIndex) => normaliseNote(note, {
                            eventId,
                            noteIndex,
                            path: `${context.path}.notes[${noteIndex}]`
                        }, warnings))
                        .filter(Boolean);
                
                    if (notes.length === 0) {
                        warnings.push(`${context.path} ignored: event has no valid notes`);
                        return null;
                    }
                
                    const midi = Array.from(new Set(notes.map((note) => note.midi))).sort((a, b) => a - b);
                    const time = isFiniteNumber(event.time) ? event.time : isFiniteNumber(event.scoreTime) ? event.scoreTime : null;
                
                    return {
                        eventId,
                        eventIndex: context.eventIndex,
                        scoreTimeSec: time,
                        pageTimeSec: time,
                        midi,
                        notes,
                        source: sourceCopy(event)
                    };
                }
                
                function normaliseEventsFromIndividualNotes(notes, context, warnings, groupingTolerance) {
                    const convertedNotes = [];
                
                    notes.forEach((note, sourceIndex) => {
                        if (!isObject(note)) {
                            warnings.push(`${context.path}.notes[${sourceIndex}] ignored: note must be an object`);
                            return;
                        }
                
                        const midi = normaliseMidiFromNote(note);
                        if (midi === null) {
                            warnings.push(`${context.path}.notes[${sourceIndex}] ignored: note requires valid midi or note name`);
                            return;
                        }
                
                        convertedNotes.push({
                            ...note,
                            midi,
                            sourceIndex
                        });
                    });
                
                    const groupingTargetId = context.barId ?? context.pageId;
                    const generatedFrom = context.generatedFrom ?? "bar.notes";
                    const eventPrefix = context.eventPrefix ?? groupingTargetId;
                
                    const grouped = parseScoreNotes({ notes: convertedNotes }, {
                        groupingTolerance,
                        targetId: groupingTargetId
                    });
                
                    if (!grouped.ok) {
                        warnings.push(`${context.path} ignored: ${grouped.error}`);
                        warnings.push(...grouped.warnings);
                        return [];
                    }
                
                    warnings.push(...grouped.warnings);
                    return grouped.events.map((event, eventIndex) => {
                        const eventId = makeGeneratedId(eventPrefix, "event", eventIndex + 1);
                        const eventNotes = event.sourceNotes.map((sourceNote, noteIndex) => ({
                            noteId: makeGeneratedId(eventId, "note", noteIndex + 1),
                            noteIndex,
                            midi: sourceNote.midi,
                            note: sourceNote.note,
                            durSec: isFiniteNumber(sourceNote.dur) ? sourceNote.dur : null,
                            hand: sourceNote.hand,
                            originalTimeSec: isFiniteNumber(sourceNote.time) ? sourceNote.time : null,
                            source: sourceCopy(sourceNote)
                        }));
                
                        return {
                            eventId,
                            eventIndex,
                            scoreTimeSec: event.scoreTime,
                            pageTimeSec: event.scoreTime,
                            midi: event.midi,
                            notes: eventNotes,
                            source: {
                                generatedFrom,
                                sourceNotes: sourceCopy(event.sourceNotes)
                            }
                        };
                    });
                }
                
                function normaliseBar(bar, context, warnings, options) {
                    if (!isObject(bar)) {
                        warnings.push(`${context.path} ignored: bar must be an object`);
                        return null;
                    }
                
                    const barId = bar.barId ?? bar.measureId ?? makeGeneratedId(context.pageId, "bar", context.barIndex + 1);
                    const rawEvents = Array.isArray(bar.events) ? bar.events : Array.isArray(bar.chords) ? bar.chords : null;
                    let events = [];
                
                    if (rawEvents) {
                        events = rawEvents
                            .map((event, eventIndex) => normaliseExplicitEvent(event, {
                                barId,
                                eventIndex,
                                path: `${context.path}.${Array.isArray(bar.events) ? "events" : "chords"}[${eventIndex}]`
                            }, warnings))
                            .filter(Boolean);
                    } else if (Array.isArray(bar.notes)) {
                        events = normaliseEventsFromIndividualNotes(bar.notes, {
                            barId,
                            path: context.path
                        }, warnings, options.groupingTolerance);
                    } else {
                        warnings.push(`${context.path} ignored: bar must contain events, chords, or notes`);
                        return null;
                    }
                
                    if (events.length === 0) {
                        warnings.push(`${context.path} ignored: bar has no valid events`);
                        return null;
                    }
                
                    return {
                        barId,
                        barIndex: Number.isInteger(bar.barIndex) ? bar.barIndex : Number.isInteger(bar.measureIndex) ? bar.measureIndex : context.barIndex,
                        pageId: context.pageId,
                        pageIndex: context.pageIndex,
                        pageNumber: context.pageNumber,
                        startTimeSec: isFiniteNumber(bar.startTime) ? bar.startTime : null,
                        durationSec: isFiniteNumber(bar.duration) ? bar.duration : null,
                        events,
                        source: sourceCopy(bar)
                    };
                }
                
                function normalisePage(page, context, warnings, options) {
                    if (!isObject(page)) {
                        warnings.push(`pages[${context.pageIndex}] ignored: page must be an object`);
                        return null;
                    }
                
                    const pageIndex = Number.isInteger(page.pageIndex) ? page.pageIndex : context.pageIndex;
                    const pageNumber = Number.isInteger(page.pageNumber) ? page.pageNumber : pageIndex + 1;
                    const pageId = page.pageId ?? makeGeneratedId("page", pageNumber);
                    const durationSec = isFiniteNumber(page.duration) ? page.duration : null;
                
                    if (Array.isArray(page.notes)) {
                        const events = normaliseEventsFromIndividualNotes(page.notes, {
                            pageId,
                            eventPrefix: pageId,
                            generatedFrom: "page.notes",
                            path: `pages[${context.pageIndex}]`
                        }, warnings, options.groupingTolerance);
                
                        if (events.length === 0) {
                            warnings.push(`pages[${context.pageIndex}] ignored: page has no valid events`);
                            return null;
                        }
                
                        return {
                            pageId,
                            pageIndex,
                            pageNumber,
                            durationSec,
                            events,
                            source: sourceCopy(page)
                        };
                    }
                
                    if (!Array.isArray(page.bars) && !Array.isArray(page.measures)) {
                        warnings.push(`pages[${context.pageIndex}] ignored: page must contain bars, measures, or notes`);
                        return null;
                    }
                
                    const rawBars = Array.isArray(page.bars) ? page.bars : page.measures;
                    const bars = rawBars
                        .map((bar, barIndex) => normaliseBar(bar, {
                            pageId,
                            pageIndex,
                            pageNumber,
                            barIndex,
                            path: `pages[${context.pageIndex}].${Array.isArray(page.bars) ? "bars" : "measures"}[${barIndex}]`
                        }, warnings, options))
                        .filter(Boolean);
                
                    if (bars.length === 0) {
                        warnings.push(`pages[${context.pageIndex}] ignored: page has no valid bars`);
                        return null;
                    }
                
                    return {
                        pageId,
                        pageIndex,
                        pageNumber,
                        durationSec,
                        bars,
                        source: sourceCopy(page)
                    };
                }
                
                function normaliseDraftFullScore(input, options = {}) {
                    const groupingTolerance = options.groupingTolerance ?? DEFAULT_DRAFT_EVENT_GROUPING_TOLERANCE;
                    const warnings = [];
                
                    if (!isFiniteNumber(groupingTolerance) || groupingTolerance < 0) {
                        return {
                            ok: false,
                            error: "groupingTolerance must be a non-negative number",
                            score: null,
                            warnings
                        };
                    }
                
                    if (!isObject(input)) {
                        return {
                            ok: false,
                            error: "score input must be an object",
                            score: null,
                            warnings
                        };
                    }
                
                    if (!Array.isArray(input.pages)) {
                        return {
                            ok: false,
                            error: "draft score input must contain a pages array",
                            score: null,
                            warnings
                        };
                    }
                
                    const pages = input.pages
                        .map((page, pageIndex) => normalisePage(page, { pageIndex }, warnings, { groupingTolerance }))
                        .filter(Boolean);
                
                    if (pages.length === 0) {
                        return {
                            ok: false,
                            error: "score contains no valid pages",
                            score: null,
                            warnings
                        };
                    }
                
                    return {
                        ok: true,
                        error: null,
                        score: {
                            type: "normalized_full_score",
                            scoreId: input.scoreId ?? input.songTitle ?? "score-1",
                            title: input.title ?? input.songTitle ?? null,
                            pages,
                            totalPages: Number.isInteger(input.totalPages) ? input.totalPages : null,
                            sourceContract: input.songTitle || Number.isInteger(input.totalPages)
                                ? "confirmed_parser_pages_v1"
                                : "draft_full_score_v1"
                        },
                        warnings
                    };
                }
                
                const normalizeDraftFullScore = normaliseDraftFullScore;
                
                module.exports = {
                    DEFAULT_DRAFT_EVENT_GROUPING_TOLERANCE,
                    normaliseDraftFullScore,
                    normalizeDraftFullScore,
                    parseNoteNameToMidi
                };
                
            }
        },
        1: {
            filename: "final_bar_matching/score_preprocessor.js",
            deps: {},
            factory: function(require, module, exports) {
                "use strict";
                
                const DEFAULT_GROUPING_TOLERANCE = 0.03;
                
                function isFiniteNumber(value) {
                    return typeof value === "number" && Number.isFinite(value);
                }
                
                function normaliseMidi(value) {
                    if (!Number.isInteger(value)) {
                        return null;
                    }
                
                    if (value < 0 || value > 127) {
                        return null;
                    }
                
                    return value;
                }
                
                function parseScoreNotes(input, options = {}) {
                    const groupingTolerance = options.groupingTolerance ?? DEFAULT_GROUPING_TOLERANCE;
                    const targetId = options.targetId ?? "final-bar";
                
                    if (!isFiniteNumber(groupingTolerance) || groupingTolerance < 0) {
                        return {
                            ok: false,
                            error: "groupingTolerance must be a non-negative number",
                            targetId,
                            events: [],
                            warnings: []
                        };
                    }
                
                    const rawNotes = Array.isArray(input) ? input : input && Array.isArray(input.notes) ? input.notes : null;
                    if (!rawNotes) {
                        return {
                            ok: false,
                            error: "score input must be an array or an object with a notes array",
                            targetId,
                            events: [],
                            warnings: []
                        };
                    }
                
                    const warnings = [];
                    const validNotes = [];
                
                    rawNotes.forEach((note, sourceIndex) => {
                        if (!note || typeof note !== "object" || Array.isArray(note)) {
                            warnings.push(`notes[${sourceIndex}] ignored: note must be an object`);
                            return;
                        }
                
                        if (!isFiniteNumber(note.time)) {
                            warnings.push(`notes[${sourceIndex}] ignored: time must be a finite number`);
                            return;
                        }
                
                        const midi = normaliseMidi(note.midi);
                        if (midi === null) {
                            warnings.push(`notes[${sourceIndex}] ignored: midi must be an integer from 0 to 127`);
                            return;
                        }
                
                        validNotes.push({
                            time: note.time,
                            midi,
                            sourceIndex,
                            source: {
                                time: note.time,
                                midi,
                                note: note.note ?? null,
                                dur: note.dur ?? null,
                                hand: note.hand ?? null
                            }
                        });
                    });
                
                    if (validNotes.length === 0) {
                        return {
                            ok: false,
                            error: "score contains no valid notes",
                            targetId,
                            events: [],
                            warnings
                        };
                    }
                
                    const sortedNotes = validNotes.slice().sort((a, b) => {
                        if (a.time !== b.time) return a.time - b.time;
                        if (a.midi !== b.midi) return a.midi - b.midi;
                        return a.sourceIndex - b.sourceIndex;
                    });
                
                    const groups = [];
                    sortedNotes.forEach((note) => {
                        const lastGroup = groups[groups.length - 1];
                        if (!lastGroup || Math.abs(note.time - lastGroup.anchorTime) > groupingTolerance) {
                            groups.push({
                                anchorTime: note.time,
                                notes: [note]
                            });
                            return;
                        }
                
                        lastGroup.notes.push(note);
                    });
                
                    const events = groups.map((group, eventIndex) => {
                        const midiValues = Array.from(new Set(group.notes.map((note) => note.midi))).sort((a, b) => a - b);
                        const times = group.notes.map((note) => note.time);
                
                        return {
                            type: "expected_chord_event",
                            targetId,
                            eventIndex,
                            scoreTime: Math.min(...times),
                            anchorTime: group.anchorTime,
                            midi: midiValues,
                            sourceNotes: group.notes.map((note) => note.source)
                        };
                    });
                
                    return {
                        ok: true,
                        error: null,
                        targetId,
                        events,
                        warnings
                    };
                }
                
                module.exports = {
                    DEFAULT_GROUPING_TOLERANCE,
                    parseScoreNotes
                };
                
            }
        },
        2: {
            filename: "final_bar_matching/frequency_score_pipeline.js",
            deps: {"./frequency_event_adapter":3,"./full_score_progress_tracker":5},
            factory: function(require, module, exports) {
                "use strict";
                
                const { normaliseFrequencyEvent, EXPECTED_PACKET_TYPE } = require("./frequency_event_adapter");
                const { createFullScoreProgressTracker } = require("./full_score_progress_tracker");
                
                function toObservedMidiChordEvent(adapterEvent) {
                    return {
                        type: "observed_chord_event",
                        eventId: adapterEvent.eventId,
                        timestampMs: adapterEvent.timestampMs,
                        midi: adapterEvent.notes.map((note) => note.midi),
                        sourceType: adapterEvent.sourceType,
                        sourceNotes: adapterEvent.notes
                    };
                }
                
                class FrequencyScorePipeline {
                    constructor(normalizedScore, options = {}) {
                        this.adapterOptions = options.adapterOptions ?? {};
                        this.trackerOptions = options.trackerOptions ?? {};
                        this.tracker = createFullScoreProgressTracker(normalizedScore, this.trackerOptions);
                    }
                
                    reset() {
                        return this.tracker.reset();
                    }
                
                    acceptFrequencyEvent(packet) {
                        const adapterResult = normaliseFrequencyEvent(packet, this.adapterOptions);
                        if (!adapterResult.ok) {
                            return {
                                ok: false,
                                inputType: packet && packet.type ? packet.type : EXPECTED_PACKET_TYPE,
                                error: adapterResult.error,
                                observedEvent: null,
                                trackerResult: null,
                                warnings: adapterResult.warnings
                            };
                        }
                
                        const observedEvent = toObservedMidiChordEvent(adapterResult.event);
                        const trackerResult = this.tracker.acceptObservedEvent(observedEvent);
                
                        return {
                            ok: true,
                            inputType: EXPECTED_PACKET_TYPE,
                            observedEvent: {
                                eventId: observedEvent.eventId,
                                timestampMs: observedEvent.timestampMs,
                                midi: observedEvent.midi
                            },
                            trackerResult,
                            warnings: adapterResult.warnings
                        };
                    }
                }
                
                function createFrequencyScorePipeline(normalizedScore, options = {}) {
                    return new FrequencyScorePipeline(normalizedScore, options);
                }
                
                module.exports = {
                    FrequencyScorePipeline,
                    createFrequencyScorePipeline,
                    toObservedMidiChordEvent
                };
                
            }
        },
        3: {
            filename: "final_bar_matching/frequency_event_adapter.js",
            deps: {"./frequency_to_midi":4},
            factory: function(require, module, exports) {
                "use strict";
                
                const { frequencyHzToMidiDetails } = require("./frequency_to_midi");
                
                const EXPECTED_PACKET_TYPE = "frequency_event";
                
                function isFiniteNumber(value) {
                    return typeof value === "number" && Number.isFinite(value);
                }
                
                function validatePacketShell(packet) {
                    if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
                        return "packet must be an object";
                    }
                
                    if (packet.type !== EXPECTED_PACKET_TYPE) {
                        return `packet type must be ${EXPECTED_PACKET_TYPE}`;
                    }
                
                    if (!Number.isInteger(packet.eventId)) {
                        return "eventId must be an integer";
                    }
                
                    if (!isFiniteNumber(packet.timestampMs) || packet.timestampMs < 0) {
                        return "timestampMs must be a non-negative number";
                    }
                
                    if (!Array.isArray(packet.peaks)) {
                        return "peaks must be an array";
                    }
                
                    if (packet.peaks.length === 0) {
                        return "peaks must not be empty";
                    }
                
                    return null;
                }
                
                function normaliseFrequencyEvent(packet, options = {}) {
                    const shellError = validatePacketShell(packet);
                    if (shellError) {
                        return {
                            ok: false,
                            error: shellError,
                            event: null,
                            warnings: []
                        };
                    }
                
                    const warnings = [];
                    const notesByMidi = new Map();
                
                    packet.peaks.forEach((peak, index) => {
                        if (!peak || typeof peak !== "object" || Array.isArray(peak)) {
                            warnings.push(`peaks[${index}] ignored: peak must be an object`);
                            return;
                        }
                
                        if (!isFiniteNumber(peak.frequencyHz) || peak.frequencyHz <= 0) {
                            warnings.push(`peaks[${index}] ignored: frequencyHz must be a positive number`);
                            return;
                        }
                
                        if (!isFiniteNumber(peak.magnitude) || peak.magnitude <= 0) {
                            warnings.push(`peaks[${index}] ignored: magnitude must be a positive number`);
                            return;
                        }
                
                        const details = frequencyHzToMidiDetails(peak.frequencyHz, options);
                        if (!details) {
                            warnings.push(`peaks[${index}] ignored: frequencyHz is outside supported MIDI range`);
                            return;
                        }
                
                        const existing = notesByMidi.get(details.midi);
                        const note = {
                            midi: details.midi,
                            frequencyHz: peak.frequencyHz,
                            magnitude: peak.magnitude,
                            centsFromNearest: details.centsFromNearest
                        };
                
                        if (!existing || note.magnitude > existing.magnitude) {
                            notesByMidi.set(details.midi, note);
                        }
                    });
                
                    const notes = Array.from(notesByMidi.values()).sort((a, b) => a.midi - b.midi);
                
                    if (notes.length === 0) {
                        return {
                            ok: false,
                            error: "packet contains no valid frequency peaks",
                            event: null,
                            warnings
                        };
                    }
                
                    return {
                        ok: true,
                        error: null,
                        event: {
                            type: "observed_chord_event",
                            sourceType: EXPECTED_PACKET_TYPE,
                            eventId: packet.eventId,
                            timestampMs: packet.timestampMs,
                            notes
                        },
                        warnings
                    };
                }
                
                const normalizeFrequencyEvent = normaliseFrequencyEvent;
                
                module.exports = {
                    EXPECTED_PACKET_TYPE,
                    normaliseFrequencyEvent,
                    normalizeFrequencyEvent
                };
                
            }
        },
        4: {
            filename: "final_bar_matching/frequency_to_midi.js",
            deps: {},
            factory: function(require, module, exports) {
                "use strict";
                
                const A4_FREQUENCY_HZ = 440;
                const A4_MIDI = 69;
                const DEFAULT_MIN_MIDI = 21;
                const DEFAULT_MAX_MIDI = 108;
                
                function isFinitePositiveNumber(value) {
                    return typeof value === "number" && Number.isFinite(value) && value > 0;
                }
                
                function frequencyHzToMidiFloat(frequencyHz) {
                    if (!isFinitePositiveNumber(frequencyHz)) {
                        return null;
                    }
                
                    return A4_MIDI + (12 * Math.log2(frequencyHz / A4_FREQUENCY_HZ));
                }
                
                function frequencyHzToMidi(frequencyHz, options = {}) {
                    const midiFloat = frequencyHzToMidiFloat(frequencyHz);
                    if (midiFloat === null) {
                        return null;
                    }
                
                    const minMidi = options.minMidi ?? DEFAULT_MIN_MIDI;
                    const maxMidi = options.maxMidi ?? DEFAULT_MAX_MIDI;
                    const midi = Math.round(midiFloat);
                
                    if (midi < minMidi || midi > maxMidi) {
                        return null;
                    }
                
                    return midi;
                }
                
                function frequencyHzToMidiDetails(frequencyHz, options = {}) {
                    const midiFloat = frequencyHzToMidiFloat(frequencyHz);
                    if (midiFloat === null) {
                        return null;
                    }
                
                    const minMidi = options.minMidi ?? DEFAULT_MIN_MIDI;
                    const maxMidi = options.maxMidi ?? DEFAULT_MAX_MIDI;
                    const midi = Math.round(midiFloat);
                
                    if (midi < minMidi || midi > maxMidi) {
                        return null;
                    }
                
                    return {
                        midi,
                        midiFloat,
                        centsFromNearest: (midiFloat - midi) * 100,
                        frequencyHz
                    };
                }
                
                module.exports = {
                    A4_FREQUENCY_HZ,
                    A4_MIDI,
                    DEFAULT_MIN_MIDI,
                    DEFAULT_MAX_MIDI,
                    frequencyHzToMidiFloat,
                    frequencyHzToMidi,
                    frequencyHzToMidiDetails
                };
                
            }
        },
        5: {
            filename: "final_bar_matching/full_score_progress_tracker.js",
            deps: {"./chord_compare":6},
            factory: function(require, module, exports) {
                "use strict";
                
                const { compareChordSets, DEFAULT_CHORD_SIMILARITY_THRESHOLD, normaliseMidiSet } = require("./chord_compare");
                
                const DEFAULT_MAX_TIMESTAMP_GAP_MS = 5000;
                const DEFAULT_MAX_CONSECUTIVE_UNRELATED = 1;
                const DEFAULT_MAX_BACKWARD_EVENTS = 2;
                
                function isObject(value) {
                    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
                }
                
                function isFiniteNumber(value) {
                    return typeof value === "number" && Number.isFinite(value);
                }
                
                function normaliseObservedEvent(event) {
                    if (!isObject(event)) {
                        return null;
                    }
                
                    if (!isFiniteNumber(event.timestampMs) || event.timestampMs < 0) {
                        return null;
                    }
                
                    const eventId = event.eventId ?? null;
                    if (eventId !== null && eventId !== undefined && !["string", "number"].includes(typeof eventId)) {
                        return null;
                    }
                
                    let midi = [];
                    if (Array.isArray(event.midi)) {
                        midi = event.midi;
                    } else if (Array.isArray(event.notes)) {
                        midi = event.notes.map((note) => {
                            if (Number.isInteger(note)) return note;
                            if (note && Number.isInteger(note.midi)) return note.midi;
                            return null;
                        });
                    }
                
                    const normalisedMidi = normaliseMidiSet(midi);
                    if (normalisedMidi.length === 0) {
                        return null;
                    }
                
                    return {
                        eventId,
                        timestampMs: event.timestampMs,
                        midi: normalisedMidi,
                        source: event
                    };
                }
                
                function flattenScore(score) {
                    const flatEvents = [];
                    const pageTotals = [];
                    const barTotals = new Map();
                
                    score.pages.forEach((page, pagePosition) => {
                        let pageEventCount = 0;
                        if (Array.isArray(page.bars) && page.bars.length > 0) {
                            page.bars.forEach((bar, barPosition) => {
                                bar.events.forEach((event, eventPosition) => {
                                    flatEvents.push({
                                        absoluteIndex: flatEvents.length,
                                        pagePosition,
                                        barPosition,
                                        eventPosition,
                                        page,
                                        bar,
                                        event
                                    });
                                    pageEventCount += 1;
                                });
                                barTotals.set(bar.barId, bar.events.length);
                            });
                        } else if (Array.isArray(page.events) && page.events.length > 0) {
                            page.events.forEach((event, eventPosition) => {
                                flatEvents.push({
                                    absoluteIndex: flatEvents.length,
                                    pagePosition,
                                    barPosition: null,
                                    eventPosition,
                                    page,
                                    bar: null,
                                    event
                                });
                                pageEventCount += 1;
                            });
                        }
                        pageTotals[pagePosition] = pageEventCount;
                    });
                
                    return { flatEvents, pageTotals, barTotals };
                }
                
                function validateScore(score) {
                    if (!isObject(score) || score.type !== "normalized_full_score" || !Array.isArray(score.pages)) {
                        return "score must be a normalized_full_score object with pages";
                    }
                
                    for (const page of score.pages) {
                        if (!isObject(page)) {
                            return "each page must be an object";
                        }
                
                        const hasBars = Array.isArray(page.bars) && page.bars.length > 0;
                        const hasPageEvents = Array.isArray(page.events) && page.events.length > 0;
                        if (!hasBars && !hasPageEvents) {
                            return "each page must contain bars or page-level events";
                        }
                
                        if (hasBars) {
                            for (const bar of page.bars) {
                                if (!isObject(bar) || !Array.isArray(bar.events) || bar.events.length === 0) {
                                    return "each bar must contain events";
                                }
                
                                for (const event of bar.events) {
                                    if (!isObject(event) || normaliseMidiSet(event.midi).length === 0) {
                                        return "each event must contain at least one MIDI note";
                                    }
                                }
                            }
                        }
                
                        if (hasPageEvents) {
                            for (const event of page.events) {
                                if (!isObject(event) || normaliseMidiSet(event.midi).length === 0) {
                                    return "each event must contain at least one MIDI note";
                                }
                            }
                        }
                    }
                
                    return null;
                }
                
                class FullScoreProgressTracker {
                    constructor(normalizedScore, options = {}) {
                        const error = validateScore(normalizedScore);
                        if (error) {
                            throw new Error(error);
                        }
                
                        this.score = normalizedScore;
                        this.config = {
                            chordSimilarityThreshold: options.chordSimilarityThreshold ?? DEFAULT_CHORD_SIMILARITY_THRESHOLD,
                            maxTimestampGapMs: options.maxTimestampGapMs ?? DEFAULT_MAX_TIMESTAMP_GAP_MS,
                            maxConsecutiveUnrelated: options.maxConsecutiveUnrelated ?? DEFAULT_MAX_CONSECUTIVE_UNRELATED,
                            maxBackwardEvents: options.maxBackwardEvents ?? DEFAULT_MAX_BACKWARD_EVENTS
                        };
                
                        const flattened = flattenScore(normalizedScore);
                        this.flatEvents = flattened.flatEvents;
                        this.pageTotals = flattened.pageTotals;
                        this.barTotals = flattened.barTotals;
                        this.reset();
                    }
                
                    reset() {
                        this.nextEventIndex = 0;
                        this.completedEvents = 0;
                        this.seenObservedEventIds = new Set();
                        this.completedPageIds = new Set();
                        this.completedBarIds = new Set();
                        this.emittedPageEndIds = new Set();
                        this.emittedBarIds = new Set();
                        this.scoreCompleted = false;
                        this.scoreCompletionEmitted = false;
                        this.lastAcceptedTimestampMs = null;
                        this.consecutiveUnrelated = 0;
                        this.matchedSimilarities = [];
                        return this.getProgress("reset");
                    }
                
                    getCurrentFlatEvent() {
                        return this.flatEvents[Math.min(this.nextEventIndex, this.flatEvents.length - 1)];
                    }
                
                    getProgress(reason = "status", extra = {}) {
                        const current = this.getCurrentFlatEvent();
                        const pageCompletedEvents = this.flatEvents
                            .slice(0, this.nextEventIndex)
                            .filter((item) => item.page.pageId === current.page.pageId).length;
                        const pageTotal = this.pageTotals[current.pagePosition] || 1;
                
                        return {
                            type: "SCORE_PROGRESS",
                            scoreId: this.score.scoreId,
                            reason,
                            currentPageIndex: current.page.pageIndex,
                            currentPageId: current.page.pageId,
                            currentBarIndex: current.bar ? current.bar.barIndex : null,
                            currentBarId: current.bar ? current.bar.barId : null,
                            currentExpectedEventIndex: current.event.eventIndex,
                            currentExpectedEventId: current.event.eventId,
                            completedEvents: this.completedEvents,
                            totalEvents: this.flatEvents.length,
                            pageProgress: Math.max(0, Math.min(1, pageCompletedEvents / pageTotal)),
                            overallScoreProgress: Math.max(0, Math.min(1, this.completedEvents / this.flatEvents.length)),
                            confidence: this.calculateConfidence(),
                            lastAcceptedTimestampMs: this.lastAcceptedTimestampMs,
                            duplicateObservedEventIds: Array.from(this.seenObservedEventIds),
                            completedPages: Array.from(this.completedPageIds),
                            scoreCompleted: this.scoreCompleted,
                            ...extra
                        };
                    }
                
                    calculateConfidence() {
                        if (this.flatEvents.length === 0) return 0;
                        const progressRatio = this.completedEvents / this.flatEvents.length;
                        if (this.matchedSimilarities.length === 0) return progressRatio;
                
                        const avgSimilarity = this.matchedSimilarities.reduce((sum, value) => sum + value, 0) / this.matchedSimilarities.length;
                        return Math.max(0, Math.min(1, (progressRatio * 0.7) + (avgSimilarity * 0.3)));
                    }
                
                    resetProgress(reason) {
                        this.nextEventIndex = 0;
                        this.completedEvents = 0;
                        this.completedPageIds.clear();
                        this.completedBarIds.clear();
                        this.emittedPageEndIds.clear();
                        this.emittedBarIds.clear();
                        this.scoreCompleted = false;
                        this.scoreCompletionEmitted = false;
                        this.lastAcceptedTimestampMs = null;
                        this.consecutiveUnrelated = 0;
                        this.matchedSimilarities = [];
                        return this.getProgress(reason);
                    }
                
                    acceptObservedEvent(observedInput) {
                        const observed = normaliseObservedEvent(observedInput);
                        if (!observed) {
                            return this.getProgress("invalid_observed_event", {
                                accepted: false,
                                comparison: null
                            });
                        }
                
                        if (observed.eventId !== null && this.seenObservedEventIds.has(observed.eventId)) {
                            return this.getProgress("duplicate_event_id", {
                                accepted: false,
                                duplicate: true,
                                timestampMs: observed.timestampMs,
                                comparison: null
                            });
                        }
                
                        if (observed.eventId !== null) {
                            this.seenObservedEventIds.add(observed.eventId);
                        }
                
                        if (this.scoreCompleted) {
                            return this.getProgress("already_completed", {
                                accepted: false,
                                timestampMs: observed.timestampMs,
                                comparison: null
                            });
                        }
                
                        if (
                            this.lastAcceptedTimestampMs !== null &&
                            observed.timestampMs - this.lastAcceptedTimestampMs > this.config.maxTimestampGapMs
                        ) {
                            return this.resetProgress("timestamp_gap");
                        }
                
                        const match = this.findBestMatch(observed);
                        if (match) {
                            return this.acceptMatch(match, observed);
                        }
                
                        this.consecutiveUnrelated += 1;
                        if (this.consecutiveUnrelated > this.config.maxConsecutiveUnrelated) {
                            return this.resetProgress("too_many_unrelated_events");
                        }
                
                        return this.getProgress("unrelated_event", {
                            accepted: false,
                            timestampMs: observed.timestampMs,
                            comparison: compareChordSets(this.flatEvents[this.nextEventIndex].event, observed, {
                                threshold: this.config.chordSimilarityThreshold
                            })
                        });
                    }
                
                    findBestMatch(observed) {
                        const candidates = [];
                
                        candidates.push({
                            kind: "next",
                            index: this.nextEventIndex,
                            priority: 0
                        });
                
                        const currentBarStart = this.findCurrentBarStartIndex();
                        if (currentBarStart !== null && this.nextEventIndex > currentBarStart) {
                            candidates.push({
                                kind: "current_bar_restart",
                                index: currentBarStart,
                                priority: 1
                            });
                        }
                
                        const currentPageStart = this.findCurrentPageStartIndex();
                        if (this.nextEventIndex > currentPageStart) {
                            candidates.push({
                                kind: "current_page_restart",
                                index: currentPageStart,
                                priority: 2
                            });
                        }
                
                        for (let offset = 1; offset <= this.config.maxBackwardEvents; offset += 1) {
                            const index = this.nextEventIndex - offset;
                            if (index >= currentPageStart && index >= 0) {
                                candidates.push({
                                    kind: "limited_backward_recovery",
                                    index,
                                    priority: 3 + offset
                                });
                            }
                        }
                
                        return candidates
                            .filter((candidate) => candidate.index >= 0 && candidate.index < this.flatEvents.length)
                            .map((candidate) => {
                                const comparison = compareChordSets(this.flatEvents[candidate.index].event, observed, {
                                    threshold: this.config.chordSimilarityThreshold
                                });
                                return { ...candidate, comparison };
                            })
                            .filter((candidate) => candidate.comparison.passed)
                            .sort((a, b) => a.priority - b.priority || b.comparison.similarity - a.comparison.similarity)[0] ?? null;
                    }
                
                    acceptMatch(match, observed) {
                        const previousIndex = this.nextEventIndex;
                        const matchedFlat = this.flatEvents[match.index];
                
                        this.nextEventIndex = match.index + 1;
                        this.completedEvents = this.nextEventIndex;
                        this.lastAcceptedTimestampMs = observed.timestampMs;
                        this.consecutiveUnrelated = 0;
                        this.matchedSimilarities.push(match.comparison.similarity);
                
                        const events = [];
                        const progress = this.getProgress(match.kind, {
                            accepted: true,
                            timestampMs: observed.timestampMs,
                            comparison: match.comparison,
                            matchedExpectedEventId: matchedFlat.event.eventId,
                            recovery: match.kind !== "next"
                        });
                        events.push(progress);
                
                        const boundaryEvents = this.collectBoundaryEvents(previousIndex, this.nextEventIndex, observed.timestampMs);
                        events.push(...boundaryEvents);
                
                        return events.length === 1 ? progress : {
                            type: "TRACKER_EVENTS",
                            events,
                            latest: events[events.length - 1],
                            progress: this.getProgress("boundary_events_emitted")
                        };
                    }
                
                    collectBoundaryEvents(previousIndex, nextIndex, timestampMs) {
                        const events = [];
                        const completedRange = this.flatEvents.slice(previousIndex, nextIndex);
                
                        completedRange.forEach((item) => {
                            if (item.bar) {
                                const isBarComplete = this.nextEventIndex >= this.findBarEndIndex(item.bar.barId);
                                if (isBarComplete && !this.emittedBarIds.has(item.bar.barId)) {
                                    this.emittedBarIds.add(item.bar.barId);
                                    this.completedBarIds.add(item.bar.barId);
                                    events.push({
                                        type: "BAR_COMPLETED",
                                        scoreId: this.score.scoreId,
                                        pageIndex: item.page.pageIndex,
                                        pageId: item.page.pageId,
                                        barIndex: item.bar.barIndex,
                                        barId: item.bar.barId,
                                        completedEvents: this.completedEvents,
                                        totalEvents: this.flatEvents.length,
                                        confidence: this.calculateConfidence(),
                                        timestampMs
                                    });
                                }
                            }
                
                            const isPageComplete = this.nextEventIndex >= this.findPageEndIndex(item.page.pageId);
                            const isFinalPage = item.pagePosition === this.score.pages.length - 1;
                            if (isPageComplete && !isFinalPage && !this.emittedPageEndIds.has(item.page.pageId)) {
                                this.emittedPageEndIds.add(item.page.pageId);
                                this.completedPageIds.add(item.page.pageId);
                                events.push({
                                    type: "PAGE_END_REACHED",
                                    scoreId: this.score.scoreId,
                                    pageIndex: item.page.pageIndex,
                                    pageId: item.page.pageId,
                                    completedEvents: this.completedEvents,
                                    totalEvents: this.flatEvents.length,
                                    confidence: this.calculateConfidence(),
                                    timestampMs
                                });
                            }
                
                            if (isPageComplete && isFinalPage) {
                                this.completedPageIds.add(item.page.pageId);
                            }
                        });
                
                        if (this.nextEventIndex >= this.flatEvents.length && !this.scoreCompletionEmitted) {
                            this.scoreCompleted = true;
                            this.scoreCompletionEmitted = true;
                            events.push({
                                type: "SCORE_COMPLETED",
                                scoreId: this.score.scoreId,
                                completedEvents: this.completedEvents,
                                totalEvents: this.flatEvents.length,
                                confidence: this.calculateConfidence(),
                                timestampMs
                            });
                        }
                
                        return events;
                    }
                
                    findCurrentBarStartIndex() {
                        const current = this.flatEvents[Math.min(this.nextEventIndex, this.flatEvents.length - 1)];
                        if (!current.bar) {
                            return null;
                        }
                        return this.flatEvents.findIndex((item) => item.bar.barId === current.bar.barId);
                    }
                
                    findCurrentPageStartIndex() {
                        const current = this.flatEvents[Math.min(this.nextEventIndex, this.flatEvents.length - 1)];
                        return this.flatEvents.findIndex((item) => item.page.pageId === current.page.pageId);
                    }
                
                    findBarEndIndex(barId) {
                        let lastIndex = -1;
                        this.flatEvents.forEach((item, index) => {
                            if (item.bar && item.bar.barId === barId) {
                                lastIndex = index;
                            }
                        });
                        return lastIndex + 1;
                    }
                
                    findPageEndIndex(pageId) {
                        let lastIndex = -1;
                        this.flatEvents.forEach((item, index) => {
                            if (item.page.pageId === pageId) {
                                lastIndex = index;
                            }
                        });
                        return lastIndex + 1;
                    }
                }
                
                function createFullScoreProgressTracker(normalizedScore, options = {}) {
                    return new FullScoreProgressTracker(normalizedScore, options);
                }
                
                module.exports = {
                    DEFAULT_MAX_TIMESTAMP_GAP_MS,
                    DEFAULT_MAX_CONSECUTIVE_UNRELATED,
                    DEFAULT_MAX_BACKWARD_EVENTS,
                    FullScoreProgressTracker,
                    createFullScoreProgressTracker,
                    normaliseObservedEvent
                };
                
            }
        },
        6: {
            filename: "final_bar_matching/chord_compare.js",
            deps: {},
            factory: function(require, module, exports) {
                "use strict";
                
                const DEFAULT_CHORD_SIMILARITY_THRESHOLD = 0.67;
                
                function normaliseMidiSet(notes) {
                    if (!Array.isArray(notes)) {
                        return [];
                    }
                
                    return Array.from(new Set(notes.filter(Number.isInteger).filter((midi) => midi >= 0 && midi <= 127))).sort((a, b) => a - b);
                }
                
                function extractMidiArray(value) {
                    if (Array.isArray(value)) {
                        return value;
                    }
                
                    if (value && Array.isArray(value.midi)) {
                        return value.midi;
                    }
                
                    if (value && Array.isArray(value.notes)) {
                        return value.notes.map((note) => {
                            if (Number.isInteger(note)) return note;
                            if (note && Number.isInteger(note.midi)) return note.midi;
                            return null;
                        });
                    }
                
                    return [];
                }
                
                function compareChordSets(expectedInput, observedInput, options = {}) {
                    const threshold = options.threshold ?? DEFAULT_CHORD_SIMILARITY_THRESHOLD;
                    const expectedNotes = normaliseMidiSet(extractMidiArray(expectedInput));
                    const observedNotes = normaliseMidiSet(extractMidiArray(observedInput));
                
                    const observedSet = new Set(observedNotes);
                    const expectedSet = new Set(expectedNotes);
                    const matchedNotes = expectedNotes.filter((midi) => observedSet.has(midi));
                    const missingExpectedNotes = expectedNotes.filter((midi) => !observedSet.has(midi));
                    const extraObservedNotes = observedNotes.filter((midi) => !expectedSet.has(midi));
                
                    let similarity = 0;
                    if (expectedNotes.length === 0 && observedNotes.length === 0) {
                        similarity = 1;
                    } else if (expectedNotes.length > 0 || observedNotes.length > 0) {
                        const unionSize = new Set([...expectedNotes, ...observedNotes]).size;
                        similarity = unionSize === 0 ? 0 : matchedNotes.length / unionSize;
                    }
                
                    return {
                        similarity,
                        passed: similarity >= threshold && expectedNotes.length > 0,
                        threshold,
                        matchedNotes,
                        missingExpectedNotes,
                        extraObservedNotes,
                        expectedNotes,
                        observedNotes
                    };
                }
                
                module.exports = {
                    DEFAULT_CHORD_SIMILARITY_THRESHOLD,
                    compareChordSets,
                    normaliseMidiSet
                };
                
            }
        }
    };
    var cache = {};
    function localRequire(id) {
        if (cache[id]) return cache[id].exports;
        if (!modules[id]) throw new Error("Module not found in FinalBarMatching bundle: " + id);
        var module = { exports: {} };
        cache[id] = module;
        function requireFromModule(request) {
            var dependencyId = modules[id].deps[request];
            if (dependencyId === undefined) throw new Error("Dependency not found: " + request + " from " + modules[id].filename);
            return localRequire(dependencyId);
        }
        modules[id].factory(requireFromModule, module, module.exports);
        return module.exports;
    }
    var publicEntries = {"chordCompare":6,"frequencyEventAdapter":3,"frequencyScorePipeline":2,"frequencyToMidi":4,"fullScoreProgressTracker":5,"scoreNormalizer":0};
    var api = {};
    Object.keys(publicEntries).forEach(function(name) {
        var exports = localRequire(publicEntries[name]);
        Object.keys(exports).forEach(function(exportName) {
            api[exportName] = exports[exportName];
        });
    });
    api.__bundleInfo = Object.freeze({
        generated: true,
        moduleCount: 7,
        source: "final_bar_matching"
    });
    global.FinalBarMatching = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
