#!/usr/bin/env node
"use strict";
// snd_cost_assemble.js — собирает outputs/sound-cost/results.json из partial/*.json
// и добавляет справочные данные (SHA, номера строк кода, размеры). Отчёт читает только results.json.
const fs = require("fs"), path = require("path");
const lib = require("./snd_cost_lib.js");

const PART = path.join(lib.OUT, "partial");
const SCENES = ["stress", "natural", "effects_knife", "effects_gem", "effects_death", "scroll", "idle_m0", "idle_m2"];

function lineOf(file, re) {
  const lines = fs.readFileSync(path.join(lib.ROOT, file), "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return null;
}
const REFS = {
  isr: "src/v06c/vec_isr.asm", game: "src/game/kvalley_game.asm", ovvi: "src/v06c/vec_snd_ov_vi.asm", ovay: "src/v06c/vec_snd_ov_ay.asm",
  boot: "src/v06c/vec_boot.asm", scroll: "src/v06c/vec_scroll.asm", blit: "src/v06c/vec_blit.asm", res: "src/res/res_music.asm",
};

function main() {
  const out = { schema: 1 };
  out.rom = { path: path.relative(lib.ROOT, lib.ROM), sha256: lib.sha256(lib.ROM), sym_sha256: lib.sha256(lib.SYM),
    expected_sha256: "764c32f5f827bbf8eea945eda4aafbfc358bb4095e5ab638abebfe3066138ecd" };
  out.rom.matches_expected = out.rom.sha256 === out.rom.expected_sha256;
  const frozen = path.join(lib.ROOT, "outputs/stage-sched-nested/kvalley_8c.rom");
  out.rom.source_sha256_now = fs.existsSync(frozen) ? lib.sha256(frozen) : null;
  out.rom.build_rom_sha256_now = lib.sha256(path.join(lib.ROOT, "build/kvalley_8c.rom"));
  out.scripts = Object.fromEntries(fs.readdirSync(__dirname).filter((f) => /^snd_cost_.*\.js$/.test(f)).map((f) => [f, lib.sha256(path.join(__dirname, f))]));
  out.emulator = { base: "/Users/boris/Projects/vector06js", i8080_sha256: lib.sha256("/Users/boris/Projects/vector06js/i8080-js/i8080.js"), tv_sha256: lib.sha256("/Users/boris/Projects/vector06js/src/tv.js") };
  out.node = process.version;
  out.partA = { ay: {}, vi: {} };
  for (const cn of ["ay", "vi"]) for (const sc of SCENES) {
    const p = path.join(PART, `${cn}_${sc}.json`);
    if (!fs.existsSync(p)) throw new Error("нет " + p);
    out.partA[cn][sc] = JSON.parse(fs.readFileSync(p));
  }
  const stream = JSON.parse(fs.readFileSync(path.join(PART, "stream.json")));
  for (const cn of ["ay", "vi"]) { const n = stream.natural[cn]; for (const k of ["cnt", "kinds", "gs", "ticks", "step"]) delete n[k]; for (const s of Object.values(stream.sounds[cn])) { delete s.per_frame_events; delete s.per_frame_kinds; } }
  out.partC = { stream, player: JSON.parse(fs.readFileSync(path.join(PART, "player.json"))) };
  out.refs = {
    isr_tick_hdr: lineOf(REFS.isr, /^vsnd_tick_hdr:/), isr_tick_clk: lineOf(REFS.isr, /^vsnd_tick_clk:/), isr_tick: lineOf(REFS.isr, /^vsnd_tick:/),
    isr_tick_coop: lineOf(REFS.isr, /^vsnd_tick_coop:/), isr_vtm_start: lineOf(REFS.isr, /^vtm_start:/), isr_vtm_arm: lineOf(REFS.isr, /^vtm_arm:/),
    isr_vtm_grab: lineOf(REFS.isr, /^vtm_grab:/), isr_vtm_delta: lineOf(REFS.isr, /^vtm_delta:/), isr_call_hdr_outer: lineOf(REFS.isr, /call\s+vsnd_tick_hdr\s*;\s*\[2026-09-12\] тик плеера: постоянная/),
    isr_call_hdr_nested: lineOf(REFS.isr, /call\s+vsnd_tick_hdr\s*;\s*\[2026-09-12\] тик плеера и во вложенной/), isr_call_clk: lineOf(REFS.isr, /call\s+vsnd_tick_clk/),
    isr_call_tick_nested: lineOf(REFS.isr, /call\s+vsnd_tick\s*;\s*конкурентно/), isr_apply_S: lineOf(REFS.isr, /call\s+vec_snd_apply/), isr_hush_pause: lineOf(REFS.isr, /call\s+vec_snd_hush/),
    isr_wrtpsg: lineOf(REFS.isr, /^WRTPSG:/),
    ovvi_wrtpsg: lineOf(REFS.ovvi, /^vwp_vi:/), ovvi_vich: lineOf(REFS.ovvi, /^vec_vi_ch:/), ovvi_mix: lineOf(REFS.ovvi, /^vwp_vi_mix:/), ovvi_off: lineOf(REFS.ovvi, /^vvi_off:/), ovvi_ay2vi: lineOf(REFS.ovvi, /^vec_ay2vi:/),
    ovvi_grab: lineOf(REFS.ovvi, /call\s+vtm_grab/), ovvi_start: lineOf(REFS.ovvi, /jp\s+z,\s*vtm_start/),
    ovay_wrtpsg: lineOf(REFS.ovay, /^vwp_ay:/), ovay_apply: lineOf(REFS.ovay, /^vsa_ay:/),
    boot_probe: lineOf(REFS.boot, /^vec_ay_ok:|vec_ay_ok:/), boot_noay: lineOf(REFS.boot, /^vec_no_ay:/), boot_chip_ay: lineOf(REFS.boot, /ld\s+\(vec_snd_chip\), a\s*; AY/), boot_chip_vi: lineOf(REFS.boot, /ld\s+\(vec_snd_chip\), a\s*; ВИ53/), boot_overlay: lineOf(REFS.boot, /^vec_ov_cp:/),
    game_setmusic: lineOf(REFS.game, /^SetMusic_:/), game_setmus: lineOf(REFS.game, /^setMus:/), game_setsfx: lineOf(REFS.game, /^setSFX:/), game_setchan: lineOf(REFS.game, /^setChanData:/),
    game_update: lineOf(REFS.game, /^updateSound:/), game_update2: lineOf(REFS.game, /^updateSound2:/), game_process: lineOf(REFS.game, /^processSndData:/), game_env: lineOf(REFS.game, /^loc_7C2D:/),
    game_setfreq: lineOf(REFS.game, /^setFreq:/), game_setvol: lineOf(REFS.game, /^setVolume:/), game_caer: lineOf(REFS.game, /^updateSfxCaer:/), game_mixer: lineOf(REFS.game, /^SetPSGMixer:/),
    game_ch3: lineOf(REFS.game, /^switchCh3OnOff:/), game_pattern_loop: lineOf(REFS.game, /^patternLoop:/), game_end: lineOf(REFS.game, /^endMusic:/),
    game_tickmuerto: lineOf(REFS.game, /^tickMuerto:/), game_tickmuerto_wait: lineOf(REFS.game, /ld\s+a,\s*\(MusicChanData\)\s*$/), game_tickgame_wait: lineOf(REFS.game, /ld\s+a,\s*\(musicCh1\)/), game_ending_wait: lineOf(REFS.game, /ld\s+a,\s*\(MusicChanData\)/),
    game_readkeys_wrtpsg: lineOf(REFS.game, /call\s+WRTPSG\s*; Запись в PSG/), game_tickmain: lineOf(REFS.game, /^tickMain:/), game_tickmain_vst: lineOf(REFS.game, /call\s+vsnd_tick\s*; Обновляет драйвер звука/),
    game_tickmain2_vst: lineOf(REFS.game, /call\s+m,\s*vsnd_tick/),
    scroll_coop: lineOf(REFS.scroll, /call\s+vsnd_tick_coop/), blit_coop: lineOf(REFS.blit, /call\s+vsnd_tick_coop/),
    game_death_set: lineOf(REFS.game, /ld\s+a,\s*0x1D\s*; Музыка смерти/),
  };
  // последние найденные строки для ожидания конца: второй вызов `ld a,(MusicChanData)` — setEndingStat
  const gl = fs.readFileSync(path.join(lib.ROOT, REFS.game), "utf8").split("\n");
  out.refs.game_music_waits = gl.map((l, i) => (/ld\s+a,\s*\((MusicChanData|musicCh1|musicCh2)\)/.test(l) ? i + 1 : 0)).filter(Boolean);
  out.refs.game_setmusic_calls = gl.filter((l) => /\b(call|jp)\s+setMusic\b/.test(l)).length;
  out.refs.game_wrtpsg_callers = gl.map((l, i) => (/\b(call|jp)\s+WRTPSG\b/.test(l) ? i + 1 : 0)).filter(Boolean);
  fs.writeFileSync(path.join(lib.OUT, "results.json"), JSON.stringify(out, null, 1));
  console.log("results.json:", fs.statSync(path.join(lib.OUT, "results.json")).size, "байт");
}
if (require.main === module) main();
