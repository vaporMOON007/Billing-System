"""
Billing System — one-command setup.

Usage:
    pip install -r requirements.txt     ← recommended
    python setup.py                     ← also works
"""
import subprocess
import sys
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def run_npm_install():
    for folder in ["backend", "frontend"]:
        path = os.path.join(BASE_DIR, folder)
        if os.path.isdir(path):
            print(f"\n  Installing npm packages in /{folder} ...")
            result = subprocess.call(["npm", "install"], cwd=path)
            if result != 0:
                print(f"  npm install failed in /{folder} (exit code {result})")
                sys.exit(result)
            print(f"  /{folder} done.")
        else:
            print(f"  Folder not found: {path} — skipping.")


def run_pip_install():
    print("\n  Installing Python packages ...")
    result = subprocess.call(
        [sys.executable, "-m", "pip", "install", "reportlab==4.2.5"]
    )
    if result != 0:
        print("  pip install failed.")
        sys.exit(result)
    print("  Python packages done.")


# ── Run directly: python setup.py ──────────────────────────
if __name__ == "__main__" and (len(sys.argv) == 1 or sys.argv[1] not in (
    "install", "develop", "egg_info", "dist_info",
    "build", "bdist_wheel", "sdist", "--help", "--help-commands",
)):
    print("=" * 52)
    print("  Billing System — Setup")
    print("=" * 52)
    run_pip_install()
    run_npm_install()
    print("\n" + "=" * 52)
    print("  Setup complete!")
    print("  Start backend : cd backend  && npm run dev")
    print("  Start frontend: cd frontend && npm run dev")
    print("=" * 52)
    sys.exit(0)

# ── Called by pip (pip install -r requirements.txt) ────────
from setuptools import setup
from setuptools.command.develop import develop
from setuptools.command.install import install


class PostDevelop(develop):
    def run(self):
        super().run()
        run_npm_install()


class PostInstall(install):
    def run(self):
        super().run()
        run_npm_install()


setup(
    name="billing-system-setup",
    version="1.0.0",
    packages=[],
    cmdclass={
        "develop": PostDevelop,
        "install": PostInstall,
    },
    python_requires=">=3.9",
)
