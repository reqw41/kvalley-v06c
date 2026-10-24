#!/bin/sh
# Пакетный прогон приёмочных гейтов (кроме coltab_frame_parity и tick_smooth,
# которые гоняются отдельно). Использование: tools/verify/run_gates.sh
cd "$(dirname "$0")/../.."
R=${GATE_ROM:-build/kvalley_8c.rom}
S=${GATE_SYM:-build/kvalley_8c.sym}
LST=${GATE_LST:-build/kvalley_8c.lst}
for g in title_boot_gate cheat_entry_gate cheat_god_death cheat_next_pyramid snd_tempo jingle_tempo_gate spr_resid_gate atomic_gate momia_hidden knife_purity door_fixup door_leaf_purity door_gem_resid map_fidelity fixup_wrap_gate mummy_contact_probe two_mum_jump_resid hero_width_residue mum_wall_step hero_overlap_gate hero_opaque_composite_gate stack_blit_zero_gate hud_junk_gate top_border_gate gameover_wall_gate hero_jump_wall bw_repair_gate check_i8080; do
  echo "== $g"
  if [ "$g" = mummy_contact_probe ]; then
    # Сценарий владельца: мумия 7 (общая p1 с кожей) + фаза прыжка 8 — до фикса
    # стабильно 4 Б следа. Пустая выборка внутри стенда = exit 1.
    MUM=7 JP=8 node tools/verify/$g.js "$R" "$S" 2>&1 | tail -2
  elif [ "$g" = two_mum_jump_resid ]; then
    # Две мумии гуськом (слоты 6 p0 + 7 p1). vpr_scan без гейта 4+5 воровал пару — 54 Б.
    GAP=6 JP=8 node tools/verify/$g.js "$R" "$S" 2>&1 | tail -2
  elif [ "$g" = hero_overlap_gate ]; then
    # Голый герой: слот 7 (p1) гасит одежду p2. BREAK=1 — одежда цела без мумии.
    SLOT=7 node tools/verify/$g.js "$R" "$S" 2>&1 | tail -3
  elif [ "$g" = check_i8080 ]; then
    node tools/verify/$g.js "$LST" 2>&1 | tail -2
  else
    node tools/verify/$g.js "$R" "$S" 2>&1 | tail -2
  fi
done
# bonus_ending_gate берёт ВТОРЫМ аргументом каталог эталонных кадров, а не .sym: с "$S"
# он падал на mkdir прямо на старте, и в наборе стояла молчаливая дыра (2026-08-05).
echo "== bonus_ending_gate"
node tools/verify/bonus_ending_gate.js "$R" 2>&1 | tail -2
# top_border_gate — В НАБОРЕ С 2026-08-10 (ЗАДАЧА#56). Раньше стоял отдельно и был красным
# на ВСЕХ сборках (40% кадров с мусором в кайме) — это был открытый дефект «нет
# вертикального отсечения спрайта сверху». Дефект закрыт клипом vclp (vec_sprout.asm), а
# сам гейт переписан под новую семантику: в кайме теперь ЖИВЁТ ТАБЛО, и критерий —
# «ни один байт lo 0..31 не изменился относительно спокойного кадра».
# Негативный контроль (call vclp -> 3 nop): 692 кадра из 700 = 98.9%, гейт красный.
