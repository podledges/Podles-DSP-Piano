#include "capture_adc.h"
#include "capture_source.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

#include "board_pins.h"
#include "esp_adc/adc_continuous.h"
#include "esp_err.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "hal/adc_types.h"
#include "soc/soc_caps.h"

static const char *TAG = "CAPTURE_ADC";

typedef struct {
    capture_source_t base;
    adc_continuous_handle_t handle;
    size_t frame_samples;
    bool initialized;
    bool started;
} capture_adc_source_t;

static int16_t clamp_int16(int32_t value)
{
    if (value > INT16_MAX) {
        return INT16_MAX;
    }
    if (value < INT16_MIN) {
        return INT16_MIN;
    }
    return (int16_t)value;
}

static esp_err_t adc_stop_and_delete(capture_adc_source_t *adc)
{
    esp_err_t result = ESP_OK;

    if (adc->started) {
        result = adc_continuous_stop(adc->handle);
        if (result == ESP_OK || result == ESP_ERR_INVALID_STATE) {
            adc->started = false;
        }
    }

    if (adc->handle != NULL) {
        esp_err_t delete_result = adc_continuous_deinit(adc->handle);
        if (result == ESP_OK) {
            result = delete_result;
        }
        adc->handle = NULL;
        adc->frame_samples = 0;
    }

    return result;
}

static esp_err_t adc_configure(capture_adc_source_t *adc, size_t n_samples)
{
    if (n_samples == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    if (n_samples > UINT32_MAX / SOC_ADC_DIGI_RESULT_BYTES / 4) {
        return ESP_ERR_INVALID_SIZE;
    }

    if (adc->handle != NULL && adc->frame_samples == n_samples) {
        return ESP_OK;
    }

    esp_err_t err = adc_stop_and_delete(adc);
    if (err != ESP_OK) {
        return err;
    }

    const uint32_t conv_frame_size = (uint32_t)(n_samples * SOC_ADC_DIGI_RESULT_BYTES);
    adc_continuous_handle_cfg_t handle_configuration = {
        .max_store_buf_size = conv_frame_size * 4,
        .conv_frame_size = conv_frame_size,
    };
    err = adc_continuous_new_handle(&handle_configuration, &adc->handle);
    if (err != ESP_OK) {
        adc->handle = NULL;
        return err;
    }

    adc_continuous_config_t digital_configuration = {
        .sample_freq_hz = BOARD_SAMPLE_RATE_HZ,
        .conv_mode = ADC_CONV_SINGLE_UNIT_1,
        .format = ADC_DIGI_OUTPUT_FORMAT_TYPE1,
        .pattern_num = 1,
    };

    adc_digi_pattern_config_t adc_pattern = {
        .atten = BOARD_PIEZO_ADC_ATTEN,
        .channel = BOARD_PIEZO_ADC_CHANNEL,
        .unit = BOARD_PIEZO_ADC_UNIT,
        .bit_width = BOARD_PIEZO_ADC_BITWIDTH,
    };
    digital_configuration.adc_pattern = &adc_pattern;

    err = adc_continuous_config(adc->handle, &digital_configuration);
    if (err != ESP_OK) {
        (void)adc_stop_and_delete(adc);
        return err;
    }

    adc->frame_samples = n_samples;
    return ESP_OK;
}

static esp_err_t adc_init(capture_source_t *self)
{
    if (self == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    capture_adc_source_t *adc = (capture_adc_source_t *)self;

    adc->initialized = true;
    return ESP_OK;
}

static esp_err_t adc_read(capture_source_t *self, int16_t *out, size_t n_samples)
{
    if (self == NULL || out == NULL || n_samples == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    capture_adc_source_t *adc = (capture_adc_source_t *)self;
    if (!adc->initialized) {
        esp_err_t init_err = adc_init(self);
        if (init_err != ESP_OK) {
            return init_err;
        }
    }

    esp_err_t err = adc_configure(adc, n_samples);
    if (err != ESP_OK) {
        return err;
    }

    if (!adc->started) {
        err = adc_continuous_start(adc->handle);
        if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
            return err;
        }
        adc->started = true;
    }

    const uint32_t raw_size = (uint32_t)(n_samples * SOC_ADC_DIGI_RESULT_BYTES);
    uint8_t *raw = (uint8_t *)malloc(raw_size);
    if (raw == NULL) {
        return ESP_ERR_NO_MEM;
    }

    uint32_t total_bytes = 0;
    while (total_bytes < raw_size) {
        uint32_t bytes_read = 0;
        err = adc_continuous_read(
            adc->handle,
            raw + total_bytes,
            raw_size - total_bytes,
            &bytes_read,
            portMAX_DELAY);
        if (err != ESP_OK) {
            free(raw);
            return err;
        }
        if (bytes_read == 0) {
            free(raw);
            return ESP_ERR_TIMEOUT;
        }
        total_bytes += bytes_read;
    }

    int64_t sum = 0;
    for (size_t i = 0; i < n_samples; ++i) {
        adc_digi_output_data_t *sample = (adc_digi_output_data_t *)&raw[i * SOC_ADC_DIGI_RESULT_BYTES];
        sum += sample->type1.data;
    }

    const int32_t mean = (int32_t)(sum / (int64_t)n_samples);
    for (size_t i = 0; i < n_samples; ++i) {
        adc_digi_output_data_t *sample = (adc_digi_output_data_t *)&raw[i * SOC_ADC_DIGI_RESULT_BYTES];
        const int32_t centered = (int32_t)sample->type1.data - mean;
        out[i] = clamp_int16(centered * 32767 / 2048);
    }

    free(raw);
    return ESP_OK;
}

static void adc_deinit(capture_source_t *self)
{
    if (self == NULL) {
        return;
    }

    capture_adc_source_t *adc = (capture_adc_source_t *)self;
    esp_err_t err = adc_stop_and_delete(adc);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "ADC deinit returned %s", esp_err_to_name(err));
    }
    adc->initialized = false;
}

static capture_adc_source_t s_adc_source = {
    .base = { adc_init, adc_read, adc_deinit },
    .handle = NULL,
    .frame_samples = 0,
    .initialized = false,
    .started = false,
};

capture_source_t *capture_adc_get(void)
{
    return &s_adc_source.base;
}

capture_source_t *capture_source_get_default(void)
{
    return capture_adc_get();
}
