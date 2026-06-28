"use strict";

const { compareChordSets, DEFAULT_CHORD_SIMILARITY_THRESHOLD, normaliseMidiSet } = require("./chord_compare");
const { parseScoreNotes, DEFAULT_GROUPING_TOLERANCE } = require("./score_preprocessor");

const DEFAULT_MAX_TIMESTAMP_GAP_MS = 5000;
const DEFAULT_MAX_CONSECUTIVE_UNRELATED = 1;

function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}

function normaliseObservedEvent(event) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
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

class FinalBarMatcher {
    constructor(scoreInput, options = {}) {
        this.targetId = options.targetId ?? "final-bar";
        this.config = {
            groupingTolerance: options.groupingTolerance ?? DEFAULT_GROUPING_TOLERANCE,
            chordSimilarityThreshold: options.chordSimilarityThreshold ?? DEFAULT_CHORD_SIMILARITY_THRESHOLD,
            maxTimestampGapMs: options.maxTimestampGapMs ?? DEFAULT_MAX_TIMESTAMP_GAP_MS,
            maxConsecutiveUnrelated: options.maxConsecutiveUnrelated ?? DEFAULT_MAX_CONSECUTIVE_UNRELATED
        };

        const preprocessed = parseScoreNotes(scoreInput, {
            groupingTolerance: this.config.groupingTolerance,
            targetId: this.targetId
        });
        if (!preprocessed.ok) {
            throw new Error(preprocessed.error);
        }

        this.expectedEvents = preprocessed.events;
        this.preprocessingWarnings = preprocessed.warnings;
        this.reset();
    }

    reset() {
        this.progressIndex = 0;
        this.matchedComparisons = [];
        this.seenEventIds = new Set();
        this.lastAcceptedTimestampMs = null;
        this.consecutiveUnrelated = 0;
        this.completed = false;
        this.completionReturned = false;
        return this.getStatus();
    }

    getStatus() {
        return {
            type: "FINAL_BAR_PROGRESS",
            targetId: this.targetId,
            matched: false,
            completed: this.completed,
            progressIndex: this.progressIndex,
            totalEvents: this.expectedEvents.length,
            progress: this.expectedEvents.length === 0 ? 0 : this.progressIndex / this.expectedEvents.length,
            confidence: this.calculateConfidence(),
            timestampMs: this.lastAcceptedTimestampMs,
            completionAvailable: this.completed && !this.completionReturned
        };
    }

    calculateConfidence() {
        if (this.expectedEvents.length === 0) {
            return 0;
        }

        const progressRatio = this.progressIndex / this.expectedEvents.length;
        if (this.matchedComparisons.length === 0) {
            return progressRatio;
        }

        const avgSimilarity = this.matchedComparisons.reduce((sum, item) => sum + item.similarity, 0) / this.matchedComparisons.length;
        return Math.max(0, Math.min(1, (progressRatio * 0.7) + (avgSimilarity * 0.3)));
    }

    resetProgressOnly(reason) {
        this.progressIndex = 0;
        this.matchedComparisons = [];
        this.lastAcceptedTimestampMs = null;
        this.consecutiveUnrelated = 0;
        return reason;
    }

    acceptObservedEvent(observedInput) {
        const observed = normaliseObservedEvent(observedInput);
        if (!observed) {
            return {
                ...this.getStatus(),
                accepted: false,
                reason: "invalid_observed_event",
                comparison: null
            };
        }

        if (observed.eventId !== null && this.seenEventIds.has(observed.eventId)) {
            return {
                ...this.getStatus(),
                accepted: false,
                duplicate: true,
                reason: "duplicate_event_id",
                timestampMs: observed.timestampMs,
                comparison: null
            };
        }

        if (observed.eventId !== null) {
            this.seenEventIds.add(observed.eventId);
        }

        if (this.completed) {
            return {
                ...this.getStatus(),
                accepted: false,
                reason: "already_completed",
                timestampMs: observed.timestampMs,
                comparison: null
            };
        }

        if (
            this.lastAcceptedTimestampMs !== null &&
            observed.timestampMs - this.lastAcceptedTimestampMs > this.config.maxTimestampGapMs
        ) {
            this.resetProgressOnly("timestamp_gap");
        }

        const expected = this.expectedEvents[this.progressIndex];
        const comparison = compareChordSets(expected, observed, {
            threshold: this.config.chordSimilarityThreshold
        });

        if (comparison.passed) {
            this.progressIndex += 1;
            this.lastAcceptedTimestampMs = observed.timestampMs;
            this.consecutiveUnrelated = 0;
            this.matchedComparisons.push(comparison);

            if (this.progressIndex === this.expectedEvents.length) {
                this.completed = true;
                return this.buildCompletion(observed.timestampMs, comparison);
            }

            return {
                ...this.getStatus(),
                accepted: true,
                reason: "matched_next_event",
                timestampMs: observed.timestampMs,
                comparison
            };
        }

        const restartComparison = compareChordSets(this.expectedEvents[0], observed, {
            threshold: this.config.chordSimilarityThreshold
        });
        if (this.progressIndex > 0 && restartComparison.passed) {
            this.progressIndex = 1;
            this.lastAcceptedTimestampMs = observed.timestampMs;
            this.consecutiveUnrelated = 0;
            this.matchedComparisons = [restartComparison];
            return {
                ...this.getStatus(),
                accepted: true,
                restarted: true,
                reason: "performer_restart_detected",
                timestampMs: observed.timestampMs,
                comparison: restartComparison
            };
        }

        this.consecutiveUnrelated += 1;
        if (this.consecutiveUnrelated > this.config.maxConsecutiveUnrelated) {
            this.resetProgressOnly("too_many_unrelated_events");
        }

        return {
            ...this.getStatus(),
            accepted: false,
            reason: "unrelated_event",
            timestampMs: observed.timestampMs,
            comparison
        };
    }

    buildCompletion(timestampMs, comparison) {
        if (this.completionReturned) {
            return {
                ...this.getStatus(),
                accepted: false,
                reason: "completion_already_returned",
                timestampMs,
                comparison
            };
        }

        this.completionReturned = true;
        return {
            type: "FINAL_BAR_MATCHED",
            targetId: this.targetId,
            matched: true,
            confidence: this.calculateConfidence(),
            timestampMs,
            progressIndex: this.progressIndex,
            totalEvents: this.expectedEvents.length,
            progress: 1,
            comparison
        };
    }
}

function createFinalBarMatcher(scoreInput, options = {}) {
    return new FinalBarMatcher(scoreInput, options);
}

module.exports = {
    DEFAULT_MAX_TIMESTAMP_GAP_MS,
    DEFAULT_MAX_CONSECUTIVE_UNRELATED,
    FinalBarMatcher,
    createFinalBarMatcher,
    normaliseObservedEvent
};
