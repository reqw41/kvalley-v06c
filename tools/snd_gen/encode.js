"use strict";
// encode.js — captured.json -> байтовые потоки голосов. Чистая функция, без эмулятора.
//
// ФОРМАТ ПОТОКА ГОЛОСА (один звук = 1..3 голоса; голос = ячейка канала 1/2/3 драйвера):
//   Поток читается в момент «тика события»; после ожидающего события голос засыпает на N тиков звука.
//   >= 0x80        ON idx    канал включить с делителем vdiv[idx & 0x7F]  (ожидающее)
//   0x00           END       выключить канал, голос свободен (ID := 0)     (конец)
//   0x01           OFF       выключить канал                               (ожидающее)
//   0x02           ON_L      включить с делителем, оставшимся от прошлого звука (период регистров AY)  (ожидающее)
//   0x03 lo hi     JMP       перейти на адрес                              (в тот же тик)
//   0x04 n         W n       следующее ожидающее событие спит n тиков (иначе — DW)   (в тот же тик)
//   0x05 n         DW n      длительность сна по умолчанию, остаётся в силе до смены  (в тот же тик)
//   0x06 idx       PERIOD    выключить канал и запомнить делитель vdiv[idx] (период AY при погашенном канале) (ожидающее)
//   0x07           FALL      падение: делитель += 108, канал включён, сон 1 тик, указатель на месте (ожидающее)
// «Делитель, который помнит голос» = период регистров AY, пересчитанный в делитель ВИ53 (13P + P/2).
const ay2vi = (p) => ((13 * p) + (p >> 1)) & 0xFFFF;
const JUNK = [0x0F11, 0x0F22, 0x0F33];
const TK = { END: 0, OFF: 1, ON_L: 2, JMP: 3, W: 4, DW: 5, PERIOD: 6, FALL: 7, ON: 0x80 };

// Состояние голоса на тике t (1-based): {on, div (если on), p ('L' = остаток от прошлого звука)}.
// Остаток опознаётся по двум съёмкам с разными «чужими» периодами: если период различается — он не от звука.
function stateAt(a, b, t) {
  const x = a.ticks[t - 1], y = b.ticks[t - 1];
  const on = !!x[0];
  const p = x[2] === y[2] ? x[2] : "L";
  return { on, div: on ? x[1] : 0, p };
}
const sameState = (a, b, trackP) => a.on === b.on && (a.on ? (trackP ? a.p === b.p : a.div === b.div) : (!trackP || a.p === b.p));

function voiceEvents(a, b, c, nTicks, loop) {
  const trackP = c === 2; // остаток периода нужен только каналу 3 (кирка читает его)
  const ev = [];
  for (let t = 1; t <= nTicks; t++) {
    const cur = stateAt(a, b, t);
    let prev, absolute = false;
    if (t === 1) { prev = { on: false, div: 0, p: "L" }; absolute = true; }
    else {
      prev = stateAt(a, b, t - 1);
      if (loop && t === loop.tA && loop.tA > 1) {
        if (!sameState(prev, stateAt(a, b, loop.tE - 1), trackP)) absolute = true;
      }
    }
    if (!cur.on) {
      const pchg = trackP && cur.p !== "L" && (absolute || cur.p !== prev.p);
      if (pchg) ev.push({ t, k: "PERIOD", div: cur.p });
      else if (absolute || prev.on) ev.push({ t, k: "OFF" });
    } else if (trackP && cur.p === "L") {
      if (absolute || !prev.on || prev.p !== "L") ev.push({ t, k: "ON_L" });
    } else {
      const d = trackP ? cur.p : cur.div;
      if (absolute || !prev.on || (trackP ? prev.p !== cur.p : prev.div !== cur.div)) ev.push({ t, k: "ON", div: d });
    }
  }
  return ev;
}

// события -> токены. Событие на тике t «спит» до следующего события (или до END/JMP).
function tokenize(ev, nTicks, loop) {
  const ticks = ev.map((e) => e.t);
  // на тике конца допустим только OFF (его поглощает END)
  let evs = ev.slice();
  if (!loop) {
    const last = evs[evs.length - 1];
    if (last && last.t === nTicks) {
      if (last.k !== "OFF") throw new Error("на тике конца событие " + last.k);
      evs.pop();
    }
  }
  const endT = loop ? loop.tE : nTicks;
  const gaps = evs.map((e, i) => (i + 1 < evs.length ? evs[i + 1].t : endT) - e.t);
  gaps.forEach((g, i) => { if (g < 1) throw new Error("нулевой интервал " + JSON.stringify(evs[i])); if (g > 255) throw new Error("интервал > 255"); });
  const h = {};
  gaps.forEach((g) => (h[g] = (h[g] || 0) + 1));
  let dw = 1, best = 0;
  for (const [g, n] of Object.entries(h)) if (n > best || (n === best && +g < dw)) { best = n; dw = +g; }
  const out = [];
  if (evs.length) out.push({ k: "DW", n: dw });
  let loopPlaced = false;
  if (loop && loop.tA === 1) { out.push({ k: "LABEL", name: "loop" }); loopPlaced = true; }
  evs.forEach((e, i) => {
    if (loop && !loopPlaced && e.t === loop.tA) { out.push({ k: "LABEL", name: "loop" }); loopPlaced = true; }
    if (gaps[i] !== dw) out.push({ k: "W", n: gaps[i] });
    out.push(e);
  });
  if (loop && !loopPlaced) throw new Error("на tA нет событий");
  out.push(loop ? { k: "JMP", target: "loop" } : { k: "END" });
  return out;
}

// токены -> байты (с метками). divIdx: Map(делитель -> индекс)
function toBytes(tokens, divIdx) {
  const bytes = []; const labels = {}; const fix = [];
  for (const t of tokens) {
    switch (t.k) {
      case "LABEL": labels[t.name] = bytes.length; break;
      case "END": bytes.push(TK.END); break;
      case "OFF": bytes.push(TK.OFF); break;
      case "ON_L": bytes.push(TK.ON_L); break;
      case "W": bytes.push(TK.W, t.n); break;
      case "DW": bytes.push(TK.DW, t.n); break;
      case "FALL": bytes.push(TK.FALL); break;
      case "PERIOD": bytes.push(TK.PERIOD, divIdx.get(t.div)); break;
      case "ON": { const i = divIdx.get(t.div); if (i > 127) throw new Error("индекс делителя > 127"); bytes.push(TK.ON | i); break; }
      case "JMP": bytes.push(TK.JMP); fix.push({ at: bytes.length, name: t.target }); bytes.push(0, 0); break;
      default: throw new Error("токен " + t.k);
    }
  }
  return { bytes, labels, fix };
}

// ---- модель проигрывателя (для проверки потока): состояние голоса по тикам -----------------------
// stream: {bytes, labels, fix}; divs: таблица; startP: делитель-остаток (для голоса 3)
function simulate(stream, divs, nTicks, startDiv) {
  const { bytes } = stream;
  const loopAt = stream.fix.length ? stream.labels[stream.fix[0].name] : -1;
  let pc = 0, wait = 1, dw = 1, on = false, div = startDiv, ended = false;
  const out = [];
  const fixAt = new Map(stream.fix.map((f) => [f.at, f.name]));
  for (let t = 1; t <= nTicks; t++) {
    if (!ended) {
      wait--;
      if (wait === 0) {
        let ow = 0, guard = 0;
        for (;;) {
          if (++guard > 1000) throw new Error("зациклился");
          const b = bytes[pc++];
          if (b & 0x80) { on = true; div = divs[b & 0x7F]; wait = ow || dw; break; }
          if (b === TK.END) { on = false; ended = true; wait = 0; break; }
          if (b === TK.OFF) { on = false; wait = ow || dw; break; }
          if (b === TK.ON_L) { on = true; wait = ow || dw; break; }
          if (b === TK.JMP) { pc = stream.labels[fixAt.get(pc)]; continue; }
          if (b === TK.W) { ow = bytes[pc++]; continue; }
          if (b === TK.DW) { dw = bytes[pc++]; continue; }
          if (b === TK.PERIOD) { on = false; div = divs[bytes[pc++]]; wait = ow || dw; break; }
          if (b === TK.FALL) { div = (div + 108) & 0xFFFF; if (div >= 0xD800) div -= 0xD800; on = true; wait = 1; pc--; break; }
          throw new Error("токен " + b);
        }
      }
    }
    out.push([on ? 1 : 0, on ? div : 0, div]);
  }
  return out;
}

module.exports = { TK, ay2vi, JUNK, voiceEvents, tokenize, toBytes, simulate, stateAt };
