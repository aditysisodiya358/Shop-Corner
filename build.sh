#!/usr/bin/env bash
# Compiles src/shop.cpp to WebAssembly. Output: public/shop.js + public/shop.wasm
# Needs Emscripten (emsdk) to be activated in this terminal first.
set -e
cd "$(dirname "$0")"

if ! command -v em++ >/dev/null 2>&1; then
  echo "em++ not found. Install and activate Emscripten first:"
  echo "  git clone https://github.com/emscripten-core/emsdk.git"
  echo "  cd emsdk && ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh"
  exit 1
fi

em++ -std=c++17 -O2 src/shop.cpp -o public/shop.js \
  --bind \
  -sMODULARIZE=1 -sEXPORT_NAME=createShop \
  -sENVIRONMENT=web \
  -sALLOW_MEMORY_GROWTH=1

echo "Built public/shop.js and public/shop.wasm"
echo "Test locally:  cd public && python3 -m http.server 8000   then open http://localhost:8000"
