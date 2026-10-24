// Title transition regression: boot -> title -> natural demo -> title -> SPACE game.
// No RAM patches, accelerated timers, or cheat keys. Optional baseline compares the
// complete title framebuffer and palette; only the 11 build-version glyphs differ.
// Usage: node tools/verify/title_boot_gate.js [rom] [sym] [baseline-rom] [baseline-sym]
'use strict';
const path = require('path');
const {make} = require('./beam_harness.js');
const base = path.resolve(__dirname, '../../build/kvalley_8c');
const [rom = base + '.rom', sym = base + '.sym', baselineRom, baselineSym] = process.argv.slice(2);
if (!!baselineRom !== !!baselineSym) throw Error('Provide both baseline ROM and symbols');
const removed = [
  'KonamiLogo', 'KonamiLogo2', 'loadKonamiLogo', 'GFX_KonamiLogo', 'vec_pal_konami',
  'vec_kl_next', 'vec_kl_decode_tile', 'vec_kl_tile', 'vec_kl_pos', 'vec_kl_run',
  'vec_kl_fillrun', 'vec_konami_draw', 'vec_konami_logo', 'vec_konami_text',
  'vec_konami_sw', 'vec_kl_underline'
];
const report = {rom, baseline: baselineRom || null, transitions: []};
const assert = (ok, message) => {if (!ok) throw Error(message);};

function state(E) {
  return {gs: E.rd(E.L.GameStatus), sub: E.rd(E.L.subStatus)};
}

function waitFor(E, predicate, limit, label, trace = false) {
  let previous = '';
  for (let frames = 1; frames <= limit; frames++) {
    E.run(1);
    const s = state(E), key = s.gs + ':' + s.sub;
    if (trace && key !== previous) {
      report.transitions.push({phase: label, frames, ...s});
      previous = key;
    }
    if (predicate(s)) return frames;
  }
  throw Error(label + ' timed out after ' + limit + ' frames: ' + JSON.stringify(state(E)));
}

function title(E) {
  // Allow deferred palette application and the current game tick to finish.
  E.run(2);
  assert(E.rd(E.L.GameStatus) === 1, 'Title did not remain in GS=1');
  return {
    planes: Uint8Array.from({length: 0x6000}, (_, i) => E.rd(0x8000 + i)),
    palette: Array.from(E.v06c.filler ? E.v06c.filler.palette : E.io.Palette)
  };
}

function compareTitles(actual, expected, label, ignoreVersion) {
  let bytes = 0, bits = 0;
  const first = [];
  for (let i = 0; i < actual.planes.length; i++) {
    const col = (i & 0x1fff) >> 8, lo = i & 255;
    // TXT_MainMenu: row 25, columns 20..30; fb row = 255 - tileRow*8.
    if (ignoreVersion && col >= 20 && col <= 30 && lo >= 48 && lo <= 55) continue;
    const diff = actual.planes[i] ^ expected.planes[i];
    if (!diff) continue;
    bytes++;
    for (let v = diff; v; v &= v - 1) bits++;
    if (first.length < 8) first.push({address: '0x' + (0x8000 + i).toString(16),
      actual: actual.planes[i], expected: expected.planes[i]});
  }
  const paletteEqual = actual.palette.length === expected.palette.length &&
    actual.palette.every((v, i) => v === expected.palette[i]);
  const result = {bytes, bits, paletteEqual, first};
  report[label] = result;
  assert(bytes === 0 && paletteEqual, label + ': ' + JSON.stringify(result));
}

try {
  const E = make(rom, sym);
  const retained = removed.filter(name => Object.hasOwn(E.L, name));
  assert(retained.length === 0, 'Konami-only symbols remain: ' + retained.join(', '));
  for (const name of ['GameStatus', 'subStatus', 'controlPlayer', 'vec_vs_cur'])
    assert(Number.isInteger(E.L[name]), 'Missing shared symbol: ' + name);

  report.bootFrames = waitFor(E, s => s.gs === 1, 1500, 'boot', true);
  const firstTitle = title(E);
  assert(E.rd(E.L.vec_vs_cur) === E.L.vec_vscroll, 'Wrong title hardware scroll');
  if (baselineRom) {
    const B = make(baselineRom, baselineSym);
    report.baselineBootFrames = waitFor(B, s => s.gs === 1, 1500, 'baseline boot');
    compareTitles(firstTitle, title(B), 'baselineTitle', true);
  }
  console.log('Boot/title verified; running the unmodified natural demo.');

  let sawDemoSetup = false;
  report.demoEntryFrames = waitFor(E, s => {
    if (s.gs === 2) sawDemoSetup = true;
    return s.gs === 5;
  }, 2500, 'demo entry', true);
  assert(sawDemoSetup, 'Demo did not pass through GS=2');
  assert((E.rd(E.L.controlPlayer) & 0x40) === 0, 'Demo incorrectly uses player controls');
  let demoEnded = false;
  report.demoReturnFrames = waitFor(E, s => {
    if (s.gs !== 5) demoEnded = true;
    return demoEnded && s.gs === 1;
  }, 9000, 'demo return', true);
  compareTitles(title(E), firstTitle, 'returnedTitle', false);

  E.key(32, true);
  E.run(12);
  E.key(32, false);
  report.spaceStartFrames = 12 + waitFor(E, s => s.gs === 5, 2000, 'SPACE start', true);
  assert((E.rd(E.L.controlPlayer) & 0x40) !== 0, 'SPACE did not start a player game');
  if (Number.isInteger(E.L.vec_cheats))
    assert(E.rd(E.L.vec_cheats) === 0, 'Ordinary SPACE start enabled cheats');
  report.final = state(E);
  console.log(JSON.stringify(report, null, 2));
  console.log('PASS: direct title, natural demo return, and ordinary SPACE start.');
} catch (error) {
  console.log(JSON.stringify(report, null, 2));
  console.error('FAIL: ' + error.message);
  process.exitCode = 1;
}
