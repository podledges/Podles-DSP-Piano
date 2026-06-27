#pragma once

#include <stdbool.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Initialize Wi-Fi in STA mode and connect to the AP configured via
 * menuconfig (CONFIG_WIFI_SSID / CONFIG_WIFI_PASSWORD).
 * Blocks until connected or times out (30s).
 * Returns ESP_OK on success, ESP_ERR_TIMEOUT if not connected in time.
 */
esp_err_t wifi_sta_init(void);

/** Returns true if currently connected. */
bool wifi_sta_is_connected(void);

#ifdef __cplusplus
}
#endif
