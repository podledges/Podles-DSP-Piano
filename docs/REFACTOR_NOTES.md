# v2 Architecture Notes

The v2 baseline is a single ESP32-S3 streaming 16 kHz PCM audio over Wi-Fi via websocket to a laptop GPU server.

The laptop server runs neural transcription, starting with a basic-pitch baseline and moving toward lower-latency realtime transcription later. The output then feeds a browser client for display and interaction.

This split keeps the embedded device focused on capture and transport, while the laptop handles the heavier inference workload.
