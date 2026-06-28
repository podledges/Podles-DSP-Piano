"use strict";

const assert = require("node:assert/strict");
const draftFullScore = require("./fixtures/full_score.draft.example.json");
const { runMilestone1SimulatorTests } = require("./simulator_milestone1");
const { runMilestone2SimulatorTests } = require("./simulator_milestone2");
const { runMilestone3SimulatorTests } = require("./simulator_milestone3");
const { normaliseDraftFullScore } = require("./score_normalizer");
const { createFrequencyScorePipeline } = require("./frequency_score_pipeline");

function midiToFrequencyHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

function frequencyPacket(eventId, timestampMs, midiNotes, options = {}) {
    const peaks = midiNotes.map((midi, index) => ({
        frequencyHz: midiToFrequencyHz(midi),
        magnitude: options.magnitude ?? (0.9 - index * 0.05)
    }));

    return {
        type: "frequency_event",
        eventId,
        timestampMs,
        peaks
    };
}

function loadPipeline(options = {}) {
    const normalized = normaliseDraftFullScore(draftFullScore, { groupingTolerance: 0.03 });
    assert.equal(normalized.ok, true);
    return createFrequencyScorePipeline(normalized.score, {
        trackerOptions: {
            maxTimestampGapMs: 5000,
            maxConsecutiveUnrelated: 1,
            ...(options.trackerOptions ?? {})
        },
        adapterOptions: options.adapterOptions ?? {}
    });
}

function pipelineSequence(startId = 1, startMs = 1000, spacingMs = 500) {
    return [
        frequencyPacket(startId, startMs, [48, 60]),
        frequencyPacket(startId + 1, startMs + spacingMs, [64]),
        frequencyPacket(startId + 2, startMs + spacingMs * 2, [48, 67]),
        frequencyPacket(startId + 3, startMs + spacingMs * 3, [69]),
        frequencyPacket(startId + 4, startMs + spacingMs * 4, [62, 65])
    ];
}

function sendAll(pipeline, packets) {
    return packets.map((packet) => pipeline.acceptFrequencyEvent(packet));
}

function trackerTypes(pipelineResult) {
    if (!pipelineResult.trackerResult) return [];
    if (pipelineResult.trackerResult.type === "TRACKER_EVENTS") {
        return pipelineResult.trackerResult.events.map((event) => event.type);
    }
    return [pipelineResult.trackerResult.type];
}

function trackerProgress(pipelineResult) {
    if (pipelineResult.trackerResult.type === "TRACKER_EVENTS") {
        return pipelineResult.trackerResult.progress;
    }
    return pipelineResult.trackerResult;
}

function trackerEvents(pipelineResult) {
    if (!pipelineResult.trackerResult) return [];
    return pipelineResult.trackerResult.type === "TRACKER_EVENTS" ? pipelineResult.trackerResult.events : [pipelineResult.trackerResult];
}

function assertHasType(result, type) {
    assert.ok(trackerTypes(result).includes(type), `Expected ${type}, got ${trackerTypes(result).join(", ")}`);
}

function assertNotHasType(result, type) {
    assert.equal(trackerTypes(result).includes(type), false, `Unexpected ${type}`);
}

function testSingleNoteAndChordPackets() {
    const pipeline = loadPipeline();
    const chord = pipeline.acceptFrequencyEvent(frequencyPacket(1, 1000, [48, 60]));
    assert.equal(chord.ok, true);
    assert.deepEqual(chord.observedEvent.midi, [48, 60]);
    assert.equal(trackerProgress(chord).completedEvents, 1);

    const single = pipeline.acceptFrequencyEvent(frequencyPacket(2, 1500, [64]));
    assert.equal(single.ok, true);
    assert.deepEqual(single.observedEvent.midi, [64]);
    assertHasType(single, "BAR_COMPLETED");
}

function testCompleteBarPageScoreFastSlow() {
    const bar = loadPipeline();
    const barResults = sendAll(bar, pipelineSequence(10).slice(0, 2));
    assertHasType(barResults[1], "BAR_COMPLETED");
    assertNotHasType(barResults[1], "PAGE_END_REACHED");

    const page = loadPipeline();
    const pageResults = sendAll(page, pipelineSequence(20).slice(0, 4));
    assertHasType(pageResults[3], "PAGE_END_REACHED");
    assertNotHasType(pageResults[3], "SCORE_COMPLETED");

    const score = loadPipeline();
    const scoreResults = sendAll(score, pipelineSequence(30));
    assertHasType(scoreResults[4], "SCORE_COMPLETED");
    assertNotHasType(scoreResults[4], "PAGE_END_REACHED");

    const fast = loadPipeline();
    assertHasType(sendAll(fast, pipelineSequence(40, 1000, 50))[4], "SCORE_COMPLETED");

    const slow = loadPipeline({ trackerOptions: { maxTimestampGapMs: 6000 } });
    assertHasType(sendAll(slow, pipelineSequence(50, 1000, 2500))[4], "SCORE_COMPLETED");
}

function testInvalidAndRecoveryCases() {
    const extra = loadPipeline();
    const extraResults = sendAll(extra, [
        frequencyPacket(60, 1000, [48, 60]),
        frequencyPacket(61, 1200, [72]),
        frequencyPacket(62, 1400, [64])
    ]);
    assert.equal(extraResults[1].trackerResult.reason, "unrelated_event");
    assert.equal(trackerProgress(extraResults[1]).completedEvents, 1);
    assertHasType(extraResults[2], "BAR_COMPLETED");

    const tooMany = loadPipeline();
    const tooManyResults = sendAll(tooMany, [
        frequencyPacket(70, 1000, [48, 60]),
        frequencyPacket(71, 1200, [72]),
        frequencyPacket(72, 1400, [73])
    ]);
    assert.equal(tooManyResults[2].trackerResult.reason, "too_many_unrelated_events");
    assert.equal(trackerProgress(tooManyResults[2]).completedEvents, 0);

    const duplicate = loadPipeline();
    const duplicateResults = sendAll(duplicate, [
        frequencyPacket(80, 1000, [48, 60]),
        frequencyPacket(80, 1100, [64]),
        frequencyPacket(81, 1300, [64])
    ]);
    assert.equal(duplicateResults[1].trackerResult.reason, "duplicate_event_id");
    assert.equal(duplicateResults[1].trackerResult.duplicate, true);
    assertHasType(duplicateResults[2], "BAR_COMPLETED");

    const wrongOrder = loadPipeline();
    const wrongResults = sendAll(wrongOrder, [
        frequencyPacket(90, 1000, [64]),
        frequencyPacket(91, 1200, [48, 60]),
        frequencyPacket(92, 1400, [48, 67])
    ]);
    assert.equal(wrongResults[0].trackerResult.accepted, false);
    assertNotHasType(wrongResults[2], "BAR_COMPLETED");
}

function testMalformedFrequencyPackets() {
    const pipeline = loadPipeline();

    const invalidFrequency = pipeline.acceptFrequencyEvent({
        type: "frequency_event",
        eventId: 100,
        timestampMs: 1000,
        peaks: [{ frequencyHz: -1, magnitude: 0.8 }]
    });
    assert.equal(invalidFrequency.ok, false);
    assert.equal(invalidFrequency.trackerResult, null);

    const emptyPeaks = pipeline.acceptFrequencyEvent({
        type: "frequency_event",
        eventId: 101,
        timestampMs: 1100,
        peaks: []
    });
    assert.equal(emptyPeaks.ok, false);

    const partial = pipeline.acceptFrequencyEvent({
        type: "frequency_event",
        eventId: 102,
        timestampMs: 1200,
        peaks: [
            { frequencyHz: "bad", magnitude: 0.7 },
            { frequencyHz: midiToFrequencyHz(48), magnitude: 0.9 },
            { frequencyHz: midiToFrequencyHz(60), magnitude: 0.85 }
        ]
    });
    assert.equal(partial.ok, true);
    assert.deepEqual(partial.observedEvent.midi, [48, 60]);
    assert.equal(partial.warnings.length, 1);
    assert.equal(trackerProgress(partial).completedEvents, 1);
}

function testFinalPageResetAndNoRepeatedBoundaries() {
    const pipeline = loadPipeline();
    const complete = sendAll(pipeline, pipelineSequence(120));
    assertHasType(complete[3], "PAGE_END_REACHED");
    assertHasType(complete[4], "SCORE_COMPLETED");
    assertNotHasType(complete[4], "PAGE_END_REACHED");

    const afterComplete = pipeline.acceptFrequencyEvent(frequencyPacket(130, 5000, [62, 65]));
    assert.equal(afterComplete.ok, true);
    assert.equal(afterComplete.trackerResult.reason, "already_completed");
    assertNotHasType(afterComplete, "SCORE_COMPLETED");
    assertNotHasType(afterComplete, "PAGE_END_REACHED");

    const pageEndCount = complete.flatMap(trackerEvents).filter((event) => event.type === "PAGE_END_REACHED").length;
    const scoreCompletedCount = complete.flatMap(trackerEvents).filter((event) => event.type === "SCORE_COMPLETED").length;
    assert.equal(pageEndCount, 1);
    assert.equal(scoreCompletedCount, 1);

    pipeline.reset();
    const replay = sendAll(pipeline, pipelineSequence(140, 6000));
    assertHasType(replay[4], "SCORE_COMPLETED");
}

function runMilestone4SimulatorTests() {
    runMilestone1SimulatorTests();
    runMilestone2SimulatorTests();
    runMilestone3SimulatorTests();
    testSingleNoteAndChordPackets();
    testCompleteBarPageScoreFastSlow();
    testInvalidAndRecoveryCases();
    testMalformedFrequencyPackets();
    testFinalPageResetAndNoRepeatedBoundaries();
}

if (require.main === module) {
    runMilestone4SimulatorTests();
    console.log("Milestone 4 simulator tests passed.");
}

module.exports = {
    runMilestone4SimulatorTests
};
