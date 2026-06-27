#include "adc_sampler.h"
#include "esp_log.h"

/* Public Function Implementations */
void init_adc(adc_continuous_handle_t *out_handle)
{
    adc_continuous_handle_cfg_t handle_configuration = {
        .max_store_buf_size = 4096,
        .conv_frame_size    = READ_LENGTH,
    };
    ESP_ERROR_CHECK(adc_continuous_new_handle(&handle_configuration, out_handle));

    adc_continuous_config_t digital_configuration = {
        .sample_freq_hz = SAMPLE_RATE,
        .conv_mode      = ADC_CONV_SINGLE_UNIT_1,
        .format         = ADC_DIGI_OUTPUT_FORMAT_TYPE1,
        .pattern_num    = 1,
    };

    static adc_digi_pattern_config_t adc_pattern = {
        .atten     = ADC_ATTEN_DB_12,
        .channel   = ADC_CHANNEL_6,
        .unit      = ADC_UNIT_1,
        .bit_width = ADC_BITWIDTH_12,
    };
    digital_configuration.adc_pattern = &adc_pattern;
    ESP_ERROR_CHECK(adc_continuous_config(*out_handle, &digital_configuration));
}

uint32_t get_peak_to_peak_mv(const float* raw_samples, uint32_t buffer_size, float* out_avg) 
{
    if (raw_samples == NULL || buffer_size == 0) return 0;

    float max_sample = 0.0f;
    float min_sample = 4095.0f; 
    float sum_sample = 0.0f;

    for (uint32_t i = 0; i < buffer_size; i++) {
        if (raw_samples[i] > max_sample) max_sample = raw_samples[i];
        if (raw_samples[i] < min_sample) min_sample = raw_samples[i];
        sum_sample += raw_samples[i];
    }

    if (out_avg != NULL) {
        *out_avg = sum_sample / buffer_size;
    }

    float peak_to_peak_adc = max_sample - min_sample;
    return (uint32_t)((peak_to_peak_adc * 3300.0f) / 4095.0f);
}