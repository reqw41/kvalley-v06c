#!/usr/bin/env node
// ============================================================================
//  ЗАЧЕМ ЭТОТ ИНСТРУМЕНТ
//
//  Ядро Vector-06C_MiSTer умеет переключать процессор: в OSD есть «CPU Type:
//  i8080 / Z80». В Z80-режиме инстанцируется T8080se БЕЗ generic map, а там по
//  умолчанию Mode=0 — то есть НАСТОЯЩИЙ Z80, а не 8080-совместимый режим.
//  Наш код — чистый i8080, но часть байт на Z80 означает СОВСЕМ ДРУГОЕ:
//
//    байт | i8080                      | Z80                     | длина 8080/Z80
//    -----+----------------------------+-------------------------+---------------
//    0x08 | NOP (недокументированный)  | EX AF,AF'               | 1 / 1
//    0x10 | NOP (недок.)               | DJNZ e                  | 1 / 2  <-- СДВИГ
//    0x18 | NOP (недок.)               | JR e                    | 1 / 2  <-- СДВИГ
//    0x20 | NOP (недок.)               | JR NZ,e                 | 1 / 2  <-- СДВИГ
//    0x28 | NOP (недок.)               | JR Z,e                  | 1 / 2  <-- СДВИГ
//    0x30 | NOP (недок.)               | JR NC,e                 | 1 / 2  <-- СДВИГ
//    0x38 | NOP (недок.)               | JR C,e                  | 1 / 2  <-- СДВИГ
//    0xCB | JMP nn (недок. дубль)      | префикс bit/rot         | 3 / 2  <-- СДВИГ
//    0xD9 | RET (недок. дубль)         | EXX                     | 1 / 1
//    0xDD | CALL nn (недок. дубль)     | префикс IX              | 3 / 2+ <-- СДВИГ
//    0xED | CALL nn (недок. дубль)     | префикс расширенных     | 3 / 2  <-- СДВИГ
//    0xFD | CALL nn (недок. дубль)     | префикс IY              | 3 / 2+ <-- СДВИГ
//
//  Любой такой байт, попавший в поток КАК ОПКОД, на Z80 не просто выполнится
//  иначе — у большинства ещё и ДРУГАЯ ДЛИНА, то есть весь дальнейший поток
//  инструкций разъезжается. Это ломает игру тише и злее всего.
//
//  ПОЧЕМУ НЕ ЛИНЕЙНЫЙ ПРОХОД. В образе 28К, и большая его часть — данные:
//  карты пирамид, графика, музыка, LUT (vec_tables.asm вообще состоит из байт
//  вида 0xD9/0xDD/0xED — это перевёрнутые биты, а не опкоды). Линейный
//  дизассемблер утонет в ложных срабатываниях. Значение имеет ровно один
//  вопрос: встречается ли опасный байт КАК ОПКОД на ИСПОЛНЯЕМОМ ПУТИ.
//
//  ПОЭТОМУ здесь обходчик по достижимости (recursive-descent disassembler) от
//  точек входа, по jmp/jcc/call/ccc/ret/rst, с раскруткой inline-таблиц
//  диспетчера jumpIndex (`call jumpIndex` + идущий следом массив `dw`).
//  Точки входа:
//    0x0100  — вход .rom (там `jp vec_init`);
//    vec_isr — тело обработчика RST7 (сам вектор по 0x0038 живёт в RAM, его
//              собирает vec_init: пишет туда C3 + адрес vec_isr);
//    tickMain— тело хука H_TIMI (в RAM лежит `jp tickMain`, ставит startCode).
//
//  ЧЕГО ОБХОД НЕ ВИДИТ САМ (и почему нужны досевы):
//    * `ld hl,label` + `push hl` — подсунутый адрес возврата. Это tier-B, ищется
//      РОВНО по паре опкодов (21 nn nn / E5): без такого сужения досев уходит
//      по каждому `ld hl,<таблица графики>` и тонет в данных (проверено — 255
//      ложных «находок» в шрифте, музыке и цветовых таблицах).
//    * САМОМОДИФИКАЦИЯ — например vec_brillo_pal, чей пролог на карте пирамид
//      патчится на `jp vbp_map`. Это tier-C: с ключом --lst берём `ld rp,nn`,
//      где nn — адрес, который листинг пометил началом ИНСТРУКЦИИ (а не
//      данных). Без --lst tier-C выключен.
//  Всё, что осталось непокрытым, печатается сводкой по процедурам. Плюс с
//  --lst считается контрольная цифра: сколько опасных ПЕРВЫХ байт есть среди
//  ВСЕХ инструкций листинга — достижимых и нет.
//
//  Использование:
//    node tools/verify/z80_mode_safety.js build/kvalley_8c.rom build/kvalley_8c.sym \
//         [--lst build/kvalley_8c.lst] [--seed <метка|0xADDR>] [-v]
//  Код возврата: 0 = на исполняемых путях опасных опкодов нет (Z80 безопасен),
//                1 = найдены (печатает адрес, байт, ближайшую метку).
// ============================================================================
"use strict";
const fs = require("fs");

const ORG = 0x0100;              // .rom грузится по 0x0100
// ЗАДАЧА#37: граница кода — НЕ константа: база игровых переменных переезжает при
// уплотнении нижней ОЗУ. Берём её ТОЛЬКО из .sym (GameStatus); запасное число убрано —
// с ним скрипт при отсутствии символа молча сканировал бы чужой диапазон.
let CODE_END = 0;                // выше — игровые переменные (kvalley_vars.asm)

// ---------------------------------------------------------------- аргументы
const argv = process.argv.slice(2);
const verbose = argv.includes("-v") || argv.includes("--verbose");
const optVal = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const lstPath = optVal("--lst");
const extraSeeds = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === "--seed") extraSeeds.push(argv[i + 1]);
const consumed = new Set([lstPath, ...extraSeeds]);
const files = argv.filter(a => !a.startsWith("-") && !consumed.has(a));
const [romPath, symPath] = files;
if (!romPath || !symPath) {
  console.error("usage: node z80_mode_safety.js <rom> <sym> [--lst <lst>] [--seed <label>] [-v]");
  process.exit(2);
}

// ------------------------------------------------------------------- данные
const rom = fs.readFileSync(romPath);
const mem = new Uint8Array(0x10000);
mem.set(rom.subarray(0, Math.min(rom.length, 0x10000 - ORG)), ORG);
const rd = a => mem[a & 0xffff];
const rd16 = a => rd(a) | (rd(a + 1) << 8);
const hex = (a, w = 4) => "0x" + a.toString(16).toUpperCase().padStart(w, "0");

// .sym: «метка: equ XXXXXXXXh»
const sym = {};
for (const l of fs.readFileSync(symPath, "latin1").split("\n")) {
  const m = l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]+)h/);
  if (m) sym[m[1]] = parseInt(m[2], 16);
}
if (!sym.GameStatus) { console.error(`в ${symPath} нет символа GameStatus — границу кода взять неоткуда`); process.exit(2); }
CODE_END = sym.romCeil || sym.GameStatus;
const codeLabels = Object.entries(sym)
  .filter(([, a]) => a >= ORG && a < CODE_END)
  .sort((a, b) => a[1] - b[1]);
const labelAt = new Map();
for (const [n, a] of codeLabels) {
  if (!labelAt.has(a)) labelAt.set(a, []);
  labelAt.get(a).push(n);
}
const isLabelAddr = a => labelAt.has(a);
function nearestLabel(addr) {
  let lo = 0, hi = codeLabels.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (codeLabels[mid][1] <= addr) { best = codeLabels[mid]; lo = mid + 1; }
    else hi = mid - 1;
  }
  return best ? (addr === best[1] ? best[0] : `${best[0]}+${addr - best[1]}`) : "?";
}

// -------------------------------------------- листинг: карта ИНСТРУКЦИЙ (опц.)
// Нужен ТОЛЬКО как оракул «здесь инструкция, а не данные»: для досева tier-C и
// для контрольной сверки покрытия. Сам обход работает по ОБРАЗУ.
let lstInsn = null;
if (lstPath) {
  const DATA_RE = /^\s*(?:[A-Za-z_]\w*:\s*)?\.?(db|dw|ds|dm|byte|word|defb|defw|defs)\b/i;
  const NONINSN_RE = /^\s*(?:[A-Za-z_]\w*:\s*)?(?:$|;|org\b|equ\b|include\b|=|\.)/i;
  lstInsn = new Map();
  for (const raw of fs.readFileSync(lstPath, "latin1").split("\n")) {
    const m = raw.match(/^\s*\d+[+]?\s+([0-9A-Fa-f]{4})\s+((?:[0-9A-Fa-f]{2}\s)+)\t?(.*)$/);
    if (!m) continue;
    const src = (m[3] || "").trim();
    // пусто / директива / данные, а также строки-продолжения db/dw (с литерала)
    if (!src || DATA_RE.test(src) || NONINSN_RE.test(src) || /^[0-9(]/.test(src)) continue;
    lstInsn.set(parseInt(m[1], 16),
      { bytes: m[2].trim().split(/\s+/).map(h => parseInt(h, 16)), src });
  }
}

// ------------------------------------------------------- таблица опкодов 8080
const LEN = new Uint8Array(256).fill(1);
for (const o of [0x01, 0x11, 0x21, 0x31, 0x22, 0x2a, 0x32, 0x3a]) LEN[o] = 3;
for (const o of [0x06, 0x0e, 0x16, 0x1e, 0x26, 0x2e, 0x36, 0x3e]) LEN[o] = 2;
for (const o of [0xc6, 0xce, 0xd6, 0xde, 0xe6, 0xee, 0xf6, 0xfe]) LEN[o] = 2;
for (const o of [0xd3, 0xdb]) LEN[o] = 2;                        // out/in
const JCC = [0xc2, 0xca, 0xd2, 0xda, 0xe2, 0xea, 0xf2, 0xfa];
const CALLS = [0xcd, 0xdd, 0xed, 0xfd, 0xc4, 0xcc, 0xd4, 0xdc, 0xe4, 0xec, 0xf4, 0xfc];
for (const o of [0xc3, 0xcb, ...JCC, ...CALLS]) LEN[o] = 3;

const isUncondJmp = o => o === 0xc3 || o === 0xcb;
const isCondJmp = o => JCC.includes(o);
const isCall = o => CALLS.includes(o);
const isRet = o => o === 0xc9 || o === 0xd9;
const isRst = o => (o & 0xc7) === 0xc7;

const DANGER = new Map([
  [0x08, "EX AF,AF'"], [0x10, "DJNZ e"], [0x18, "JR e"], [0x20, "JR NZ,e"],
  [0x28, "JR Z,e"], [0x30, "JR NC,e"], [0x38, "JR C,e"], [0xcb, "CB-префикс"],
  [0xd9, "EXX"], [0xdd, "DD-префикс (IX)"], [0xed, "ED-префикс"],
  [0xfd, "FD-префикс (IY)"],
]);

// ------------------------------------------------------------- точки входа
const ENTRY = [];
const addEntry = (addr, why) => {
  if (addr >= ORG && addr < CODE_END) ENTRY.push({ addr, why });
};
addEntry(ORG, "вход .rom");
for (const n of ["vec_isr", "tickMain"]) if (sym[n] !== undefined) addEntry(sym[n], n);
for (const s of extraSeeds) {
  const a = /^0x/i.test(s) ? parseInt(s, 16) : sym[s];
  if (a === undefined) { console.error(`--seed: неизвестная метка ${s}`); process.exit(2); }
  addEntry(a, `--seed ${s}`);
}
const JUMPTAB = new Set(["jumpIndex", "JumpIndex2"]
  .map(n => sym[n]).filter(a => a !== undefined));

// ------------------------------------------------------------------- обход
const seen = new Uint8Array(0x10000);     // 1=опкод, 2=операнд, 3=байт dw-таблицы
const insnStart = new Set();
const hits = new Map();
const indirect = [], rstSites = [], jumpTables = [];
const work = [];
let insnCount = 0, tier = "A";

function push(addr) {
  if (addr >= ORG && addr < CODE_END && seen[addr] !== 1) work.push(addr);
}

function walk() {
  while (work.length) {
    let pc = work.pop();
    for (;;) {
      if (pc < ORG || pc >= CODE_END || seen[pc] === 1) break;
      const op = rd(pc), len = LEN[op];
      seen[pc] = 1; insnStart.add(pc); insnCount++;
      for (let i = 1; i < len; i++) if (!seen[pc + i]) seen[pc + i] = 2;

      if (DANGER.has(op) && !hits.has(pc))
        hits.set(pc, { addr: pc, op, z80: DANGER.get(op), label: nearestLabel(pc), tier });

      const nn = len === 3 ? rd16(pc + 1) : 0;
      const next = pc + len;

      if (isUncondJmp(op)) { push(nn); break; }
      if (isCondJmp(op)) { push(nn); pc = next; continue; }
      if (isCall(op)) {
        push(nn);
        if (JUMPTAB.has(nn)) {
          // inline-таблица `dw` сразу за call: едим слова, пока каждое — адрес
          // РОВНО на метке кода; так таблица заканчивается сама собой.
          let t = next; const targets = [];
          while (t + 1 < CODE_END && isLabelAddr(rd16(t))) {
            targets.push(rd16(t));
            if (!seen[t]) seen[t] = 3;
            if (!seen[t + 1]) seen[t + 1] = 3;
            t += 2;
          }
          jumpTables.push({ site: pc, at: next, count: targets.length, targets });
          for (const v of targets) push(v);
          break;   // за таблицей исполнение не продолжается (там следующая процедура)
        }
        pc = next; continue;
      }
      if (isRet(op)) break;
      if (isRst(op)) { rstSites.push({ addr: pc, op, label: nearestLabel(pc) }); pc = next; continue; }
      if (op === 0xe9) { indirect.push({ addr: pc, label: nearestLabel(pc) }); break; }  // pchl
      if (op === 0x76) break;                                                            // hlt
      pc = next;
    }
  }
}

for (const e of ENTRY) push(e.addr);
walk();
const statA = { insn: insnCount, labels: codeLabels.filter(([, a]) => seen[a] === 1).length };

// --- tier-B: `ld hl,nn` + `push hl` (подсунутый адрес возврата)
tier = "B";
const tierB = [];
for (let round = 0; round < 8; round++) {
  const before = work.length;
  for (const pc of [...insnStart]) {
    if (rd(pc) !== 0x21 || rd(pc + 3) !== 0xe5) continue;   // lxi h,nn / push h
    const v = rd16(pc + 1);
    if (!isLabelAddr(v) || seen[v] === 1) continue;
    tierB.push({ target: v, from: pc, names: labelAt.get(v) });
    push(v);
  }
  if (work.length === before) break;
  walk();
}

// --- tier-C: `ld rp,nn`, где nn — адрес НАЧАЛА ИНСТРУКЦИИ по листингу.
// Ловит входы через самомодификацию (пролог патчится на `jp <метка>`).
tier = "C";
const tierC = [];
if (lstInsn) {
  for (let round = 0; round < 8; round++) {
    const before = work.length;
    for (const pc of [...insnStart]) {
      const op = rd(pc);
      if (op !== 0x01 && op !== 0x11 && op !== 0x21) continue;   // lxi b/d/h,nn
      const v = rd16(pc + 1);
      if (!lstInsn.has(v) || seen[v] === 1) continue;
      tierC.push({ target: v, from: pc, name: nearestLabel(v) });
      push(v);
    }
    if (work.length === before) break;
    walk();
  }
}

// ------------------------------------------------------------- статистика
let codeBytes = 0, tabBytes = 0;
for (let a = ORG; a < CODE_END; a++)
  if (seen[a] === 1 || seen[a] === 2) codeBytes++; else if (seen[a] === 3) tabBytes++;

console.log("=== Z80-БЕЗОПАСНОСТЬ: обход по исполняемым путям ===");
console.log(`образ:   ${romPath} (${rom.length} Б; код ${hex(ORG)}..${hex(CODE_END)})`);
console.log(`входы:   ${ENTRY.map(e => `${hex(e.addr)} (${e.why})`).join(", ")}`);
console.log(`обойдено: ${insnCount} инструкций, ${codeBytes} Б кода + ${tabBytes} Б inline-таблиц`);
console.log(`  из них tier-A (только jmp/call/ret/таблицы): ${statA.insn} инстр., ${statA.labels} меток`);
console.log(`метки:   ${codeLabels.filter(([, a]) => seen[a] === 1).length} из ${codeLabels.length} меток кодовой области — на границе инструкции`);
console.log(`таблицы jumpIndex: ${jumpTables.length} шт, ${jumpTables.reduce((s, t) => s + t.count, 0)} записей`);
console.log(`досев: tier-B (lxi+push) ${tierB.length}, tier-C (lxi -> инстр. по .lst) ${tierC.length}`);
console.log(`обрывы достижимости: pchl x${indirect.length}, rst x${rstSites.length}`);

if (verbose) {
  console.log("\n-- таблицы jumpIndex --");
  for (const t of jumpTables)
    console.log(`  call @${hex(t.site)} -> табл @${hex(t.at)}: ${t.count} записей [` +
      t.targets.map(v => (labelAt.get(v) || [])[0] || hex(v)).join(", ") + "]");
  console.log("\n-- pchl (косвенный переход, дальше достижимость обрывается) --");
  for (const i of indirect) console.log(`  ${hex(i.addr)}  ${i.label}`);
  if (tierB.length) {
    console.log("\n-- tier-B входы (lxi h,nn + push h) --");
    for (const t of tierB) console.log(`  ${hex(t.target)} (${t.names.join("/")}) <- ${hex(t.from)}`);
  }
  if (tierC.length) {
    console.log("\n-- tier-C входы (самомодификация / указатель на код) --");
    for (const t of tierC) console.log(`  ${hex(t.target)} (${t.name}) <- ${hex(t.from)}`);
  }
}

// ------------------------------------------- перекрёстная сверка по .lst
if (lstInsn) {
  const unreached = [], dangerInLst = [];
  for (const [a, o] of lstInsn) {
    if (seen[a] !== 1) unreached.push({ a, src: o.src });
    if (DANGER.has(o.bytes[0])) dangerInLst.push({ a, src: o.src, op: o.bytes[0] });
  }
  console.log(`\n-- сверка с .lst (контрольная, оракул «инструкция vs данные») --`);
  console.log(`  инструкций в .lst: ${lstInsn.size}; обход НЕ достал: ${unreached.length}`);
  console.log(`  опасных первых байт среди ВСЕХ .lst-инструкций: ${dangerInLst.length}`);
  for (const d of dangerInLst) console.log(`    ${hex(d.a)} ${hex(d.op, 2)} ${d.src}`);
  const byProc = new Map();
  for (const u of unreached) {
    const p = nearestLabel(u.a).replace(/\+\d+$/, "");
    byProc.set(p, (byProc.get(p) || 0) + 1);
  }
  if (byProc.size) {
    console.log(`  НЕ ПОКРЫТО обходом, по процедурам (${byProc.size}):`);
    for (const [p, n] of [...byProc.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`    ${p}: ${n} инстр.`);
  }
  if (verbose && unreached.length) {
    console.log("  непокрытые инструкции поимённо:");
    for (const u of unreached) console.log(`    ${hex(u.a)}  ${nearestLabel(u.a)}  ${u.src}`);
  }
}

// ------------------------------------------------------------------ вердикт
console.log("");
if (hits.size === 0) {
  console.log("Z80-БЕЗОПАСНОСТЬ: OK — на исполняемых путях опасных опкодов НЕТ");
  process.exit(0);
}
console.log(`Z80-БЕЗОПАСНОСТЬ: НАЙДЕНО ${hits.size} опасных опкодов на исполняемых путях:`);
for (const h of [...hits.values()].sort((a, b) => a.addr - b.addr))
  console.log(`  ${hex(h.addr)}  байт ${hex(h.op, 2)}  Z80: ${h.z80}  (${h.label}) [tier-${h.tier}]`);
process.exit(1);
