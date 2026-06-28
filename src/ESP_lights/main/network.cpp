#include "network.h"
#include "esp_log.h"

NetworkManager Network; 
static const char *TAG = "NETWORK_MANAGER";

NetworkManager::NetworkManager() {}

bool NetworkManager::begin() {

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    if (esp_wifi_init(&cfg) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to initialize Wi-Fi");
        return false;
    }

    //* we need to add the receiving logic function

    // Initialize the ESP-NOW protocol
    if (esp_now_init() != ESP_OK) {         
        ESP_LOGE(TAG, "Error initializing ESP-NOW");
        return false;
    }

    // Send Callback on Data Sent
    esp_now_register_send_cb(OnDataSent);     


    if (!registerPeer()) {
        return false;
    }
    
    ESP_LOGI(TAG, "ESP-NOW Initialized Successfully.");
    return true;
}

bool NetworkManager::registerPeer() {
    memcpy(peerInfo.peer_addr, broadcastAddress, 6);
    peerInfo.channel = 0;
    peerInfo.encrypt = false;
    
    if (esp_now_add_peer(&peerInfo) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to add peer");
        return false;
    }
    return true;
}


// Broadcast Packet 
bool NetworkManager::broadcast(PianoDataPacket packet) {
    esp_err_t result = esp_now_send(broadcastAddress, (uint8_t *) &packet, sizeof(packet));
    
    return (result == ESP_OK);
}

// Callback function (executes after data is sent)
void NetworkManager::OnDataSent(const esp_now_send_info_t *tx_info, esp_now_send_status_t status) {
    if (status == ESP_NOW_SEND_SUCCESS) {
        ESP_LOGD(TAG, "Delivery Success"); // Debug level so it doesn't spam your terminal
    } else {
        ESP_LOGW(TAG, "Delivery Fail");
    }
}