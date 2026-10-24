#!/bin/sh
# Локальная сборка БЕЗ деплоя в общий kv8c.rom/MiSTer (запрет в задании).
# Гейты: паддинг до потолка образа (адрес GameStatus из .sym, задача #37),
# карта памяти (падение при заходе в переменные), паритет Devector.
set -e
cd "$(dirname "$0")/.."
mkdir -p build
python3 tools/maps_compile.py
tools/bin/sjasm -s src/kvalley_8c.asm build/kvalley_8c.rom build/kvalley_8c.lst build/kvalley_8c.sym
python3 tools/rom_pad.py
python3 tools/mem_map.py
node tools/verify/devector_gate.js
echo "md5: $(md5 -q build/kvalley_8c.rom)"
