#!/bin/sh
# [mummy-zx] Гейты run_gates.sh по одному в свой лог, параллельно; итог PASS/FAIL построчно.
# tools/verify/mz_gates.sh <каталог с kvalley_8c.rom/.sym/.lst/kvalley_splash.rom> <каталог логов>
cd "$(dirname "$0")/../.."
D=$1; O=$2; mkdir -p "$O"
R=$D/kvalley_8c.rom; S=$D/kvalley_8c.sym; LST=$D/kvalley_8c.lst
run() { g=$1; shift; ( "$@" > "$O/$g.log" 2>&1; echo $? > "$O/$g.rc" ) & }
for g in title_boot_gate cheat_god_death cheat_next_pyramid snd_tempo jingle_tempo_gate spr_resid_gate atomic_gate momia_hidden knife_purity door_fixup door_leaf_purity door_gem_resid map_fidelity fixup_wrap_gate hero_width_residue mum_wall_step hero_opaque_composite_gate stack_blit_zero_gate hud_junk_gate top_border_gate gameover_wall_gate hero_jump_wall bw_repair_gate; do
  run $g node tools/verify/$g.js "$R" "$S"
done
run cheat_entry_gate node tools/verify/cheat_entry_gate.js "$R" "$S" "$D/kvalley_splash.rom"
run mummy_contact_probe env MUM=7 JP=8 node tools/verify/mummy_contact_probe.js "$R" "$S"
run two_mum_jump_resid env GAP=6 JP=8 node tools/verify/two_mum_jump_resid.js "$R" "$S"
run hero_overlap_gate env SLOT=7 node tools/verify/hero_overlap_gate.js "$R" "$S"
run check_i8080 node tools/verify/check_i8080.js "$LST"
run bonus_ending_gate node tools/verify/bonus_ending_gate.js "$R"
run keys_monty node tools/verify/keys_monty.js "$R" "$S"
wait
for f in "$O"/*.rc; do g=$(basename "$f" .rc); printf '%-28s rc=%s  %s\n' "$g" "$(cat "$f")" "$(grep -v '^\s*$' "$O/$g.log" | tail -1 | cut -c1-110)"; done
