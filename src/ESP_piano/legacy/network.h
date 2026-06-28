// Network.h
#ifndef NETWORK_H
#define NETWORK_H

#include <esp_now.h>
#include <esp_wifi.h>
#include "packet.h"

#define ESP_LIGHTS_MAC {0x44, 0x09, 0x47, 0x76, 0xF8, 0x04} // NOT UPDATED
class NetworkManager {
private:
    uint8_t broadcastAddress[6] = ESP_LIGHTS_MAC; //MAC address of receiving esp32

    esp_now_peer_info_t peerInfo; //ESP-NOW library

    bool registerPeer();   

    static void OnDataSent(const esp_now_send_info_t *info, esp_now_send_status_t status);    
    
public:
    NetworkManager();
    
    bool begin(); 
    
    bool broadcast(PianoDataPacket packet);
};

// extern --> Promise compiler that a network object already exists elsewhere (C thing)
extern NetworkManager Network; 

#endif