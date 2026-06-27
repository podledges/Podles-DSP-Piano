#pragma once
/**
 * startup.h - Zero-extra-hardware startup for Podles DSP Piano v2
 *
 * Uses GPIO0 (BOOT button on every ESP32-S3 devkit - active LOW, pulled high).
 *
 * State machine:
 *   IDLE      -> short press (< 2 s)   -> STREAMING  (LED solid, start tasks)
 *   STREAMING -> hold     (>= 3 s)     -> IDLE        (LED 1Hz blink, stop tasks)
 *
 * Typical usage in app_main():
 *     startup_init();
 *     startup_wait_for_stream();   // blocks until button pressed
 *     // ... start ADC capture + websocket streamer ...
 *
 * Auto-start (no button needed):
 *     startup_init();
 *     startup_force_stream();
 */
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

#define STARTUP_BUTTON_GPIO    0      // GPIO0 = BOOT button, active LOW
#define STARTUP_HOLD_STOP_MS   3000   // hold >= 3s to return to IDLE
#define STARTUP_DEBOUNCE_MS    50     // debounce window

typedef enum {
    STARTUP_STATE_IDLE      = 0,
    STARTUP_STATE_STREAMING = 1,
    STARTUP_STATE_STOPPING  = 2,
} startup_state_t;

void            startup_init(void);              // configure GPIO0 + LED, launch poll task
void            startup_wait_for_stream(void);   // block until STREAMING (button press)
startup_state_t startup_get_state(void);         // non-blocking query
void            startup_force_stream(void);      // programmatic start (skip button)
bool            startup_is_server_ready(void);   // true once WS connection established
void            startup_set_server_ready(bool ready); // called by ws_stream on connect/disconnect

#ifdef __cplusplus
}
#endif
