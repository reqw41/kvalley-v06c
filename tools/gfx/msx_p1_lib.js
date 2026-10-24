// msx_p1_lib.js — запуск НАСТОЯЩЕЙ игры (не аттракт-демо) King's Valley (MSX) и выход
// на ПЕРВУЮ пирамиду. Демо жёстко зашита на пирамиду 5 (SetDemo: ld hl,805h -> piramideDest),
// поэтому все прошлые снятия эталона были со схемы камня пирамиды 5.
// Реальная партия: в статусе 1 (меню) нажать SPACE -> chkPushAnyKey -> GameStatus=3 ->
// IniciaDatosPartida -> piramideActual = piramideDest = 1.
"use strict";
const { makeEmu, renderScreen, savePNG, MSXPAL, MSXNAME } = require("./msx_door_lib.js");

// Матрица клавиатуры MSX, ряд 8: b0=SPACE b4=LEFT b5=UP b6=DOWN b7=RIGHT
const ROW8 = { SPACE: 0, LEFT: 4, UP: 5, DOWN: 6, RIGHT: 7 };

const A = {
  GameStatus: 0xE000, subStatus: 0xE001, controlPlayer: 0xE002, timer: 0xE003, waitCounter: 0xE004,
  Vidas: 0xE050, flagPiramideMap: 0xE051, flagVivo: 0xE053, piramideActual: 0xE054, piramideDest: 0xE055,
  puertaEntrada: 0xE056, puertaSalida: 0xE057, PiramidesPasadas: 0xE062,
  sprAttrib: 0xE0B0, protaAttrib: 0xE0C0,
  statusEntrada: 0xE130, flagEntraSale: 0xE132, flagStageClear: 0xE133,
  protaStatus: 0xE134, sentidoProta: 0xE136, ProtaY: 0xE137, ProtaX: 0xE139,
  pyramidDoors: 0xE1C5, ElemEnProceso: 0xE1F4,
};
const ROM = { drawPuerta: 0x6772, animExitClosed: 0x67DE, animExitClosing: 0x67ED, animExitOpen: 0x67FC,
  ColoresPalanca: 0x4C0D, coloresBrillo: 0x4C09 };

const TILES_SALIDA  = [0x6C,0x7B,0x6D,0x7C,0x6E,0x7D,0x63,0x64,0x65,0x66,0x67,0x6F,0x5F,0x60,0x7E,0x70];
const TILES_SALIDA2 = [0x71,0x80,0x7F,0x72,0x61,0x62,0x81,0x5C,0x5D,0x5E];
const id2pat = id => id === 0 ? 0 : (id >> 4) === 6 ? TILES_SALIDA[id & 15]
                : (id >> 4) === 7 ? TILES_SALIDA2[id & 15] : -1;

function hookKbd(e) {
  if (e._kbRows) return;
  const hub = e.W.room.controllersHub;
  const orig = hub.readKeyboardPort.bind(hub);
  e._kbRows = {};
  hub.readKeyboardPort = r => (r in e._kbRows ? e._kbRows[r] : orig(r));
  e.setRow8 = (name, on) => { const cur = e._kbRows[8] === undefined ? 0xFF : e._kbRows[8];
    e._kbRows[8] = on ? (cur & ~(1 << ROW8[name])) : (cur | (1 << ROW8[name])); };
  e.tap = (name, hold = 6, after = 4) => { e.setRow8(name, true); e.runFrames(hold);
    e.setRow8(name, false); e.runFrames(after); };
}

// Запустить реальную партию. Возвращает номер кадра, на котором GameStatus стал 4 (StartGame).
function startRealGame(e, log = () => {}) {
  hookKbd(e);
  let f = 0;
  // ждём меню (GameStatus 1)
  while (f < 3000 && e.rd(A.GameStatus) !== 1) { e.runFrames(1); f++; }
  log(`меню (GameStatus=1) на кадре ${f}`);
  // жмём SPACE, пока не уйдём в статус 3 (PLAY START)
  let tries = 0;
  while (tries < 40 && e.rd(A.GameStatus) !== 3) { e.tap("SPACE", 6, 4); tries++; f += 10;
    if (e.rd(A.GameStatus) === 2) {  // проскочили в демо — вернёмся в меню ещё одним нажатием
      e.tap("SPACE", 6, 4); f += 10; } }
  log(`после ${tries} нажатий SPACE: GameStatus=${e.rd(A.GameStatus)} controlPlayer=$${e.rd(A.controlPlayer).toString(16)}`);
  // ждём GameStatus 4 (StartGame — рисует пирамиду, дверь и вход прота)
  while (f < 8000 && e.rd(A.GameStatus) !== 4) { e.runFrames(1); f++; }
  log(`GameStatus=4 на кадре ${f}; пирамида=${e.rd(A.piramideActual)} ` +
      `управление игроком=${(e.rd(A.controlPlayer) & 0x40) ? "ДА (реальная партия)" : "НЕТ (демо!)"}`);
  return f;
}

const bases = e => renderScreen(e.vram(), e.regs()).bases;

// Найти ворота на экране: тайл низа рычага 0x5E (иначе 0x5C/0x5D)
function findGate(e, B) {
  const v = e.vram();
  for (let i = 0; i < 768; i++) if (v[B.nameBase + i] === 0x5E) return { c: i % 32, r: ((i / 32) | 0) - 1 };
  for (let i = 0; i < 768; i++) if (v[B.nameBase + i] === 0x5C || v[B.nameBase + i] === 0x5D)
    return { c: i % 32, r: (i / 32) | 0 };
  return null;
}

const colRows = (e, B, pat, bank) => [...Array(8)].map((_, y) => e.vram()[B.colBase + bank * 0x800 + pat * 8 + y]);
const patRows = (e, B, pat, bank) => [...Array(8)].map((_, y) => e.vram()[B.patBase + bank * 0x800 + pat * 8 + y]);

module.exports = { A, ROM, id2pat, TILES_SALIDA, TILES_SALIDA2, hookKbd, startRealGame,
  findGate, bases, colRows, patRows, makeEmu, renderScreen, savePNG, MSXPAL, MSXNAME };
