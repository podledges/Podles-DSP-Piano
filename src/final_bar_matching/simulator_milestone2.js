"use strict";

const assert = require("node:assert/strict");
const draftFullScore = require("./fixtures/full_score.draft.example.json");
const { runMilestone1SimulatorTests } = require("./simulator_milestone1");
const {
    normaliseDraftFullScore,
    normalizeDraftFullScore,
    parseNoteNameToMidi
} = require("./score_normalizer");

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function testNoteNameConversion() {
    assert.equal(parseNoteNameToMidi("C4"), 60);
    assert.equal(parseNoteNameToMidi("D#5"), 75);
    assert.equal(parseNoteNameToMidi("Bb3"), 58);
    assert.equal(parseNoteNameToMidi("not-a-note"), null);
}

function testDraftFullScoreNormalization() {
    const source = cloneJson(draftFullScore);
    const sourceBefore = JSON.stringify(source);
    const result = normaliseDraftFullScore(source, { groupingTolerance: 0.03 });

    assert.equal(result.ok, true);
    assert.equal(normalizeDraftFullScore(source).ok, true);
    assert.equal(JSON.stringify(source), sourceBefore);
    assert.equal(result.score.type, "normalized_full_score");
    assert.equal(result.score.scoreId, "draft-score-ppap");
    assert.equal(result.score.pages.length, 2);

    const page1 = result.score.pages[0];
    assert.equal(page1.pageId, "page-1");
    assert.equal(page1.pageIndex, 0);
    assert.equal(page1.pageNumber, 1);
    assert.equal(page1.bars.length, 2);

    const explicitBar = page1.bars[0];
    assert.equal(explicitBar.barId, "page-1-bar-1");
    assert.equal(explicitBar.events.length, 2);
    assert.equal(explicitBar.events[0].eventId, "page-1-bar-1-event-1");
    assert.deepEqual(explicitBar.events[0].midi, [48, 60]);
    assert.deepEqual(explicitBar.events[0].notes.map((note) => note.noteId), ["n-1", "n-2"]);
    assert.equal(explicitBar.events[0].notes[0].midi, 60);
    assert.equal(explicitBar.events[0].notes[1].midi, 48);

    const groupedBar = page1.bars[1];
    assert.equal(groupedBar.barId, "page-1-bar-2");
    assert.equal(groupedBar.events.length, 2);
    assert.deepEqual(groupedBar.events[0].midi, [48, 67]);
    assert.deepEqual(groupedBar.events[1].midi, [69]);
    assert.equal(groupedBar.events[0].source.generatedFrom, "bar.notes");

    const page2Event = result.score.pages[1].bars[0].events[0];
    assert.equal(page2Event.eventId, "page-2-bar-1-event-1");
    assert.deepEqual(page2Event.midi, [62, 65]);
    assert.equal(page2Event.notes.length, 2);
}

function testGeneratedIdsAndMeasuresAlias() {
    const result = normaliseDraftFullScore({
        title: "Generated IDs",
        pages: [
            {
                measures: [
                    {
                        chords: [
                            {
                                scoreTime: 1.25,
                                notes: [
                                    { note: "F4", duration: 0.5 },
                                    { midi: 53, duration: 0.5 }
                                ]
                            }
                        ]
                    }
                ]
            }
        ]
    });

    assert.equal(result.ok, true);
    assert.equal(result.score.scoreId, "score-1");
    assert.equal(result.score.pages[0].pageId, "page-1");
    assert.equal(result.score.pages[0].bars[0].barId, "page-1-bar-1");
    assert.equal(result.score.pages[0].bars[0].events[0].eventId, "page-1-bar-1-event-1");
    assert.deepEqual(result.score.pages[0].bars[0].events[0].midi, [53, 65]);
    assert.equal(result.score.pages[0].bars[0].events[0].scoreTimeSec, 1.25);
}

function testMalformedDraftInput() {
    assert.equal(normaliseDraftFullScore(null).ok, false);
    assert.equal(normaliseDraftFullScore({}).ok, false);
    assert.equal(normaliseDraftFullScore({ pages: [] }).ok, false);
    assert.equal(normaliseDraftFullScore({ pages: [{}] }).ok, false);
    assert.equal(normaliseDraftFullScore({ pages: [{ bars: [{}] }] }).ok, false);
    assert.equal(normaliseDraftFullScore({ pages: [{ bars: [{ notes: [{ time: 0, note: "bad" }] }] }] }).ok, false);

    const partiallyMalformed = normaliseDraftFullScore({
        pages: [
            {
                bars: [
                    {
                        events: [
                            { time: 0, notes: [{ note: "C4" }, { note: "bad" }] }
                        ]
                    }
                ]
            }
        ]
    });
    assert.equal(partiallyMalformed.ok, true);
    assert.deepEqual(partiallyMalformed.score.pages[0].bars[0].events[0].midi, [60]);
    assert.ok(partiallyMalformed.warnings.length > 0);
}

function runMilestone2SimulatorTests() {
    runMilestone1SimulatorTests();
    testNoteNameConversion();
    testDraftFullScoreNormalization();
    testGeneratedIdsAndMeasuresAlias();
    testMalformedDraftInput();
}

if (require.main === module) {
    runMilestone2SimulatorTests();
    console.log("Milestone 2 simulator tests passed.");
}

module.exports = {
    runMilestone2SimulatorTests
};
