// msx_original_live_worker.js — вспомогательный воркер для msx_original_live.js.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ ПРОЦЕСС. tools/gfx/msx_door_lib.js::makeEmu делает `new MsxEmu()`,
// а MsxEmu.constructor однократно требует tools/msxjs/wmsx.js — этот файл при ПЕРВОМ
// require() кладёт метод .start в global.WMSX, но require() кэширует модуль, и при
// ВТОРОМ создании MsxEmu в том же процессе setupEnv() пересоздаёт global.WMSX уже БЕЗ
// .start (тело wmsx.js второй раз не выполняется) -> "this.W.start is not a function".
// Проверено эмпирически (см. журнал агента). Обходим без правки чужой библиотеки:
// каждый замер на оригинале — свой процесс node, свежий require-кэш, свежий MsxEmu.
//
// Печатает в stdout ровно одну строку "RESULT:<json>". Логи старта партии — в stderr.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const P = require("../gfx/msx_p1_lib.js");
const MSX_ROM = path.join(ROOT, "legacy/msx/kvalley_z80.rom");
const MSX_SYM = path.join(ROOT, "legacy/msx/kvalley_src.sym");

function readSym(p) {
  const m = {};
  for (const l of fs.readFileSync(p, "latin1").split("\n")) {
    const g = l.match(/^(\S+):\s*equ\s*0*([0-9A-Fa-f]+)h/);
    if (g) m[g[1]] = parseInt(g[2], 16);
  }
  return m;
}
const Lm = readSym(MSX_SYM);
const ACTOR_STATUS = 0, ACTOR_SPEEDXDEC = 7, ACTOR_SPEED_X = 8, ACTOR_TIPO = 0x14;
const MOMIA_STRIDE = 0x16, MOMIA_MAX = 4;

function bootOrig() {
  const e = P.makeEmu(MSX_ROM);
  P.startRealGame(e, s => console.error("  " + s));
  for (let i = 0; i < 400 && e.rd(Lm.GameStatus) !== 5; i++) e.runFrames(1);
  if (e.rd(Lm.GameStatus) !== 5) return null;
  return e;
}

const phase = process.argv[2];
let result = { ok: false };

if (phase === "selfcheck") {
  const e = bootOrig();
  if (!e) result = { ok: false, reason: "до GameStatus=5 не дошли" };
  else {
    const x0 = e.rd(Lm.ProtaX);
    e.setRow8("RIGHT", true); e.runFrames(30);
    const x1 = e.rd(Lm.ProtaX);
    e.setRow8("RIGHT", false); e.runFrames(20);
    const x2 = e.rd(Lm.ProtaX);
    result = { ok: true, x0, x1, x2,
      piramideActual: e.rd(Lm.piramideActual), GameStatus: e.rd(Lm.GameStatus),
      ProtaY: e.rd(Lm.ProtaY), ProtaRoom: e.rd(Lm.ProtaRoom) };
  }
} else if (phase === "hero") {
  const e = bootOrig();
  if (!e) result = { ok: false, reason: "до GameStatus=5 не дошли" };
  else {
    const pos = () => e.rd(Lm.ProtaRoom) * 256 + e.rd(Lm.ProtaX);
    const x0 = pos();
    e.setRow8("RIGHT", true);
    let prevT = e.rd(Lm.timer), ticks = 0, frames = 140;
    const speedSamples = [];
    for (let f = 0; f < frames; f++) {
      e.runFrames(1);
      const t = e.rd(Lm.timer);
      if (t !== prevT) { ticks += (t - prevT + 256) % 256; prevT = t;
        if (e.rd(Lm.protaStatus) === 0) speedSamples.push(e.rd(Lm.protaSpeed + 1) + e.rd(Lm.protaSpeed) / 256); }
    }
    e.setRow8("RIGHT", false);
    const distPx = pos() - x0;
    result = { ok: ticks > 0 && speedSamples.length > 0, ticks, frames, distPx, speedSamples };
  }
} else if (phase === "mum") {
  const e = bootOrig();
  if (!e) result = { ok: false, reason: "до GameStatus=5 не дошли" };
  else {
    const fld = (s, o) => e.rd(Lm.momiaDat + s * MOMIA_STRIDE + o);
    const numM = e.rd(Lm.numMomias);
    const constSamples = [], byTipo = {};
    for (let f = 0; f < 2500; f++) {
      e.runFrames(1);
      for (let s = 0; s < MOMIA_MAX; s++) {
        if (fld(s, ACTOR_STATUS) !== 0) continue;
        const spd = fld(s, ACTOR_SPEED_X) + fld(s, ACTOR_SPEEDXDEC) / 256;
        if (spd > 0) { constSamples.push(spd); byTipo[fld(s, ACTOR_TIPO)] = spd; }
      }
    }
    result = { ok: constSamples.length > 0, numM, constSamples, byTipo };
  }
} else if (phase === "jump") {
  const e = bootOrig();
  if (!e) result = { ok: false, reason: "до GameStatus=5 не дошли" };
  else {
    const y0 = e.rd(Lm.ProtaY), room0 = e.rd(Lm.ProtaRoom), x0 = e.rd(Lm.ProtaX);
    e.setRow8("RIGHT", true);
    e.setRow8("SPACE", true); e.runFrames(2); e.setRow8("SPACE", false);
    let entered = -1;
    for (let f = 0; f < 40 && entered < 0; f++) { e.runFrames(1); if (e.rd(Lm.protaStatus) === 1) entered = f; }
    if (entered < 0) result = { ok: false, reason: "прыжок не начался", y0, room0, x0 };
    else {
      let minY = e.rd(Lm.ProtaY), minAttr = e.rd(Lm.protaAttrib), ticks = 0, prevT = e.rd(Lm.timer), exitF = -1;
      let peakSnap = null; // сохраняем PNG ТОЙ ЖЕ живой сессии в момент нового минимума —
      // второй bootOrig() в этом же процессе падает (см. комментарий в шапке файла)
      for (let f = 0; f < 300 && exitF < 0; f++) {
        e.runFrames(1);
        const t = e.rd(Lm.timer); if (t !== prevT) { prevT = t; ticks++; }
        if (e.rd(Lm.ProtaY) < minY) minY = e.rd(Lm.ProtaY);
        const attrNow = e.rd(Lm.protaAttrib);
        if (attrNow < minAttr) { minAttr = attrNow; try { peakSnap = e.snap(); } catch (err) { /* пропустить кадр */ } }
        if (e.rd(Lm.protaStatus) !== 1) exitF = f;
      }
      e.setRow8("RIGHT", false);
      if (exitF < 0) result = { ok: false, reason: "прыжок не завершился за 300 кадров" };
      else {
        const runPx = (e.rd(Lm.ProtaRoom) * 256 + e.rd(Lm.ProtaX)) - (room0 * 256 + x0);
        result = { ok: true, y0, ticks, rise: y0 - minY, runPx, minAttr, wrap: minAttr >= 0xF0 };
        try {
          const OUT = "/tmp/kv_orig_live";
          fs.mkdirSync(OUT, { recursive: true });
          if (peakSnap) {
            P.savePNG(`${OUT}/jump_peak_full.png`, peakSnap, 0, 0, 256, 192, 3);
            result.png = `${OUT}/jump_peak_full.png`;
          } else result.pngError = "снимок пика не сохранился (peakSnap пуст)";
        } catch (err) { result.pngError = err.message; }
      }
    }
  }
} else {
  console.error("неизвестная фаза: " + phase);
  process.exit(2);
}

// ВАЖНО: tools/gfx/msx_door_lib.js::makeEmu (через emu.js::setupEnv) глобально
// подменяет console.log на запись в stderr (WebMSX болтливый, а stdout занят JSON-RPC
// в MCP-режиме) — подмена не восстанавливается. Поэтому строку-результат пишем
// напрямую в дескриптор stdout, а не через console.log.
process.stdout.write("RESULT:" + JSON.stringify(result) + "\n");
