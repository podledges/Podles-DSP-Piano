#ifndef ADC_SAMPLER_H
#define ADC_SAMPLER_H

#include <stdint.h>
#include "esp_adc/adc_continuous.h"

#define SAMPLE_RATE 20480
#define READ_LENGTH 1024

#ifdef __cplusplus
extern "C" {
#endif

/* Public Function Declarations */
void init_adc(adc_continuous_handle_t *out_handle);
uint32_t get_peak_to_peak_mv(const float* raw_samples, uint32_t buffer_size, float* out_avg);

#ifdef __cplusplus
}
#endif

#endif 