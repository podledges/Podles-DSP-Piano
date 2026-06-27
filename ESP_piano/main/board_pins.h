#pragma once
/**
 * board_pins.h — ESP32-S3 pin map for Podles DSP Piano (v2)
 *
 * SOURCE OF TRUTH — supersedes the KiCad draft (Adafruit Feather HUZZAH32 / classic ESP32).
 * PCB respin to ESP32-S3 is out of scope for the firmware plan.
 *
 * Analog front-end preconditions (hardware, not firmware):
 *   - Piezo output biased to mid-rail (~1.65 V) before the ADC pin
 *   - Clamp / attenuate into ADC range (0 – 3.1 V at 12 dB atten)
 *   - Optional RC low-pass anti-alias filter: cutoff < 8 kHz (for 16 kHz sample rate)
 *
 * Forbidden pins (do NOT use for ADC/LED/UART/I2S):
 *   Strapping: GPIO0, GPIO3, GPIO45, GPIO46
 *   USB D-/D+: GPIO19, GPIO20
 *   Console UART0: GPIO43 (TX), GPIO44 (RX)
 *   Flash/PSRAM (octal modules): GPIO26-GPIO37
 */

#include "hal/adc_types.h"

/* ── Piezo ADC input ─────────────────────────────────────────────────── */
/** ADC1 channel 0 = GPIO1.  Internal ADC1 (radio-immune, DMA-capable). */
#define BOARD_PIEZO_ADC_UNIT     ADC_UNIT_1
#define BOARD_PIEZO_ADC_CHANNEL  ADC_CHANNEL_0   /* GPIO1 */
#define BOARD_PIEZO_ADC_ATTEN    ADC_ATTEN_DB_12  /* 0–3.1 V range */
#define BOARD_PIEZO_ADC_BITWIDTH ADC_BITWIDTH_12

/* ── Status LED ──────────────────────────────────────────────────────── */
/**
 * GPIO38 is safe on most ESP32-S3 devkits (no strapping / USB / flash conflict).
 * Some boards use GPIO48 for the RGB LED — override with -DBOARD_LED_GPIO=48
 * at compile time if needed.
 */
#ifndef BOARD_LED_GPIO
#  define BOARD_LED_GPIO  38
#endif

/* ── Future: Hardware envelope detector (DEFERRED — DO NOT IMPLEMENT NOW) ── */
/**
 * When the hardware envelope detector circuit is validated, wire it to
 * a second ADC1 channel and flip this define in board_pins.h only.
 * The capture_source interface in firmware will accept it without DSP-core changes.
 */
#define BOARD_ENVELOPE_ADC_CHANNEL  ADC_CHANNEL_1   /* GPIO2 — reserved, unused */

/* ── Future: External I2S audio codec (DEFERRED — DO NOT IMPLEMENT NOW) ── */
/**
 * If internal ADC SNR proves insufficient, swap in an I2S codec (e.g. INMP441,
 * ES8388, PCM1808) on these pins.  The capture_i2s stub uses these defines.
 */
#define BOARD_I2S_BCLK_GPIO   4
#define BOARD_I2S_WS_GPIO     5
#define BOARD_I2S_DIN_GPIO    6    /* data from codec to ESP */

/* ── Sample rate (must match the server's expected PCM rate) ─────────── */
#define BOARD_SAMPLE_RATE_HZ  16000
