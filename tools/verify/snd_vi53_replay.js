"use strict";
// snd_vi53_replay.js — прогнать операции звука, записанные в игре (snd_vi53_rec.js), через ОСНОВУ и
// через НОВУЮ сборку в изоляции и сравнить порт-состояния после каждого тика с записанными в игре.
//   node tools/verify/snd_vi53_replay.js <base.rom> <base.sym> <new.rom> <new.sym> <rec_base.json> <rec_new.json> [out.json]
// Проверки:
//   A (контроль стенда): основа в изоляции на операциях ИЗ ЕЁ ЖЕ прогона == состояния основы в игре
//   B (приёмка):          основа в изоляции на операциях из прогона НОВОЙ сборки == состояния новой сборки в игре
//   C (контроль):         новая сборка в изоляции на операциях из своего прогона == её состояния в игре
//   D:                    основа в изоляции == новая в изоляции на операциях из прогона новой (то же, что B/C вместе)
const fs = require("fs");
const iso = require("./snd_vi53_iso.js");
function cmp(name, ref, got, details) {
  const o = { name, ticks_ref: ref.length, ticks_got: got.length, diffs: [] };
  const n = Math.min(ref.length, got.length);
  let bad = 0;
  for (let i = 0; i < n; i++) if (ref[i] !== got[i]) { bad++; if (o.diffs.length < 20) o.diffs.push({ tick: i + 1, ref: ref[i], got: got[i] }); }
  o.mismatched = bad + Math.abs(ref.length - got.length);
  return o;
}
function main() {
  const [br, bs, nr, ns, ra, rb, out] = process.argv.slice(2);
  const A = JSON.parse(fs.readFileSync(ra)), Bn = JSON.parse(fs.readFileSync(rb));
  const B = iso.boot(br, bs, "base"), N = iso.boot(nr, ns, "new");
  const res = { A: null, B: null, C: null, D: null, ops: { base_run: A.ops.length, new_run: Bn.ops.length } };
  res.A = cmp("A: основа в изоляции на операциях основы == основа в игре", A.ticks, iso.replay(B, A.ops));
  res.B = cmp("B: основа в изоляции на операциях новой == новая в игре", Bn.ticks, iso.replay(B, Bn.ops));
  res.C = cmp("C: новая в изоляции на операциях новой == новая в игре", Bn.ticks, iso.replay(N, Bn.ops));
  res.D = cmp("D: основа в изоляции == новая в изоляции на операциях новой", iso.replay(B, Bn.ops), iso.replay(N, Bn.ops));
  for (const k of ["A", "B", "C", "D"]) console.log(`${res[k].name}: тиков ${res[k].ticks_ref}/${res[k].ticks_got}, расхождений ${res[k].mismatched}`);
  for (const k of ["A", "B", "C", "D"]) for (const d of res[k].diffs.slice(0, 5)) console.log(k, JSON.stringify(d));
  if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1));
}
if (require.main === module) main();
module.exports = { cmp };
