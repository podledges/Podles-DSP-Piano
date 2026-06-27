#pragma once
/**
 * capture_source.h - Swappable audio capture interface.
 *
 * Implement this interface for ADC (now) or I2S (future).
 * The framer (Task 8) calls only these functions.
 */
#include <stdint.h>
#include <stddef.h>
#include "esp_err.h"

typedef struct capture_source_t capture_source_t;

struct capture_source_t {
    /** Initialize the capture hardware. Returns ESP_OK on success. */
    esp_err_t (*init)(capture_source_t *self);
    /**
     * Read exactly `n_samples` int16 samples into `out`.
     * Blocks until samples available. Returns ESP_OK or an error code.
     * Output is DC-removed, centered around 0, signed int16 mono.
     */
    esp_err_t (*read)(capture_source_t *self, int16_t *out, size_t n_samples);
    /** Release hardware resources. */
    void      (*deinit)(capture_source_t *self);
};

/** Returns the active capture source (ADC by default; swap for I2S later). */
capture_source_t *capture_source_get_default(void);
