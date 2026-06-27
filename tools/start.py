#!/usr/bin/env python3
"""
start.py - One-click Podles DSP Piano server launcher.

Usage:
    python tools/start.py [--port 8000] [--no-browser] [--auto-start]

What it does:
    1. Finds and launches the python server (server/app.py or run_app.py)
    2. Polls /health until ready (up to 30s)
    3. Opens the browser to http://localhost:<port>
    4. Ctrl-C cleanly shuts down the server

The ESP32-S3 auto-connects over Wi-Fi once the server is up.
Press the BOOT button on the ESP (or use --auto-start mode in firmware) to begin streaming.
"""
import argparse
import os
import signal
import subprocess
import sys
import time
import urllib.request
import webbrowser


def find_server_entry():
    candidates = [
        os.path.join(os.path.dirname(__file__), '..', 'server', 'app.py'),
        os.path.join(os.path.dirname(__file__), '..', 'run_app.py'),
    ]
    for c in candidates:
        if os.path.exists(os.path.normpath(c)):
            return os.path.normpath(c)
    return None


def poll_health(port, timeout=30):
    url = f'http://localhost:{port}/health'
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except Exception:
            sys.stdout.write('.')
            sys.stdout.flush()
            time.sleep(0.5)
    return False


def main():
    parser = argparse.ArgumentParser(description='Start Podles DSP Piano server')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--auto-start', action='store_true')
    args = parser.parse_args()

    entry = find_server_entry()
    if not entry:
        print('ERROR: Could not find server/app.py or run_app.py. Run from repo root.')
        sys.exit(1)

    print(f'Starting server: {entry} --port {args.port}')
    proc = subprocess.Popen([sys.executable, entry, '--port', str(args.port)])

    def shutdown(sig, frame):
        print('\nShutting down...')
        proc.terminate()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    print('Waiting for server', end='')
    if poll_health(args.port):
        print(f'\nServer ready at http://localhost:{args.port}')
        if not args.no_browser:
            webbrowser.open(f'http://localhost:{args.port}')
    else:
        print('\nWARNING: Server did not respond to /health within 30s - check logs.')

    print('Press Ctrl-C to stop.')
    proc.wait()


if __name__ == '__main__':
    main()
