// Скан ПОВТОРЯЮЩЕГОСЯ КОДА в build/kvalley_8c.lst — кандидаты на вынос в общую процедуру.
//
// МЕТОД: разбираем .lst sjasm (адрес+байты+мнемоника), строим поток инструкций (без db/dw —
// это данные, не код), для каждой инструкции считаем "ключ" сравнения:
//   - jp/jn*/call (все условные и безусловные, 3 Б, опкоды C2/C3/CA/D2/DA/E2/EA/F2/FA/
//     C4/CC/CD/D4/DC/E4/EC/F4/FC) — операнд-адрес ВСЕГДА маскируется (это ровно то, что
//     скрывало дубль setSprPuerta от простого побайтного скана).
//   - "адресные" инструкции с imm16 (shld/lhld/sta/lda = 22/2A/32/3A, lxi b/d/h = 01/11/21) —
//     Вариант А: сравниваются ЛИТЕРАЛЬНО (опкод+операнд), Вариант Б: операнд тоже маскируется.
//   - всё остальное — только литеральное совпадение опкода и байт-операндов.
// Ищем макс. одинаковые цепочки инструкций (хэш по окну 4 инструкции + расширение в обе
// стороны), длиной >= MIN_BYTES исходных байт (не считая маску — маска НЕ уменьшает длину).
//
// Запуск:
//   node tools/verify/dup_scan.js [lst] [sym] [--min-bytes 12] [--top 20]
//
// Самопроверка на прецеденте setSprPuerta (эпоха до слияния 45c939f, коммит deecc3a):
//   node tools/verify/dup_scan.js /path/to/worktree/build/kvalley_8c.lst /path/to/worktree/build/kvalley_8c.sym --selfcheck

'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const posArgs = args.filter(a => !a.startsWith('--'));
const flag = (name, def) => {
  const i = args.indexOf('--' + name);
  if (i === -1) return def;
  const v = args[i + 1];
  return v;
};
const T = __dirname;
const LST_PATH = posArgs[0] || path.join(T, '../../build/kvalley_8c.lst');
const SYM_PATH = posArgs[1] || path.join(T, '../../build/kvalley_8c.sym');
const MIN_BYTES = +flag('min-bytes', 12);
const TOP_N = +flag('top', 20);
const SELFCHECK = args.includes('--selfcheck');

// ----------------------------------------------------------------------------------------
// opcode tables (i8080/Z80-common subset; мнемоники в .lst — Z80-стиль, байты — i8080)
// ----------------------------------------------------------------------------------------
const CTRL3 = new Set([ // jp/jp cc/call/call cc, 3 Б, операнд = адрес перехода, маскируется ВСЕГДА
  0xC3, 0xC2, 0xCA, 0xD2, 0xDA, 0xE2, 0xEA, 0xF2, 0xFA,
  0xCD, 0xC4, 0xCC, 0xD4, 0xDC, 0xE4, 0xEC, 0xF4, 0xFC,
]);
const ADDR3 = new Set([ // shld/lhld/sta/lda + lxi b/d/h,nn — 3 Б, операнд = imm16 (адрес ИЛИ константа)
  0x22, 0x2A, 0x32, 0x3A, 0x01, 0x11, 0x21,
]);

// ----------------------------------------------------------------------------------------
// .sym — таблица меток (для отчёта: ближайшая метка к каждому адресу)
// ----------------------------------------------------------------------------------------
function parseSym(p) {
  const list = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^(\S+):\s+equ\s+([0-9A-Fa-f]+)h\s*$/);
    if (m) list.push({ name: m[1], addr: parseInt(m[2], 16) });
  }
  list.sort((a, b) => a.addr - b.addr || (a.name < b.name ? -1 : 1));
  return list;
}
function nearestLabel(symList, addr) {
  let lo = 0, hi = symList.length - 1, res = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (symList[mid].addr <= addr) { res = symList[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return res;
}

// ----------------------------------------------------------------------------------------
// .lst разбор: поток инструкций {addr, bytes[], mnem, file, lstLine, rawText}
//
// ВАЖНО: sjasm .lst — ФИКСИРОВАННЫЕ КОЛОНКИ. Первые PREFIX_LEN=25 символов строки — это
// "номер_строки[+..] АДРЕС БАЙТЫ" (байты — hex-пары, м.б. с пробелами или слитно, если не
// влезли — уходят на отдельную строку-продолжение с ТЕМ ЖЕ номером и ПУСТОЙ текстовой частью).
// Всё начиная с колонки 25 — текст (метка/мнемоника/операнды/комментарий). Колонки строго
// фиксированы независимо от глубины вложенности .include (числа '+').
// ГРАБЛИ ПЕРВОЙ ВЕРСИИ: если резать по пробелам без учёта колонок, мнемоника "db" (0x64,0x62)
// сама выглядит как валидная hex-пара (0xDB) и на строках, где байтовая зона ПУСТА (текст
// начинается сразу с "db"), ошибочно съедалась как байт данных — весь массив db-таблиц спрайтов
// (gen/vec_sprdata.asm) превращался в поток липовых "инструкций" 0xDB и заваливал скан
// тысячами ложных совпадений. Колоночный разбор исключает эту путаницу в принципе.
// ----------------------------------------------------------------------------------------
const PREFIX_LEN = 25;

function parseLst(p) {
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const instrs = [];
  let fileStack = ['src/kvalley_8c.asm'];
  let pendingInclude = null;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    // сначала разбираем адрес БЕЗ ограничения в 25 колонок — нужно увидеть весь "хвост"
    // строки целиком, чтобы отличить настоящий код от строки-продолжения db-таблицы,
    // чей hex-блок (без пробелов) может быть ДЛИННЕЕ 25-колоночного бюджета байтовой зоны.
    const fm = line.match(/^(\d+)(\+*)\s+([0-9A-Fa-f]{4})\s*(.*)$/);
    if (!fm) continue;
    const depth = fm[2].length;

    // выравниваем стек файлов по глубине вложенности .include (число '+')
    if (depth + 1 === fileStack.length) {
      // тот же файл — ничего не делаем
    } else if (depth + 1 === fileStack.length + 1) {
      fileStack.push(pendingInclude || '<unknown-include>');
      pendingInclude = null;
    } else {
      fileStack.length = depth + 1;
    }

    const addr = parseInt(fm[3], 16);
    const fullRemainder = fm[4].trim();

    // СТРОКА-ПРОДОЛЖЕНИЕ db-таблицы: "голый" hex-блок БЕЗ пробелов/табов/текста, любой длины
    // (не влезло в 25-колоночный бюджет — sjasm просто печатает остаток целиком одной строкой).
    // Если такую строку резать по колонке 25, "хвост" данных попадёт в текстовую зону и будет
    // ошибочно принят за мнемонику (так утекли в скан спрайтовые таблицы vec_spr_knife/pico).
    if (fullRemainder.length >= 2 && fullRemainder.length % 2 === 0 && /^[0-9A-Fa-f]+$/.test(fullRemainder)) continue;

    if (line.length < PREFIX_LEN) continue; // короткая строка (метка/пусто) — не код
    const prefix = line.slice(0, PREFIX_LEN);
    const text = line.slice(PREFIX_LEN);
    const pm = prefix.match(/^\d+\+*\s+[0-9A-Fa-f]{4}\s*(.*)$/);
    const byteBlob = (pm ? pm[1] : '').replace(/\s+/g, '');
    const bytes = [];
    if (byteBlob.length && byteBlob.length % 2 === 0 && /^[0-9A-Fa-f]+$/.test(byteBlob)) {
      for (let k = 0; k < byteBlob.length; k += 2) bytes.push(parseInt(byteBlob.slice(k, k + 2), 16));
    }

    const incM = text.match(/\.include\s+"([^"]+)"/);
    if (incM) pendingInclude = incM[1];

    const ttrim = text.trim();
    let rem = ttrim.length ? ttrim.split(/\s+/) : [];
    // инлайн-метка в начале текстовой части (LABEL: ...) — не мнемоника, пропускаем токен
    if (rem.length && /:$/.test(rem[0])) rem = rem.slice(1);
    if (!bytes.length || !rem.length) continue; // нет байт кода, или чистая метка/комментарий/продолжение без текста

    const first = rem[0];
    if (first.startsWith(';')) continue; // строка байт-продолжения со случайным комментарием после — не мнемоника
    const mnem = first.toLowerCase();
    if (mnem === 'db' || mnem === 'dw' || mnem === 'ds' || mnem === 'equ' || mnem === '.align') continue; // данные/паддинг

    instrs.push({
      addr, bytes, len: bytes.length, mnem,
      file: fileStack[fileStack.length - 1],
      lstLine: li + 1,
      rawText: ttrim,
    });
  }
  return instrs;
}

// ----------------------------------------------------------------------------------------
// ключ сравнения инструкции для варианта A / Б
// ----------------------------------------------------------------------------------------
function keyFor(instr, variant) {
  const b = instr.bytes;
  const op = b[0];
  if (CTRL3.has(op)) return 'C' + op.toString(16); // jp/call — операнд маскируется всегда
  if (variant === 'B' && ADDR3.has(op)) return 'D' + op.toString(16); // imm16-адресация — маска только в Б
  return 'L' + b.map(x => x.toString(16).padStart(2, '0')).join(''); // литерал
}

// ----------------------------------------------------------------------------------------
// поиск максимальных повторяющихся цепочек инструкций (окно-хэш + расширение)
// ----------------------------------------------------------------------------------------
function findDuplicates(instrs, variant, minBytes) {
  const N = instrs.length;
  const tokens = instrs.map(ins => keyFor(ins, variant));
  const prefix = new Array(N + 1).fill(0);
  for (let i = 0; i < N; i++) prefix[i + 1] = prefix[i] + instrs[i].len;
  const byteLen = (i, j) => prefix[j] - prefix[i]; // [i,j)

  const K = 4; // минимальное окно для затравки хэша (4 инструкции по 3 Б = 12 Б — наш минимум)
  const buckets = new Map();
  for (let i = 0; i + K <= N; i++) {
    const key = tokens[i] + '|' + tokens[i + 1] + '|' + tokens[i + 2] + '|' + tokens[i + 3];
    let arr = buckets.get(key);
    if (!arr) { arr = []; buckets.set(key, arr); }
    arr.push(i);
  }

  const seen = new Set(); // дедуп по "start1|start2|len"
  const raw = [];
  const MAX_BUCKET = 400; // защита от взрыва на слишком частых микро-идиомах

  for (const arr of buckets.values()) {
    if (arr.length < 2) continue;
    const cap = Math.min(arr.length, MAX_BUCKET);
    for (let a = 0; a < cap; a++) {
      for (let bI = a + 1; bI < cap; bI++) {
        let i = arr[a], j = arr[bI];
        if (i === j) continue;
        if (i > j) { const t = i; i = j; j = t; }
        if (j - i < K) continue; // перекрытие — не берём

        // расширение вправо
        let rightExt = 0;
        const maxRight = j - i - K; // не даём занять начало второго вхождения (не перекрываться)
        while (rightExt < maxRight && j + K + rightExt < N && tokens[i + K + rightExt] === tokens[j + K + rightExt]) rightExt++;

        // расширение влево
        let leftExt = 0;
        const maxLeft = j - i - K - rightExt; // предел, чтобы не перекрыться после учёта rightExt
        while (leftExt < maxLeft && i - 1 - leftExt >= 0 && tokens[i - 1 - leftExt] === tokens[j - 1 - leftExt]) leftExt++;

        const start1 = i - leftExt, start2 = j - leftExt, len = leftExt + K + rightExt;
        if (start2 < start1 + len) continue; // страховка от перекрытия
        const bl = byteLen(start1, start1 + len);
        if (bl < minBytes) continue;
        // ЛОВУШКА "таблицы переходов": run из одних только jp/call (маскированный опкод,
        // операнд игнорируется) тривиально "совпадает" с ЛЮБЫМ другим run того же опкода —
        // dummyJump и tickGame2 совпадут просто потому что оба состоят из "jp куда-то".
        // Такое не сворачиваемо (нечего разделять, у каждого jp свой адрес) — требуем хотя бы
        // одну ЛИТЕРАЛЬНУЮ (немаскированную) инструкцию-якорь внутри совпадения.
        let hasLiteral = false;
        for (let k = 0; k < len; k++) { if (tokens[start1 + k][0] === 'L') { hasLiteral = true; break; } }
        if (!hasLiteral) continue;
        const sig = start1 + '|' + start2 + '|' + len;
        if (seen.has(sig)) continue;
        seen.add(sig);
        raw.push({ start1, start2, len, byteLen: bl });
      }
    }
  }
  return { tokens, raw, prefix };
}

// группировка многократных (>2) повторов одного и того же паттерна по контент-сигнатуре токенов
function clusterBySignature(instrs, tokens, matches) {
  const bySig = new Map();
  for (const m of matches) {
    const sig = tokens.slice(m.start1, m.start1 + m.len).join(',');
    let g = bySig.get(sig);
    if (!g) { g = { len: m.len, byteLen: m.byteLen, starts: new Set() }; bySig.set(sig, g); }
    g.starts.add(m.start1);
    g.starts.add(m.start2);
    if (m.len > g.len) { g.len = m.len; g.byteLen = m.byteLen; } // не должно расходиться, но на всякий случай
  }
  const out = [];
  for (const [sig, g] of bySig) {
    out.push({ sig, len: g.len, byteLen: g.byteLen, starts: [...g.starts].sort((a, b) => a - b) });
  }
  return out;
}

// ----------------------------------------------------------------------------------------
// горячие зоны
// ----------------------------------------------------------------------------------------
function baseName(f) { return f.replace(/^.*\//, ''); }
function isHot(file, label) {
  const b = baseName(file || '');
  if (b === 'vec_sprout.asm') return !!(label && /^(vsb_|vsz_|vsm_|vpr_|vso_)/.test(label));
  if (b === 'vec_blit.asm') return !!(label && /^vbt8_/.test(label));
  if (b === 'vec_saveunder.asm') return true; // весь файл — POP-хайджеки save/restore, вызывается на каждый спрайт каждый кадр
  if (b === 'vec_isr.asm') return label === 'vec_isr'; // только шапка (сам вход vec_isr:, до vec_isr_nr:)
  return false;
}

// ----------------------------------------------------------------------------------------
// основной проход
// ----------------------------------------------------------------------------------------
function run(lstPath, symPath, minBytes) {
  const instrs = parseLst(lstPath);
  const symList = parseSym(symPath);
  const labelOf = addr => { const l = nearestLabel(symList, addr); return l ? l.name : '?'; };

  const results = {};
  for (const variant of ['A', 'B']) {
    const { tokens, raw } = findDuplicates(instrs, variant, minBytes);
    const clustered = clusterBySignature(instrs, tokens, raw);
    results[variant] = { tokens, raw, clustered };
  }
  return { instrs, symList, labelOf, results };
}

function report({ instrs, labelOf, results }, minBytes, topN) {
  function describeOccurrence(startIdx, len) {
    const first = instrs[startIdx], last = instrs[startIdx + len - 1];
    const lbl = labelOf(first.addr);
    return { addr0: first.addr, addr1: last.addr + last.len, file: first.file, lstLine: first.lstLine, label: lbl };
  }
  function classify(startIdx, len) {
    const occFile = instrs[startIdx].file;
    const occLabel = labelOf(instrs[startIdx].addr);
    return { file: occFile, label: occLabel, hot: isHot(occFile, occLabel) };
  }

  // строим единый список кандидатов: сначала вариант А (чистые), затем добавки варианта Б,
  // которых НЕТ (как минимум той же длины) среди А-находок с теми же стартовыми позициями.
  const A = results.A.clustered;
  const B = results.B.clustered;

  const Akeys = new Map(); // "start1|len" -> true, для вычета из Б
  for (const g of A) for (const s of g.starts) Akeys.set(s + '|' + g.len, true);

  function annotate(g, variant) {
    const occs = g.starts.map(s => {
      const d = describeOccurrence(s, g.len);
      const c = classify(s, g.len);
      return { start: s, ...d, ...c };
    });
    const n = occs.length;
    const hot = occs.some(o => o.hot);
    const sameLabel = new Set(occs.map(o => o.label)).size === 1;
    // Анролл БЕЗ общей метки: ручной 2x/4x/8x-анролл цикла часто даёт каждой итерации СВОЮ
    // метку (fall-through), но сами вхождения идут ВПЛОТНУЮ друг за другом (zero-gap —
    // конец одного == начало следующего). Это тот же "внутрипроцедурный повтор", просто
    // метки честно расставлены на границах итераций (см. vflf_loop/vflf_nxA/vflf_nxB).
    const sortedStarts = g.starts.slice().sort((a, b) => a - b);
    const adjacent = sortedStarts.some((s, idx) => idx > 0 && s === sortedStarts[idx - 1] + g.len);
    const sameProc = sameLabel || adjacent;
    const savings = g.byteLen * (n - 1) - n * 3 - 1; // экономия = освобождённые байты - (n*call 3Б) - (1 ret в общей процедуре)
    return { variant, len: g.len, byteLen: g.byteLen, n, occs, hot, sameProc, savings };
  }

  const candA = A.map(g => annotate(g, 'A'));
  const candB = B.filter(g => {
    // пропускаем, если ту же (или большую) длину на тех же позициях уже нашёл вариант А
    return !g.starts.every(s => Akeys.has(s + '|' + g.len));
  }).map(g => annotate(g, 'B'));

  return { candA, candB };
}

// ----------------------------------------------------------------------------------------
// печать
// ----------------------------------------------------------------------------------------
function fmtOcc(o) {
  return `0x${o.addr0.toString(16).toUpperCase()}-0x${o.addr1.toString(16).toUpperCase()} ${o.label} [${o.file}:${o.lstLine}]`;
}

function printReport(data, minBytes, topN) {
  const { candA, candB } = data;

  const coldCrossProc = candA.filter(c => !c.hot && !c.sameProc);
  const hotCrossProc = candA.filter(c => c.hot && !c.sameProc);
  const unrolls = [...candA.filter(c => c.sameProc), ...candB.filter(c => c.sameProc)];

  console.log(`\n=== dup_scan: ${LST_PATH_G} ===`);
  console.log(`минимальная длина совпадения: ${minBytes} Б; всего инструкций в потоке: ${INSTR_COUNT_G}`);
  console.log(`\nВариант А (адресные imm16 НЕ маскируются, только jp/call): ${candA.length} кандидатов`);
  console.log(`Вариант Б (доп. маска imm16 shld/lhld/sta/lda/lxi): ${candB.length} ДОПОЛНИТЕЛЬНЫХ кандидатов (сверх А)`);

  function printTable(list, title) {
    console.log(`\n--- ${title} (топ ${topN} по экономии) ---`);
    const sorted = [...list].sort((a, b) => b.savings - a.savings).slice(0, topN);
    for (const c of sorted) {
      console.log(`\n[Б=${c.byteLen}, n=${c.n}, эконом.=${c.savings}Б, ${c.hot ? 'ГОРЯЧИЙ' : 'холодный'}, вариант ${c.variant}]`);
      for (const o of c.occs) console.log(`   ${fmtOcc(o)}`);
    }
    return sorted;
  }

  const topCold = printTable(coldCrossProc, 'ХОЛОДНЫЕ межпроцедурные (кандидаты на вынос)');
  const topHot = printTable(hotCrossProc, 'ГОРЯЧИЕ межпроцедурные (сворачивать НЕЛЬЗЯ — потеря тактов)');

  console.log(`\n--- Вариант Б доп. (требуют параметризации imm16, могут быть неподъёмны) ---`);
  const bOnly = candB.filter(c => !c.sameProc);
  for (const c of [...bOnly].sort((a, b) => b.savings - a.savings).slice(0, topN)) {
    console.log(`\n[Б=${c.byteLen}, n=${c.n}, эконом.=${c.savings}Б, ${c.hot ? 'ГОРЯЧИЙ' : 'холодный'}, вариант Б]`);
    for (const o of c.occs) console.log(`   ${fmtOcc(o)}`);
  }

  const totalCold = coldCrossProc.reduce((s, c) => s + Math.max(0, c.savings), 0);
  console.log(`\n=== ИТОГО реалистичная экономия (только холодные, вариант А): ${totalCold} Б ===`);

  const unrollBytes = unrolls.reduce((s, c) => s + c.byteLen * c.n, 0);
  console.log(`Справочно: суммарный объём анроллов/внутрипроцедурных повторов (сворачивать НЕЛЬЗЯ): ${unrollBytes} Б в ${unrolls.length} находках`);

  return { totalCold, coldCrossProc, hotCrossProc, unrolls, bOnly };
}

let LST_PATH_G = LST_PATH, INSTR_COUNT_G = 0;

function main() {
  LST_PATH_G = LST_PATH;
  if (!fs.existsSync(LST_PATH)) { console.error('нет файла: ' + LST_PATH); process.exit(2); }
  if (!fs.existsSync(SYM_PATH)) { console.error('нет файла: ' + SYM_PATH); process.exit(2); }
  const data = run(LST_PATH, SYM_PATH, MIN_BYTES);
  INSTR_COUNT_G = data.instrs.length;
  const rep = report(data, MIN_BYTES, TOP_N);
  const summary = printReport(rep, MIN_BYTES, TOP_N);

  if (SELFCHECK) {
    // прецедент setSprPuerta / initDoorProta: ищем пару кандидатов, где обе метки среди
    // {setSprPuerta, setSprPuerta2, initDoorProta3, initDoorProta4, initDoorProta5}, длина >= 30 Б
    const names = /^(setSprPuerta\d?|initDoorProta\d)$/;
    const hit = [...summary.coldCrossProc, ...summary.hotCrossProc].find(c =>
      c.byteLen >= 30 && c.occs.some(o => names.test(o.label)) && c.occs.length >= 2 &&
      new Set(c.occs.map(o => names.test(o.label))).has(true)
    );
    if (hit) {
      console.log(`\n✅ САМОПРОВЕРКА OK: найден прецедент setSprPuerta/initDoorProta, Б=${hit.byteLen}`);
      for (const o of hit.occs) console.log(`   ${fmtOcc(o)}`);
    } else {
      console.log(`\n❌ САМОПРОВЕРКА ПРОВАЛЕНА: прецедент setSprPuerta/initDoorProta НЕ найден — инструмент сломан`);
      process.exitCode = 1;
    }
  }
}

main();
