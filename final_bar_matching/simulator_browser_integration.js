"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const bundlePath = path.join(repoRoot, "web_app", "final_bar_matching.browser.js");
const integrationPath = path.join(repoRoot, "web_app", "score_matching_integration.js");
const appPath = path.join(repoRoot, "web_app", "app.js");
const indexPath = path.join(repoRoot, "web_app", "index.html");
const parserFixturePath = path.join(repoRoot, "final_bar_matching", "fixtures", "fur_elise.parser.example.json");

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
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

function loadBrowserContext() {
    const capturedEvents = [];
    let pageTurnCalls = 0;

    class CustomEvent {
        constructor(type, options = {}) {
            this.type = type;
            this.detail = options.detail;
        }
    }

    const window = {
        CustomEvent,
        dispatchEvent(event) {
            capturedEvents.push(event);
            return true;
        },
        addEventListener() {},
        renderPdfPage() {
            pageTurnCalls += 1;
        }
    };

    const context = {
        window,
        CustomEvent,
        JSON,
        Math,
        Number,
        Array,
        Object,
        String,
        Boolean,
        Date,
        Set,
        Map
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(bundlePath, "utf8"), context, {
        filename: "final_bar_matching.browser.js"
    });
    vm.runInContext(fs.readFileSync(integrationPath, "utf8"), context, {
        filename: "score_matching_integration.js"
    });

    return {
        context,
        window,
        capturedEvents,
        getPageTurnCalls: () => pageTurnCalls
    };
}

function eventCount(capturedEvents, type) {
    return capturedEvents.filter((event) => event.type === type).length;
}

function playEvents(integration, events, eventIdStart, timestampStart) {
    let result = null;
    events.forEach((event, index) => {
        result = integration.handleTextMessage(JSON.stringify(frequencyPacket(
            eventIdStart + index,
            timestampStart + index * 200,
            event.midi
        )));
        assert.equal(result.handled, true);
        assert.equal(result.ok, true);
    });
    return result;
}

function runBrowserIntegrationSimulatorTests() {
    const indexHtml = fs.readFileSync(indexPath, "utf8");
    assert.ok(
        indexHtml.indexOf("final_bar_matching.browser.js") <
            indexHtml.indexOf("score_matching_integration.js")
    );
    assert.ok(indexHtml.indexOf("score_matching_integration.js") < indexHtml.indexOf("app.js"));

    const appSource = fs.readFileSync(appPath, "utf8");
    assert.ok(appSource.includes("event.data instanceof ArrayBuffer"));
    assert.ok(appSource.includes("const view = new DataView(event.data);"));
    assert.ok(appSource.includes("const status = view.getUint8(0);"));
    assert.ok(appSource.includes("typeof event.data === \"string\""));
    assert.ok(appSource.includes("ScoreMatchingIntegration.handleTextMessage(event.data)"));

    const fixture = JSON.parse(fs.readFileSync(parserFixturePath, "utf8"));
    const fixtureBefore = JSON.stringify(fixture);
    const browser = loadBrowserContext();
    const integration = browser.window.ScoreMatchingIntegration;

    assert.ok(browser.window.FinalBarMatching);
    assert.ok(integration);
    assert.equal(typeof integration.initializeScore, "function");
    assert.equal(typeof integration.acceptFrequencyEvent, "function");
    assert.equal(typeof integration.handleTextMessage, "function");
    assert.equal(typeof integration.reset, "function");
    assert.equal(typeof integration.getStatus, "function");
    assert.equal(typeof integration.isInitialized, "function");

    const invalidInit = integration.initializeScore({ pages: [] });
    assert.equal(invalidInit.ok, false);
    assert.equal(integration.isInitialized(), false);

    const init = integration.initializeScore(fixture, {
        normalizerOptions: { groupingTolerance: 0.001 },
        trackerOptions: { maxTimestampGapMs: 10000, maxConsecutiveUnrelated: 1 }
    });
    assert.equal(init.ok, true);
    assert.equal(integration.isInitialized(), true);
    assert.equal(JSON.stringify(fixture), fixtureBefore);
    assert.equal(init.score.sourceContract, "confirmed_parser_pages_v1");
    assert.equal(Array.isArray(init.score.pages[0].bars), false);

    const malformed = integration.handleTextMessage("{not json");
    assert.equal(malformed.ok, false);
    assert.equal(malformed.handled, false);

    const unsupported = integration.handleTextMessage(JSON.stringify({ type: "other_message" }));
    assert.equal(unsupported.ok, true);
    assert.equal(unsupported.handled, false);
    assert.equal(unsupported.ignored, true);

    const firstPacket = frequencyPacket(1, 1000, init.score.pages[0].events[0].midi);
    const first = integration.handleTextMessage(JSON.stringify(firstPacket));
    assert.equal(first.ok, true);
    assert.equal(first.handled, true);
    assert.deepEqual(Array.from(first.pipelineResult.observedEvent.midi), Array.from(init.score.pages[0].events[0].midi));
    assert.equal(eventCount(browser.capturedEvents, "score-progress"), 1);

    const duplicate = integration.handleTextMessage(JSON.stringify(firstPacket));
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.handled, true);
    assert.equal(duplicate.dispatchedEvents.length, 0);
    assert.equal(eventCount(browser.capturedEvents, "score-progress"), 1);
    assert.equal(eventCount(browser.capturedEvents, "page-end-reached"), 0);

    playEvents(integration, init.score.pages[0].events.slice(1), 2, 1200);
    assert.equal(eventCount(browser.capturedEvents, "page-end-reached"), 1);
    assert.equal(eventCount(browser.capturedEvents, "bar-completed"), 0);

    playEvents(integration, init.score.pages[1].events, 100, 10000);
    assert.equal(eventCount(browser.capturedEvents, "page-end-reached"), 2);
    assert.equal(eventCount(browser.capturedEvents, "score-completed"), 0);

    playEvents(integration, init.score.pages[2].events, 200, 20000);
    assert.equal(eventCount(browser.capturedEvents, "score-completed"), 1);
    assert.equal(eventCount(browser.capturedEvents, "page-end-reached"), 2);
    assert.equal(eventCount(browser.capturedEvents, "bar-completed"), 0);

    const afterComplete = integration.handleTextMessage(JSON.stringify(frequencyPacket(
        300,
        30000,
        init.score.pages[2].events[0].midi
    )));
    assert.equal(afterComplete.ok, true);
    assert.equal(afterComplete.dispatchedEvents.length, 0);
    assert.equal(eventCount(browser.capturedEvents, "score-completed"), 1);

    const reset = integration.reset();
    assert.equal(reset.ok, true);
    assert.equal(reset.dispatchedEvents.includes("score-progress"), true);

    const reinit = integration.initializeScore(cloneJson(fixture), {
        normalizerOptions: { groupingTolerance: 0.001 },
        trackerOptions: { maxTimestampGapMs: 10000, maxConsecutiveUnrelated: 1 }
    });
    assert.equal(reinit.ok, true);
    const replay = integration.handleTextMessage(JSON.stringify(frequencyPacket(
        400,
        40000,
        reinit.score.pages[0].events[0].midi
    )));
    assert.equal(replay.ok, true);
    assert.equal(eventCount(browser.capturedEvents, "score-progress") >= 3, true);
    assert.equal(browser.getPageTurnCalls(), 0);
}

if (require.main === module) {
    runBrowserIntegrationSimulatorTests();
    console.log("Browser integration simulator tests passed.");
}

module.exports = {
    runBrowserIntegrationSimulatorTests
};
