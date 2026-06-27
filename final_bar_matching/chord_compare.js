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
