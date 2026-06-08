"""
Billing System — one-command setup.
Run: python setup.py
"""
import subprocess
import sys
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DIVIDER = "=" * 52

def run(cmd, cwd=None):
    # shell=True required on Windows so npm.cmd / npx.cmd are found
    return subprocess.call(cmd, cwd=cwd, shell=True)

def main():
    print(DIVIDER)
    print("  Billing System — Setup")
    print(DIVIDER)

    # 1. Backend npm packages
    backend_path = os.path.join(BASE_DIR, "backend")
    print("\n[1/2] Installing backend npm packages ...")
    if os.path.isdir(backend_path):
        result = run("npm install", cwd=backend_path)
        if result != 0:
            print("      FAILED — check Node.js / npm is installed.")
            sys.exit(result)
        print("      Done.")
    else:
        print("      /backend folder not found — skipping.")

    # 2. Frontend npm packages
    frontend_path = os.path.join(BASE_DIR, "frontend")
    print("\n[2/2] Installing frontend npm packages ...")
    if os.path.isdir(frontend_path):
        result = run("npm install", cwd=frontend_path)
        if result != 0:
            print("      FAILED — check Node.js / npm is installed.")
            sys.exit(result)
        print("      Done.")
    else:
        print("      /frontend folder not found — skipping.")

    print("\n" + DIVIDER)
    print("  Setup complete!")
    print("")
    print("  1. Create a PostgreSQL database")
    print("  2. Run schema.sql in pgAdmin")
    print("  3. Create backend/.env (see README.md)")
    print("")
    print("  Start backend : cd backend  && npm run dev")
    print("  Start frontend: cd frontend && npm run dev")
    print(DIVIDER + "\n")

if __name__ == "__main__":
    main()
