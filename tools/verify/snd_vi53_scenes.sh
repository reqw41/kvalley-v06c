#!/bin/sh
# Приёмка звука: записать сцены на основе и на новой сборке (расписание кадров новой подгоняется под основу),
# сравнить. Использование: tools/verify/snd_vi53_scenes.sh <base.rom> <base.sym> <new.rom> <new.sym> <outdir>
set -e
cd "$(dirname "$0")/../.."
BR=$1; BS=$2; NR=$3; NS=$4; OUT=$5
mkdir -p "$OUT"
for sc in ${SCENES:-natural demo knife gem scroll death keys_s_p}; do
  node tools/verify/snd_vi53_rec.js "$BR" "$BS" base $sc "$OUT/base_$sc.json"
  node tools/verify/snd_vi53_rec.js "$NR" "$NS" new $sc "$OUT/new_$sc.json" "$OUT/base_$sc.json"
  node tools/verify/snd_vi53_replay.js "$BR" "$BS" "$NR" "$NS" "$OUT/base_$sc.json" "$OUT/new_$sc.json" "$OUT/replay_$sc.json"
done
