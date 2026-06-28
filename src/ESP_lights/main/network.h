// Network.h
#ifndef NETWORK_H
#define NETWORK_H

#include <esp_now.h>
#include <esp_wifi.h>
#include "packet.h"

#define ESP_PIANO_MAC {0x70, 0x4B, 0xCA, 0x6E, 0x8A, 0x68} // NOT UPDATED

class NetworkManager {
private:
    uint8_t broadcastAddress[6] = ESP_PIANO_MAC; //MAC address of receiving esp32

    esp_now_peer_info_t peerInfo; //ESP-NOW library

    bool registerPeer();   

    static void OnDataSent(const esp_now_send_info_t *tx_info, esp_now_send_status_t status);

public:
    NetworkManager();
    
    bool begin(); 
    
    bool broadcast(PianoDataPacket packet);
};

// extern --> Promise compiler that a network object already exists elsewhere (C thing)
extern NetworkManager Network; 

#endif