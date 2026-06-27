"use strict";

const assert = require("node:assert/strict");
const examplePacket = require("./fixtures/frequency_event.example.json");
const parsedScoreExample = require("./fixtures/parsed_score.example.json");
const {
    frequencyHzToMidi,
    frequencyHzToMidiFloat,
    frequencyHzToMidiDetails
} = require("./frequency_to_midi");
const {
    normaliseFrequencyEvent,
    normalizeFrequencyEvent
} = require("./frequency_event_adapter");
const { parseScoreNotes } = require("./score_preprocessor");
const { compareChordSets } = require("./chord_compare");
const { createFinalBarMatcher } = require("./final_bar_matcher");

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function observed(eventId, timestampMs, midi) {
    return {
        type: "observed_chord_event",
        eventId,
        timestampMs,
        midi: Array.isArray(midi) ? midi : [midi]
    };
}

function assertNoCompletion(results) {
    assert.equal(results.some((result) => result.type === "FINAL_BAR_MATCHED"), false);
}

function runSequence(events, options = {}) {
    const matcher = createFinalBarMatcher(parsedScoreExample, {
        targetId: "page-1-final-bar",
        maxTimestampGapMs: 5000,
        ...options
    });

    return {
        matcher,
        results: events.map((event) => matcher.acceptObservedEvent(event))
    };
}

function assertCompletion(result) {
    assert.equal(result.type, "FINAL_BAR_MATCHED");
    assert.equal(result.targetId, "page-1-final-bar");
    assert.equal(result.matched, true);
    assert.ok(result.confidence >= 0.99);
    assert.equal(result.progress, 1);
}

function testFrequencyConversionAndAdapter() {
    assert.equal(frequencyHzToMidi(440), 69);
    assert.equal(frequencyHzToMidi(261.625565), 60);
    assert.equal(frequencyHzToMidi(130.812783), 48);
    assert.equal(frequencyHzToMidi(0), null);
    assert.equal(frequencyHzToMidi(-440), null);
    assert.equal(frequencyHzToMidi(Number.NaN), null);
    assert.equal(frequencyHzToMidi(Number.POSITIVE_INFINITY), null);
    assert.equal(frequencyHzToMidi(undefined), null);
    assert.ok(Math.abs(frequencyHzToMidiFloat(440) - 69) < 0.000001);

    const details = frequencyHzToMidiDetails(440);
    assert.deepEqual(details, {
        midi: 69,
        midiFloat: 69,
        centsFromNearest: 0,
        frequencyHz: 440
    });

    const exampleResult = normaliseFrequencyEvent(examplePacket);
    assert.equal(exampleResult.ok, true);
    assert.equal(normalizeFrequencyEvent(examplePacket).ok, true);
    assert.deepEqual(exampleResult.event.notes.map((note) => note.midi), [48, 60]);
    assert.equal(exampleResult.event.eventId, 301);
    assert.equal(exampleResult.event.timestampMs, 28510);

    const duplicateMidiResult = normaliseFrequencyEvent({
        type: "frequency_event",
        eventId: 302,
        timestampMs: 28600,
        peaks: [
            { frequencyHz: 261.63, magnitude: 0.2 },
            { frequencyHz: 261.5, magnitude: 0.9 }
        ]
    });
    assert.equal(duplicateMidiResult.ok, true);
    assert.equal(duplicateMidiResult.event.notes.length, 1);
    assert.equal(duplicateMidiResult.event.notes[0].magnitude, 0.9);

    const partiallyInvalidResult = normaliseFrequencyEvent({
        type: "frequency_event",
        eventId: 303,
        timestampMs: 28700,
        peaks: [
            { frequencyHz: "261.63", magnitude: 0.8 },
            { frequencyHz: 329.63, magnitude: 0.7 },
            { frequencyHz: 392.0, magnitude: -1 }
        ]
    });
    assert.equal(partiallyInvalidResult.ok, true);
    assert.equal(partiallyInvalidResult.event.notes.length, 1);
    assert.equal(partiallyInvalidResult.event.notes[0].midi, 64);
    assert.equal(partiallyInvalidResult.warnings.length, 2);

    [
        null,
        {},
        { type: "other", eventId: 1, timestampMs: 0, peaks: [] },
        { type: "frequency_event", eventId: "301", timestampMs: 0, peaks: [] },
        { type: "frequency_event", eventId: 301, timestampMs: -1, peaks: [] },
        { type: "frequency_event", eventId: 301, timestampMs: 0, peaks: [] },
        { type: "frequency_event", eventId: 301, timestampMs: 0, peaks: [{ frequencyHz: 0, magnitude: 1 }] }
    ].forEach((packet) => {
        const result = normaliseFrequencyEvent(packet);
        assert.equal(result.ok, false);
        assert.equal(result.event, null);
        assert.equal(typeof result.error, "string");
    });
}

function testScorePreprocessing() {
    const source = cloneJson(parsedScoreExample);
    const sourceBefore = JSON.stringify(source);
    const result = parseScoreNotes(source, {
        targetId: "page-1-final-bar",
        groupingTolerance: 0.03
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.events.map((event) => event.midi), [[48, 60], [64], [67]]);
    assert.equal(JSON.stringify(source), sourceBefore);

    const nearlySimultaneous = parseScoreNotes({
        notes: [
            { time: 0.01, midi: 60, note: "C4", hand: "right" },
            { time: 0.02, midi: 48, note: "C3", hand: "left" },
            { time: 0.2, midi: 64, note: "E4", hand: "right" }
        ]
    }, { groupingTolerance: 0.03 });
    assert.equal(nearlySimultaneous.ok, true);
    assert.deepEqual(nearlySimultaneous.events.map((event) => event.midi), [[48, 60], [64]]);

    const deduped = parseScoreNotes({
        notes: [
            { time: 0, midi: 60, hand: "right" },
            { time: 0, midi: 60, hand: "left" },
            { time: 0, midi: 48, hand: "left" }
        ]
    });
    assert.equal(deduped.ok, true);
    assert.deepEqual(deduped.events[0].midi, [48, 60]);

    const noHand = parseScoreNotes({
        notes: [
            { time: 0, midi: 60, hand: "right" },
            { time: 0, midi: 48, hand: "left" }
        ]
    });
    const changedHand = parseScoreNotes({
        notes: [
            { time: 0, midi: 60, hand: "left" },
            { time: 0, midi: 48, hand: "right" }
        ]
    });
    assert.deepEqual(noHand.events.map((event) => event.midi), changedHand.events.map((event) => event.midi));

    assert.equal(parseScoreNotes(null).ok, false);
    assert.equal(parseScoreNotes({ notes: [] }).ok, false);
    assert.equal(parseScoreNotes({ notes: [{ time: "x", midi: 60 }] }).ok, false);
}

function testChordComparison() {
    const result = compareChordSets([60, 48, 60], [48, 64, 60], { threshold: 0.66 });
    assert.equal(result.passed, true);
    assert.equal(result.similarity, 2 / 3);
    assert.deepEqual(result.matchedNotes, [48, 60]);
    assert.deepEqual(result.missingExpectedNotes, []);
    assert.deepEqual(result.extraObservedNotes, [64]);
    assert.deepEqual(result.expectedNotes, [48, 60]);
    assert.deepEqual(result.observedNotes, [48, 60, 64]);

    const partial = compareChordSets([48, 60], [48], { threshold: 0.67 });
    assert.equal(partial.passed, false);
    assert.deepEqual(partial.missingExpectedNotes, [60]);

    const empty = compareChordSets([], []);
    assert.equal(empty.similarity, 1);
    assert.equal(empty.passed, false);
}

function testMatcherScenarios() {
    const exact = runSequence([
        observed(1, 1000, [60, 48]),
        observed(2, 1500, [64]),
        observed(3, 2000, [67])
    ]);
    assertCompletion(exact.results[2]);

    const fast = runSequence([
        observed(10, 1000, [48, 60]),
        observed(11, 1050, [64]),
        observed(12, 1100, [67])
    ]);
    assertCompletion(fast.results[2]);

    const slow = runSequence([
        observed(20, 1000, [48, 60]),
        observed(21, 3500, [64]),
        observed(22, 6000, [67])
    ]);
    assertCompletion(slow.results[2]);

    const extraNote = runSequence([
        observed(30, 1000, [48, 60]),
        observed(31, 1300, [72]),
        observed(32, 1600, [64]),
        observed(33, 1900, [67])
    ]);
    assert.equal(extraNote.results[1].reason, "unrelated_event");
    assert.equal(extraNote.results[1].progressIndex, 1);
    assertCompletion(extraNote.results[3]);

    const wrongOrder = runSequence([
        observed(40, 1000, [64]),
        observed(41, 1500, [48, 60]),
        observed(42, 2000, [67])
    ]);
    assertNoCompletion(wrongOrder.results);

    const duplicateId = runSequence([
        observed(50, 1000, [48, 60]),
        observed(50, 1100, [64]),
        observed(51, 1500, [64]),
        observed(52, 2000, [67])
    ]);
    assert.equal(duplicateId.results[1].duplicate, true);
    assert.equal(duplicateId.results[1].progressIndex, 1);
    assertCompletion(duplicateId.results[3]);

    const incomplete = runSequence([
        observed(60, 1000, [48, 60]),
        observed(61, 1500, [64])
    ]);
    assertNoCompletion(incomplete.results);
    assert.equal(incomplete.matcher.getStatus().progressIndex, 2);

    const restart = runSequence([
        observed(70, 1000, [48, 60]),
        observed(71, 1500, [64]),
        observed(72, 1800, [48, 60]),
        observed(73, 2200, [64]),
        observed(74, 2600, [67])
    ]);
    assert.equal(restart.results[2].restarted, true);
    assert.equal(restart.results[2].progressIndex, 1);
    assertCompletion(restart.results[4]);

    const timestampGap = runSequence([
        observed(80, 1000, [48, 60]),
        observed(81, 8000, [64]),
        observed(82, 8500, [67])
    ], { maxTimestampGapMs: 1000 });
    assertNoCompletion(timestampGap.results);
    assert.equal(timestampGap.results[1].progressIndex, 0);

    const unrelatedFlood = runSequence([
        observed(90, 1000, [48, 60]),
        observed(91, 1200, [72]),
        observed(92, 1400, [73]),
        observed(93, 1600, [64]),
        observed(94, 1800, [67])
    ]);
    assertNoCompletion(unrelatedFlood.results);
    assert.equal(unrelatedFlood.results[2].progressIndex, 0);

    const once = runSequence([
        observed(100, 1000, [48, 60]),
        observed(101, 1500, [64]),
        observed(102, 2000, [67]),
        observed(103, 2500, [67])
    ]);
    assertCompletion(once.results[2]);
    assert.notEqual(once.results[3].type, "FINAL_BAR_MATCHED");
    assert.equal(once.results[3].reason, "already_completed");

    once.matcher.reset();
    const afterReset = [
        once.matcher.acceptObservedEvent(observed(104, 3000, [48, 60])),
        once.matcher.acceptObservedEvent(observed(105, 3500, [64])),
        once.matcher.acceptObservedEvent(observed(106, 4000, [67]))
    ];
    assertCompletion(afterReset[2]);

    const malformed = runSequence([
        null,
        { eventId: 200, timestampMs: -1, midi: [48, 60] },
        { eventId: 201, timestampMs: 1000, midi: [] },
        observed(202, 1500, [48, 60]),
        observed(203, 1800, [64]),
        observed(204, 2100, [67])
    ]);
    assert.equal(malformed.results[0].reason, "invalid_observed_event");
    assert.equal(malformed.results[1].reason, "invalid_observed_event");
    assert.equal(malformed.results[2].reason, "invalid_observed_event");
    assertCompletion(malformed.results[5]);
}

function runMilestone1SimulatorTests() {
    testFrequencyConversionAndAdapter();
    testScorePreprocessing();
    testChordComparison();
    testMatcherScenarios();
}

if (require.main === module) {
    runMilestone1SimulatorTests();
    console.log("Milestone 1 simulator tests passed.");
}

module.exports = {
    runMilestone1SimulatorTests
};
