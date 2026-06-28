#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "board_pins.h"
#include "startup.h"
#include "hal/capture_source.h"
#include "hal/wifi_sta.h"
#include "hal/ws_stream.h"
#include "core/esp_hint.h"
#include "core/ringbuf.h"
#include "core/pcm_framer.h"

static const char *TAG = "MAIN";
#define FIRMWARE_VERSION  "v2.0.0"

static int16_t s_rb_storage[4096];
static ringbuf_t s_ringbuf;
static pcm_framer_t s_framer;

static void esp_hint_log_event(const char *note_event_json, void *ctx) {
    (void)ctx;
    ESP_LOGI("ESP_HINT_EVENT", "%s", note_event_json);
}

// capture_task: runs on core 1, feeds ring buffer
static void capture_task(void *arg) {
    capture_source_t *src = capture_source_get_default();
    ESP_ERROR_CHECK(src->init(src));
    int16_t samples[64];
    while (1) {
        if (src->read(src, samples, 64) == ESP_OK) {
            esp_hint_feed(samples, 64);
            for (int i = 0; i < 64; i++) ringbuf_push(&s_ringbuf, samples[i]);
        }
    }
}

// stream_task: runs on core 0, drains ring buffer through framer to websocket
static void stream_task(void *arg) {
    framer_frame_t frame;
    int16_t s;
    while (1) {
        while (ringbuf_pop(&s_ringbuf, &s)) {
            if (pcm_framer_push(&s_framer, s, &frame)) {
                ws_stream_send_frame(frame.data, frame.len);
            }
        }
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}

extern "C" void app_main(void) {
    // 1. NVS
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // 2. Startup (auto-start streaming, no button required)
    startup_init();
    startup_force_stream();

    // 3. Boot log
    ESP_LOGI(TAG, "=== Podles DSP Piano %s ===", FIRMWARE_VERSION);
    ESP_LOGI(TAG, "role=dsp-stream  sample_rate=%d", BOARD_SAMPLE_RATE_HZ);
    ESP_LOGI(TAG, "server_uri=%s", CONFIG_SERVER_URI);
    ESP_LOGI(TAG, "capture_task->core1  stream_task->core0");

    // 4. Wi-Fi STA
    ESP_ERROR_CHECK(wifi_sta_init());

    // 5. WebSocket streamer
    ws_stream_config_t ws_cfg = {
        .server_uri  = CONFIG_SERVER_URI,
        .sample_rate = BOARD_SAMPLE_RATE_HZ,
    };
    ESP_ERROR_CHECK(ws_stream_init(&ws_cfg));

    // 6. Ring buffer + framer
    ringbuf_init(&s_ringbuf, s_rb_storage, 4096);
    pcm_framer_init(&s_framer, BOARD_SAMPLE_RATE_HZ);
    esp_hint_init(esp_hint_log_event, NULL, BOARD_SAMPLE_RATE_HZ);

    // 7. Launch pinned tasks
    xTaskCreatePinnedToCore(capture_task, "capture", 4096, NULL, 5, NULL, 1);
    xTaskCreatePinnedToCore(stream_task,  "stream",  4096, NULL, 4, NULL, 0);

    // 8. Metrics loop
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(10000));
        ws_stream_metrics_t m = ws_stream_get_metrics();
        ESP_LOGI(TAG, "sent=%lu reconnects=%lu dropped=%lu",
                 (unsigned long)m.frames_sent,
                 (unsigned long)m.reconnects,
                 (unsigned long)m.dropped_frames);
    }
}
