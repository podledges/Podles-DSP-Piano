#include "audio_dsp.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "web_server.h"
#include "dsps_fft2r.h"
#include "dsps_math.h"
#include "dsps_wind.h"  
#include <math.h>
#include <stdio.h>

static const char *TAG = "DSP_MODULE";

#define HPS_HARMONICS                5      // Analyzes fundamental frequency and     
#define HOLD_WINDOW_MS               200      
#define MIN_VALID_MAGNITUDE          800.0f   
#define MIN_PEAK_TO_AVERAGE_RATIO    5.0f     
#define NOTE_DEBOUNCE_FRAMES         3  

/* Private State (Hidden from main.c) */
__attribute__((aligned(16))) static float fft_input[FFT_SIZE * 2];
static float fft_window[FFT_SIZE];
static float fft_magnitude[FFT_SIZE / 2];

static float hold_peak_magnitude = 0.0f;
static int   hold_peak_bin_index = -1;
static float hold_peak_signal_to_noise_ratio = 0.0f;
static int64_t hold_start_time = 0;

static int last_candidate_midi = -1;
static int candidate_repeat_count = 0;
static float dc_bias = 2048.0f;

static const char *note_names[12] = {
    "C", "C#", "D", "D#", "E", "F",
    "F#", "G", "G#", "A", "A#", "B"
};

/* Private Helper Functions */
static inline float remove_dc_offset(float sample) {
    dc_bias = 0.999f * dc_bias + 0.001f * sample;
    return sample - dc_bias;
}



static void prepare_fft_input(const float* sample_buffer) {     // proccesses first few (FFT_SIZE) samples in sample_buffer

    for (int i = 0; i < FFT_SIZE; i++) {
        float windowed = remove_dc_offset(sample_buffer[i]) * fft_window[i];
        fft_input[2*i]     = windowed;
        fft_input[2*i + 1] = 0.0f;
    }
}

static void compute_magnitude_spectrum(void) {
    dsps_fft2r_fc32(fft_input, FFT_SIZE);
    dsps_bit_rev_fc32(fft_input, FFT_SIZE);     //orders the FFT output in order

    for (int i = 1; i < FFT_SIZE / 2; i++) {
        float real_part = fft_input[2*i];
        float imaginary_part= fft_input[2*i + 1];
        fft_magnitude[i] = sqrtf(real_part*real_part + imaginary_part*imaginary_part);
    }
}

static void run_fft_frame(const float* sample_buffer) {

    prepare_fft_input(sample_buffer);
    compute_magnitude_spectrum();

}

/* Public Function Implementations */
void init_dsp_library(void) {
    dsps_fft2r_init_fc32(NULL, CONFIG_DSP_MAX_FFT_SIZE);
    dsps_wind_hann_f32(fft_window, FFT_SIZE);
}

void process_audio_frame(const float* sample_buffer, uint32_t signal_amplitude_mv) {
    if (signal_amplitude_mv > NOTE_ACTIVATION_THRESHOLD_MV) {       /// WHERE IS THIS DEFINED
        run_fft_frame(sample_buffer);
        
        int64_t current_time = esp_timer_get_time();
        if ((current_time - hold_start_time) >= (HOLD_WINDOW_MS * 1000)) {          // avg worst case latency = 100ms 
            float frequency_hz = (float)hold_peak_bin_index * ((float)SAMPLE_RATE / (float)FFT_SIZE);
            
            if (hold_peak_magnitude >= MIN_VALID_MAGNITUDE && 
                hold_peak_signal_to_noise_ratio >= MIN_PEAK_TO_AVERAGE_RATIO &&
                frequency_hz >= 27.5f && frequency_hz <= 4186.0f) {
                
                int current_midi_note = (int)(69.0f + 12.0f * log2f(frequency_hz / 440.0f) + 0.5f);
                
                if (debounce_note_selection(current_midi_note)) {
                    char note_string[32];
                    frequency_to_note(frequency_hz, note_string, sizeof(note_string));
                    ESP_LOGI(TAG, "FFT SUCCESS: %-10s | %7.1f Hz | Mag: %6.0f | VPP: %lu mV",
                             note_string, frequency_hz, hold_peak_magnitude, signal_amplitude_mv);
                    web_server_send_midi_packet(0x90, current_midi_note, 100);
                }
            }
            
            hold_peak_magnitude = 0.0f;
            hold_peak_bin_index = -1;
            hold_peak_signal_to_noise_ratio = 0.0f;
            hold_start_time = esp_timer_get_time();
        }
    }
}


/* deprecated functions */

/* 
static void frequency_to_note(float frequency_hz, char *output_string, size_t output_size) {
    float midi_value = 69.0f + 12.0f * log2f(frequency_hz / 440.0f);
    int midi_rounded = (int)(midi_value + 0.5f);
    int octave_number = (midi_rounded / 12) - 1;
    const char *note_name = note_names[midi_rounded % 12];
    float cents_deviation = (midi_value - midi_rounded) * 100.0f;
    snprintf(output_string, output_size, "%s%d (%+.0f cents)", note_name, octave_number, cents_deviation);
}

static bool debounce_note_selection(int current_midi_note) {
    if (current_midi_note == last_candidate_midi) {
        candidate_repeat_count++;
    } else {
        last_candidate_midi = current_midi_note;
        candidate_repeat_count = 1;
    }
    return (candidate_repeat_count >= NOTE_DEBOUNCE_FRAMES);
}

static void run_fft_frame(const float* sample_buffer) {

    // proccesses first few (FFT_SIZE) samples in sample_buffer
    for (int i = 0; i < FFT_SIZE; i++) {        
        float centered_sample = remove_dc_offset(sample_buffer[i]);
        fft_input[2*i] = centered_sample * fft_window[i];               // what is fft_window exactly?? 
        fft_input[2*i + 1] = 0.0f;                                      // why do we alternate empty values? 
    }

    dsps_fft2r_fc32(fft_input, FFT_SIZE);
    dsps_bit_rev_fc32(fft_input, FFT_SIZE);

    float sum_magnitude = 0.0f;                                         // neccessary? if i have the envelope detector working to obtain amplitude
    for (int i = 1; i < FFT_SIZE / 2; i++) {     
        float real_part = fft_input[2*i];
        float imaginary_part = fft_input[2*i + 1];
        float current_magnitude = sqrtf(real_part*real_part + imaginary_part*imaginary_part);
        fft_magnitude[i] = current_magnitude;
        sum_magnitude += current_magnitude;
    }

    float peak_hps_value = 0.0f;                        // hps == harmonic product spectrum
    int peak_bin_index = 0;
    for (int i = 1; i < (FFT_SIZE / 2) / HPS_HARMONICS; i++) {
        float hps_product = fft_magnitude[i];
        for (int h = 2; h <= HPS_HARMONICS; h++) {
            hps_product *= fft_magnitude[i * h];
        }
        if (hps_product > peak_hps_value) {
            peak_hps_value = hps_product;
            peak_bin_index = i;
        }
    }

    float peak_magnitude = fft_magnitude[peak_bin_index];
    float average_magnitude = sum_magnitude / (float)(FFT_SIZE / 2 - 1);
    float signal_to_noise_ratio = (average_magnitude > 0.0f) ? (peak_magnitude / average_magnitude) : 0.0f;

    if (hold_start_time == 0) hold_start_time = esp_timer_get_time();

    if (peak_magnitude > hold_peak_magnitude) {
        hold_peak_magnitude = peak_magnitude;
        hold_peak_bin_index = peak_bin_index;
        hold_peak_signal_to_noise_ratio = signal_to_noise_ratio;
    }
}
    */