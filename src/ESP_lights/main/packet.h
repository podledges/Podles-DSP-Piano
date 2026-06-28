#ifndef packet_h
#define packet_h

#include <stdint.h>


typedef struct {
    uint8_t noteCount;         // How many different notes are being played
    uint16_t activeNotes[10];  // array of notes detected
    uint8_t overallAmplitude;  // To be implemented
} PianoDataPacket;

#endif // packet_h
