#include "ws_stream.h"

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "audio_stream_v1.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_websocket_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "startup.h"

#define WS_STREAM_QUEUE_DEPTH 8
#define WS_STREAM_MAX_FRAME_BYTES 2048
#define WS_STREAM_TX_TASK_STACK 4096
#define WS_STREAM_TX_TASK_PRIORITY 4

typedef struct {
    size_t len;
    uint8_t data[WS_STREAM_MAX_FRAME_BYTES];
} ws_frame_t;

static const char *TAG = "WS_STREAM";

static QueueHandle_t s_tx_queue;
static esp_websocket_client_handle_t s_client;
static TaskHandle_t s_tx_task;
static ws_stream_metrics_t s_metrics;
static portMUX_TYPE s_metrics_lock = portMUX_INITIALIZER_UNLOCKED;
static uint32_t s_hello_seq;
static bool s_client_started;

static bool ws_stream_start_client_if_needed(void)
{
    if (s_client_started) {
        return true;
    }

    esp_err_t err = esp_websocket_client_start(s_client);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start WebSocket client: %s", esp_err_to_name(err));
        return false;
    }

    s_client_started = true;
    return true;
}

static void ws_stream_metrics_inc_frames_sent(void)
{
    portENTER_CRITICAL(&s_metrics_lock);
    s_metrics.frames_sent++;
    portEXIT_CRITICAL(&s_metrics_lock);
}

static void ws_stream_metrics_inc_reconnects(void)
{
    portENTER_CRITICAL(&s_metrics_lock);
    s_metrics.reconnects++;
    portEXIT_CRITICAL(&s_metrics_lock);
}

static void ws_stream_metrics_inc_dropped(void)
{
    portENTER_CRITICAL(&s_metrics_lock);
    s_metrics.dropped_frames++;
    portEXIT_CRITICAL(&s_metrics_lock);
}

static void ws_stream_make_session_id(char *session_id, size_t session_id_len)
{
    static uint32_t seq;
    uint32_t random_part = esp_random();
    uint32_t seq_part = ++seq;

    snprintf(session_id, session_id_len, "esp-%08x-%02x",
             random_part, (unsigned int)(seq_part & 0xff));
}

static void ws_stream_send_hello(void)
{
    uint8_t hello[ASV1_HEADER_SIZE + ASV1_SESSION_SIZE];
    char session_id[ASV1_SESSION_SIZE];

    ws_stream_make_session_id(session_id, sizeof(session_id));
    size_t hello_len = asv1_encode_hello(hello, sizeof(hello), ++s_hello_seq, session_id);
    if (hello_len == 0) {
        ESP_LOGE(TAG, "Failed to encode hello frame");
        return;
    }

    int sent = esp_websocket_client_send_bin(s_client, (const char *)hello,
                                             hello_len, pdMS_TO_TICKS(1000));
    if (sent < 0) {
        ESP_LOGE(TAG, "Failed to send hello frame");
        return;
    }

    ESP_LOGI(TAG, "WebSocket hello sent for session %s", session_id);
}

static void ws_stream_event_handler(void *handler_args, esp_event_base_t base,
                                    int32_t event_id, void *event_data)
{
    (void)handler_args;
    (void)base;
    (void)event_data;

    switch (event_id) {
    case WEBSOCKET_EVENT_CONNECTED:
        ws_stream_metrics_inc_reconnects();
        ESP_LOGI(TAG, "WebSocket connected");
        ws_stream_send_hello();
        startup_set_server_ready(true);
        break;

    case WEBSOCKET_EVENT_DISCONNECTED:
        startup_set_server_ready(false);
        ESP_LOGW(TAG, "WebSocket disconnected; client will reconnect");
        break;

    case WEBSOCKET_EVENT_ERROR:
        startup_set_server_ready(false);
        ESP_LOGE(TAG, "WebSocket error");
        break;

    default:
        break;
    }
}

static void ws_stream_tx_task(void *arg)
{
    (void)arg;
    ws_frame_t frame;

    while (1) {
        if (xQueueReceive(s_tx_queue, &frame, portMAX_DELAY) != pdTRUE) {
            continue;
        }

        if (!ws_stream_start_client_if_needed()) {
            ws_stream_metrics_inc_dropped();
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }

        if (!esp_websocket_client_is_connected(s_client)) {
            ws_stream_metrics_inc_dropped();
            continue;
        }

        int sent = esp_websocket_client_send_bin(s_client, (const char *)frame.data,
                                                 frame.len, pdMS_TO_TICKS(10));
        if (sent >= 0) {
            ws_stream_metrics_inc_frames_sent();
        } else {
            ws_stream_metrics_inc_dropped();
            ESP_LOGW(TAG, "Dropped frame after WebSocket send failure");
        }
    }
}

esp_err_t ws_stream_init(const ws_stream_config_t *cfg)
{
    if (cfg == NULL || cfg->server_uri == NULL || cfg->server_uri[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }

    if (s_client != NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    (void)cfg->sample_rate;

    s_tx_queue = xQueueCreate(WS_STREAM_QUEUE_DEPTH, sizeof(ws_frame_t));
    if (s_tx_queue == NULL) {
        return ESP_ERR_NO_MEM;
    }

    esp_websocket_client_config_t client_cfg = {
        .uri = cfg->server_uri,
        .reconnect_timeout_ms = 1000,
        .network_timeout_ms = 10000,
    };

    s_client = esp_websocket_client_init(&client_cfg);
    if (s_client == NULL) {
        vQueueDelete(s_tx_queue);
        s_tx_queue = NULL;
        return ESP_ERR_NO_MEM;
    }

    esp_err_t err = esp_websocket_register_events(s_client, WEBSOCKET_EVENT_ANY,
                                                  ws_stream_event_handler, NULL);
    if (err != ESP_OK) {
        esp_websocket_client_destroy(s_client);
        s_client = NULL;
        vQueueDelete(s_tx_queue);
        s_tx_queue = NULL;
        return err;
    }

    BaseType_t task_ok = xTaskCreatePinnedToCore(ws_stream_tx_task, "ws_tx",
                                                WS_STREAM_TX_TASK_STACK, NULL,
                                                WS_STREAM_TX_TASK_PRIORITY,
                                                &s_tx_task, 0);
    if (task_ok != pdPASS) {
        esp_websocket_client_destroy(s_client);
        s_client = NULL;
        vQueueDelete(s_tx_queue);
        s_tx_queue = NULL;
        return ESP_ERR_NO_MEM;
    }

    ESP_LOGI(TAG, "WebSocket streamer initialized for %s", cfg->server_uri);
    return ESP_OK;
}

esp_err_t ws_stream_send_frame(const uint8_t *frame_data, size_t frame_len)
{
    if (frame_data == NULL || frame_len == 0 || frame_len > WS_STREAM_MAX_FRAME_BYTES) {
        return ESP_ERR_INVALID_ARG;
    }

    if (s_tx_queue == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    ws_frame_t frame = {
        .len = frame_len,
    };
    memcpy(frame.data, frame_data, frame_len);

    if (xQueueSend(s_tx_queue, &frame, 0) != pdTRUE) {
        ws_stream_metrics_inc_dropped();
        return ESP_ERR_NO_MEM;
    }

    return ESP_OK;
}

ws_stream_metrics_t ws_stream_get_metrics(void)
{
    ws_stream_metrics_t metrics;

    portENTER_CRITICAL(&s_metrics_lock);
    metrics = s_metrics;
    portEXIT_CRITICAL(&s_metrics_lock);

    return metrics;
}

void ws_stream_on_server_ready(void)
{
    startup_set_server_ready(true);
}
