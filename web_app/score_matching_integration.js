(function () {
    "use strict";

    var EVENT_NAME_BY_TRACKER_TYPE = {
        SCORE_PROGRESS: "score-progress",
        BAR_COMPLETED: "bar-completed",
        PAGE_END_REACHED: "page-end-reached",
        SCORE_COMPLETED: "score-completed"
    };

    var state = {
        initialized: false,
        error: null,
        normalizedScore: null,
        pipeline: null,
        options: {}
    };

    function cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function hasBundle() {
        return Boolean(window.FinalBarMatching);
    }

    function makeFailure(error, extra) {
        return Object.assign({
            ok: false,
            error: error,
            initialized: state.initialized
        }, extra || {});
    }

    function makeSuccess(extra) {
        return Object.assign({
            ok: true,
            error: null,
            initialized: state.initialized
        }, extra || {});
    }

    function trackerEventsFromResult(trackerResult) {
        if (!trackerResult) return [];
        if (trackerResult.type === "TRACKER_EVENTS" && Array.isArray(trackerResult.events)) {
            return trackerResult.events;
        }
        return [trackerResult];
    }

    function shouldDispatchTrackerEvent(trackerEvent) {
        if (!trackerEvent || !EVENT_NAME_BY_TRACKER_TYPE[trackerEvent.type]) {
            return false;
        }

        if (trackerEvent.type !== "SCORE_PROGRESS") {
            return true;
        }

        return trackerEvent.accepted === true || trackerEvent.reason === "reset";
    }

    function dispatchTrackerEvents(pipelineResult) {
        var dispatched = [];
        trackerEventsFromResult(pipelineResult.trackerResult).forEach(function (trackerEvent) {
            if (!shouldDispatchTrackerEvent(trackerEvent)) {
                return;
            }

            var eventName = EVENT_NAME_BY_TRACKER_TYPE[trackerEvent.type];
            var detail = {
                trackerEvent: trackerEvent,
                trackerResult: pipelineResult.trackerResult,
                pipelineResult: pipelineResult,
                observedEvent: pipelineResult.observedEvent || null,
                warnings: pipelineResult.warnings || []
            };

            window.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
            dispatched.push(eventName);
        });
        return dispatched;
    }

    function initializeScore(rawParserScore, options) {
        if (!hasBundle()) {
            state.initialized = false;
            state.error = "FinalBarMatching bundle is unavailable";
            return makeFailure(state.error);
        }

        try {
            var sourceCopy = cloneJson(rawParserScore);
            var normalized = window.FinalBarMatching.normaliseDraftFullScore(
                sourceCopy,
                (options && options.normalizerOptions) || {}
            );

            if (!normalized.ok) {
                state.initialized = false;
                state.error = normalized.error || "score normalization failed";
                state.normalizedScore = null;
                state.pipeline = null;
                return makeFailure(state.error, {
                    warnings: normalized.warnings || []
                });
            }

            state.options = options || {};
            state.normalizedScore = normalized.score;
            state.pipeline = window.FinalBarMatching.createFrequencyScorePipeline(
                normalized.score,
                {
                    adapterOptions: state.options.adapterOptions || {},
                    trackerOptions: state.options.trackerOptions || {}
                }
            );
            state.initialized = true;
            state.error = null;

            return makeSuccess({
                score: normalized.score,
                warnings: normalized.warnings || []
            });
        } catch (error) {
            state.initialized = false;
            state.error = error && error.message ? error.message : String(error);
            state.normalizedScore = null;
            state.pipeline = null;
            return makeFailure(state.error);
        }
    }

    function acceptFrequencyEvent(packet) {
        if (!state.initialized || !state.pipeline) {
            return makeFailure("score matching pipeline is not initialized", {
                handled: false
            });
        }

        var pipelineResult = state.pipeline.acceptFrequencyEvent(packet);
        var dispatchedEvents = pipelineResult.ok ? dispatchTrackerEvents(pipelineResult) : [];

        return {
            ok: pipelineResult.ok,
            handled: true,
            error: pipelineResult.error || null,
            pipelineResult: pipelineResult,
            dispatchedEvents: dispatchedEvents,
            warnings: pipelineResult.warnings || []
        };
    }

    function handleTextMessage(text) {
        if (typeof text !== "string") {
            return makeFailure("text message must be a string", {
                handled: false
            });
        }

        var packet;
        try {
            packet = JSON.parse(text);
        } catch (error) {
            return makeFailure("malformed JSON text message", {
                handled: false
            });
        }

        if (!packet || packet.type !== "frequency_event") {
            return makeSuccess({
                handled: false,
                ignored: true,
                reason: "unsupported_json_message_type",
                inputType: packet && packet.type ? packet.type : null
            });
        }

        return acceptFrequencyEvent(packet);
    }

    function reset() {
        if (!state.initialized || !state.pipeline) {
            return makeFailure("score matching pipeline is not initialized", {
                handled: false
            });
        }

        var trackerResult = state.pipeline.reset();
        var pipelineResult = {
            ok: true,
            inputType: "reset",
            observedEvent: null,
            trackerResult: trackerResult,
            warnings: []
        };

        return makeSuccess({
            handled: true,
            trackerResult: trackerResult,
            dispatchedEvents: dispatchTrackerEvents(pipelineResult)
        });
    }

    function getStatus() {
        return {
            initialized: state.initialized,
            error: state.error,
            scoreId: state.normalizedScore ? state.normalizedScore.scoreId : null,
            sourceContract: state.normalizedScore ? state.normalizedScore.sourceContract : null,
            pageCount: state.normalizedScore ? state.normalizedScore.pages.length : 0
        };
    }

    window.ScoreMatchingIntegration = {
        initializeScore: initializeScore,
        acceptFrequencyEvent: acceptFrequencyEvent,
        handleTextMessage: handleTextMessage,
        reset: reset,
        getStatus: getStatus,
        isInitialized: function () {
            return state.initialized;
        }
    };
}());
