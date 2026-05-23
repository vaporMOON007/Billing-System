"""
╔══════════════════════════════════════════════════════════════════╗
║           BILLING SYSTEM — WINDOWS STARTUP SCRIPT               ║
║  Run directly  : python start.py                                 ║
║  Task Scheduler: Action → Start a program → python.exe           ║
║                  Arguments → "C:\...\start.py"                   ║
╚══════════════════════════════════════════════════════════════════╝
"""

# ════════════════════════════════════════════════════════════════
#  ██  CONFIGURATION  — only edit this section  ██
# ════════════════════════════════════════════════════════════════

# Root folder of the project (folder that contains backend\ and frontend\)
BILLING_SYSTEM_PATH = r"C:\Users\Administrator\Desktop\Billing-System"

# Full path to node.exe
#   Run  `where node`  in cmd to find yours
NODE_EXE = r"C:\Program Files\nodejs\node.exe"

# Full path to npm.cmd
#   Run  `where npm`   in cmd to find yours
NPM_CMD  = r"C:\Program Files\nodejs\npm.cmd"

# Ports (must match your .env / vite.config)
BACKEND_PORT  = 5000
FRONTEND_PORT = 3000

# Open the app in the default browser automatically?
OPEN_BROWSER = True

# Show a console window for each server? (True = visible window, False = silent/background)
# Set False when running via Task Scheduler so no windows pop up at startup
SHOW_WINDOWS = True

# Log folder — used only when SHOW_WINDOWS = False
#   Logs go to  <BILLING_SYSTEM_PATH>\logs\backend.log  and  frontend.log
LOG_TO_FILE  = True

# Seconds to wait for the backend to start before launching the frontend
BACKEND_WAIT = 3

# ════════════════════════════════════════════════════════════════
#  DO NOT EDIT BELOW THIS LINE
# ════════════════════════════════════════════════════════════════

import subprocess
import sys
import time
import os
import webbrowser

# ── derived paths ────────────────────────────────────────────────
BACKEND_DIR  = os.path.join(BILLING_SYSTEM_PATH, "backend")
FRONTEND_DIR = os.path.join(BILLING_SYSTEM_PATH, "frontend")
LOGS_DIR     = os.path.join(BILLING_SYSTEM_PATH, "logs")

FRONTEND_URL = f"http://localhost:{FRONTEND_PORT}"


def validate_paths():
    """Abort early with a clear message if any path is wrong."""
    errors = []
    if not os.path.isdir(BACKEND_DIR):
        errors.append(f"  ✗ Backend folder not found:  {BACKEND_DIR}")
    if not os.path.isdir(FRONTEND_DIR):
        errors.append(f"  ✗ Frontend folder not found: {FRONTEND_DIR}")
    if not os.path.isfile(NODE_EXE):
        errors.append(f"  ✗ node.exe not found:        {NODE_EXE}")
    if not os.path.isfile(NPM_CMD):
        errors.append(f"  ✗ npm.cmd not found:         {NPM_CMD}")
    if errors:
        print("Billing System — startup failed\n")
        for e in errors:
            print(e)
        print("\nPlease fix the paths in the CONFIGURATION section of start.py")
        sys.exit(1)


def get_log_files():
    """Create logs dir and return open file handles (or None if not logging)."""
    if not LOG_TO_FILE or SHOW_WINDOWS:
        return None, None
    os.makedirs(LOGS_DIR, exist_ok=True)
    backend_log  = open(os.path.join(LOGS_DIR, "backend.log"),  "a", encoding="utf-8")
    frontend_log = open(os.path.join(LOGS_DIR, "frontend.log"), "a", encoding="utf-8")
    return backend_log, frontend_log


def launch(label, cwd, cmd_list, log_file):
    """Launch a process and return its Popen handle."""
    if SHOW_WINDOWS:
        # Each server gets its own titled console window
        proc = subprocess.Popen(
            cmd_list,
            cwd=cwd,
            creationflags=subprocess.CREATE_NEW_CONSOLE,
        )
    else:
        # Silent background process — stdout/stderr go to log file
        sink = log_file if log_file else subprocess.DEVNULL
        proc = subprocess.Popen(
            cmd_list,
            cwd=cwd,
            stdout=sink,
            stderr=sink,
        )
    print(f"  ✓ {label} started  (PID {proc.pid})")
    return proc


def main():
    print("=" * 60)
    print("  Billing System — Starting up")
    print("=" * 60)

    validate_paths()

    backend_log, frontend_log = get_log_files()

    # ── 1. Backend ──────────────────────────────────────────────
    print(f"\n[1/2] Starting backend  (port {BACKEND_PORT}) …")
    backend_proc = launch(
        label    = "Backend  (node server.js)",
        cwd      = BACKEND_DIR,
        cmd_list = [NPM_CMD, "run", "start"],
        log_file = backend_log,
    )

    # Give the backend a moment to bind its port before the frontend starts
    print(f"      Waiting {BACKEND_WAIT}s for backend to initialise …")
    time.sleep(BACKEND_WAIT)

    # ── 2. Frontend ─────────────────────────────────────────────
    print(f"\n[2/2] Starting frontend (port {FRONTEND_PORT}) …")
    frontend_proc = launch(
        label    = "Frontend (npm run dev)",
        cwd      = FRONTEND_DIR,
        cmd_list = [NPM_CMD, "run", "dev"],
        log_file = frontend_log,
    )

    # ── 3. Browser ──────────────────────────────────────────────
    if OPEN_BROWSER:
        browser_wait = 4
        print(f"\n      Opening browser in {browser_wait}s → {FRONTEND_URL}")
        time.sleep(browser_wait)
        webbrowser.open(FRONTEND_URL)

    print("\n" + "=" * 60)
    print("  Both servers are running.")
    if LOG_TO_FILE and not SHOW_WINDOWS:
        print(f"  Logs → {LOGS_DIR}")
    print("  Close this window or press Ctrl+C to stop both servers.")
    print("=" * 60 + "\n")

    # ── Keep alive + clean shutdown ──────────────────────────────
    try:
        backend_proc.wait()
    except KeyboardInterrupt:
        print("\nShutting down …")
        backend_proc.terminate()
        frontend_proc.terminate()
        backend_proc.wait()
        frontend_proc.wait()
        print("Done.")


if __name__ == "__main__":
    main()
