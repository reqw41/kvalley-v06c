// Гейт паритета Devector: собирает src/kvalley_8c.asm встроенным ассемблером
// расширения Devector (VS Code) и сравнивает байт-в-байт с build/kvalley_8c.rom (sjasm).
// Запуск: node tools/verify/devector_gate.js
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req) {
  if (req === 'vscode') return { window: {}, workspace: {}, Uri: {} };
  return origLoad.apply(this, arguments);
};
const fs = require('fs'), path = require('path'), os = require('os');
// DEVECTOR_ROOT — корень сборки Devector (напр. форк ~/projects/devector-fork).
// Без неё берётся расширение, установленное из маркетплейса.
//  ВЫБОР ИСТОЧНИКА (2026-08-19): гейт зовёт assemble(project, true) — это сигнатура
//  ФОРКА. У маркетплейсной сборки она другая (assemble(source, sourcePath, projectFile)),
//  и гейт падает «paths[0] must be string» — так и случилось, когда в редакторе
//  оказалось расширение из маркетплейса. Поэтому: DEVECTOR_ROOT -> форк -> установленное
//  расширение, и сборка больше НЕ зависит от того, что сейчас стоит в VS Code.
let devectorRoot = process.env.DEVECTOR_ROOT;
if (!devectorRoot) {
  const fork = path.join(os.homedir(), 'Projects/devector-fork');
  if (fs.existsSync(path.join(fork, 'out/assembler/assembler.js'))) devectorRoot = fork;
}
if (!devectorRoot) {
  const EXT = path.join(os.homedir(), '.vscode/extensions');
  const extDir = fs.readdirSync(EXT).filter(d => d.startsWith('alexfedotovskikh.devector-')).sort().pop();
  if (!extDir) { console.error('расширение Devector не найдено в ~/.vscode/extensions'); process.exit(2); }
  devectorRoot = path.join(EXT, extDir);
}
const A = require(path.join(devectorRoot, 'out/assembler/assembler.js'));

const root = path.resolve(__dirname, '../..');
const proj = path.join(root, 'kvalley.project.json');
const r = A.assemble(proj, true);
if (!r.success) {
  console.error('DEVECTOR: ошибки сборки:');
  (r.errors || []).forEach(e => console.error('  ' + e));
  process.exit(1);
}
const ref = fs.readFileSync(path.join(root, 'build/kvalley_8c.rom'));
// ЗАДАЧА#37: размер паддинга больше НЕ константа 28К — потолок образа считает build.sh по
// адресу первой игровой переменной. Гейт сравнивает по длине уже собранного эталона.
const SIZE = ref.length;
let out = Buffer.from(r.output);
if (out.length > SIZE) { console.error('DEVECTOR: ROM больше потолка (' + out.length + ' > ' + SIZE + ')'); process.exit(1); }
out = Buffer.concat([out, Buffer.alloc(SIZE - out.length)]);
if (out.length !== ref.length) { console.error('DEVECTOR: размер ' + out.length + ' != ' + ref.length); process.exit(1); }
let diffs = [];
for (let i = 0; i < out.length && diffs.length < 10; i++) if (out[i] !== ref[i]) diffs.push(i);
if (diffs.length) {
  console.error('DEVECTOR PARITY FAIL, первые расхождения (смещения в файле, адрес = +0x100):');
  diffs.forEach(i => console.error('  0x' + (i + 0x100).toString(16) + ': dv=' + out[i].toString(16) + ' sj=' + ref[i].toString(16)));
  process.exit(1);
}
console.log('DEVECTOR PARITY OK (' + out.length + ' байт, ' + Object.keys(r.labels).length + ' меток)');
