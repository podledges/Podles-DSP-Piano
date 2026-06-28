"use strict";

const assert = require("node:assert/strict");
const furEliseParserFixture = require("./fixtures/fur_elise.parser.example.json");
const { normaliseDraftFullScore, parseNoteNameToMidi } = require("./score_normalizer");
const { createFullScoreProgressTracker } = require("./full_score_progress_tracker");

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function eventTypes(result) {
    if (result.type === "TRACKER_EVENTS") {
        return result.events.map((event) => event.type);
    }
    return [result.type];
}

function assertHasType(result, type) {
    assert.ok(eventTypes(result).includes(type), `Expected ${type}, got ${eventTypes(result).join(", ")}`);
}

function assertNotHasType(result, type) {
    assert.equal(eventTypes(result).includes(type), false, `Unexpected ${type}`);
}

function observedFromExpected(expectedEvent, eventId, timestampMs) {
    return {
        eventId,
        timestampMs,
        midi: expectedEvent.midi
    };
}

function playPage(tracker, page, eventIdStart, timestampStart) {
    let result = tracker.getProgress("before_page");
    page.events.forEach((event, index) => {
        result = tracker.acceptObservedEvent(observedFromExpected(
            event,
            eventIdStart + index,
            timestampStart + index * 250
        ));
    });
    return result;
}

function testConfirmedParserContractNormalizes() {
    const source = cloneJson(furEliseParserFixture);
    const sourceBefore = JSON.stringify(source);
    const result = normaliseDraftFullScore(source, { groupingTolerance: 0.001 });

    assert.equal(result.ok, true);
    assert.equal(JSON.stringify(source), sourceBefore);
    assert.equal(result.score.scoreId, "fur_elise.pdf");
    assert.equal(result.score.title, "fur_elise.pdf");
    assert.equal(result.score.totalPages, 3);
    assert.equal(result.score.sourceContract, "confirmed_parser_pages_v1");
    assert.deepEqual(result.score.pages.map((page) => page.pageNumber), [1, 2, 3]);
    assert.deepEqual(result.score.pages.map((page) => page.pageIndex), [0, 1, 2]);
    assert.deepEqual(result.score.pages.map((page) => page.pageId), ["page-1", "page-2", "page-3"]);
    assert.equal(result.score.pages.every((page) => Array.isArray(page.bars)), false);
    assert.equal(result.score.pages.every((page) => Array.isArray(page.events)), true);

    assert.equal(parseNoteNameToMidi("E5"), 76);
    assert.equal(parseNoteNameToMidi("D#5"), 75);
    assert.equal(parseNoteNameToMidi("Bb3"), 58);
    assert.equal(parseNoteNameToMidi("G#4"), 68);

    const page1 = result.score.pages[0];
    const page2 = result.score.pages[1];
    const page3 = result.score.pages[2];

    assert.equal(page1.events.length, 17);
    assert.equal(page2.events.length, 6);
    assert.equal(page3.events.length, 6);
    assert.deepEqual(page1.events.find((event) => event.scoreTimeSec === 2).midi, [45, 69]);
    assert.deepEqual(page1.events.find((event) => event.scoreTimeSec === 3.65).midi, [40, 71]);
    assert.deepEqual(page2.events.find((event) => event.scoreTimeSec === 0.75).midi, [45, 72]);
    assert.deepEqual(page3.events.find((event) => event.scoreTimeSec === 0.75).midi, [45, 72]);
    assert.notEqual(page2.events[0].eventId, page3.events[0].eventId);

    const grouped = page1.events.find((event) => event.scoreTimeSec === 2);
    assert.equal(grouped.source.generatedFrom, "page.notes");
    assert.deepEqual(grouped.notes.map((note) => note.note), ["A2", "A4"]);
    assert.deepEqual(grouped.notes.map((note) => note.hand).sort(), ["left", "right"]);
    assert.deepEqual(grouped.notes.map((note) => note.originalTimeSec), [2, 2]);
}

function testPartialInvalidNotesWarnAndUnusableScoreFails() {
    const result = normaliseDraftFullScore({
        songTitle: "partial-invalid.pdf",
        totalPages: 1,
        pages: [
            {
                pageNumber: 1,
                duration: 4,
                notes: [
                    { time: 0, note: "C4", dur: 0.25, hand: "right" },
                    { time: 0, note: "not-a-note", dur: 0.25, hand: "left" }
                ]
            }
        ]
    });

    assert.equal(result.ok, true);
    assert.ok(result.warnings.length > 0);
    assert.deepEqual(result.score.pages[0].events[0].midi, [60]);

    const unusable = normaliseDraftFullScore({
        songTitle: "unusable.pdf",
        totalPages: 1,
        pages: [
            {
                pageNumber: 1,
                duration: 4,
                notes: [{ time: 0, note: "bad" }]
            }
        ]
    });

    assert.equal(unusable.ok, false);
}

function testPageLevelTrackerBoundaries() {
    const normalized = normaliseDraftFullScore(furEliseParserFixture, { groupingTolerance: 0.001 });
    assert.equal(normalized.ok, true);

    const tracker = createFullScoreProgressTracker(normalized.score, {
        maxTimestampGapMs: 10000,
        maxConsecutiveUnrelated: 1
    });

    let result = playPage(tracker, normalized.score.pages[0], 100, 1000);
    assertHasType(result, "PAGE_END_REACHED");
    assertNotHasType(result, "BAR_COMPLETED");

    result = playPage(tracker, normalized.score.pages[1], 200, 10000);
    assertHasType(result, "PAGE_END_REACHED");
    assertNotHasType(result, "BAR_COMPLETED");

    result = playPage(tracker, normalized.score.pages[2], 300, 20000);
    assertHasType(result, "SCORE_COMPLETED");
    assertNotHasType(result, "PAGE_END_REACHED");
    assertNotHasType(result, "BAR_COMPLETED");

    const repeated = tracker.acceptObservedEvent(observedFromExpected(
        normalized.score.pages[2].events[0],
        400,
        30000
    ));
    assert.equal(repeated.type, "SCORE_PROGRESS");
    assert.equal(repeated.reason, "already_completed");
    assertNotHasType(repeated, "SCORE_COMPLETED");
    assertNotHasType(repeated, "PAGE_END_REACHED");

    tracker.reset();
    result = playPage(tracker, normalized.score.pages[0], 500, 40000);
    assertHasType(result, "PAGE_END_REACHED");
}

function runParserContractSimulatorTests() {
    testConfirmedParserContractNormalizes();
    testPartialInvalidNotesWarnAndUnusableScoreFails();
    testPageLevelTrackerBoundaries();
}

if (require.main === module) {
    runParserContractSimulatorTests();
    console.log("Parser contract simulator tests passed.");
}

module.exports = {
    runParserContractSimulatorTests
};
