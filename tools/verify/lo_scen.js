// lo_scen.js — сценарии ввода для стенда logic-opt (lo_lib.js). Всё — функции НОМЕРА ТИКА
// геймплея и ГСЧ с зерном, поэтому две сборки получают тот же ввод тик в тик.
"use strict";
const { KEY } = require("./lo_lib.js");

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Случайный тур: направление держится 6..40 тиков, вертикаль и пробел вкраплениями.
function tourKeys(seed, opt = {}) {
  const r = mulberry32(seed);
  let dir = KEY.RIGHT, dirLeft = 0, vert = 0, vertLeft = 0, jump = 0;
  const pJump = opt.pJump ?? 0.10, pVert = opt.pVert ?? 0.15;
  return t => {
    if (dirLeft-- <= 0) { const q = r(); dir = q < 0.42 ? KEY.RIGHT : q < 0.84 ? KEY.LEFT : 0; dirLeft = 6 + Math.floor(r() * 34); }
    if (vertLeft-- <= 0) { const q = r(); vert = q < pVert ? KEY.UP : q < pVert * 2 ? KEY.DOWN : 0; vertLeft = 4 + Math.floor(r() * 26); }
    let k = dir | vert;
    if (jump > 0) { jump--; k |= KEY.SPACE; }
    else if (r() < pJump) { jump = 1 + Math.floor(r() * 4); k |= KEY.SPACE; }
    return k;
  };
}

// Телепорт героя к объекту уровня (нож, кирка, гем, дверь): позиция берётся из ОЗУ игры.
function targets(api) {
  const { L, rd } = api, out = [];
  const nk = rd(L.numKnifes);
  for (let i = 0; i < nk && i < 6; i++) { const p = L.knifesData + i * 17; if (rd(p) === 1) out.push({ k: "knife", y: rd(p + 2), x: rd(p + 4), room: rd(p + 5) }); }
  const np = rd(L.numPicos);
  for (let i = 0; i < np && i < 12; i++) { const p = L.picosData + i * 5; if (rd(p) === 1 || rd(p) === 0) out.push({ k: "pico", y: rd(p + 1), x: rd(p + 3), room: rd(p + 4) }); }
  const ng = rd(L.gemasTotales);
  for (let i = 0; i < ng && i < 6; i++) { const p = L.datosGemas + i * 9; if (rd(p) & 1) out.push({ k: "gem", y: rd(p + 2), x: rd(p + 4), room: rd(p + 5) }); }
  return out;
}
function teleport(api, tg, dy = 0) {
  const { L, wr } = api;
  wr(L.ProtaY, (tg.y + dy) & 255); wr(L.ProtaX, tg.x); wr(L.ProtaXdecimal, 0); wr(L.ProtaRoom, tg.room); wr(L.protaStatus, 0);
}

function coverageProbe() {
  const c = { gs: {}, pst: {}, mst: {}, gems: 0, knifeTaken: 0, picoTaken: 0, deaths: 0, pyr: new Set(), stageClear: 0, maxSimMum: 0, knifeStat: {}, doorSt: {}, spinning: 0 };
  let prevGems = 0, prevObj = 0, prevVivo = 1, prevClear = 0;
  return {
    c,
    post(t, api) {
      const { L, rd } = api;
      c.gs[rd(L.GameStatus)] = (c.gs[rd(L.GameStatus)] || 0) + 1;
      const ps = rd(L.protaStatus); c.pst[ps] = (c.pst[ps] || 0) + 1;
      let vis = 0;
      for (let m = 0; m < 3; m++) { const s = rd(L.momiaDat + m * 22); c.mst[s] = (c.mst[s] || 0) + 1; if (rd(L.momiaDat + m * 22 + 6) === rd(L.ProtaRoom) && s !== 4) vis++; }
      c.maxSimMum = Math.max(c.maxSimMum, vis);
      const g = rd(L.gemasCogidas); if (g > prevGems) c.gems += g - prevGems; prevGems = g;
      const o = rd(L.objetoCogido); if (o !== prevObj) { if (o === 0x10) c.knifeTaken++; if (o === 0x20) c.picoTaken++; } prevObj = o;
      const v = rd(L.flagVivo); if (!v && prevVivo) c.deaths++; prevVivo = v;
      const fc = rd(L.flagStageClear); if (fc && !prevClear) c.stageClear++; prevClear = fc;
      c.pyr.add(rd(L.piramideActual));
      for (let k = 0; k < 6; k++) { const s = rd(L.knifesData + k * 17); c.knifeStat[s] = (c.knifeStat[s] || 0) + 1; }
      for (let d = 0; d < 4; d++) { const s = rd(L.pyramidDoors + d * 7 + 4) >> 4; c.doorSt[s] = (c.doorSt[s] || 0) + 1; }
      if (rd(L.numDoorGira)) c.spinning++;
    },
  };
}

// страховка от Game Over: жизней не меньше трёх (одинаково в обеих сборках)
function lives(api) { const { L, rd, wr } = api; if (rd(L.Vidas) < 3) wr(L.Vidas, 3); }

// Сквозной сценарий: собрать гемы телепортом, открыть выход, выйти, войти в следующую пирамиду.
function stagePre() {
  let lastTp = -100;
  return (t, api) => {
    const { L, rd, wr } = api;
    lives(api);
    if (rd(L.flagEntraSale)) return;
    const doorOpen = [0, 1, 2, 3].some(d => rd(L.pyramidDoors + d * 7) !== 0xff && (rd(L.pyramidDoors + d * 7 + 4) >> 4) === 4);
    if (!doorOpen && t - lastTp < 6) return;
    for (let d = 0; d < 4; d++) {
      const p = L.pyramidDoors + d * 7, y = rd(p);
      if (y === 0xff) continue;
      const st = rd(p + 4) >> 4;
      if (st === 2) { wr(p + 4, 0x30); }
      else if (st === 4) { teleport(api, { y: rd(p) - 2, x: rd(p + 2), room: rd(p + 3) }); lastTp = t; return; }
    }
    const g = targets(api).filter(x => x.k === "gem");
    if (g.length) { teleport(api, g[0]); lastTp = t; }
  };
}

function mk(name, ticks, boot, keysSeed, extra = {}) {
  const probe = coverageProbe();
  const keys = tourKeys(keysSeed, extra.keyOpt);
  const s = {
    name, ticks, boot,
    keys(t, api) { return extra.keys ? extra.keys(t, api, keys) : keys(t, api); },
    pre(t, api) { lives(api); if (extra.pre) extra.pre(t, api); },
    post(t, api) { probe.post(t, api); if (extra.post) extra.post(t, api); },
    cov: probe.c,
  };
  return s;
}

function scenarios() {
  const S = [];
  S.push(mk("demo", 2600, "demo", 1, { keys: () => 0 }));
  // три тура от старта партии; телепорты к предметам каждые 90 тиков
  const tpPre = (period, ph, godAfter) => (t, api) => {
    if (t % period === ph) { const tg = targets(api); if (tg.length) { const r = mulberry32(t * 7919 + 13)(); teleport(api, tg[Math.floor(r * tg.length)]); } }
  };
  S.push(mk("tour1", 3000, "game", 11, { pre: tpPre(90, 20) }));
  S.push(mk("tour2", 3000, "game", 22, { pre: tpPre(60, 5), keyOpt: { pJump: 0.2, pVert: 0.25 } }));
  S.push(mk("tour3", 3000, "game", 33, { pre: tpPre(120, 40), keyOpt: { pJump: 0.05, pVert: 0.1 } }));
  // стресс: бессмертие, три мумии прижаты к герою, прыжки и лестницы
  const pinMum = (t, api) => {
    const { L, rd, wr } = api;
    if (t === 0) wr(L.vec_god, 1);
    if (t % 3 === 0) {
      const hy = rd(L.ProtaY), hx = rd(L.ProtaX), room = rd(L.ProtaRoom);
      const off = [18, -22, 40];
      for (let m = 0; m < 3; m++) {
        const p = L.momiaDat + m * 22;
        if (rd(p) === 4 || rd(p + 6) !== room) { wr(p, 0); wr(p + 3, hy); wr(p + 5, (hx + off[m]) & 255); wr(p + 6, room); wr(p + 0x14, m & 3); wr(p + 0x11, 0); }
      }
    }
    if (t % 150 === 30) { const tg = targets(api); if (tg.length) teleport(api, tg[(t / 150) % tg.length | 0]); }
  };
  S.push(mk("stress", 2500, "game", 44, { pre: pinMum, keyOpt: { pJump: 0.15, pVert: 0.2 } }));
  S.push(mk("stage", 3000, "game", 55, { pre: stagePre(), keyOpt: { pJump: 0.05, pVert: 0.05 } }));
  return S;
}
module.exports = { scenarios, mulberry32, tourKeys, targets, teleport };
