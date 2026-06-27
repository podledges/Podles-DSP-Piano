#ifndef AUDIO_DSP_H
#define AUDIO_DSP_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

/* Public Constants */
#define FFT_SIZE 2048
#define SAMPLE_RATE 20480
#define NOTE_ACTIVATION_THRESHOLD_MV 150

#ifdef __cplusplus
extern "C" {
#endif

/* Public Functions */
void init_dsp_library(void);
void process_audio_frame(const float* sample_buffer, uint32_t signal_amplitude_mv);

#endif // AUDIO_DSP_H

#ifdef __cplusplus
}
#endif