#pragma once
/* FROZEN - do NOT modify fields without updating the Python decoder and golden fixtures */

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define ASV1_MAGIC        0xAD51
#define ASV1_VERSION      0x01
#define ASV1_TYPE_AUDIO   0x00
#define ASV1_TYPE_HELLO   0x01
#define ASV1_TYPE_GOODBYE 0x02
#define ASV1_HEADER_SIZE  26
#define ASV1_SESSION_SIZE 16 /* hello frame appends 16-byte session_id */

typedef struct __attribute__((packed)) {
    uint16_t magic;
    uint8_t  version;
    uint8_t  type;
    uint32_t seq;
    uint64_t sample_index;
    uint32_t timestamp_ms;
    uint16_t sample_rate;
    uint8_t  channels;
    uint8_t  reserved;
    uint16_t pcm_len;
    /* int16_t pcm_data[pcm_len] follows */
} asv1_header_t;

/**
 * Encode an audio chunk frame into buf.
 * buf must be at least ASV1_HEADER_SIZE + pcm_len*2 bytes.
 * Returns total bytes written, or 0 on invalid input / insufficient capacity.
 */
size_t asv1_encode_audio(uint8_t *buf, size_t buf_size,
                         uint32_t seq, uint64_t sample_index,
                         uint32_t timestamp_ms, uint16_t sample_rate,
                         const int16_t *pcm, uint16_t pcm_len);

/**
 * Encode a hello frame into buf (42 bytes).
 * session_id must be a null-terminated string up to 15 chars.
 * Returns total bytes written, or 0 on invalid input / insufficient capacity.
 */
size_t asv1_encode_hello(uint8_t *buf, size_t buf_size,
                         uint32_t seq, const char *session_id);

#ifdef __cplusplus
}
#endif
