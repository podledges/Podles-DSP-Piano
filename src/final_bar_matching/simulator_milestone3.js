"use strict";

const assert = require("node:assert/strict");
const draftFullScore = require("./fixtures/full_score.draft.example.json");
const { runMilestone1SimulatorTests } = require("./simulator_milestone1");
const { runMilestone2SimulatorTests } = require("./simulator_milestone2");
const { normaliseDraftFullScore } = require("./score_normalizer");
const { createFullScoreProgressTracker } = require("./full_score_progress_tracker");

function loadScore() {
    const result = normaliseDraftFullScore(draftFullScore, { groupingTolerance: 0.03 });
    assert.equal(result.ok, true);
    return result.score;
}

function tracker(options = {}) {
    return createFullScoreProgressTracker(loadScore(), {
        maxTimestampGapMs: 5000,
        maxConsecutiveUnrelated: 1,
        ...options
    });
}

function observed(eventId, timestampMs, midi) {
    return {
        eventId,
        timestampMs,
        midi: Array.isArray(midi) ? midi : [midi]
    };
}

function eventTypes(result) {
    if (result.type === "TRACKER_EVENTS") {
        return result.events.map((event) => event.type);
    }
    return [result.type];
}

function allEvents(result) {
    return result.type === "TRACKER_EVENTS" ? result.events : [result];
}

function finalProgress(result) {
    return result.type === "TRACKER_EVENTS" ? result.progress : result;
}

function playSequence(instance, sequence) {
    return sequence.map((event) => instance.acceptObservedEvent(event));
}

function completeScoreSequence(startId = 1, startMs = 1000, spacingMs = 500) {
    return [
        observed(startId, startMs, [48, 60]),
        observed(startId + 1, startMs + spacingMs, [64]),
        observed(startId + 2, startMs + spacingMs * 2, [48, 67]),
        observed(startId + 3, startMs + spacingMs * 3, [69]),
        observed(startId + 4, startMs + spacingMs * 4, [62, 65])
    ];
}

function assertHasType(result, type) {
    assert.ok(eventTypes(result).includes(type), `Expected ${type}, got ${eventTypes(result).join(", ")}`);
}

function assertNotHasType(result, type) {
    assert.equal(eventTypes(result).includes(type), false, `Unexpected ${type}`);
}

function testOneCompleteBar() {
    const instance = tracker();
    const first = instance.acceptObservedEvent(observed(1, 1000, [60, 48]));
    assert.equal(first.type, "SCORE_PROGRESS");
    assert.equal(first.completedEvents, 1);
    assertNotHasType(first, "BAR_COMPLETED");

    const second = instance.acceptObservedEvent(observed(2, 1500, [64]));
    assertHasType(second, "BAR_COMPLETED");
    assertNotHasType(second, "PAGE_END_REACHED");
    assert.equal(finalProgress(second).completedEvents, 2);
    assert.equal(finalProgress(second).currentBarId, "page-1-bar-2");
}

function testOneCompletePageAndNextPageContinuation() {
    const instance = tracker();
    const results = playSequence(instance, completeScoreSequence(10).slice(0, 4));
    const last = results[3];
    assertHasType(last, "BAR_COMPLETED");
    assertHasType(last, "PAGE_END_REACHED");
    assertNotHasType(last, "SCORE_COMPLETED");
    assert.equal(finalProgress(last).currentPageId, "page-2");
    assert.equal(finalProgress(last).currentBarId, "page-2-bar-1");

    const next = instance.acceptObservedEvent(observed(20, 3500, [62, 65]));
    assertHasType(next, "SCORE_COMPLETED");
}

function testCompleteScoreFastAndSlow() {
    const fast = tracker();
    const fastResults = playSequence(fast, completeScoreSequence(30, 1000, 50));
    assertHasType(fastResults[4], "SCORE_COMPLETED");
    assert.equal(finalProgress(fastResults[4]).scoreCompleted, true);

    const slow = tracker({ maxTimestampGapMs: 6000 });
    const slowResults = playSequence(slow, completeScoreSequence(40, 1000, 2500));
    assertHasType(slowResults[4], "SCORE_COMPLETED");
}

function testUnrelatedDuplicateAndPartial() {
    const oneExtra = tracker();
    const extraResults = playSequence(oneExtra, [
        observed(50, 1000, [48, 60]),
        observed(51, 1200, [72]),
        observed(52, 1400, [64])
    ]);
    assert.equal(extraResults[1].reason, "unrelated_event");
    assert.equal(extraResults[1].completedEvents, 1);
    assertHasType(extraResults[2], "BAR_COMPLETED");

    const tooMany = tracker();
    const tooManyResults = playSequence(tooMany, [
        observed(60, 1000, [48, 60]),
        observed(61, 1200, [72]),
        observed(62, 1400, [73])
    ]);
    assert.equal(tooManyResults[2].reason, "too_many_unrelated_events");
    assert.equal(tooManyResults[2].completedEvents, 0);

    const duplicate = tracker();
    const dupResults = playSequence(duplicate, [
        observed(70, 1000, [48, 60]),
        observed(70, 1100, [64]),
        observed(71, 1300, [64])
    ]);
    assert.equal(dupResults[1].reason, "duplicate_event_id");
    assert.equal(dupResults[1].completedEvents, 1);
    assertHasType(dupResults[2], "BAR_COMPLETED");

    const partial = tracker();
    const partialResult = partial.acceptObservedEvent(observed(80, 1000, [48]));
    assert.equal(partialResult.reason, "unrelated_event");
    assert.equal(partialResult.completedEvents, 0);
}

function testWrongOrderRepeatedChordsAndRestarts() {
    const wrongOrder = tracker();
    const wrong = playSequence(wrongOrder, [
        observed(90, 1000, [64]),
        observed(91, 1200, [48, 60]),
        observed(92, 1400, [48, 67])
    ]);
    assert.equal(wrong[0].accepted, false);
    assertNotHasType(wrong[2], "BAR_COMPLETED");

    const repeatedScore = normaliseDraftFullScore({
        scoreId: "repeated",
        pages: [{
            pageId: "page-r",
            bars: [{
                barId: "bar-r",
                events: [
                    { eventId: "r1", time: 0, midi: [60] },
                    { eventId: "r2", time: 1, midi: [60] },
                    { eventId: "r3", time: 2, midi: [64] }
                ]
            }]
        }]
    }).score;
    const repeated = createFullScoreProgressTracker(repeatedScore);
    const repeatedResults = playSequence(repeated, [
        observed(100, 1000, [60]),
        observed(101, 1200, [60]),
        observed(102, 1400, [64])
    ]);
    assertHasType(repeatedResults[2], "SCORE_COMPLETED");

    const barRestart = tracker();
    const barRestartResults = playSequence(barRestart, [
        observed(110, 1000, [48, 60]),
        observed(111, 1200, [64]),
        observed(112, 1400, [48, 67]),
        observed(113, 1600, [48, 67]),
        observed(114, 1800, [69])
    ]);
    assert.equal(barRestartResults[3].reason, "current_bar_restart");
    assertHasType(barRestartResults[4], "BAR_COMPLETED");

    const pageRestart = tracker();
    const pageRestartResults = playSequence(pageRestart, [
        observed(120, 1000, [48, 60]),
        observed(121, 1200, [64]),
        observed(122, 1400, [48, 67]),
        observed(123, 1600, [48, 60])
    ]);
    assert.equal(pageRestartResults[3].reason, "current_page_restart");
    assert.equal(pageRestartResults[3].completedEvents, 1);
}

function testPauseMalformedResetAndSingleEmission() {
    const longPause = tracker({ maxTimestampGapMs: 1000 });
    const pauseResults = playSequence(longPause, [
        observed(130, 1000, [48, 60]),
        observed(131, 3000, [64])
    ]);
    assert.equal(pauseResults[1].reason, "timestamp_gap");
    assert.equal(pauseResults[1].completedEvents, 0);

    const malformed = tracker();
    const malformedResults = playSequence(malformed, [
        null,
        { eventId: 140, timestampMs: -1, midi: [48, 60] },
        { eventId: 141, timestampMs: 1000, midi: [] },
        observed(142, 1200, [48, 60])
    ]);
    assert.equal(malformedResults[0].reason, "invalid_observed_event");
    assert.equal(malformedResults[1].reason, "invalid_observed_event");
    assert.equal(malformedResults[2].reason, "invalid_observed_event");
    assert.equal(malformedResults[3].completedEvents, 1);

    const single = tracker();
    const complete = playSequence(single, completeScoreSequence(150));
    assertHasType(complete[3], "PAGE_END_REACHED");
    assertHasType(complete[4], "SCORE_COMPLETED");
    assertNotHasType(complete[4], "PAGE_END_REACHED");
    const afterComplete = single.acceptObservedEvent(observed(160, 5000, [62, 65]));
    assert.equal(afterComplete.reason, "already_completed");
    assertNotHasType(afterComplete, "SCORE_COMPLETED");
    assertNotHasType(afterComplete, "PAGE_END_REACHED");

    const pageEndCount = complete.flatMap(allEvents).filter((event) => event.type === "PAGE_END_REACHED").length;
    const scoreCompleteCount = complete.flatMap(allEvents).filter((event) => event.type === "SCORE_COMPLETED").length;
    assert.equal(pageEndCount, 1);
    assert.equal(scoreCompleteCount, 1);

    single.reset();
    const replay = playSequence(single, completeScoreSequence(170, 6000));
    assertHasType(replay[4], "SCORE_COMPLETED");
}

function runMilestone3SimulatorTests() {
    runMilestone1SimulatorTests();
    runMilestone2SimulatorTests();
    testOneCompleteBar();
    testOneCompletePageAndNextPageContinuation();
    testCompleteScoreFastAndSlow();
    testUnrelatedDuplicateAndPartial();
    testWrongOrderRepeatedChordsAndRestarts();
    testPauseMalformedResetAndSingleEmission();
}

if (require.main === module) {
    runMilestone3SimulatorTests();
    console.log("Milestone 3 simulator tests passed.");
}

module.exports = {
    runMilestone3SimulatorTests
};
