"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const buildScript = path.join(repoRoot, "scripts", "build_final_bar_matching_browser_bundle.js");
const bundlePath = path.join(repoRoot, "web_app", "final_bar_matching.browser.js");
const fixturePath = path.join(repoRoot, "final_bar_matching", "fixtures", "full_score.draft.example.json");
const parserFixturePath = path.join(repoRoot, "final_bar_matching", "fixtures", "fur_elise.parser.example.json");
const bundleBuilder = require(buildScript);

function runBuilder() {
    bundleBuilder.main();
}

function loadBundleContext() {
    const context = {
        window: {}
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(bundlePath, "utf8"), context, {
        filename: "final_bar_matching.browser.js"
    });
    return context;
}

function midiToFrequencyHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

function frequencyPacket(eventId, timestampMs, midiNotes) {
    return {
        type: "frequency_event",
        eventId,
        timestampMs,
        peaks: midiNotes.map((midi, index) => ({
            frequencyHz: midiToFrequencyHz(midi),
            magnitude: 0.9 - index * 0.05
        }))
    };
}

function eventTypes(result) {
    if (!result.trackerResult) return [];
    if (result.trackerResult.type === "TRACKER_EVENTS") {
        return result.trackerResult.events.map((event) => event.type);
    }
    return [result.trackerResult.type];
}

function assertHasType(result, type) {
    assert.ok(eventTypes(result).includes(type), `Expected ${type}, got ${eventTypes(result).join(", ")}`);
}

function assertNotHasType(result, type) {
    assert.equal(eventTypes(result).includes(type), false, `Unexpected ${type}`);
}

function runBrowserBundleSmokeTest() {
    runBuilder();
    const firstBundle = fs.readFileSync(bundlePath, "utf8");
    runBuilder();
    const secondBundle = fs.readFileSync(bundlePath, "utf8");
    assert.equal(secondBundle, firstBundle);

    const context = loadBundleContext();
    const api = context.window.FinalBarMatching;

    assert.ok(api);
    assert.equal(typeof api.normaliseDraftFullScore, "function");
    assert.equal(typeof api.normalizeDraftFullScore, "function");
    assert.equal(typeof api.createFrequencyScorePipeline, "function");
    assert.equal(typeof api.FrequencyScorePipeline, "function");
    assert.equal(typeof api.createFullScoreProgressTracker, "function");
    assert.equal(typeof api.frequencyHzToMidiDetails, "function");

    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    const normalized = api.normaliseDraftFullScore(fixture, { groupingTolerance: 0.03 });
    assert.equal(normalized.ok, true);
    assert.equal(normalized.score.pages.length, 2);

    const parserFixture = JSON.parse(fs.readFileSync(parserFixturePath, "utf8"));
    const normalizedParserScore = api.normaliseDraftFullScore(parserFixture, { groupingTolerance: 0.001 });
    assert.equal(normalizedParserScore.ok, true);
    assert.equal(normalizedParserScore.score.sourceContract, "confirmed_parser_pages_v1");
    assert.equal(normalizedParserScore.score.pages.length, 3);
    assert.equal(Array.isArray(normalizedParserScore.score.pages[0].bars), false);
    assert.deepEqual(
        Array.from(normalizedParserScore.score.pages[0].events.find((event) => event.scoreTimeSec === 2).midi),
        [45, 69]
    );

    const pipeline = api.createFrequencyScorePipeline(normalized.score, {
        trackerOptions: {
            maxTimestampGapMs: 5000,
            maxConsecutiveUnrelated: 1
        }
    });

    const first = pipeline.acceptFrequencyEvent(frequencyPacket(1, 1000, [48, 60]));
    assert.equal(first.ok, true);
    assert.deepEqual(Array.from(first.observedEvent.midi), [48, 60]);
    assert.equal(first.trackerResult.type, "SCORE_PROGRESS");
    assert.equal(first.trackerResult.completedEvents, 1);

    const second = pipeline.acceptFrequencyEvent(frequencyPacket(2, 1500, [64]));
    assertHasType(second, "BAR_COMPLETED");

    const third = pipeline.acceptFrequencyEvent(frequencyPacket(3, 2000, [48, 67]));
    assert.equal(third.ok, true);

    const fourth = pipeline.acceptFrequencyEvent(frequencyPacket(4, 2500, [69]));
    assertHasType(fourth, "PAGE_END_REACHED");

    const fifth = pipeline.acceptFrequencyEvent(frequencyPacket(5, 3000, [62, 65]));
    assertHasType(fifth, "SCORE_COMPLETED");
    assertNotHasType(fifth, "PAGE_END_REACHED");

    const malformed = pipeline.acceptFrequencyEvent({
        type: "frequency_event",
        eventId: 6,
        timestampMs: 3500,
        peaks: [{ frequencyHz: -1, magnitude: 0.8 }]
    });
    assert.equal(malformed.ok, false);
    assert.equal(malformed.trackerResult, null);
}

if (require.main === module) {
    runBrowserBundleSmokeTest();
    console.log("Browser bundle smoke test passed.");
}

module.exports = {
    runBrowserBundleSmokeTest
};
