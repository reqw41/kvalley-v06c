"use strict";
// snd_cost_scenes.js — собственные сцены замера звука (эпизоды с эффектами, скролл комнат).
// Все записи в память игры — те же, что разрешены перф-драйвером: ProtaX/ProtaY/ProtaRoom/protaStatus,
// objetoCogido (нож в руке, как в snd_tempo/knife_cost). Запись — только на границе логического тика.
// Звук запускает сама игровая логика (бросок ножа, касание гема, переход комнаты); setMusic не зовётся.
const lib = require("./snd_cost_lib.js");

function boot(chip) {
  const E = lib.makeEmu(chip);
  const T = lib.createTracker(E, chip);
  const gs = lib.harness.toGame(E);
  if (gs !== 5) throw new Error("нет геймплея");
  return { E, T };
}
const idle = (E) => { for (let t = 0; t < 80 && E.rd(E.L.tickInProgress); t++) E.run(1); };
const wr = (E, a, v) => E.memory.write(a, v & 255, false);

// бросок ножа: нож в руку (objetoCogido=0x10) + импульс FIRE; вокруг — тишина игры (герой стоит)
function effectsKnife(chip) {
  const { E, T } = boot(chip);
  E.run(30);
  T.arm();
  for (let k = 0; k < 3; k++) {                    // три броска с паузой 90 кадров: звук SFX_Lanzar
    idle(E); wr(E, E.L.objetoCogido, 0x10);
    E.key(32, 1); E.run(3); E.key(32, 0);
    E.run(90);
  }
  T.disarm();
  return { T, E };
}

// подбор гема: герой переставлен на гем (X, Y-8, комната 0), подбор делает chkCogeGema
function effectsGem(chip) {
  const { E, T } = boot(chip);
  const { L, rd } = E;
  E.run(30);
  T.arm();
  for (let gi = 0; gi < 4; gi++) {
    const a = L.datosGemas + gi * 9;
    const Y = rd(a + 2), X = rd(a + 4);
    idle(E);
    wr(E, L.ProtaRoom, 0); wr(E, L.ProtaX, X); wr(E, L.ProtaY, gi === 2 ? Y : Y - 8); wr(E, L.protaStatus, 0);
    E.run(90);
  }
  T.disarm();
  return { T, E, gems: rd(L.gemasCogidas) };
}

// скролл между комнатами: герой ставится у правой кромки и держит «вправо» — переход делает игра (GS=9)
function scroll(chip) {
  const { E, T } = boot(chip);
  const { L, rd } = E;
  E.run(30);
  T.arm();
  const dirs = [[240, 39], [240, 39], [10, 37], [10, 37]];
  for (const [x, k] of dirs) {
    idle(E); wr(E, L.ProtaX, x); E.key(k, 1);
    E.run(150);
    E.key(k, 0); E.run(40);
  }
  T.disarm();
  return { T, E };
}

// смерть героя: герой стоит, мумия подходит сама (естественная гибель), берём окно от появления
// мумии до конца мелодии смерти (игра ждёт конца мелодии в GS=6)
function effectsDeath(chip) {
  const { E, T } = boot(chip);
  const { L, rd } = E;
  E.run(30);
  T.arm();
  let seen6 = false, f = 0;
  for (; f < 1500; f++) {
    E.run(1);
    const g = rd(L.GameStatus);
    if (g === 6) seen6 = true;
    if (seen6 && g !== 6) break;
  }
  E.run(20);
  T.disarm();
  if (!seen6) throw new Error("герой не погиб за 1500 кадров");
  return { T, E, frames_to_end: f };
}

// режим прослушивания: герой стоит 600 кадров, mode = 0 (музыка+эффекты) или 2 (тишина).
// Режим ставится как в игре: запись vec_snd_mode + vec_snd_apply (клавиша S делает то же в ISR).
function idleMode(mode) {
  return function (chip) {
    const { E, T } = boot(chip);
    const { L } = E;
    E.run(30);
    idle(E);
    if (mode !== 0) {
      wr(E, L.vec_snd_mode, mode);
      const { callSub } = require("./snd_cost_stream.js");
      callSub(E, L.vec_snd_apply, undefined, 400000, true);
    }
    T.arm();
    E.run(600);
    T.disarm();
    return { T, E };
  };
}

module.exports = { idle_m0: idleMode(0), idle_m2: idleMode(2), effects_death: effectsDeath, effects_knife: effectsKnife, effects_gem: effectsGem, scroll };
