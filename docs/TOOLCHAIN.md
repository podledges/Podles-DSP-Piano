# Toolchain Baseline

- Project target: `esp32s3`
- ESP-IDF: `idf.py` is not available in PATH from this shell. The environment must source ESP-IDF before `idf.py --version` can be recorded.
- Python: `Python 3.13.13`
- CUDA / GPU: RTX 3070 laptop; `nvidia-smi` is not available in PATH from this shell, but the project baseline assumes CUDA-capable GPU availability on the laptop.

## Notes

- `idf.py --version` could not be captured here because the command was not found.
- `nvidia-smi` could not be captured here because the command was not found.
