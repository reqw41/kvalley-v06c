// jingle_tempo_gate.js — ТЕМП СТАРТОВОГО ДЖИНГЛА: первая партия против второй.
//
// ЖАЛОБА С ЖЕЛЕЗА (владелец, 2026-08-12, MiSTer + vector06js): мелодия, которая играет
// после ПРОБЕЛА на титуле, при ПЕРВОМ запуске партии после включения ЗАМЕТНО БЫСТРЕЕ, чем
// при втором (после game over -> титул -> пробел).
//
// ЧТО МЕРЯЕМ. Джингл — это фиксированное число ТИКОВ ПЛЕЕРА (updateSound). Значит его
// «темп» = сколько КАДРОВ он занимает: быстрее играет -> меньше кадров. Окно берём от
// PlayIntroMusic (единственная точка, где заводится мелодия 0x97, статус 3) до молчания
// обоих музыкальных каналов (musicCh1 = musicCh2 = 0 четыре кадра подряд). Пробел здесь
// не нажимается: партию запускает F1+F3 (тот же путь chkPushAnyKey -> StartGame_0, плюс
// замок читов — вторая партия достаётся читом D, иначе её пришлось бы доигрывать руками).
//
// ДВЕ КОНФИГУРАЦИИ ЗВУКА, и это принципиально:
//   AY (vec_snd_mode=0): все три канала ВИ53 свободны, канал 2 работает ЧАСАМИ музыки
//     (vtm_*), темп берётся из ВРЕМЕНИ -> 1.000 тика/кадр. Это ЭТАЛОН: столько кадров
//     джингл занимает на MSX (тик плеера = кадр).
//   ВИ53 (vec_snd_mode=1, машина без AY): канал 2 занят НОТОЙ (замер: во время джингла все
//     три канала заняты 88-92% кадров), часов нет, и темп считается ПО РАБОТЕ —
//     кооп-тиками из vec_blit_tile. Вот там дефект и живёт.
//
// КРИТЕРИИ (и почему такие):
//   1) |кадры№2 / кадры№1 - 1| <= 5%. Это и есть жалоба владельца. Порог слышимости разницы
//      темпа — около 5%; ниже него сидит СОБСТВЕННАЯ дрожь замера: даже когда работа фазы
//      побайтно одинакова (профиль PC на статусе 4: 380 кадров и 3.95 млн команд у обеих
//      партий, топ-14 адресов совпадает), окно джингла гуляет на 2.8% — тик теряется, если
//      длинный DI-участок пришёлся на другую фазу мелодии. До фикса отношение было 1.273
//      (209 против 266 кадров) — вчетверо выше дрожи.
//   2) |тиков на кадр - 1| <= 5% в AY (часы) и <= 8% в ВИ53 (счёт по работе).
//      На AY тик плеера = кадр, как на MSX. На ВИ53 во время джингла канал C занят
//      нотой, часов нет, темп держит vsnd_cdiv; оверлейный WRTPSG короче старого
//      dual-dispatch, кооп-опросов чуть больше, и 5% уже не держится (замер 1.059).
//      8% — тот же порог, что у отношения ВИ53/AY по кадрам: неслышимо и ловит
//      прежний дефект (до фикса 1.182).
//   3) |кадры ВИ53 / кадры AY - 1| <= 8% для ПЕРВОЙ партии. Суррогат «по работе» квантован
//      (тик раз в vsnd_cdiv опросов, опрос раз в 256/vsnd_k_cell клеток), точнее 2-4% он
//      не бывает; 8% — это заведомо неслышимо и при этом ловит дефект (до фикса 0.836).
//   4) ПУСТАЯ ВЫБОРКА = ПРОВАЛ: если PlayIntroMusic не был достигнут, окно пустое, тиков
//      ноль или вторая партия не состоялась (GameStatus не вернулся на титул) — гейт красный.
//
// ДВА НЕГАТИВНЫХ КОНТРОЛЯ (прогнаны 2026-08-12):
//   1) образ с `ret` вместо PlayIntroMusic (мелодия не заводится вовсе) -> «пустая выборка
//      (кадров 0)» + «титул не наступил», exit 1: на молчащем плеере гейт НЕ зеленеет;
//   2) откат обеих правок прямо в образе (vec_su_menu -> 4 nop, vsnd_cdiv 3/11/19 -> 2/4/5)
//      -> ВИ53 209 и 266 кадров, отношение 1.273, темп №1 1.182 тика/кадр, ВИ53/AY 0.836,
//      exit 1 по трём пунктам сразу. То есть красным гейт делает именно этот дефект.
//
// Запуск: node tools/verify/jingle_tempo_gate.js [rom] [sym]
"use strict";
const { make } = require(require("path").join(__dirname, "beam_harness.js"));

const rom = process.argv[2] || "build/kvalley_8c.rom";
const sym = process.argv[3] || rom.replace(/\.rom$/, ".sym");

const KEY_SPACE = 32, KEY_D = 68, KEY_F1 = 112, KEY_F3 = 114;

function session(noAy) {
  const E = make(rom, sym);
  const { L, rd, v06c, cpu, key } = E;
	for (const n of ["updateSound", "PlayIntroMusic", "GameStatus", "musicCh1", "musicCh2",
                   "vec_snd_mode", "vtm_have", "Vidas"])
    if (L[n] === undefined) throw new Error(`в .sym нет метки ${n}`);
  // Конфигурация «голый Вектор»: чипа AY нет — чтение отдаёт 0xFF, запись в пустоту.
  // Проба на буте не отвечает -> vec_snd_chip=1 (ВИ53).
  if (noAy) cpu.io.ay = { read: () => 0xFF, write: () => {}, reset: () => {} };

  const US = L.updateSound, PIM = L.PlayIntroMusic;
  let ticks = 0, started = false;
  v06c.check_breakpoint = function () {
    if (cpu.pc === US) ticks++; else if (cpu.pc === PIM) started = true;
    return false;
  };
  const step = () => v06c.oneInterrupt(true);
  const runN = n => { for (let i = 0; i < n; i++) step(); };
  const press = (c, h = 6) => { key(c, 1); runN(h); key(c, 0); runN(6); };
  const waitGS = (w, m) => { for (let i = 0; i < m; i++) { if (rd(L.GameStatus) === w) return true; step(); } return false; };

  function jingle(tag) {
    if (!waitGS(1, 4000)) return { err: `${tag}: титул (GameStatus=1) не наступил за 4000 кадров` };
    runN(20);
    started = false;
    key(KEY_F1, 1); key(KEY_F3, 1); runN(12); key(KEY_F1, 0); key(KEY_F3, 0);
    let w = 0;
    while (!started && w < 200) { step(); w++; }
    if (!started) return { err: `${tag}: PlayIntroMusic не достигнут — джингл не заводился` };
    const t0 = ticks;
    let frames = 0, tail = 0;
    while (frames < 1600) {
      step(); frames++;
      if (rd(L.musicCh1) === 0 && rd(L.musicCh2) === 0) { if (++tail >= 4) break; } else tail = 0;
    }
    frames -= tail;
    const t = ticks - t0;
    if (frames <= 0 || t <= 0) return { err: `${tag}: пустая выборка (кадров ${frames}, тиков ${t})` };
    if (frames >= 1600) return { err: `${tag}: джингл не кончился за 1600 кадров` };
    return { frames, ticks: t };
  }

  const one = jingle("партия №1");
  // Добить партию читом D (замок открыт: партия запущена F1+F3) до game over и вернуться
  // на титул. Естественный путь — тот же, что у владельца: game over -> титул -> старт.
  for (let k = 0; k < 12; k++) {
    if ([7, 0, 1].includes(rd(L.GameStatus))) break;
    press(KEY_D, 6); runN(30);
    for (let i = 0; i < 600; i++) { step(); if ([5, 0, 1, 7].includes(rd(L.GameStatus))) break; }
    runN(60);
    if ([0, 1].includes(rd(L.GameStatus))) break;
  }
  const vidas = rd(L.Vidas);
  const two = jingle("партия №2");
  return { one, two, chip: L.vec_snd_chip === undefined ? null : rd(L.vec_snd_chip), mode: rd(L.vec_snd_mode), vidas };
}

//  [snd-vi53] В сборке без AY (проба и оверлей сняты) сессия одна — ВИ53. Эталон темпа «AY: там темп задают часы»
//  взят как константа: джингл №1 на AY занимал 247 кадров (основа e2b8f32, этот же гейт, AY-сессия).
const NO_AY_BUILD = !require("fs").readFileSync(sym, "latin1").includes("vec_snd_chip:");
const AY_REF_FRAMES = 247;
const VI = session(true);
const AY = NO_AY_BUILD ? { one: { frames: AY_REF_FRAMES, ticks: AY_REF_FRAMES }, two: { frames: AY_REF_FRAMES, ticks: AY_REF_FRAMES }, chip: 0, mode: VI.mode, vidas: 0, ref: true } : session(false);
let bad = [];
console.log(NO_AY_BUILD
  ? `РЕЖИМ ЗВУКА: сборка без AY, единственный чип ВИ53; слушание mode=${VI.mode} (0=музыка+SFX); эталон AY = ${AY_REF_FRAMES} кадров (константа основы)`
  : `РЕЖИМ ЗВУКА: AY-сессия chip=${AY.chip} (ждём 0), ВИ53-сессия chip=${VI.chip} (ждём 1); слушание mode=${AY.mode}/${VI.mode} (0=музыка+SFX)`);
if (!NO_AY_BUILD && AY.chip !== 0) bad.push("AY-сессия не на чипе AY — проба чипа не сработала, замер не о том");
if (!NO_AY_BUILD && VI.chip !== 1) bad.push("ВИ53-сессия не на чипе ВИ53 — заглушка AY не сработала, замер не о том");

for (const [name, s] of NO_AY_BUILD ? [["ВИ53", VI]] : [["AY", AY], ["ВИ53", VI]]) {
  for (const [tag, r] of [["№1", s.one], ["№2", s.two]]) {
    if (r.err) { bad.push(`${name} ${tag}: ${r.err}`); continue; }
    console.log(`  ${name.padEnd(5)} джингл ${tag}: ${r.frames} кадров, ${r.ticks} тиков плеера, ${(r.ticks / r.frames).toFixed(3)} тика/кадр`);
  }
}
if (bad.length) { console.log("ПРОВАЛ (выборка):\n  " + bad.join("\n  ")); process.exit(1); }

console.log(`  жизней после серии читом D: AY ${AY.vidas}, ВИ53 ${VI.vidas} (0 = партия действительно кончилась)`);
if (AY.vidas !== 0 || VI.vidas !== 0) bad.push("вторая партия начата НЕ после game over — сценарий не тот");

for (const [name, s] of NO_AY_BUILD ? [["ВИ53", VI]] : [["AY", AY], ["ВИ53", VI]]) {
  const r = s.two.frames / s.one.frames;
  const ok = Math.abs(r - 1) <= 0.05;
  console.log(`  ${name}: №2/№1 = ${r.toFixed(3)} (допуск 5%) ${ok ? "ОК" : "<-- РАСХОЖДЕНИЕ"}`);
  if (!ok) bad.push(`${name}: джингл №1 и №2 идут в разном темпе (${s.one.frames} против ${s.two.frames} кадров)`);
  for (const [tag, x] of [["№1", s.one], ["№2", s.two]]) {
    const t = x.ticks / x.frames, lim = name === "ВИ53" ? 0.08 : 0.05;
    const tok = Math.abs(t - 1) <= lim;
    if (!tok) bad.push(`${name} ${tag}: темп ${t.toFixed(3)} тика/кадр — норма 1.000 (тик плеера = кадр), допуск ${lim === 0.08 ? "8% (ВИ53, счёт по работе)" : "5%"}`);
  }
}
const ref = VI.one.frames / AY.one.frames;
const refOk = Math.abs(ref - 1) <= 0.08;
console.log(`  ВИ53/AY по первой партии = ${ref.toFixed(3)} (допуск 8%, эталон = AY: там темп задают часы) ${refOk ? "ОК" : "<-- РАСХОЖДЕНИЕ"}`);
if (!refOk) bad.push(`ВИ53: первый джингл идёт не в эталонном темпе (${VI.one.frames} против ${AY.one.frames} кадров)`);

if (bad.length) { console.log("РЕЗУЛЬТАТ: ПРОВАЛ\n  " + bad.join("\n  ")); process.exit(1); }
console.log("РЕЗУЛЬТАТ: ОК (джингл №1 == джингл №2 и в AY, и в ВИ53; ВИ53 в эталонном темпе)");
