#pragma once

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    const char *server_uri;   /* e.g. "ws://192.168.1.100:8000/stream" */
    uint16_t    sample_rate;
} ws_stream_config_t;

typedef struct {
    uint32_t frames_sent;
    uint32_t reconnects;
    uint32_t dropped_frames;
} ws_stream_metrics_t;

/**
 * Initialize the websocket streamer. Does NOT connect yet.
 * Call after wifi_sta_init() succeeds.
 */
esp_err_t ws_stream_init(const ws_stream_config_t *cfg);

/**
 * Send a pre-encoded audio_stream_v1 frame (output of pcm_framer_push).
 * Non-blocking: if the TX queue is full, drops the frame and increments dropped_frames.
 * Returns ESP_OK if queued, ESP_ERR_NO_MEM if dropped.
 */
esp_err_t ws_stream_send_frame(const uint8_t *frame_data, size_t frame_len);

/** Get current metrics (thread-safe copy). */
ws_stream_metrics_t ws_stream_get_metrics(void);

/** Called by startup module to indicate server acknowledgement. */
void ws_stream_on_server_ready(void);

#ifdef __cplusplus
}
#endif
