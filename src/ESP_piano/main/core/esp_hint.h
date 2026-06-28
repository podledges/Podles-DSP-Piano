#pragma once
/**
 * esp_hint.h - Optional on-board FFT "instant hint" for Podles DSP Piano v2.
 *
 * When CONFIG_ESP_HINT_ENABLED=y: runs a lightweight monophonic FFT peak-pick
 * on the latest PCM samples and emits a note_events_v1 JSON string with
 * source="esp_hint" via the registered callback.
 *
 * This is NON-AUTHORITATIVE. The laptop server's transcription is the source
 * of truth. esp_hint provides low-latency local feedback only.
 *
 * When CONFIG_ESP_HINT_ENABLED=n (default): all functions are no-ops.
 */
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Callback invoked when a hint note event is ready. JSON is a note_events_v1 string. */
typedef void (*esp_hint_cb_t)(const char *note_event_json, void *ctx);

/**
 * Initialize the hint module. No-op if CONFIG_ESP_HINT_ENABLED=n.
 * @param cb      Callback to receive hint JSON events (may be NULL to disable output).
 * @param ctx     User context passed to cb.
 * @param sample_rate  PCM sample rate (e.g. 16000).
 */
void esp_hint_init(esp_hint_cb_t cb, void *ctx, uint32_t sample_rate);

/**
 * Feed PCM samples. When enough samples accumulate (FFT_SIZE), runs FFT
 * and calls cb if a note is detected above threshold.
 * No-op if CONFIG_ESP_HINT_ENABLED=n.
 */
void esp_hint_feed(const int16_t *samples, size_t n);

/** Returns true if the hint module is enabled at build time. */
bool esp_hint_is_enabled(void);

#ifdef __cplusplus
}
#endif
