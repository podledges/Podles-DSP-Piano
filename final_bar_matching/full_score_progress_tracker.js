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
