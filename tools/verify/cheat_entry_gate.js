// Keyboard-only contract for ordinary/Splash ROMs: one F1+F3 cheat lock.
// No emulator RAM writes, ROM patches, forced game states, or accelerated timers.
// Usage: node tools/verify/cheat_entry_gate.js [plain-rom] [sym] [splash-rom]
'use strict';
const path = require('path');
const {make} = require('./beam_harness.js');
const build = path.resolve(__dirname, '../../build');
const [plain = path.join(build, 'kvalley_8c.rom'),
  sym = path.join(build, 'kvalley_8c.sym'),
  splash = path.join(build, 'kvalley_splash.rom')] = process.argv.slice(2);
const reports = [];
const keys = {SPACE: 32, G: 71, E: 69, F1: 112, F3: 114};
const assert = (ok, message) => {if (!ok) throw Error(message);};

function session(rom, report) {
  const E = make(rom, sym);
  for (const name of ['GameStatus', 'subStatus', 'controlPlayer', 'vec_cheats',
    'vec_god', 'ShowEnding', 'setupEnding', 'nextSubstatus2'])
    assert(Number.isInteger(E.L[name]), 'Missing symbol ' + name);
  const hits = {ShowEnding: 0, setupEnding: 0, endingReady: 0};
  E.v06c.check_breakpoint = () => {
    if (E.cpu.pc === E.L.ShowEnding) hits.ShowEnding++;
    if (E.cpu.pc === E.L.setupEnding) hits.setupEnding++;
    if (E.cpu.pc === E.L.nextSubstatus2 && E.rd(E.L.GameStatus) === 10)
      hits.endingReady++;
    return false;
  };
  const state = () => ({gs: E.rd(E.L.GameStatus), sub: E.rd(E.L.subStatus),
    lock: E.rd(E.L.vec_cheats), god: E.rd(E.L.vec_god)});
  const run = (frames, check) => {
    for (let f = 0; f < frames; f++) {
      E.run(1);
      if (check) check(state());
    }
  };
  const wait = (predicate, limit, label, check) => {
    for (let frames = 1; frames <= limit; frames++) {
      run(1, check);
      if (predicate(state())) return frames;
    }
    throw Error(label + ' timed out: ' + JSON.stringify(state()));
  };
  const clean = s => assert(s.god === 0 && s.lock === 0,
    'Unexpected unlocked/God state: ' + JSON.stringify(s));
  const boot = holdG => {
    if (holdG) E.key(keys.G, true);
    const frames = wait(s => s.gs === 1, 1800, 'boot/title', clean);
    run(4, s => {clean(s); assert(s.gs === 1, 'Title did not settle');});
    if (holdG) E.key(keys.G, false);
    run(4, clean);
    report.bootFrames = frames;
  };
  const start = codes => {
    for (const key of codes) E.key(key, true);
    const leftTitle = wait(s => s.gs !== 1, 60, 'start from title');
    for (const key of codes) E.key(key, false);
    const gameFrames = wait(s => s.gs === 5, 2000, 'first pyramid');
    assert((E.rd(E.L.controlPlayer) & 0x40) !== 0, 'Started demo instead of player game');
    report.startFrames = leftTitle + gameFrames;
  };
  return {E, hits, state, run, wait, clean, boot, start};
}

function unlocked(rom) {
  const report = {rom, mode: 'F1+F3'};
  reports.push(report);
  const S = session(rom, report), {E} = S;
  S.boot(true);
  report.bootHeldG = 'ignored';
  for (const name of ['F1', 'F3']) {
    E.key(keys[name], true);
    S.run(16, s => {
      S.clean(s);
      assert(s.gs === 1, name + ' alone started the game');
    });
    E.key(keys[name], false);
    S.run(4, S.clean);
  }
  report.singleFunctionKeys = 'ignored';
  S.start([keys.F1, keys.F3]);
  assert(S.state().lock === 1 && S.state().god === 0,
    'F1+F3 must unlock cheats without enabling God: ' + JSON.stringify(S.state()));
  E.key(keys.G, true);
  report.godOnFrames = S.wait(s => s.god === 1, 20, 'G enable');
  S.run(24, s => assert(s.god === 1 && s.lock === 1, 'Held G repeated or lost lock'));
  E.key(keys.G, false);
  S.run(6, s => assert(s.god === 1, 'Releasing G changed God'));
  report.heldGFrames = 24;
  assert(S.state().gs === 5, 'Game left GS5 before E test');
  E.key(keys.E, true);
  report.endingRequestFrames = S.wait(s => s.gs === 10, 20, 'E ending request');
  E.key(keys.E, false);
  report.endingSetupFrames = S.wait(s => s.gs === 10 && s.sub >= 1 &&
    S.hits.ShowEnding > 0 && S.hits.setupEnding > 0 && S.hits.endingReady > 0,
    1800, 'ending setup complete');
  report.endingHits = {...S.hits};
  report.final = S.state();
  console.log('PASS ' + path.basename(rom) + ': held boot G ignored; F1/F3 alone ignored; ' +
    'F1+F3 unlocked; held G toggled once; E initialized ending.');
}

function closed(rom) {
  const report = {rom, mode: 'SPACE'};
  reports.push(report);
  const S = session(rom, report), {E} = S;
  S.boot(false);
  S.start([keys.SPACE]);
  S.clean(S.state());
  E.key(keys.G, true);
  S.run(24, s => {S.clean(s); assert(s.gs === 5, 'Closed game left GS5 during G');});
  E.key(keys.G, false);
  S.run(4, S.clean);
  E.key(keys.E, true);
  S.run(12, s => {S.clean(s); assert(s.gs === 5, 'E worked with closed lock');});
  E.key(keys.E, false);
  assert(S.hits.ShowEnding === 0 && S.hits.setupEnding === 0,
    'Closed-lock game executed ending code');
  report.final = S.state();
  console.log('PASS ' + path.basename(rom) + ': SPACE left lock/God off; G/E ignored.');
}

try {
  for (const rom of [plain, splash]) {
    unlocked(rom);
    closed(rom);
  }
  console.log(JSON.stringify(reports, null, 2));
  console.log('PASS: cheat entry contract matches in ordinary and Splash ROMs.');
} catch (error) {
  console.log(JSON.stringify(reports, null, 2));
  console.error('FAIL: ' + error.message);
  process.exitCode = 1;
}
