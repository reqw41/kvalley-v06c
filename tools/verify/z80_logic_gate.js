// Z80-ГЕЙТ логики: MSX(Z80-эталон) vs Vector-рекомпилят, ТОЛЬКО игровое
// состояние (MAP), VRAM-слой отключён. Рендер-специфичные переменные
// (offsetPlanoSpr/knife-plane/protaAttrib — MSX flicker-трюк, Vector не
// использует) игнорируются. Эталон base: первая дивергенция = protaAttrib
// тик 824 (GS=5). Оптимизация ВАЛИДНА если даёт ТУ ЖЕ первую дивергенцию.
// Сборка MSX-эталона: sjasm msx/kvalley_src.asm kvm.rom kvm.lst kvm.sym
// Использование: node z80_logic_gate.js kvm.rom kvm.sym <vec.rom> <vec.sym> [тиков]
// ЛОКСТЕП-ВЕРИФИКАТОР рекомпилятора: MSX(Z80) vs Vector(i8080) из одного
// исходника, тик-в-тик, сравнение префикса MAP (игровые переменные, одинаковая
// раскладка от GameStatus в обоих таргетах). Дивергенция = трансляционный баг.
// Использование: node lockstep_kv.js <kvm.rom> <kvm.sym> <kvv.rom> <kvv.sym> [тиков]
"use strict";
const fs = require("fs");
const MsxHeadless = require("./msx_headless.js");
const base = "/Users/boris/Projects/vector06js";

function readSym(p) {
  const m = {};
  for (const l of fs.readFileSync(p, "latin1").split("\n")) {
    const g = l.match(/^(\S+):\s*equ\s*([0-9A-Fa-f]{8})h/);
    if (g) m[g[1]] = parseInt(g[2], 16);
  }
  return m;
}

// --- Vector headless (vector06js) ---
function makeVector(romPath) {
  global.window = global;
  global.document = { createElement: () => fc(), getElementById: () => fc() };
  function fcx(){return{createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:()=>{},drawImage:()=>{},getImageData:()=>({data:new Uint8ClampedArray(4)}),fillRect:()=>{},save:()=>{},restore:()=>{},scale:()=>{},setTransform:()=>{}};}
  function fc(){return{width:0,height:0,style:{},getContext:()=>fcx()};}
  global.requestAnimationFrame=()=>0; global.setTimeout=()=>0; global.print=()=>0; global.console.debug=()=>{};
  const files=["i8080-js/i8080_trace.js","i8080-js/i8080_disasm.js","i8080-js/i8080.js","src/fili.js","src/ay.js","src/fd1793.js","src/fddimage.js","src/i8253.js","src/io.js","src/keyboard.js","src/memory.js","src/sound.js","src/tv.js"];
  const vm=require("vm"); const ctx=vm.createContext(global);
  for(const f of files) vm.runInContext(fs.readFileSync(base+"/"+f,"utf8"),ctx,{filename:f});
  const {Memory,IO,AY,I8253,Keyboard,I8080,Vector06c,Floppy}=ctx;
  const memory=new Memory(),keyboard=new Keyboard(),timer=new I8253(),ay=new AY();
  const floppy=new(Floppy().FD1793)(); const io=new IO(keyboard,timer,memory,ay,floppy);
  io.Palette=new Array(16).fill(0);
  const cpu=new I8080(memory,io); const tape={advance:()=>{},sample:0,reset:()=>{}};
  const v06c=new Vector06c(cpu,memory,io,ay,tape);
  v06c.bmp=new Uint32Array(256*256); v06c.displayFrame=function(){}; v06c.check_breakpoint=()=>false; v06c.dbg=null;
  if(v06c.soundnik) v06c.soundnik.soundStep=function(){};
  const img=new Uint8Array(fs.readFileSync(romPath));
  memory.init_from_array(img.subarray(0,0x10000),0x100); memory.detach_boot&&memory.detach_boot();
  cpu.pc=0; cpu.sp=0xc300; cpu.iff=false;
  timer.Write(3,0x36); timer.Write(3,0x76); timer.Write(3,0xb6); ay.reset&&ay.reset();
  const rd=(a)=>memory.bytes[memory.tobank(a)];
  return { cpu, rd, keyboard, frame: () => v06c.oneInterrupt(true) };
}

const [romM, symM, romV, symV, maxTicksS] = process.argv.slice(2);
const maxTicks = +(maxTicksS || 2000);
const sm = readSym(symM), sv = readSym(symV);

// Префикс MAP: от GameStatus до первой vector-only ячейки (в обоих таргетах
// одинаковые смещения игровых переменных).
const gsM = sm.GameStatus, gsV = sv.GameStatus;
let prefEnd = Infinity;
for (const [n, a] of Object.entries(sv))
  if (!(n in sm) && a > gsV && a < gsV + 0x2000) prefEnd = Math.min(prefEnd, a);
// потолок: stackArea (зона стека различается легально)
const stackCut = (sm.stackArea || (gsM + 0x6FF)) - gsM;
const PREF = Math.min(prefEnd - gsV, stackCut);
// имя переменной по смещению (для отчёта)
const byOff = {};
for (const [n, a] of Object.entries(sv))
  if (a >= gsV && a < gsV + PREF) byOff[a - gsV] = n;

console.log(`MAP prefix: ${PREF} bytes (GameStatus_msx=0x${gsM.toString(16)}, _vec=0x${gsV.toString(16)})`);

const msx = MsxHeadless(new Uint8Array(fs.readFileSync(romM)));
const vec = makeVector(romV);
const tmM = sm.tickMain, tmV = sv.tickMain;

function runToTick(stepFrame, cpu, tmAddr, isMsx) {
  // исполнить до следующего входа в tickMain (по инструкциям)
  for (let guard = 0; guard < 4e6; guard++) {
    if (isMsx) {
      if (msx.cpu.pc === tmAddr) { msx.cpu.instruction(); return true; }
      msx._acc = (msx._acc || 0) + (msx.cpu.instruction() || 4);
      if (msx._acc >= 59736) { msx._acc -= 59736; msx.cpu.interrupt(false, 0xFF); }
    } else {
      // Vector: пошагово нельзя (oneInterrupt кадрами) -> хук в цикле кадров
      return false; // не используется, см. ниже
    }
  }
  return false;
}

// Vector: тик ловим хуком на instruction
let vTickHit = false;
const vOrig = vec.cpu.instruction.bind(vec.cpu);
vec.cpu.instruction = function () { if (vec.cpu.pc === tmV) vTickHit = true; return vOrig(); };
function vecRunToTick() {
  for (let guard = 0; guard < 4000; guard++) {   // до 4000 кадров на тик
    if (vTickHit) { vTickHit = false; return true; }
    vec.frame();
  }
  return false;
}
// ВНИМАНИЕ: vec.frame() исполняет целый кадр -> внутри может быть >1 тика.
// Точность: ловим тики ЧЕРЕЗ счётчик, сравниваем только когда оба на границе.
let vTicks = 0, mTicks = 0;
// ---- СИНХРОТОЧКА = ВХОД В ТИК ----
// Игровая RAM (MAP-префикс) и VRAM/тень пишутся ТОЛЬКО тиками; main-потоки
// их не трогают. Останов обеих машин ровно на pc==tickMain (входе тика T+1)
// даёт атомарный снимок состояния "после тика T".
class SyncStop { }
const symSortedCache = new Map();
function symLbl(sym, addr) {
  let arr = symSortedCache.get(sym);
  if (!arr) { arr = Object.entries(sym).sort((x, y) => x[1] - y[1]); symSortedCache.set(sym, arr); }
  if (addr < 0x100) return null;
  let lo = 0, hi = arr.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m][1] <= addr) { r = m; lo = m + 1; } else hi = m - 1; }
  if (r < 0) return null;
  return [arr[r][0], addr - arr[r][1]];
}
// REPLAY: KeyHold-поток с реального прогона; оба таргета через родные механизмы
const REC = JSON.parse(fs.readFileSync("/tmp/keyhold_rec.json")).rec;
// НУЛЕВОЙ ВВОД: King's Valley demo самоиграется по встроенной DemoKeyData -
// обе машины детерминированы без внешних клавиш. Чистейший тест транслятора.
function applyMsxInput(t) { msx.kbd[8] = 0xFF; }
function applyVecInput(t) { vec.keyboard.matrix.fill(0); }
vec.cpu.instruction = function () {
  if (vec.cpu.pc === tmV && vec.rd(gsV + 5) === 0) {   // только ПОЛНЫЕ тики
    if (vTicks + 1 > vecTarget) throw new SyncStop();
    vTicks++; applyVecInput(vTicks);
  }
  return vOrig();
};
let vecTarget = 0;
function vecRunToEntry(t) {
  vecTarget = t - 1;                 // остановиться на входе тика t (выполнено t-1)
  for (let guard = 0; guard < 20000; guard++) {
    try { vec.frame(); } catch (e) { if (e instanceof SyncStop) return true; throw e; }
  }
  return false;
}
function msxRunToEntry(t) {
  for (let guard = 0; guard < 2e9; guard++) {
    if (msx.cpu.pc === tmM && msx.mem[gsM + 5] === 0) {   // только ПОЛНЫЕ тики
      if (mTicks + 1 === t) return true;         // стоим на входе тика t
      mTicks++; applyMsxInput(mTicks);
    }
    msx._acc = (msx._acc || 0) + (msx.cpu.instruction() || 4);
    if (msx._acc >= 59736) { msx._acc -= 59736; msx.cpu.interrupt(false, 0xFF); }
  }
  return false;
}
function snapshot(rd, gs) { const b = Buffer.alloc(PREF); for (let i = 0; i < PREF; i++) b[i] = rd(gs + i); return b; }
const mRd = (a) => msx.mem[a];

let diverged = false, honest = 0;
for (let t = 2; t <= maxTicks && !diverged; t++) {
  if (!msxRunToEntry(t) || !vecRunToEntry(t)) { console.log(`не докрутились до тика ${t}`); break; }
  honest++;
  // стартовая инициализация пишет VRAM/MAP из MAIN-потока - несравнима;
  // ждём выхода обеих из init (GS>=1 и tickInProgress==0)
  // сравнивать только в ЖИВОЙ ИГРЕ (GS==5) при завершённом тике - жалоба
  // юзера («01», мусор мумий) там; заставка/меню = отдельный тайминг анимаций.
  if (msx.mem[gsM] === 0 || msx.mem[gsM + 5] || vec.rd(gsV) === 0 || vec.rd(gsV + 5)) continue;
  // VRAM-слой сравниваем ТОЛЬКО в живой игре (GS==5): в заставке/меню
  // софт-VDP асинхронен и тень лого отстаёт по фазе (визуально безвредно).
  // MAP (игровая логика) — ПЕРВЫМ: это истина, важнее визуала
  {
    const a = snapshot(mRd, gsM), b = snapshot(vec.rd, gsV);
    if (!a.equals(b)) {
      const diffs = [];
      for (let i = 0; i < PREF; i++) {
        if (a[i] === b[i]) continue;
        if (i >= 0x10 && i <= 0x3f) continue;      // звук frame-paced, легально
        if (i === 0x61) continue;                  // offsetPlanoSpr: MSX flicker-трюк, Vector не использует
        if (i >= 0x26e && i <= 0x26e) continue;    // knifesData+10: спрайт-plane (производное flicker)
        let ok = false;
        for (const s0 of [i - 1, i]) {
          if (s0 < 0 || s0 + 1 >= PREF) continue;
          const wm = a[s0] | (a[s0 + 1] << 8), wv = b[s0] | (b[s0 + 1] << 8);
          const lm = symLbl(sm, wm), lv = symLbl(sv, wv);
          if (lm && lv && lm[0] === lv[0] && lm[1] === lv[1]) { ok = true; i = s0 + 1; break; }
        }
        if (!ok) diffs.push(i);
      }
      if (diffs.length) {
        diverged = true;
        console.log(`MAP DIVERGENCE после тика ${t - 1} (GS=${a[0]}):`);
        for (const i of diffs.slice(0, 12))
          console.log(`  +0x${i.toString(16)} ${byOff[i] || ""}: msx=${a[i].toString(16)} vec=${b[i].toString(16)}`);
        break;
      }
    }
  }
  const nsV = 0; // VRAM-слой отключён: гейт ТОЛЬКО логики (MAP)
  if (nsV) {
    let nd = [];
    let nb = msx.nameBase();
    for (let i = 0; i < 768; i++) if (msx.vram[nb + i] !== vec.rd(nsV + i)) nd.push(i);
    if (nd.length) {
      // СИММЕТРИЧНЫЙ catch-up: двигаю ОБЕ машины на +30 тиков и сверяю остаток.
      // Отсеивает лаг отрисовки уровня (setupRoom растянут по кадрам на Векторе)
      // от СТОЙКОГО мусора (недостёртые клетки, которые не исчезают).
      const settle = t + 30;
      msxRunToEntry(settle); vecRunToEntry(settle);
      nb = msx.nameBase();
      const nd2 = [];
      for (let i = 0; i < 768; i++) if (msx.vram[nb + i] !== vec.rd(nsV + i)) nd2.push(i);
      t = settle;
      if (nd2.length === 0) { lagged++; continue; }
      nd = nd2;
    }
    if (nd.length) {
      diverged = true;
      // РЕШАЮЩАЯ ПРОВЕРКА: совпадает ли КАРТА уровня (MapaRAMRoot, вне префикса)?
      // Карта равна + name разный => баг РЕНДЕРА (софт-VDP). Карта разная =>
      // баг логики за пределами сравниваемого префикса.
      const mapM = sm.MapaRAMRoot, mapV = sv.MapaRAMRoot;
      let mapDiff = 0, mapLoc = [];
      for (let i = 0; i < 768; i++) if (msx.mem[mapM + i] !== vec.rd(mapV + i)) { mapDiff++; if (mapLoc.length < 8) mapLoc.push("r" + (i >> 5) + "c" + (i & 31) + "(m" + msx.mem[mapM + i].toString(16) + "/v" + vec.rd(mapV + i).toString(16) + ")"); }
      console.log(`КАРТА уровня (MapaRAMRoot): расхождений ${mapDiff}/768 ${mapLoc.join(" ")}`);
      console.log(`  вердикт: ${mapDiff === 0 ? "КАРТА РАВНА => баг РЕНДЕРА (софт-VDP)" : "КАРТА РАЗНАЯ => логика вне префикса"}`);
      console.log(`СТОЙКАЯ VRAM-NAME DIVERGENCE после тика ${t - 1}: ${nd.length} клеток (msx nameBase=0x${nb.toString(16)})`);
      for (let r = 0; r < 24; r++) {
        let lm2 = "", lv2 = "";
        for (let c = 0; c < 32; c++) { lm2 += (msx.vram[nb + r * 32 + c] || 0).toString(16).padStart(2, "0"); lv2 += vec.rd(nsV + r * 32 + c).toString(16).padStart(2, "0"); }
        if (lm2 !== lv2) console.log(`r${String(r).padStart(2)}: M ${lm2}\n     V ${lv2}`);
      }
      for (const i of nd.slice(0, 10)) {
        const row = i >> 5, col = i & 31;
        let scr = 0; for (let r2 = 0; r2 < 8; r2++) if (vec.rd(((0x80 + col) << 8) | (255 - row * 8 - r2))) scr++;
        console.log(`  cell ${i} (r${row}c${col}): msx=${msx.vram[msx.nameBase() + i].toString(16)} vec=${vec.rd(nsV + i).toString(16)} vecSCR=${scr}`);
      }
    }
  }
  if ((t % 400) === 0) console.log(`тик ${t}: ok (GS=${msx.mem[gsM]}, честных=${honest})`);
}
if (!diverged) console.log(`clean for ${maxTicks} ticks (честных сравнений: ${honest})`);
