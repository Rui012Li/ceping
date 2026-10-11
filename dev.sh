#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

source /opt/homebrew/Caskroom/miniconda/base/etc/profile.d/conda.sh
conda activate ceping

cleanup() {
  kill $BACKEND_PID $FRONT_PID 2>/dev/null || true
}
trap cleanup EXIT

cd "$ROOT/backend"
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

cd "$ROOT/frontend"
npm run dev -- --host 127.0.0.1 --port 5173 &
FRONT_PID=$!

echo "后端 http://127.0.0.1:8000"
echo "前端 http://127.0.0.1:5173"
wait
