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
