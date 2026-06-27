#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
    int16_t  *buf;
    size_t    capacity;   /* max samples */
    volatile size_t head; /* producer writes here */
    volatile size_t tail; /* consumer reads here */
    volatile size_t dropped; /* samples dropped due to overflow */
} ringbuf_t;

void   ringbuf_init(ringbuf_t *rb, int16_t *storage, size_t capacity);
bool   ringbuf_push(ringbuf_t *rb, int16_t sample);   /* returns false if full; drops + increments dropped */
bool   ringbuf_pop(ringbuf_t *rb, int16_t *out);      /* returns false if empty */
size_t ringbuf_available(ringbuf_t *rb);              /* samples ready to read */
size_t ringbuf_dropped(ringbuf_t *rb);                /* total dropped count */
void   ringbuf_reset_dropped(ringbuf_t *rb);
