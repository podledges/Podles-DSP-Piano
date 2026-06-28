#pragma once
#include "capture_source.h"
/**
 * I2S capture source - DEFERRED. DO NOT IMPLEMENT NOW.
 * Returns ESP_ERR_NOT_SUPPORTED from init().
 */
capture_source_t *capture_i2s_get(void);
