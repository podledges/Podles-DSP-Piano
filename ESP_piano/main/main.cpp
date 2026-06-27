#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "soc/soc_caps.h"
#include "nvs_flash.h"

/* created modules */
#include "adc_sampler.h"
#include "audio_dsp.h"
#include "web_server.h"
#include "network.h"

const gpio_num_t ONBOARD_LED_GPIO = (gpio_num_t)2;

static const char *TAG = "MAIN";
static float sample_buffer[FFT_SIZE];
static int   sample_count = 0;

void blink_heartbeat_task(void *pvParameters)
{
    gpio_reset_pin(ONBOARD_LED_GPIO);
    gpio_set_direction(ONBOARD_LED_GPIO, GPIO_MODE_OUTPUT);
    while (1) {
        gpio_set_level(ONBOARD_LED_GPIO, 1);
        vTaskDelay(pdMS_TO_TICKS(1000));
        gpio_set_level(ONBOARD_LED_GPIO, 0);
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
//extern "C" --> Tell Compiler to treat functio as pure C code
extern "C" void app_main(void)
{
    // Initialize NVS (Wi-Fi/networking requires NVS)
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // Boot Wi-Fi AP and HTTP/WebSocket Server
    wifi_init_softap();
    start_web_server();

    // Start ESP-NOW network broadcast
    Network.begin();

    xTaskCreate(blink_heartbeat_task, "blink_task", 2048, NULL, 5, NULL);
    
    init_dsp_library();
    
    adc_continuous_handle_t adc_handle = NULL;  
    init_adc(&adc_handle);
    ESP_ERROR_CHECK(adc_continuous_start(adc_handle));

    static uint8_t raw_result_buffer[READ_LENGTH] = {0};
    uint32_t bytes_read = 0;

    ESP_LOGI(TAG, "=== Sampling started, FFT size = %d, resolution = %.1f Hz ===",
             FFT_SIZE, (float)SAMPLE_RATE / FFT_SIZE);

    while (1) {
        esp_err_t ret = adc_continuous_read(adc_handle, raw_result_buffer,      
                                            READ_LENGTH, &bytes_read, portMAX_DELAY);

        if (ret == ESP_OK) {        
            for (int i = 0; i < bytes_read; i += SOC_ADC_DIGI_RESULT_BYTES) {   
                if (sample_count >= FFT_SIZE) break;
                
                adc_digi_output_data_t *output_data_pointer = (adc_digi_output_data_t*)&raw_result_buffer[i];
                sample_buffer[sample_count++] = (float)output_data_pointer->type1.data;
            }

            /* process audio frame .*/
            if (sample_count >= FFT_SIZE) { // When we sample enough to fill the buffer
                float avg_adc_val = 0.0f;
                
                // Get amplitude using our ADC module
                uint32_t signal_amplitude_mv = get_peak_to_peak_mv(sample_buffer, FFT_SIZE, &avg_adc_val);

                // 2. Process the frame using our DSP module
                process_audio_frame(sample_buffer, signal_amplitude_mv);
                
                sample_count = 0;
            }
        } else {    
            vTaskDelay(pdMS_TO_TICKS(1));
        }
    }
}
/*
// 1. Run FFT and Envelope Reader
uint8_t currentAmplitude = readEnvelope();
uint8_t currentNoteCount = getLoudestPeaks(currentNotesArray); // Up to 10

// 2. Check for Silence (Note-Off)
if (currentAmplitude < THRESHOLD && isPlaying) {
    isPlaying = false;
    PianoEventPacket packet = {0, {0}, 0}; // The Staccato trigger
    Network.broadcast((uint8_t *) &packet, sizeof(packet));
}

// 3. Check for New Attack or Changed Chord
else if (currentAmplitude >= THRESHOLD) {
    isPlaying = true;
    
    // Compare currentNotesArray to Last_Sent_Notes array
    // Compare currentAmplitude to Last_Sent_Amplitude
    
    if (chordChanged || amplitudeSpiked) {
        // Build the packet
        PianoEventPacket packet;
        packet.noteCount = currentNoteCount;
        packet.overallAmplitude = currentAmplitude;
        // Copy currentNotesArray into packet.activeNotes...
        
        // Broadcast!
        Network.broadcast((uint8_t *) &packet, sizeof(packet));
        
        // Update memory
        saveToMemory(currentNotesArray, currentAmplitude);
    }
}
*/