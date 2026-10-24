#!/bin/bash
# Тонкая (4 такта) развёртка порога гонки: d фиксирован, nops 0..7, оба эмулятора.
set -e
T="$(cd "$(dirname "$0")" && pwd)"
BIN="${EMU80HL:-${TMPDIR:-/tmp}/emu80hl-build/bin/emu80hl}"   # см. build_emu80hl.sh
D="${1:-1026}"
export HL_MODE=race HL_SYM="$T/build/probe_race.sym" \
       HL_POKE_LXI=DVAL HL_POKE_JMP=SJMP HL_SLED=SLED HL_WSTA=WSTA \
       HL_D0="$D" HL_D1="$D" HL_DSTEP=1
export HL_BASE=/Users/boris/projects/emu80v4/dist
echo "== emu80hl =="
for n in 0 1 2 3 4 5 6 7; do
  HL_NOPS=$n HL_PIX=60,148 "$BIN" --platform vector --run "$T/build/probe_race.rom" 2>/dev/null
done
echo "== vector06js =="
for n in 0 1 2 3 4 5 6 7; do
  HL_NOPS=$n HL_PIX=32,148 node "$T/v06js_probe.js" "$T/build/probe_race.rom" "$T/build/probe_race.sym"
done
