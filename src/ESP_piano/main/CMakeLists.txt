cmake_minimum_required(VERSION 3.16)

file(GLOB CORE_SRCS CONFIGURE_DEPENDS "core/*.c" "core/*.cpp")

idf_component_register(
    SRCS
        "main.cpp"
        "startup.c"
        "hal/capture_adc.c"
        "hal/capture_i2s.c"
        "hal/wifi_sta.c"
        "hal/ws_stream.c"
        ${CORE_SRCS}
    INCLUDE_DIRS "." "core" "hal"
    PRIV_REQUIRES
        contracts esp-dsp esp_adc esp_timer esp_driver_gpio esp_wifi nvs_flash esp_websocket_client
)
