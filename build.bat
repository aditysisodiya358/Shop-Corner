@echo off
rem Compiles src\shop.cpp to WebAssembly. Output: public\shop.js + public\shop.wasm
rem Run this from a terminal where emsdk_env.bat has been run (so em++ is available).
cd /d "%~dp0"

where em++ >nul 2>nul
if errorlevel 1 (
  echo em++ not found. Install and activate Emscripten first:
  echo   git clone https://github.com/emscripten-core/emsdk.git
  echo   cd emsdk
  echo   emsdk install latest
  echo   emsdk activate latest
  echo   emsdk_env.bat
  exit /b 1
)

call em++ -std=c++17 -O2 src/shop.cpp -o public/shop.js --bind -sMODULARIZE=1 -sEXPORT_NAME=createShop -sENVIRONMENT=web -sALLOW_MEMORY_GROWTH=1
if errorlevel 1 exit /b 1

echo Built public\shop.js and public\shop.wasm
echo Test locally:  cd public ^&^& python -m http.server 8000   then open http://localhost:8000
