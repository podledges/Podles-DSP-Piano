#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_wifi.h"
#include "esp_mac.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "esp_now.h"
#include "driver/gpio.h"

static const char *TAG = "ESPNOW_RX";
const gpio_num_t TRANSISTOR_PIN = GPIO_NUM_4;

// Handle for the blink task
static TaskHandle_t blink_task_handle = NULL;

// 1. Task dedicated to blinking the GPIO safely
void blink_task(void *pvParameter) {
    // Configure the GPIO pin
    gpio_reset_pin(TRANSISTOR_PIN);
    gpio_set_direction(TRANSISTOR_PIN, GPIO_MODE_OUTPUT);
    gpio_set_level(TRANSISTOR_PIN, 0);

    while (1) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        
        gpio_set_level(TRANSISTOR_PIN, 1);
        vTaskDelay(pdMS_TO_TICKS(50)); // 50ms blink duration
        gpio_set_level(TRANSISTOR_PIN, 0);
    }
}

// 2. ESP-NOW Receive Callback (ESP-IDF v5.x signature)
void on_data_recv(const esp_now_recv_info_t *recv_info, const uint8_t *data, int len) {
    // Notify the blink task that data arrived
    if (blink_task_handle != NULL) {
        BaseType_t xHigherPriorityTaskWoken = pdFALSE;
        vTaskNotifyGiveFromISR(blink_task_handle, &xHigherPriorityTaskWoken);
        if (xHigherPriorityTaskWoken) {
            portYIELD_FROM_ISR();
        }
    }
    
    ESP_LOGI(TAG, "Received %d bytes", len);
}

extern "C" void app_main(void) {
    // Initialize NVS (Required for Wi-Fi/MAC operations)
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        nvs_flash_erase();
        nvs_flash_init();
    }

    // Put the Wi-Fi hardware into Station Mode
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    esp_wifi_init(&cfg);
    esp_wifi_set_mode(WIFI_MODE_STA);
    esp_wifi_start();

    // Retrieve and format the MAC Address
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);

    ESP_LOGI(TAG, "=======================================");
    ESP_LOGI(TAG, "RECEIVER MAC ADDRESS: %02X:%02X:%02X:%02X:%02X:%02X", 
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    ESP_LOGI(TAG, "=======================================");

    // 3. Create the blink task before initializing ESP-NOW
    xTaskCreate(blink_task, "blink_task", 2048, NULL, 5, &blink_task_handle);

    // 4. Initialize ESP-NOW
    if (esp_now_init() != ESP_OK) {
        ESP_LOGE(TAG, "Error initializing ESP-NOW");
        return;
    }

    // 5. Register the receive callback
    esp_now_register_recv_cb(on_data_recv);
}