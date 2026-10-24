#!/bin/sh
# Сборка БЕЗ шага деплоя: то же, что ./build.sh, но не трогает общий браузерный ROM
# (~/projects/vector06js/kv8c.rom), devector/ и MiSTer. Нужна, когда над репозиторием
# работают несколько веток/агентов сразу: деплой из build.sh затирает чужой тестовый ROM.
# Результат: build/kvalley_8c.rom (+ копия build/kvscroll_test.rom для проб).
# Гейты карты памяти и паритета Devector остаются на месте.
set -e
cd "$(dirname "$0")/.."
python3 tools/maps_compile.py >/dev/null
tools/bin/sjasm -s src/kvalley_8c.asm build/kvalley_8c.rom build/kvalley_8c.lst build/kvalley_8c.sym
python3 tools/rom_pad.py
python3 tools/mem_map.py
node tools/verify/devector_gate.js
cp build/kvalley_8c.rom build/kvscroll_test.rom
cp build/kvalley_8c.sym build/kvscroll_test.sym
echo "собрано: build/kvalley_8c.rom (деплой пропущен)"
