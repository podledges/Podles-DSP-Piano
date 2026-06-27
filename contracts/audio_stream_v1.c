/* FROZEN - mirrors contracts/include/audio_stream_v1.h and contracts/audio_stream_v1.py */

#include "audio_stream_v1.h"

#include <string.h>

/* This contract is little-endian. Host x86 and the ESP32-S3 target are little-endian. */

size_t asv1_encode_audio(uint8_t *buf, size_t buf_size,
                         uint32_t seq, uint64_t sample_index,
                         uint32_t timestamp_ms, uint16_t sample_rate,
                         const int16_t *pcm, uint16_t pcm_len)
{
    const size_t pcm_bytes = (size_t)pcm_len * sizeof(int16_t);
    const size_t total_size = ASV1_HEADER_SIZE + pcm_bytes;

    if (buf == NULL || buf_size < total_size || (pcm_len > 0 && pcm == NULL)) {
        return 0;
    }

    const asv1_header_t header = {
        .magic = ASV1_MAGIC,
        .version = ASV1_VERSION,
        .type = ASV1_TYPE_AUDIO,
        .seq = seq,
        .sample_index = sample_index,
        .timestamp_ms = timestamp_ms,
        .sample_rate = sample_rate,
        .channels = 1,
        .reserved = 0,
        .pcm_len = pcm_len,
    };

    memcpy(buf, &header, ASV1_HEADER_SIZE);
    if (pcm_bytes > 0) {
        memcpy(buf + ASV1_HEADER_SIZE, pcm, pcm_bytes);
    }

    return total_size;
}

size_t asv1_encode_hello(uint8_t *buf, size_t buf_size,
                         uint32_t seq, const char *session_id)
{
    const size_t total_size = ASV1_HEADER_SIZE + ASV1_SESSION_SIZE;
    size_t session_len = 0;

    if (buf == NULL || session_id == NULL || buf_size < total_size) {
        return 0;
    }

    while (session_len < ASV1_SESSION_SIZE && session_id[session_len] != '\0') {
        session_len++;
    }

    if (session_len >= ASV1_SESSION_SIZE) {
        return 0;
    }

    const asv1_header_t header = {
        .magic = ASV1_MAGIC,
        .version = ASV1_VERSION,
        .type = ASV1_TYPE_HELLO,
        .seq = seq,
        .sample_index = 0,
        .timestamp_ms = 0,
        .sample_rate = 0,
        .channels = 1,
        .reserved = 0,
        .pcm_len = 0,
    };

    memcpy(buf, &header, ASV1_HEADER_SIZE);
    memset(buf + ASV1_HEADER_SIZE, 0, ASV1_SESSION_SIZE);
    memcpy(buf + ASV1_HEADER_SIZE, session_id, session_len);

    return total_size;
}
