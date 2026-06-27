#include "startup.h"

#include "board_pins.h"

#ifndef BOARD_LED_GPIO
#define BOARD_LED_GPIO 38
#endif

#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

static volatile startup_state_t s_state = STARTUP_STATE_IDLE;
static volatile bool s_server_ready = false;
static SemaphoreHandle_t s_stream_sem = NULL;
static const char *TAG = "STARTUP";

static void startup_button_task(void *arg)
{
    (void)arg;
    int toggle = 0;

    while (1) {
        switch (s_state) {
        case STARTUP_STATE_IDLE:
            toggle = !toggle;
            gpio_set_level(BOARD_LED_GPIO, toggle);
            vTaskDelay(pdMS_TO_TICKS(500));

            if (gpio_get_level(STARTUP_BUTTON_GPIO) == 0) {
                vTaskDelay(pdMS_TO_TICKS(STARTUP_DEBOUNCE_MS));
                if (gpio_get_level(STARTUP_BUTTON_GPIO) == 0) {
                    int64_t press_start = esp_timer_get_time();

                    while (gpio_get_level(STARTUP_BUTTON_GPIO) == 0) {
                        vTaskDelay(pdMS_TO_TICKS(10));
                    }

                    int64_t held_ms = (esp_timer_get_time() - press_start) / 1000;
                    if (held_ms < STARTUP_HOLD_STOP_MS) {
                        s_state = STARTUP_STATE_STREAMING;
                        gpio_set_level(BOARD_LED_GPIO, 1);
                        if (s_stream_sem) {
                            xSemaphoreGive(s_stream_sem);
                        }
                        ESP_LOGI(TAG, "STREAMING started");
                    }
                }
            }
            break;

        case STARTUP_STATE_STREAMING:
            vTaskDelay(pdMS_TO_TICKS(STARTUP_DEBOUNCE_MS));
            if (gpio_get_level(STARTUP_BUTTON_GPIO) == 0) {
                int64_t press_start = esp_timer_get_time();

                while (gpio_get_level(STARTUP_BUTTON_GPIO) == 0) {
                    int64_t held_ms = (esp_timer_get_time() - press_start) / 1000;
                    if (held_ms >= STARTUP_HOLD_STOP_MS) {
                        s_state = STARTUP_STATE_IDLE;
                        s_server_ready = false;
                        gpio_set_level(BOARD_LED_GPIO, 0);
                        ESP_LOGI(TAG, "Returned to IDLE");
                        break;
                    }

                    gpio_set_level(BOARD_LED_GPIO, (held_ms / 125) % 2);
                    vTaskDelay(pdMS_TO_TICKS(10));
                }

                if (s_state == STARTUP_STATE_STREAMING) {
                    gpio_set_level(BOARD_LED_GPIO, 1);
                }
            }
            break;

        default:
            vTaskDelay(pdMS_TO_TICKS(100));
            break;
        }
    }
}

void startup_init(void)
{
    gpio_config_t button_conf = {
        .pin_bit_mask = 1ULL << STARTUP_BUTTON_GPIO,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&button_conf);

    gpio_config_t led_conf = {
        .pin_bit_mask = 1ULL << BOARD_LED_GPIO,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&led_conf);
    gpio_set_level(BOARD_LED_GPIO, 0);

    s_stream_sem = xSemaphoreCreateBinary();
    xTaskCreatePinnedToCore(startup_button_task, "startup_btn", 2048, NULL, 3, NULL, 0);
}

void startup_wait_for_stream(void)
{
    if (s_stream_sem) {
        xSemaphoreTake(s_stream_sem, portMAX_DELAY);
    }
}

startup_state_t startup_get_state(void)
{
    return s_state;
}

void startup_force_stream(void)
{
    s_state = STARTUP_STATE_STREAMING;
    gpio_set_level(BOARD_LED_GPIO, 1);
    if (s_stream_sem) {
        xSemaphoreGive(s_stream_sem);
    }
    ESP_LOGI(TAG, "Auto-start: STREAMING forced");
}

bool startup_is_server_ready(void)
{
    return s_server_ready;
}

void startup_set_server_ready(bool ready)
{
    s_server_ready = ready;
    ESP_LOGI(TAG, "Server ready: %d", ready);
}
