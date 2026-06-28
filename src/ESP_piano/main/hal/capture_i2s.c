/* capture_i2s.c - DEFERRED stub. Swap in when I2S codec is validated. */
#include "capture_i2s.h"

#include "esp_err.h"
#include "esp_log.h"

static const char *TAG = "CAPTURE_I2S";

static esp_err_t i2s_init(capture_source_t *self)
{
    (void)self;
    ESP_LOGW(TAG, "I2S capture is DEFERRED - not implemented");
    return ESP_ERR_NOT_SUPPORTED;
}

static esp_err_t i2s_read(capture_source_t *self, int16_t *out, size_t n)
{
    (void)self;
    (void)out;
    (void)n;
    return ESP_ERR_NOT_SUPPORTED;
}

static void i2s_deinit(capture_source_t *self)
{
    (void)self;
}

static capture_source_t s_i2s_source = { i2s_init, i2s_read, i2s_deinit };

capture_source_t *capture_i2s_get(void)
{
    return &s_i2s_source;
}
