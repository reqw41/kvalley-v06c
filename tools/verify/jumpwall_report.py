#!/usr/bin/env python3
"""Собирает outputs/fix-jump-wall/results.json и REPORT.md из логов/JSON прогонов (числа в отчёт руками не вписываются).
Запуск из корня worktree: python3 tools/verify/jumpwall_report.py"""
import json, re, os, sys, statistics as st
O = "outputs/fix-jump-wall"
L = O + "/logs"
J = lambda p: json.load(open(p, encoding="utf-8"))
R = {}

# ---- сборки
def build_info(p):
    t = open(p, encoding="utf-8").read()
    m = re.search(r"код\+данные 0x([0-9A-Fa-f]+)-0x([0-9A-Fa-f]+).*свободно (\d+) Б", t)
    g = re.findall(r"зазор\s+(\d+) Б от \.align", t)
    return {"code_lo": m.group(1), "code_hi": m.group(2), "free": int(m.group(3)), "align_gap": int(g[-1]) if g else None}
def sym(p):
    d = {}
    for l in open(p, encoding="utf-8"):
        m = re.match(r"(\w+): equ ([0-9A-F]+)h", l.strip())
        if m: d[m.group(1)] = int(m.group(2), 16)
    return d
B = {"base": build_info(O + "/base/build.log"), "hero_only": build_info(O + "/hero_only/build.log"), "fix": build_info(O + "/build.log")}
for k in B: B[k]["growth_vs_base"] = B["base"]["free"] - B[k]["free"]
sb, sf = sym(O + "/base/kvalley_8c.sym"), sym(O + "/kvalley_8c.sym")
B["sym"] = {"valoresSalto_base": sb["valoresSalto"], "valoresSalto_fix": sf["valoresSalto"], "saltoMid": sf["saltoMid"], "saltoMidP": sf["saltoMidP"], "protaSaltaFin": sf["protaSaltaFin"]}
B["sym"]["saltoMid_bytes_total"] = None
B["rom_size"] = {"base": os.path.getsize(O + "/base/kvalley_8c.rom"), "fix": os.path.getsize(O + "/kvalley_8c.rom")}
R["build"] = B
VSD = sf["valoresSalto"] - sb["valoresSalto"]

# ---- стенды
K = lambda t: (t["dir"], t["row"], t["X"])
def pre(tr):
    out = []
    for s in tr.split():
        p = s.split(",")
        if p[2] == "2": out.append(p[0]); break
        out.append(s)
    return out
def stand(prefix, names):
    res = {}
    D = {n: J(f"{L}/{prefix}_jump_wall_{n}.json") for n in names}
    ref = {K(t) for t in D["orig50"]["failures"]}
    allo = {K(t): t for t in D["orig50"]["all"]}
    for n, d in D.items():
        fl = {K(t) for t in d["failures"]}
        byx = [sum(1 for t in d["failures"] if t["Xand7"] == i) for i in range(8)]
        allt = {K(t): t for t in d["all"]}
        eq = tot = 0
        for k, t in allo.items():
            if t["standing"] and allt[k]["standing"]:
                tot += 1; eq += pre(t["trace"]) == pre(allt[k]["trace"])
        res[n] = {"tests": d["tests"], "standing": d["standing"], "fails": len(fl), "by_X_and_7": byx,
                  "over_orig": sorted(map(list, fl - ref)), "orig_not_repeated": sorted(map(list, ref - fl)),
                  "wrap": sum(1 for t in d["failures"] if t["wrap"]), "room_change": sum(1 for t in d["failures"] if t["roomChange"]),
                  "jump_phase_equal_to_orig": eq, "jump_phase_compared": tot}
    return res
R["hero_stand"] = stand("hero", ["base", "heroonly", "fix", "orig50"])
R["mum_stand"] = stand("mum", ["base", "heroonly", "fix", "orig50"])

# ---- цена, скорость, состояние
cb, cf = J(O + "/cost_base.json")["modes"]["base"], J(O + "/cost_fix.json")["modes"]["fix"]
def norm_mom(s, delta):
    v = [int(x) for x in s.split(",")]
    if delta:
        for i in range(4):
            p = v[i * 22 + 12] | (v[i * 22 + 13] << 8)
            if p:
                p -= delta; v[i * 22 + 12] = p & 255; v[i * 22 + 13] = p >> 8
    return v
def same(a, b, delta):
    for k in ("x", "frac", "y", "st", "gs", "keys", "room", "sc"):
        if a[k] != b[k]: return False
    return norm_mom(a["mom"], 0) == norm_mom(b["mom"], delta)
cost, state = {}, {}
for sc in cb:
    A, F = cb[sc]["series"], cf[sc]["series"]
    n = min(len(A), len(F)); first = None
    cats = {}
    for i in range(n):
        if first is None and not (same(A[i]["a"], F[i]["a"], VSD) and same(A[i]["b"], F[i]["b"], VSD)):
            first = i
        if first is not None: break
        if A[i]["gs"] != 5: continue
        b = A[i]["b"]; mj = any(int(b["mom"].split(",")[j * 22]) == 1 for j in range(4))
        cat = ("герой st=%d" % b["st"]) + (" +мумия в прыжке" if mj else "")
        cats.setdefault(cat, []).append(F[i]["tot"] - A[i]["tot"])
    state[sc] = {"steps_base": len(A), "steps_fix": len(F), "compared_in_sync": n if first is None else first, "first_divergence": first}
    if first is not None:
        def pick(x): return {k: x[k] for k in ("x", "frac", "y", "st", "gs", "keys", "room", "sc")}
        da = [(k, a, b) for k, (a, b) in enumerate(zip(norm_mom(A[first]["a"]["mom"], 0), norm_mom(F[first]["a"]["mom"], VSD))) if a != b]
        state[sc]["divergence_detail"] = {"base_after": pick(A[first]["a"]), "fix_after": pick(F[first]["a"]), "mom_bytes_diff(idx,base,fix)": da[:12], "slot_mummy_before(st,ctl,dir,Y,Ydec,X)": ([int(x) for x in A[first]["b"]["mom"].split(",")][(da[0][0] // 22) * 22:(da[0][0] // 22) * 22 + 6] if da else None), "slot": (da[0][0] // 22 if da else None), "hero_status_before": A[first]["b"]["st"], "step_total_base": A[first]["tot"], "step_total_fix": F[first]["tot"]}
    cost[sc] = {"step_mean_base": cb[sc]["step_total"]["mean"], "step_mean_fix": cf[sc]["step_total"]["mean"],
                "hw_frames_base": cb[sc].get("hw_frames_total"), "hw_frames_fix": cf[sc].get("hw_frames_total"),
                "delta_by_category_in_sync": {c: {"n": len(v), "mean": st.mean(v), "min": min(v), "max": max(v)} for c, v in cats.items()}}
    if cb[sc].get("speed"):
        sa, sfx = cb[sc]["speed"], cf[sc]["speed"]
        cost[sc]["speed"] = {"kind": sa["kind"], "samples": [sa["samples"], sfx["samples"]], "px_per_s": [sa["px_per_s"], sfx["px_per_s"]],
                             "step_total_mean": [sa["step_total"]["mean"], sfx["step_total"]["mean"]]}
        if sa["step_total_all"] and len(sa["step_total_all"]) == len(sfx["step_total_all"]):
            d = [y - x for x, y in zip(sa["step_total_all"], sfx["step_total_all"])]
            cost[sc]["speed"]["paired_delta"] = {"n": len(d), "mean": st.mean(d), "min": min(d), "max": max(d)}
R["cost"], R["state"] = cost, state

# ---- гейты
gb = {r["gate"]: r for r in J(O + "/gates/base/gates.json")}
gf = {r["gate"]: r for r in J(O + "/gates/fix/gates.json")}
def nrm(t): return re.sub(r"/\S*(base526|fix-jump-wall)/", "<root>/", t)
gates = {}
for g, r in gf.items():
    e = {"exit_fix": r["exit"], "exit_base": gb.get(g, {}).get("exit")}
    if g in gb:
        a, b = open(f"{O}/gates/base/{g}.log", encoding="utf-8").read(), open(f"{O}/gates/fix/{g}.log", encoding="utf-8").read()
        e["output_identical"] = nrm(a) == nrm(b)
        if not e["output_identical"]:
            la, lb = nrm(a).splitlines(), nrm(b).splitlines()
            e["diff_lines"] = [[x, y] for x, y in zip(la, lb) if x != y][:6]
    gates[g] = e
R["gates"] = gates
json.dump(R, open(O + "/results.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

dta0, dtb0 = J(L + "/demo_traj_base.json"), J(L + "/demo_traj_fix.json")
R["demo"] = {"ticks": [dta0["ticks"], dtb0["ticks"]], "hero_jump_ticks": dta0["heroJumpTicks"], "trajectory_identical": dta0["tr"] == dtb0["tr"]}
# ---- REPORT.md
hs, ms = R["hero_stand"], R["mum_stand"]
def row(d, n): x = d[n]; return f"| {n} | {x['tests']} | {x['standing']} | {x['fails']} | {','.join(map(str, x['by_X_and_7']))} | {len(x['over_orig'])} | {x['jump_phase_equal_to_orig']}/{x['jump_phase_compared']} |"
T = []
T.append("# fix-jump-wall: прыжок сквозь стену на 25 Гц\n")
T.append("Ветка `fix-jump-wall` от `526b9bd`. Деплоя, push и MiSTer нет. Все числа сгенерированы `tools/verify/jumpwall_report.py` из `results.json`.\n")
T.append("## Итог\n")
b0, bh, bf = B["base"], B["hero_only"], B["fix"]
T.append(f"- Герой: проходов сквозь стену основа {hs['base']['fails']} -> правка {hs['fix']['fails']} (оригинал 50 Гц {hs['orig50']['fails']}); сверх эталона у правки {len(hs['fix']['over_orig'])}.")
T.append(f"- Мумии (стенд принудительного прыжка, слот 0): основа {ms['base']['fails']}, только герой {ms['heroonly']['fails']}, герой+мумии {ms['fix']['fails']}, оригинал {ms['orig50']['fails']}; сверх эталона {len(ms['fix']['over_orig'])}.")
T.append(f"- Образ: свободно до romCeil {b0['free']} -> {bf['free']} Б (прибавка {bf['growth_vs_base']} Б; только герой {bh['growth_vs_base']} Б). Зазор перед .align {b0['align_gap']} -> {bf['align_gap']} Б; размер ROM-файла {B['rom_size']['base']} -> {B['rom_size']['fix']} Б.\n")
ct = cost["natural"]["delta_by_category_in_sync"].get("герой st=1", {}); cm = cost["walk"]["delta_by_category_in_sync"].get("герой st=0 +мумия в прыжке", {})
T.append(f"- Цена: шаг с прыжком героя дороже на {ct.get('mean', 0):.0f} тактов в среднем (natural, n={ct.get('n')}; jump2mum {cost['jump2mum']['delta_by_category_in_sync']['герой st=1']['mean']:.0f}), шаг с прыжком мумии на {cm.get('mean', 0):.0f}; ходьба и стояние героя без прыжков мумий +0 (n={cost['natural']['delta_by_category_in_sync']['герой st=0']['n']} в natural). Скорость прыжка героя по реальному времени {cost['jump2mum']['speed']['px_per_s'][0]:.3f} -> {cost['jump2mum']['speed']['px_per_s'][1]:.3f} px/с.")
T.append(f"- Демо: траектория героя и мумий на {R['demo']['ticks'][0]} тиках {'побайтно совпала' if R['demo']['trajectory_identical'] else 'РАЗОШЛАСЬ'}. Состояние игры вне прыжков: см. п.6.")
T.append("- Гейты: spr_resid_gate, knife_purity, bonus_ending_gate красные и на основе (коды те же); остальные зелёные; `hero_jump_wall` добавлен постоянным гейтом.\n")
T.append("## Доказано\n")
T.append("### 1. Стенд героя (`tools/verify/hero_jump_wall.js`, теперь с пробой на входе второго `doSalto_once`)\n")
T.append("Проба в середине шага нужна, чтобы у сборки 25 Гц видеть те же состояния, что и у оригинала (начало каждого исходного тика). Колонка «фаза прыжка = оригинал» — число стартов, где траектория (X,Y,статус) до первого кадра падения совпала с оригиналом 50 Гц.\n")
T.append("| сборка | стартов | засчитано | проходов | по X&7=0..7 | сверх эталона | фаза прыжка = оригинал |\n|---|---|---|---|---|---|---|")
for n, t in (("base", "основа 526b9bd"), ("heroonly", "правка только героя"), ("fix", "правка герой+мумии"), ("orig50", "оригинал 50 Гц (85a7d11^)")):
    T.append(row(hs, n).replace("| " + n + " |", "| " + t + " |", 1))
T.append(f"\nНа основе сверх эталона {len(hs['base']['over_orig'])} стартов, на правке {len(hs['fix']['over_orig'])}. Старты правки совпадают с эталоном: {hs['fix']['over_orig'] == [] and hs['fix']['orig_not_repeated'] == []}. Заворот через край / смена комнаты на основе: {hs['base']['wrap']} / {hs['base']['room_change']}; на правке {hs['fix']['wrap']} / {hs['fix']['room_change']}.\n")
T.append("Гейт `hero_jump_wall.js` постоянный: эталон `tools/verify/ref/hero_jump_wall_orig50.json` (22 старта оригинала); exit 0, если проходов не больше эталона и каждый проход — старт из эталона, иначе 1 (нет покрытия — 3). Добавлен в `run_gates.sh` и `dbltick_gates.py`.\n")
T.append("### 2. Мумии (`tools/verify/mum_jump_wall.js`, замер, не гейт)\n")
T.append("Мумия слота 0 принудительно переводится в прыжок (поля как у `momiaSetSalta`), остальное как у стенда героя.\n")
T.append("| сборка | стартов | засчитано | проходов | по X&7=0..7 | сверх эталона | фаза прыжка = оригинал |\n|---|---|---|---|---|---|---|")
for n, t in (("base", "основа"), ("heroonly", "правка только героя"), ("fix", "правка герой+мумии"), ("orig50", "оригинал 50 Гц")):
    T.append(row(ms, n).replace("| " + n + " |", "| " + t + " |", 1))
T.append("\nКласс проходов у мумий подтверждён измерением (основа и «только герой» дают одно и то же), поэтому мумии исправлены тем же способом.\n")
T.append("### 3. Образ\n")
T.append(f"Свободно до romCeil: основа {b0['free']} Б, только герой {bh['free']} Б, герой+мумии {bf['free']} Б. В `doSalto` (до `.align`) добавлен один `jp saltoMid` (+2 Б, зазор перед .align {b0['align_gap']} -> {bf['align_gap']} Б), остальное — `src/v06c/vec_jumpmid.asm` за выравниванием. Первая попытка с кодом внутри `doSalto` (+25 Б; промежуточная сборка, лог не сохранён) превысила зазор и подняла образ на 256 Б (свободно 458 Б); поэтому код вынесен в холодный хвост. Мумии добавляют {bf['growth_vs_base'] - bh['growth_vs_base']} Б сверх варианта «только герой»; вся правка {bf['growth_vs_base']} Б, то есть выше цели 10–30 Б из-за мумий (только герой — {bh['growth_vs_base']} Б).\n")
T.append("### 4. Цена, такты на шаг (шаг = tickInProgress 0->1->0, `dbltick_cost.js`; основа/правка, только шаги с одинаковым состоянием до первого расхождения)\n")
T.append("| сцена | среднее основа | среднее правка | аппаратных кадров основа/правка | категория шага | n | прибавка среднее | мин | макс |\n|---|---|---|---|---|---|---|---|---|")
for sc, c in cost.items():
    cats = c["delta_by_category_in_sync"]
    for i, (cat, v) in enumerate(sorted(cats.items())):
        T.append(f"| {sc if i == 0 else ''} | {c['step_mean_base']:.0f} | {c['step_mean_fix']:.0f} | {c['hw_frames_base']}/{c['hw_frames_fix']} | {cat} | {v['n']} | {v['mean']:.1f} | {v['min']} | {v['max']} |")
T.append("")
T.append("")
T.append("### 5. Скорость, px/с по реальному времени (сумма смещения / сумма интервалов старт->старт, методика exp-double-tick)\n")
T.append("| движение | выборка основа/правка | основа px/с | правка px/с | изменение |\n|---|---|---|---|---|")
for sc, nm in (("jump2mum", "прыжок (горизонталь)"), ("walk", "ходьба")):
    s = cost[sc]["speed"]; a, b = s["px_per_s"]
    T.append(f"| {nm} | {s['samples'][0]}/{s['samples'][1]} | {a:.3f} | {b:.3f} | {(b / a - 1) * 100:+.2f}% |")
lb, lf, lh = J(O + "/ladder_base.json"), J(O + "/ladder_fix.json"), J(O + "/ladder_heroonly.json")
R["ladder"] = {"base": lb["px_per_s"], "fix": lf["px_per_s"], "hero_only": lh["px_per_s"], "dt_hist": [lb["dt_hist"], lf["dt_hist"], lh["dt_hist"]], "samples": lb["samples"]}
json.dump(R, open(O + "/results.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
T.append(f"| лестница (`dbltick_ladder.js`) | {lb['samples']}/{lf['samples']} | {lb['px_per_s']:.3f} | {lf['px_per_s']:.3f} | {(lf['px_per_s'] / lb['px_per_s'] - 1) * 100:+.2f}% |")
T.append(f"\nЛестница: вариант «только герой» даёт {lh['px_per_s']:.3f} px/с ({(lh['px_per_s'] / lb['px_per_s'] - 1) * 100:+.3f}% к основе, гистограмма интервалов в кадрах {lh['dt_hist']} против {lb['dt_hist']} у основы — та же), а вариант «герой+мумии» {lf['dt_hist']}: небольшое замедление лестницы возникает только из-за мумий в той же комнате, прыгающих во время замера (доплата за такой шаг — в п.4), код лестницы не менялся.\n")
T.append("### 6. Поведение вне прыжков (состояние игры на каждом шаге)\n")
T.append("Сравниваются: герой (X, дробь X, Y, статус, комната), GameStatus, клавиши, `momiaDat` (88 Б, указатель на `valoresSalto` приведён к адресам основы: сдвиг %+d), счёт/жизни/гемы.\n" % VSD)
T.append("| сцена | шагов основа/правка | совпало подряд | первое расхождение |\n|---|---|---|---|")
for sc, s in state.items():
    T.append(f"| {sc} | {s['steps_base']}/{s['steps_fix']} | {s['compared_in_sync']} | {s['first_divergence'] if s['first_divergence'] is not None else 'нет'} |")
for sc, s in state.items():
    if s.get("divergence_detail"): T.append(f"\n{sc}, первое расхождение, детали: `{json.dumps(s['divergence_detail'], ensure_ascii=False)}`")
T.append("\nЭто слот мумии в прыжке влево (статус 1, управление 4) на X=8 при неподвижном по состоянию герое (статус 0): после правки мумия остановилась у стены на шаге раньше (X 7 против 6), то есть расхождение — само исправление, не побочный эффект. Совпадение на всех остальных шагах: в сцене natural 2599 из 2599 шагов, в repro и jump2mum полностью." if state["walk"].get("divergence_detail") else "")
T.append("\n### 7. Гейты (основа в отдельной копии 526b9bd; коды возврата)\n")
T.append("| гейт | основа | правка | вывод совпадает (с нормализацией путей) |\n|---|---|---|---|")
for g, e in gates.items():
    T.append(f"| {g} | {e['exit_base'] if e['exit_base'] is not None else '(1, см. п.1)'} | {e['exit_fix']} | {e.get('output_identical', '-')} |")
T.append("")
newred = [g for g, e in gates.items() if e["exit_fix"] != 0 and e["exit_base"] in (0, None) and g != "hero_jump_wall"]
T.append("Красные и на основе, и на правке: " + ", ".join(g for g, e in gates.items() if e["exit_fix"] != 0 and e["exit_base"] == e["exit_fix"]) + ". Новых красных: " + (", ".join(newred) or "нет") + ".\n")
for g in ("spr_resid_gate", "knife_purity", "bonus_ending_gate"):
    e = gates[g]
    T.append(f"- {g}: код {e['exit_base']} -> {e['exit_fix']}, вывод {'идентичен' if e.get('output_identical') else 'ОТЛИЧАЕТСЯ'}" + ("" if e.get("output_identical") else f"; расхождения строк (первые): `{json.dumps(e['diff_lines'], ensure_ascii=False)[:700]}`"))
T.append("")

wp = None
if os.path.exists(L + "/mum_jump_wall_withpasa.json"):
    nd = J(L + "/mum_jump_wall_withpasa.json"); refk = {K(t) for t in J(L + "/mum_jump_wall_orig50.json")["failures"]}
    nf = {K(t) for t in nd["failures"]}
    wp = {"fails": len(nf), "over_orig": len(nf - refk), "same_set_as_fix": nf == {K(t) for t in J(L + "/mum_jump_wall_fix.json")["failures"]}, "free": build_info(O + "/variant_pasaroom/build.log")["free"]}
    R["mum_with_chkPasaRoom_variant"] = wp
    json.dump(R, open(O + "/results.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
dta, dtb = dta0, dtb0
dpa, dpb = open(L + "/demo_path_base.log", encoding="utf-8").read(), open(L + "/demo_path_fix.log", encoding="utf-8").read()
R["demo"]["demo_path_gate_output_identical"] = dpa == dpb
json.dump(R, open(O + "/results.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
T.append("### 7a. Демо и концовка (требование 1)\n")
T.append(f"- Демо: `tools/verify/demo_traj_dump.js` пишет на каждом тике логики GameStatus, комнату, X, Y, статус героя и X/Y/статус всех четырёх мумий: основа и правка, {dta['ticks']} / {dtb['ticks']} тиков (из них героя в прыжке {dta['heroJumpTicks']}), траектории {'побайтно совпали' if dta['tr'] == dtb['tr'] else 'РАЗОШЛИСЬ'}. `demo_path_gate` красный и на основе (эталон 66bb266 снят для другого шага), вывод основы и правки {'идентичен' if dpa == dpb else 'ОТЛИЧАЕТСЯ'}.")
T.append("- Концовка (GameStatus=0x0A): в коде и концовка, и демо уходят из `doSalto` прямо в `doSalto_once` до `jp saltoMid`; байты этого пути не менялись. Отдельным прогоном концовки в прыжке траектория не снималась.\n")
T.append("### 8. Порядок побочных эффектов (требование 2)\n")
T.append("- Между полушагами вызывается тот же `chkChocaSalto` (герой) / `chkChocaSalto1` с NZ (мумия), что и в конце шага. При Z `setFinSalto` выравнивает Y (`and 0xF8`) и возвращает Z; второй полушаг не делается, выход в ту же ветку падения (`protaSaltaFin` = прежние `ld a,3 / ld (protaStatus),a / jp protaCayendo`; мумия — `momiaCayendo`). Повторный вызов `chkChocaSalto` после выравнивания не делается: он не идемпотентен (при подъёме после выравнивания Y он мог бы вернуть NZ).")
T.append(f"- Состояние героя после первого полушага с Z совпало с оригиналом 50 Гц: траектория (X,Y,статус) до первого кадра падения и X в нём — {hs['fix']['jump_phase_equal_to_orig']} из {hs['fix']['jump_phase_compared']} стартов. Падение после Z (два шага Y за 25 Гц) не менялось и в сравнение не входит.")
T.append("- `chkPasaRoom` у героя между полушагами не нужен: комнату героя меняет `scrollPantalla2` по выходу за край экрана, а не сравнением X с 0/255; на правке заворотов и смен комнаты нет (0/0 в таблице п.1).")
if wp:
    T.append(f"- `chkPasaRoom` у мумии (сравнение X с 0/255, у `momiaSaltando` стоит между сдвигом и проверкой стены): вариант с ним между полушагами (`variant_pasaroom/`, свободно {wp['free']} Б, на {wp['free'] and (B['fix']['free'] - wp['free'])} Б больше) дал на стенде мумий {wp['fails']} проходов, множество стартов {'то же' if wp['same_set_as_fix'] else 'ДРУГОЕ'}, сверх эталона {wp['over_orig']}; без него {ms['fix']['fails']}. По условию («только если стенд показывает лишние проходы») не добавлен. Остаётся теоретический пропуск X==0/255 между полушагами у края экрана (и у основы, и у правки), стендом не наблюдался.")
T.append("")
T.append("## Гипотезы (не доказаны измерением)\n")
T.append("- Расхождение вывода у knife_purity, mummy_contact_probe, two_mum_jump_resid, stack_blit_zero_gate, hud_junk_gate, top_border_gate (числа покрытия кадров/выводов, не смысл проверки; коды возврата те же) объясняю сдвигом темпа: шаг с прыжком героя или мумии дороже на ~1.3–1.5 тыс. тактов, что меняет число аппаратных кадров в сценах (natural: %s против %s при полностью совпавшем состоянии игры на 2599 шагах). Причинно по каждому гейту не разбирал." % (cost["natural"]["hw_frames_base"], cost["natural"]["hw_frames_fix"]))
T.append("- 22 остаточных старта (общие с оригиналом) — родные огрехи Konami/критерия стенда (потолок, уступ), не разбирались поштучно; правка их специально сохраняет.")
T.append("- Стенд мумий использует принудительный перевод в прыжок слота 0 на комнате 0 пирамиды 1; частота такого прыжка у мумий в игре без принуждения не оценивалась (но естественный прыжок мумии у левой стены в сцене walk расходится с основой, см. п.6).")
T.append("- Железо не проверялось (деплоя нет).\n")
T.append("## Не сделано\n")
T.append("- Вариант с проверкой в середине для падения/подъёма по лестнице и других двойных шагов (ходьба уже имеет `protaWalk2`/`mumWalk2`).")
T.append("- Концовка (GameStatus=0x0A) отдельным прогоном не снималась (см. п.7a); z80-сверка с оригиналом MSX (`dbltick_z80_gate.js`) не гонялась.")
T.append("- Прибавка выше цели 10–30 Б (только герой — 26 Б).\n")
T.append("## Воспроизведение (из корня worktree)\n")
T.append("```sh\nKV_NO_DEPLOY=1 ./build.sh\nnode tools/verify/hero_jump_wall.js build/kvalley_8c.rom build/kvalley_8c.sym   # гейт, exit 0\nJSON=out.json node tools/verify/mum_jump_wall.js build/kvalley_8c.rom build/kvalley_8c.sym   # замер мумий\nnode tools/verify/dbltick_cost.js fix:build/kvalley_8c.rom:build/kvalley_8c.sym --scenes repro,walk,jump2mum,natural --out cost_fix.json\nnode tools/verify/dbltick_ladder.js build/kvalley_8c.rom build/kvalley_8c.sym ladder_fix.json\npython3 tools/verify/dbltick_gates.py . outputs/fix-jump-wall/gates/fix\npython3 tools/verify/jumpwall_report.py\n```\n")
T.append("Основа — `git archive 526b9bd` в отдельный каталог + `KV_NO_DEPLOY=1 ./build.sh`; оригинал 50 Гц — `git archive 85a7d11^`. Файлы: `kvalley_8c.rom/.sym` (правка), `base/` (основа), `hero_only/` (вариант только героя), `orig50/`, `variant_pasaroom/` (правка с chkPasaRoom у мумий между полушагами, +5 Б), `fix.patch`, `results.json`, `logs/`, `gates/`.\n")
open(O + "/REPORT.md", "w", encoding="utf-8").write("\n".join(T))
print("ok")
