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
