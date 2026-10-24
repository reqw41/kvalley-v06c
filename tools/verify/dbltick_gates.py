#!/usr/bin/env python3
"""Параллельный прогон гейтов из run_gates.sh с КОДАМИ ВОЗВРАТА (run_gates.sh режет вывод tail и кода не пишет).
Использование: dbltick_gates.py <корень_дерева> <каталог_логов> [--extra hero_jump_wall]
Аргументы гейтов повторяют run_gates.sh. Результат: <каталог_логов>/gates.json"""
import subprocess, sys, os, json
from concurrent.futures import ThreadPoolExecutor
root, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
R, S = "build/kvalley_8c.rom", "build/kvalley_8c.sym"
names = "title_boot_gate cheat_entry_gate cheat_god_death cheat_next_pyramid snd_tempo jingle_tempo_gate spr_resid_gate atomic_gate momia_hidden knife_purity door_fixup door_leaf_purity door_gem_resid map_fidelity fixup_wrap_gate mummy_contact_probe two_mum_jump_resid hero_width_residue mum_wall_step hero_overlap_gate hero_opaque_composite_gate stack_blit_zero_gate hud_junk_gate top_border_gate gameover_wall_gate hero_jump_wall check_i8080".split()
def cmd(g):
    env = dict(os.environ)
    if g == "mummy_contact_probe": env.update(MUM="7", JP="8")
    if g == "two_mum_jump_resid": env.update(GAP="6", JP="8")
    if g == "hero_overlap_gate": env.update(SLOT="7")
    if g == "check_i8080": return ["node", "tools/verify/check_i8080.js", "build/kvalley_8c.lst"], env
    return ["node", f"tools/verify/{g}.js", R, S], env
jobs = [(g,) + cmd(g) for g in names] + [("bonus_ending_gate", ["node", "tools/verify/bonus_ending_gate.js", R], dict(os.environ))]
def run(j):
    g, c, env = j
    p = subprocess.run(c, cwd=root, env=env, capture_output=True, text=True)
    txt = p.stdout + p.stderr
    open(os.path.join(out, g + ".log"), "w").write(txt)
    lines = [l for l in txt.strip().split("\n") if l.strip()]
    return {"gate": g, "exit": p.returncode, "tail": lines[-3:]}
with ThreadPoolExecutor(8) as ex:
    res = list(ex.map(run, jobs))
json.dump(res, open(os.path.join(out, "gates.json"), "w"), ensure_ascii=False, indent=1)
for r in res: print(r["gate"], r["exit"])
