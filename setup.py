"""
Billing System — one-command setup.
Run:  pip install -r requirements.txt
This installs Python deps AND triggers npm install for backend + frontend.
"""
import subprocess
import sys
import os
from setuptools import setup
from setuptools.command.develop import develop
from setuptools.command.install import install


BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def run_npm_install():
    for folder in ["backend", "frontend"]:
        path = os.path.join(BASE_DIR, folder)
        if os.path.isdir(path):
            print(f"\n📦  Running npm install in /{folder} ...")
            result = subprocess.call(["npm", "install"], cwd=path)
            if result != 0:
                print(f"⚠️  npm install failed in /{folder} (exit code {result})")
                sys.exit(result)
            print(f"✅  /{folder} npm packages installed.")
        else:
            print(f"⚠️  Folder not found: {path} — skipping.")


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
    description="Setup hook — installs Node.js deps for backend and frontend",
    cmdclass={
        "develop": PostDevelop,
        "install": PostInstall,
    },
    python_requires=">=3.9",
)
