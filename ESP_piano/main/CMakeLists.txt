idf_component_register(SRCS "audio_dsp.c" "adc_sampler.c" "main.cpp" "network.cpp" "web_server.cpp"
                       INCLUDE_DIRS "."
                       PRIV_REQUIRES esp_adc esp_timer esp_driver_gpio esp_wifi nvs_flash esp_http_server
                       EMBED_TXTFILES "web_app/index.html" "web_app/style.css" "web_app/app.js")