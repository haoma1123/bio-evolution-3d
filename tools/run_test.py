import sys
import subprocess
import time
import json
from pathlib import Path

# Start HTTP server in background
server_proc = subprocess.Popen(
    [sys.executable, '-m', 'http.server', '8803'],
    cwd=r'G:\生物演化-3d',
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL
)

time.sleep(2)

try:
    # Run Puppeteer test
    result = subprocess.run(
        ['node', r'G:\生物演化-3d\tools\test_theme_simple.js'],
        cwd=r'G:\生物演化-3d',
        capture_output=True,
        text=True,
        timeout=60
    )
    
    print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    
    sys.exit(result.returncode)
finally:
    server_proc.terminate()
    server_proc.wait()
