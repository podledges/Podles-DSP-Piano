#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "pcm_framer.h"
#include "ringbuf.h"

/* Simple host test runner - no Unity dependency needed, use assert() */
#define TEST(name) static void test_##name(void)
#define RUN(name)  do { test_##name(); printf("PASS: " #name "\n"); } while (0)

static void read_header(const framer_frame_t *frame, asv1_header_t *header)
{
    assert(frame != NULL);
    assert(header != NULL);
    assert(frame->data != NULL);
    assert(frame->len >= ASV1_HEADER_SIZE);
    memcpy(header, frame->data, sizeof(*header));
}

static bool push_chunk(pcm_framer_t *framer, framer_frame_t *frame, int16_t base_sample)
{
    bool ready = false;

    for (size_t i = 0; i < FRAMER_CHUNK_SAMPLES; i++) {
        ready = pcm_framer_push(framer, (int16_t)(base_sample + (int16_t)i), frame);
        if (i + 1 < FRAMER_CHUNK_SAMPLES) {
            assert(!ready);
        }
    }

    return ready;
}

TEST(ringbuf_basic_round_trip)
{
    int16_t storage[8];
    ringbuf_t rb;
    int16_t out = 0;

    ringbuf_init(&rb, storage, 8);
    assert(ringbuf_available(&rb) == 0);
    assert(ringbuf_push(&rb, 123));
    assert(ringbuf_available(&rb) == 1);
    assert(ringbuf_pop(&rb, &out));
    assert(out == 123);
    assert(ringbuf_available(&rb) == 0);
    assert(!ringbuf_pop(&rb, &out));
}

TEST(ringbuf_overflow_drops_oldest)
{
    int16_t storage[8];
    ringbuf_t rb;
    int16_t out = 0;

    ringbuf_init(&rb, storage, 8);
    for (int16_t i = 1; i <= 8; i++) {
        assert(ringbuf_push(&rb, i));
    }

    assert(!ringbuf_push(&rb, 9));
    assert(ringbuf_dropped(&rb) == 1);
    assert(ringbuf_available(&rb) == 8);

    for (int16_t expected = 2; expected <= 9; expected++) {
        assert(ringbuf_pop(&rb, &out));
        assert(out == expected);
    }

    assert(!ringbuf_pop(&rb, &out));
}

TEST(ringbuf_index_wrap_fill_drain_fill)
{
    int16_t storage[4];
    ringbuf_t rb;
    int16_t out = 0;

    ringbuf_init(&rb, storage, 4);
    for (int16_t i = 0; i < 4; i++) {
        assert(ringbuf_push(&rb, i));
    }
    for (int16_t expected = 0; expected < 4; expected++) {
        assert(ringbuf_pop(&rb, &out));
        assert(out == expected);
    }

    for (int16_t i = 10; i < 14; i++) {
        assert(ringbuf_push(&rb, i));
    }
    for (int16_t expected = 10; expected < 14; expected++) {
        assert(ringbuf_pop(&rb, &out));
        assert(out == expected);
    }

    assert(ringbuf_available(&rb) == 0);
    assert(ringbuf_dropped(&rb) == 0);
}

TEST(pcm_framer_emits_after_exactly_320_samples)
{
    pcm_framer_t framer;
    framer_frame_t frame = {0};
    bool ready = false;

    pcm_framer_init(&framer, 16000);
    for (size_t i = 0; i < FRAMER_CHUNK_SAMPLES - 1; i++) {
        ready = pcm_framer_push(&framer, (int16_t)i, &frame);
        assert(!ready);
    }

    ready = pcm_framer_push(&framer, 319, &frame);
    assert(ready);
    assert(frame.data == framer.frame_buf);
    assert(frame.len == FRAMER_BUF_SIZE);
}

TEST(pcm_framer_frame_seq_first_and_second)
{
    pcm_framer_t framer;
    framer_frame_t frame = {0};
    asv1_header_t header;

    pcm_framer_init(&framer, 16000);
    assert(push_chunk(&framer, &frame, 0));
    read_header(&frame, &header);
    assert(header.seq == 0);
    assert(framer.seq == 1);

    assert(push_chunk(&framer, &frame, 320));
    read_header(&frame, &header);
    assert(header.seq == 1);
    assert(framer.seq == 2);
}

TEST(pcm_framer_sample_index_after_frames)
{
    pcm_framer_t framer;
    framer_frame_t frame = {0};

    pcm_framer_init(&framer, 16000);
    assert(push_chunk(&framer, &frame, 0));
    assert(framer.sample_index == 320);

    assert(push_chunk(&framer, &frame, 320));
    assert(framer.sample_index == 640);
}

TEST(pcm_framer_timestamp_first_and_second)
{
    pcm_framer_t framer;
    framer_frame_t frame = {0};
    asv1_header_t header;

    pcm_framer_init(&framer, 16000);
    assert(push_chunk(&framer, &frame, 0));
    read_header(&frame, &header);
    assert(header.timestamp_ms == 0);
    assert(header.sample_index == 0);

    assert(push_chunk(&framer, &frame, 320));
    read_header(&frame, &header);
    assert(header.timestamp_ms == 20);
    assert(header.sample_index == 320);
}

TEST(pcm_framer_seq_wraps)
{
    pcm_framer_t framer;
    framer_frame_t frame = {0};
    asv1_header_t header;

    pcm_framer_init(&framer, 16000);
    framer.seq = UINT32_MAX;

    assert(push_chunk(&framer, &frame, 0));
    read_header(&frame, &header);
    assert(header.seq == UINT32_MAX);
    assert(framer.seq == 0);
}

int main(void)
{
    RUN(ringbuf_basic_round_trip);
    RUN(ringbuf_overflow_drops_oldest);
    RUN(ringbuf_index_wrap_fill_drain_fill);
    RUN(pcm_framer_emits_after_exactly_320_samples);
    RUN(pcm_framer_frame_seq_first_and_second);
    RUN(pcm_framer_sample_index_after_frames);
    RUN(pcm_framer_timestamp_first_and_second);
    RUN(pcm_framer_seq_wraps);

    return 0;
}
