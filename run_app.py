import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8000

# Ensure working directory is the script folder
script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)

web_app_dir = os.path.join(script_dir, "web_app")

if not os.path.exists(web_app_dir):
    print(f"Error: web_app directory not found at {web_app_dir}")
    sys.exit(1)

# Change directory to serve files from web_app
os.chdir(web_app_dir)

Handler = http.server.SimpleHTTPRequestHandler

# Allow reuse of address/port (prevents 'address already in use' error on quick restarts)
socketserver.TCPServer.allow_reuse_address = True

print(f"====================================================")
print(f"Starting server for DSP Piano Sheet Parser...")
print(f"Serving files from: {web_app_dir}")
print(f"URL: http://localhost:{PORT}")
print(f"====================================================")

try:
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        # Open default browser automatically
        webbrowser.open(f"http://localhost:{PORT}")
        print("Server running. Press Ctrl+C to stop.")
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\nStopping server. Goodbye!")
except Exception as e:
    print(f"\nError starting server: {e}")
