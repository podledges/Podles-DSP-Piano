cmake_minimum_required(VERSION 3.16)

file(GLOB CORE_SRCS CONFIGURE_DEPENDS "core/*.c" "core/*.cpp")

idf_component_register(
    SRCS
        "main.cpp"
        "adc_sampler.c"
        "audio_dsp.c"
        "hal/capture_adc.c"
        "hal/capture_i2s.c"
        "hal/wifi_sta.c"
        "hal/ws_stream.c"
        "network.cpp"
        "web_server.cpp"
        ${CORE_SRCS}
    INCLUDE_DIRS "." "core" "hal"
    PRIV_REQUIRES
        contracts esp_adc esp_timer esp_driver_gpio esp_wifi nvs_flash esp_http_server esp_websocket_client
)
