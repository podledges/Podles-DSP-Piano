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

    const grouped = parseScoreNotes({ notes: convertedNotes }, {
        groupingTolerance,
        targetId: context.barId
    });

    if (!grouped.ok) {
        warnings.push(`${context.path} ignored: ${grouped.error}`);
        warnings.push(...grouped.warnings);
        return [];
    }

    warnings.push(...grouped.warnings);
    return grouped.events.map((event, eventIndex) => {
        const eventId = makeGeneratedId(context.barId, "event", eventIndex + 1);
        const eventNotes = event.sourceNotes.map((sourceNote, noteIndex) => ({
            noteId: makeGeneratedId(eventId, "note", noteIndex + 1),
            noteIndex,
            midi: sourceNote.midi,
            note: sourceNote.note,
            durSec: isFiniteNumber(sourceNote.dur) ? sourceNote.dur : null,
            hand: sourceNote.hand,
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
                generatedFrom: "bar.notes",
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

    if (!Array.isArray(page.bars) && !Array.isArray(page.measures)) {
        warnings.push(`pages[${context.pageIndex}] ignored: page must contain bars or measures`);
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
        durationSec: isFiniteNumber(page.duration) ? page.duration : null,
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
            scoreId: input.scoreId ?? "score-1",
            title: input.title ?? null,
            pages,
            sourceContract: "draft_full_score_v1"
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
