#!/bin/bash
# Сборка headless-Emu80 (третий, независимый оракул тайминга Вектор-06Ц).
# Исходники Emu80 берутся READ-ONLY из ~/projects/emu80v4 (форк Emu80 v4, там же
# поддержка Вектора штатно), копируются во временную директорию и патчатся тремя
# точками диспетчеризации PAL (PAL_HEADLESS). Наш код — tools/emu80/headless/.
# Результат: $BUILD/bin/emu80hl. Запуск:
#   HL_BASE=~/projects/emu80v4/dist HL_MODE=info emu80hl --platform vector [--run rom]
set -e
T="$(cd "$(dirname "$0")" && pwd)"
SRC="${EMU80_SRC:-$HOME/projects/emu80v4/src}"
BUILD="${EMU80HL_BUILD:-${TMPDIR:-/tmp}/emu80hl-build}"

mkdir -p "$BUILD"
rsync -a --delete --exclude='*.o' --exclude='qt' --exclude='wx' --exclude='wasm' \
      "$SRC/" "$BUILD/src/"
cp "$T"/headless/*.h "$T"/headless/*.cpp "$BUILD/src/headless/" 2>/dev/null || {
  mkdir -p "$BUILD/src/headless"
  cp "$T"/headless/*.h "$T"/headless/*.cpp "$BUILD/src/headless/"
}

python3 - "$BUILD" <<'EOF'
import sys
B = sys.argv[1]

def patch(path, old, new):
    t = open(path, encoding="utf-8-sig").read()
    if new.splitlines()[0] in t:
        return
    assert old in t, path
    open(path, "w").write(t.replace(old, new, 1))

patch(B + "/src/Pal.h", "#ifdef PAL_LITE",
      '#ifdef PAL_HEADLESS\n#include "headless/hlPal.h"\n#endif // PAL_HEADLESS\n\n#ifdef PAL_LITE')
patch(B + "/src/PalWindow.h", "#ifdef PAL_QT",
      '#ifdef PAL_HEADLESS\n#include "headless/hlPalWindow.h"\n#endif // PAL_HEADLESS\n\n#ifdef PAL_QT')
patch(B + "/src/PalFile.h", "#ifdef PAL_QT",
      '#ifdef PAL_HEADLESS\n  #include "headless/hlPalFile.h"\n#endif // PAL_HEADLESS\n\n#ifdef PAL_QT')
print("patched PAL dispatch")
EOF

cd "$BUILD"
mkdir -p obj bin
: > files.txt
for f in src/*.cpp; do
  [ "$(basename "$f")" = "Main.cpp" ] && continue
  echo "$f" >> files.txt
done
for f in src/headless/hlPal.cpp src/headless/hlPalFile.cpp src/headless/hlMain.cpp; do
  echo "$f" >> files.txt
done

FAIL=0
while read -r f; do
  o="obj/$(basename "$f" .cpp).o"
  if [ "$o" -nt "$f" ]; then continue; fi
  if ! clang++ -std=c++14 -O2 -DPAL_HEADLESS -c "$f" -o "$o" 2> "obj/$(basename "$f" .cpp).err"; then
    echo "FAIL $f (см. obj/*.err)"
    FAIL=1
  fi
done < files.txt
[ $FAIL -ne 0 ] && exit 1
clang++ obj/*.o -o bin/emu80hl
echo "OK $BUILD/bin/emu80hl"
