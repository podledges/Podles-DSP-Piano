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
