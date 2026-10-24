#!/bin/sh
# lo_gate.sh — ГЕЙТ ПОВЕДЕНИЯ logic-opt: сборка против эталона 23ffb6f по игровому состоянию
# после КАЖДОГО тика логики, шесть сценариев с одним вводом по номеру тика.
# Использование: tools/verify/lo_gate.sh <каталог с kvalley_8c.rom/.sym> [эталон-каталог] [сценарии...]
# Эталон по умолчанию outputs/logic-opt/base (снимки кэшируются в <эталон>/snap_<сценарий>.bin).
# Выход 0 = расхождений нет и раскладка цела.
cd "$(dirname "$0")/../.."
NEW=${1:-build}
BASE=${2:-outputs/logic-opt/base}
shift; shift
SCEN=${*:-demo tour1 tour2 tour3 stress stage}
OUT=outputs/logic-opt/gate_$(basename "$NEW")
mkdir -p "$OUT"
# раскладка, от которой зависят быстрые пути: статусы дверей в одной странице
node -e '
const fs=require("fs");const L={};for(const l of fs.readFileSync(process.argv[1],"latin1").split("\n")){const m=l.match(/^(\S+):\s+equ\s+0*([0-9A-Fa-f]+)h/);if(m)L[m[1]]=parseInt(m[2],16);}
if((L.pyramidDoors+4>>8)!==(L.pyramidDoors+25>>8)){console.log("РАСКЛАДКА: статусы дверей пересекают страницу");process.exit(1);}
if((L.gmd_tab&255)>0xF8){console.log("РАСКЛАДКА: gmd_tab пересекает страницу");process.exit(1);}
console.log("раскладка ок");' "$NEW/kvalley_8c.sym" || exit 1
for s in $SCEN; do
  [ -f "$BASE/snap_$s.bin" ] || node tools/verify/lo_snap.js "$BASE/kvalley_8c.rom" "$BASE/kvalley_8c.sym" $s "$BASE/snap_$s.bin" > "$BASE/snap_$s.log" 2>&1 &
  node tools/verify/lo_snap.js "$NEW/kvalley_8c.rom" "$NEW/kvalley_8c.sym" $s "$OUT/snap_$s.bin" > "$OUT/snap_$s.log" 2>&1 &
done
wait
RC=0
for s in $SCEN; do
  node tools/verify/lo_cmp.js "$BASE/snap_$s.bin" "$OUT/snap_$s.bin" "$NEW/kvalley_8c.sym" | tee "$OUT/cmp_$s.json" || RC=1
done
exit $RC
