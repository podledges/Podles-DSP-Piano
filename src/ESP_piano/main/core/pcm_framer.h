#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "../../../contracts/include/audio_stream_v1.h"

#define FRAMER_CHUNK_SAMPLES  320   /* 20ms at 16kHz */
#define FRAMER_BUF_SIZE       (ASV1_HEADER_SIZE + FRAMER_CHUNK_SAMPLES * 2)

typedef struct {
    uint32_t seq;
    uint64_t sample_index;   /* monotonic, source of truth */
    uint16_t sample_rate;
    /* internal scratch */
    int16_t  chunk[FRAMER_CHUNK_SAMPLES];
    size_t   chunk_fill;
    uint8_t  frame_buf[FRAMER_BUF_SIZE];
} pcm_framer_t;

typedef struct {
    uint8_t *data;
    size_t   len;
} framer_frame_t;

void pcm_framer_init(pcm_framer_t *f, uint16_t sample_rate);
/**
 * Feed one sample. When a full chunk is ready, encodes a frame and returns it via *out.
 * Returns true if a frame is ready; false otherwise.
 * The returned data pointer is valid until the next call.
 */
bool pcm_framer_push(pcm_framer_t *f, int16_t sample, framer_frame_t *out);
/** Reset seq and sample_index (call on new session). */
void pcm_framer_reset(pcm_framer_t *f);
