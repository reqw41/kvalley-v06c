#!/bin/sh
# [flicker-kv2] Все стенды мерцания и темпа на одну сборку, параллельно.
# tools/verify/fk_flick.sh <каталог сборки с kvalley_8c.rom/.sym> <каталог вывода>
# rh_eval  — верх поля (герой Y 8..24, бег/прыжок, мумии нет/далеко/рядом), весь экран
# gt_eval  — бег на этажах 72/112 (шлейф), весь экран
# st_eval  — лестница / переход / гем / ворота (окно героя и ворот)
# st_eval2 — верх лестницы, нож, контроль; мумии 0/1/2 (окно героя + OTHER: остальное поле)
# mz_measure — кадры на шаг demo/stress/tour1-3
cd "$(dirname "$0")/../.."
D=$1; O=$2; mkdir -p "$O"; R=$D/kvalley_8c.rom; S=$D/kvalley_8c.sym; NS=${NS:-6}
j() { n=$1; shift; ( "$@" > "$O/$n.out" 2> "$O/$n.log"; echo $? > "$O/$n.rc" ) & }
j rh   node tools/verify/rh_eval.js "$R" "$S" "$O/rh.json"
j gt   node tools/verify/gt_eval.js "$R" "$S" "$O/gt.json"
j st1  env CLS=stairs,pass MUM=0,1 node tools/verify/st_eval.js "$R" "$S" "$O/st1.json"
j st2  env CLS=gem,door,ctrl MUM=0,1 node tools/verify/st_eval.js "$R" "$S" "$O/st2.json"
i=0; while [ $i -lt $NS ]; do
  j e2_$i env OTHER=1 SHARD=$i/$NS node tools/verify/st_eval2.js "$R" "$S" "$O/e2_$i.json"; i=$((i+1)); done
j meas node tools/verify/mz_measure.js "$R" "$S" demo stress tour1 tour2 tour3
wait
for f in "$O"/*.rc; do printf '%s=%s ' "$(basename $f .rc)" "$(cat $f)"; done; echo
