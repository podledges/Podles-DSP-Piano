#include "esp_hint.h"

#include "board_pins.h"

#ifdef CONFIG_ESP_HINT_ENABLED

#include <math.h>
#include <stdio.h>

#include "esp_dsp.h"
#include "esp_log.h"
#include "esp_timer.h"

#define HINT_FFT_SIZE   1024
#define HINT_THRESHOLD  200.0f
#define HINT_SESSION_ID "esp_hint"

static const char *TAG = "ESP_HINT";
static esp_hint_cb_t s_cb;
static void *s_ctx;
static uint32_t s_sample_rate = BOARD_SAMPLE_RATE_HZ;
static float s_window[HINT_FFT_SIZE];
static float s_fft_buf[HINT_FFT_SIZE * 2];
static int16_t s_pcm_buf[HINT_FFT_SIZE];
static size_t s_fill;
static uint32_t s_seq;

void esp_hint_init(esp_hint_cb_t cb, void *ctx, uint32_t sample_rate)
{
    s_cb = cb;
    s_ctx = ctx;
    s_sample_rate = (sample_rate > 0) ? sample_rate : BOARD_SAMPLE_RATE_HZ;
    s_fill = 0;
    s_seq = 0;

    dsps_fft2r_init_fc32(NULL, CONFIG_DSP_MAX_FFT_SIZE);
    dsps_wind_hann_f32(s_window, HINT_FFT_SIZE);
    ESP_LOGI(TAG, "esp_hint enabled, FFT_SIZE=%d sample_rate=%lu",
             HINT_FFT_SIZE, (unsigned long)s_sample_rate);
}

static void esp_hint_run(void)
{
    for (int i = 0; i < HINT_FFT_SIZE; i++) {
        float dc_removed = (float)s_pcm_buf[i];
        s_fft_buf[2 * i] = dc_removed * s_window[i];
        s_fft_buf[(2 * i) + 1] = 0.0f;
    }

    dsps_fft2r_fc32(s_fft_buf, HINT_FFT_SIZE);
    dsps_bit_rev_fc32(s_fft_buf, HINT_FFT_SIZE);

    int peak_bin = 1;
    float peak_mag = 0.0f;
    for (int i = 1; i < HINT_FFT_SIZE / 2; i++) {
        float re = s_fft_buf[2 * i];
        float im = s_fft_buf[(2 * i) + 1];
        float mag = sqrtf((re * re) + (im * im));
        if (mag > peak_mag) {
            peak_mag = mag;
            peak_bin = i;
        }
    }

    if (peak_mag < HINT_THRESHOLD) {
        return;
    }

    float freq_hz = (float)peak_bin * ((float)s_sample_rate / (float)HINT_FFT_SIZE);
    if (freq_hz < 27.5f || freq_hz > 4186.0f) {
        return;
    }

    int midi = (int)(69.0f + 12.0f * log2f(freq_hz / 440.0f) + 0.5f);
    if (midi < 21 || midi > 108) {
        return;
    }

    if (s_cb != NULL) {
        char json[192];
        int64_t onset_ms = esp_timer_get_time() / 1000;
        snprintf(json, sizeof(json),
                 "{\"type\":\"note_on\",\"session_id\":\"%s\","
                 "\"midi\":%d,\"onset_ms\":%lld,\"velocity\":100,"
                 "\"source\":\"esp_hint\",\"confidence\":0.5,\"seq\":%lu}",
                 HINT_SESSION_ID, midi, (long long)onset_ms,
                 (unsigned long)s_seq++);
        s_cb(json, s_ctx);
    }
}

void esp_hint_feed(const int16_t *samples, size_t n)
{
    if (samples == NULL || n == 0) {
        return;
    }

    for (size_t i = 0; i < n; i++) {
        s_pcm_buf[s_fill++] = samples[i];
        if (s_fill >= HINT_FFT_SIZE) {
            esp_hint_run();
            s_fill = 0;
        }
    }
}

bool esp_hint_is_enabled(void)
{
    return true;
}

#else

void esp_hint_init(esp_hint_cb_t cb, void *ctx, uint32_t sample_rate)
{
    (void)cb;
    (void)ctx;
    (void)sample_rate;
}

void esp_hint_feed(const int16_t *samples, size_t n)
{
    (void)samples;
    (void)n;
}

bool esp_hint_is_enabled(void)
{
    return false;
}

#endif
