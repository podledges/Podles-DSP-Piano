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
