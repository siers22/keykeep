#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/python ]; then
  echo 'Create .venv with Python 3.12+ and install dependencies first. See README.md.'
  exit 1
fi
export PYTHONPATH=src
.venv/bin/alembic upgrade head
exec .venv/bin/python -m uvicorn keykeep.main:app --host 127.0.0.1 --port "${PORT:-8000}" --no-access-log
