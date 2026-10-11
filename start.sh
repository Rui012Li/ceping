#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

source /opt/homebrew/Caskroom/miniconda/base/etc/profile.d/conda.sh
conda activate ceping

echo "→ 构建前端..."
cd "$ROOT/frontend"
npm run build

echo "→ 启动服务 http://127.0.0.1:8000"
cd "$ROOT/backend"
exec python -m uvicorn main:app --host 0.0.0.0 --port 8000
