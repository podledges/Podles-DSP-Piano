#ifndef WEB_SERVER_H
#define WEB_SERVER_H

#include <esp_http_server.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize Wi-Fi in Access Point (AP) mode
 *        SSID: "Piano-Guide-AP"
 *        IP: 192.168.4.1
 */
void wifi_init_softap(void);

/**
 * @brief Start the HTTP and WebSocket server
 */
void start_web_server(void);

/**
 * @brief Broadcast a detected MIDI note to all connected WebSocket clients
 * 
 * @param status Event type (0x90 for Note On, 0x80 for Note Off)
 * @param note MIDI note number (36 - 96)
 * @param velocity Velocity/volume (0 - 127)
 */
void web_server_send_midi_packet(uint8_t status, uint8_t note, uint8_t velocity);

#ifdef __cplusplus
}
#endif

#endif // WEB_SERVER_H
