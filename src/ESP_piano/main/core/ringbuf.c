#include "ringbuf.h"

void ringbuf_init(ringbuf_t *rb, int16_t *storage, size_t capacity)
{
    if (rb == NULL) {
        return;
    }

    rb->buf = storage;
    rb->capacity = capacity;
    rb->head = 0;
    rb->tail = 0;
    rb->dropped = 0;
}

bool ringbuf_push(ringbuf_t *rb, int16_t sample)
{
    bool overflowed = false;

    if (rb == NULL || rb->buf == NULL || rb->capacity == 0) {
        if (rb != NULL) {
            rb->dropped++;
        }
        return false;
    }

    if (ringbuf_available(rb) >= rb->capacity) {
        rb->tail++;
        rb->dropped++;
        overflowed = true;
    }

    rb->buf[rb->head % rb->capacity] = sample;
    rb->head++;

    return !overflowed;
}

bool ringbuf_pop(ringbuf_t *rb, int16_t *out)
{
    if (rb == NULL || out == NULL || rb->buf == NULL || rb->capacity == 0) {
        return false;
    }

    if (ringbuf_available(rb) == 0) {
        return false;
    }

    *out = rb->buf[rb->tail % rb->capacity];
    rb->tail++;

    return true;
}

size_t ringbuf_available(ringbuf_t *rb)
{
    if (rb == NULL) {
        return 0;
    }

    return rb->head - rb->tail;
}

size_t ringbuf_dropped(ringbuf_t *rb)
{
    if (rb == NULL) {
        return 0;
    }

    return rb->dropped;
}

void ringbuf_reset_dropped(ringbuf_t *rb)
{
    if (rb == NULL) {
        return;
    }

    rb->dropped = 0;
}
