"use strict";
// Генерирует outputs/snd-opt/REPORT.md из results.json (числа не вписывать руками).
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const R = JSON.parse(fs.readFileSync(path.join(ROOT, "outputs/snd-opt/results.json"), "utf8"));
const L = (...a) => lines.push(a.join(""));
const lines = [];

L("# snd-opt: этап 1 (оверлеи) + этап 2 (часы) — отчёт");
L();
L("База: `", R.base_commit, "`, ветка `", R.branch, "`.");
L();
L("**Вердикт: ", R.verdict, "** — ", R.verdict_ru, ".");
L();
L("ROM базы SHA256 `", R.rom.base_sha256, "`.");
L("Финальная сборка в worktree (сток, оверлеи без правки): `", R.rom.final_sha256, "` — ", R.rom.final_note);
L();

L("## Доказано");
L();
L("### Размеры оверлеев и romCeil");
L();
L("| | AY | ВИ53 | дырка | до romCeil |");
L("| --- | ---: | ---: | ---: | ---: |");
L("| до (9a93866) | ", R.rom.overlay_ay_bytes_before, " | ", R.rom.overlay_vi_bytes_before, " | ", R.rom.hole_before, " | ", R.rom.romCeil_headroom_before, " |");
L("| после (принято) | ", R.rom.overlay_ay_bytes_after, " | ", R.rom.overlay_vi_bytes_after, " | ", R.rom.hole_after, " | ", R.rom.romCeil_headroom_after, " |");
L();
L("Выигрыш тактов на шаг (принято): AY natural ", R.stage1_savings_cycles.ay_natural_step,
  ", ВИ53 natural ", R.stage1_savings_cycles.vi_natural_step,
  ", AY stress ", R.stage1_savings_cycles.ay_stress_step,
  ", ВИ53 stress ", R.stage1_savings_cycles.vi_stress_step, ".");
L();
L("### Цена звука на базе (из sound-cost, без правки)");
L();
L("Обычный прогон, на шаг (среднее): AY **", R.acceptance.cost_before_after.ay_natural_step_mean,
  "**, ВИ53 **", R.acceptance.cost_before_after.vi_natural_step_mean, "**.");
L("Стресс, на шаг: AY **", R.acceptance.cost_before_after.ay_stress_step_mean,
  "**, ВИ53 **", R.acceptance.cost_before_after.vi_stress_step_mean, "**.");
L();
L("### Режим ВИ53 в эмуляторе");
L();
L(R.vi53_mode_method.how);
L();
L("На железе этим методом не проверяется:");
for (const x of R.vi53_mode_method.not_checked_on_hardware) L("- ", x);
L();
L("### Эксперименты этапа 1");
L();
for (const e of R.experiments) {
  L("#### `", e.id, "` — ", e.ok ? "OK" : "провал");
  L();
  L(e.desc);
  L();
  if (e.stress_chip_out_diffs != null) L("- покадровых расхождений выхода (stress AY): **", e.stress_chip_out_diffs, "**");
  if (e.ports_base != null) L("- портовых записей base/opt: ", e.ports_base, " / ", e.ports_opt);
  if (e.ay_bytes != null) L("- размер оверлея AY: ", e.ay_bytes, " Б");
  if (e.vi_bytes != null) L("- размер оверлея ВИ53: ", e.vi_bytes, " Б");
  if (e.stress_harness) L("- harness: ", e.stress_harness);
  if (e.tick_boundary_moves) L("- сдвиг границ тиков (пары кадров): ", JSON.stringify(e.tick_boundary_moves));
  if (e.cause) L("- причина: ", e.cause);
  if (e.sum_with_ay191 != null) L("- AY+VI=", e.sum_with_ay191, " при лимите splash ", e.splash_limit_bytes);
  L();
}
L("### Приёмка (итог)");
L();
L("- Покадровый выход AY: ", R.acceptance.chip_out_frame_parity.ay.ok ? "OK" : "нет",
  " — ", R.acceptance.chip_out_frame_parity.ay.note);
L("- Покадровый выход ВИ53: ", R.acceptance.chip_out_frame_parity.vi.ok ? "OK" : "нет",
  " — ", R.acceptance.chip_out_frame_parity.vi.stress_note);
L("- Гейты: ", R.acceptance.gates.note);
L();
L("### Этап 2 — состав «часы и вход» (цифры с базы sound-cost)");
L();
const P = R.stage2_clocks.proven_from_sound_cost;
L("На логический шаг, обычный прогон (среднее):");
L();
L("| подпункт | AY | ВИ53 |");
L("| --- | ---: | ---: |");
L("| вход (call/обвязка) | ", P.ay_breakdown_per_step_natural.clk_entry, " | ", P.vi_breakdown_per_step_natural.clk_entry, " |");
L("| vsnd_tick* / vst_* | ", P.ay_breakdown_per_step_natural.clk_gate_vsnd_tick, " | ", P.vi_breakdown_per_step_natural.clk_gate_vsnd_tick, " |");
L("| vtm_read/delta | ", P.ay_breakdown_per_step_natural.clk_delta_vtm_read, " | ", P.vi_breakdown_per_step_natural.clk_delta_vtm_read, " |");
L("| аренда C | ", P.ay_breakdown_per_step_natural.clk_lease, " | ", P.vi_breakdown_per_step_natural.clk_lease, " |");
L("| **итого участок 1** | **", P.ay_natural_step_section1_mean, "** | **", P.vi_natural_step_section1_mean, "** |");
L();
L("Метки: ", P.labels.join(", "), ".");
L();

L("## Гипотезы");
L();
L("### Почему equal-skip не проходит приёмку");
L();
L("1. **Hush vs тень.** `vec_snd_hush` глушит чип (AY: микшер 0x3F, громкости 0; ВИ53: ctrl + `vec_vch=0`), не меняя `vec_ayregs`. Skip «равно тени» после hush не дописывает в чип значение тени → расхождение 0x3F/0xFF на микшере и молчание каналов ВИ53 до apply.");
L("2. **Экономия тактов сдвигает тики.** Даже корректный chip-mirror (эксперимент `ay_chip_mirror_all_regs`) даёт 0 лишних/пропущенных тиков за прогон, но **переносит** тики между соседними кадрами → покадровый снимок регистров 8–9 плывёт на ±1 шаг огибающей.");
L("3. **Темп ВИ53.** Equal-skip на входе WRTPSG валит stress (`недобор тиков`). Вероятна связка с арендой канала C / `vtm_have` и порядком «период при ещё заглушенном микшере в тени».");
L("4. **Лимит splash.** ВИ53 с кэшем периода ~425 Б + AY ~191 Б = 616 Б данных оверлея при потолке 0x7800−0x75A5 = 603 Б.");
L();
L("### Этап 2 — что можно снять в «часах и входе»");
L();
for (const h of R.stage2_clocks.hypotheses) {
  L("- **", h.id, ".** ", h.text);
  if (h.est_waste_cycles_per_step) L(" Оценка лишнего: ", h.est_waste_cycles_per_step, ".");
  if (h.est_save_if_cut_half != null) L(" Оценка выигрыша: ~", h.est_save_if_cut_half, " т/шаг.");
  if (h.est_waste) L(" ", h.est_waste, ".");
  if (h.risk) L(" Риск: ", h.risk);
  L();
}
L();
L("## Не сделано");
L();
for (const x of R.not_done) L("- ", x);
L();
L("---");
L();
L("Отчёт сгенерирован `node tools/verify/snd_opt_report.js` из `outputs/snd-opt/results.json`.");
L();

fs.writeFileSync(path.join(ROOT, "outputs/snd-opt/REPORT.md"), lines.join("\n"));
console.log("wrote outputs/snd-opt/REPORT.md");
