#include "pcm_framer.h"

#include <string.h>

void pcm_framer_init(pcm_framer_t *f, uint16_t sample_rate)
{
    if (f == NULL) {
        return;
    }

    memset(f, 0, sizeof(*f));
    f->sample_rate = sample_rate;
}

bool pcm_framer_push(pcm_framer_t *f, int16_t sample, framer_frame_t *out)
{
    size_t encoded_size;
    uint32_t timestamp_ms;

    if (f == NULL || out == NULL || f->sample_rate == 0) {
        return false;
    }

    f->chunk[f->chunk_fill] = sample;
    f->chunk_fill++;

    if (f->chunk_fill < FRAMER_CHUNK_SAMPLES) {
        return false;
    }

    timestamp_ms = (uint32_t)((f->sample_index * 1000U) / f->sample_rate);
    encoded_size = asv1_encode_audio(f->frame_buf,
                                     sizeof(f->frame_buf),
                                     f->seq,
                                     f->sample_index,
                                     timestamp_ms,
                                     f->sample_rate,
                                     f->chunk,
                                     FRAMER_CHUNK_SAMPLES);
    if (encoded_size == 0) {
        return false;
    }

    out->data = f->frame_buf;
    out->len = encoded_size;

    f->seq++;
    f->sample_index += FRAMER_CHUNK_SAMPLES;
    f->chunk_fill = 0;

    return true;
}

void pcm_framer_reset(pcm_framer_t *f)
{
    if (f == NULL) {
        return;
    }

    f->seq = 0;
    f->sample_index = 0;
    f->chunk_fill = 0;
}
