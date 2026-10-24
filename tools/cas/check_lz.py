#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_lz.py — ГЕЙТ пары «pack_lz.py + src/cas/unlz.asm».

Что делает по шагам:
  1. упаковывает docs/cas/v16_planes.raw;
  2. собирает src/cas/unlz.asm тем же sjasm, что и остальной проект;
  3. проверяет, что в коде НЕТ команд, которых нет у i8080 (sjasm — ассемблер Z80,
     он молча съест jr/djnz/ix, а Вектор их не выполнит);
  4. гоняет распаковщик на модели i8080 со СТОРОЖЕМ обращений к памяти;
  5. сверяет 32768 распакованных байт С ИСХОДНЫМ ФАЙЛОМ БАЙТ В БАЙТ;
  6. печатает такты.

Гейт ПАДАЕТ, если:
  - ассемблер ругнулся или в коде оказалась команда не из i8080;
  - распаковщик писал вне [DE, DE+32768) или читал вне сжатого блока/приёмника/кода;
  - распаковка не дошла до ret (зациклилась) или не тронула все 32768 байт приёмника
    — это и есть защита от ПУСТОЙ ВЫБОРКИ: приёмник до старта забит 0xA5, «ничего не
    делал» отличается от «распаковал» и по покрытию, и по сверке;
  - хоть один байт не совпал с исходным файлом.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import pack_lz                                                    # noqa: E402

RAW = os.path.join(ROOT, "docs", "cas", "v16_planes.raw")
ASM = os.path.join(ROOT, "src", "cas", "unlz.asm")
SJASM = os.path.join(ROOT, "tools", "bin", "sjasm")
CORE = "/Users/boris/projects/vector06js/i8080-js/i8080.js"
OUT = os.path.join(ROOT, "build", "cas")

ORG = 0x0100          # куда кладём распаковщик на стенде
LZ_AT = 0x0800        # куда кладём сжатый блок (заведомо ниже видеопамяти)
DST = 0x8000
DSTLEN = 0x8000
SP = 0x7F00

# --- команды, которых у i8080 НЕТ (префиксы Z80 и «двойники» 8080) ---
NOT_8080 = {0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38,
            0xCB, 0xD9, 0xDD, 0xED, 0xFD}
LEN3 = ({0x01, 0x11, 0x21, 0x31, 0x22, 0x2A, 0x32, 0x3A} |
        {0xC2, 0xC3, 0xC4, 0xCA, 0xCC, 0xCD, 0xD2, 0xD4, 0xDA, 0xDC,
         0xE2, 0xE4, 0xEA, 0xEC, 0xF2, 0xF4, 0xFA, 0xFC})
LEN2 = {0x06, 0x0E, 0x16, 0x1E, 0x26, 0x2E, 0x36, 0x3E,
        0xC6, 0xCE, 0xD6, 0xDE, 0xE6, 0xEE, 0xF6, 0xFE, 0xD3, 0xDB}


def die(msg):
    print("ГЕЙТ УПАЛ: " + msg)
    sys.exit(1)


def build():
    """Собрать unlz.asm и вернуть (файл образа, таблица меток)."""
    os.makedirs(OUT, exist_ok=True)
    wrap = os.path.join(OUT, "unlz_stand.asm")
    with open(wrap, "w") as f:
        f.write("\torg 0x%04X\n\tinclude \"%s\"\n" % (ORG, ASM))
    rom = os.path.join(OUT, "unlz.rom")
    sym = os.path.join(OUT, "unlz.sym")
    r = subprocess.run([SJASM, "-s", wrap, rom, os.path.join(OUT, "unlz.lst"), sym],
                       capture_output=True, text=True)
    if r.returncode != 0 or "Errors: 0" not in r.stdout:
        die("sjasm: %s%s" % (r.stdout, r.stderr))
    labels = {}
    for line in open(sym):
        if ":" in line and "equ" in line:
            name, val = line.split(":")
            labels[name.strip()] = int(val.strip().replace("equ", "").strip()
                                       .rstrip("hH"), 16)
    return rom, labels


def check_opcodes(rom, labels):
    """Линейный разбор кода: все ли команды существуют у i8080."""
    img = open(rom, "rb").read()
    start = labels["unlz"] - ORG
    end = labels["unlz_len"] - ORG          # дальше — ячейка данных, не код
    if end <= start:
        die("метки unlz/unlz_len не найдены или пусты")
    i = start
    seen = 0
    while i < end:
        op = img[i]
        if op in NOT_8080:
            die("команда 0x%02X по адресу 0x%04X — её нет у i8080" % (op, ORG + i))
        i += 3 if op in LEN3 else 2 if op in LEN2 else 1
        seen += 1
    if i != end:
        die("разбор кода не сошёлся с границей данных (0x%04X != 0x%04X)"
            % (ORG + i, ORG + end))
    if seen == 0:
        die("в коде распаковщика ноль команд")
    return seen


def main():
    raw = open(RAW, "rb").read()
    if len(raw) != DSTLEN:
        die("%s: %d Б, ждали %d" % (RAW, len(raw), DSTLEN))

    # 1. упаковка + самопроверка эталонной распаковкой на Python
    blob, items = pack_lz.pack(raw)
    back, used = pack_lz.unpack(blob)
    if back != raw or used != len(blob):
        die("эталонная распаковка на Python не воспроизвела вход")
    lzfile = os.path.join(OUT, "v16.lz")
    os.makedirs(OUT, exist_ok=True)
    open(lzfile, "wb").write(blob)

    # 2-3. сборка и проверка набора команд
    rom, labels = build()
    ncmd = check_opcodes(rom, labels)
    codelen = labels["unlz_end"] - labels["unlz"]

    # 4. прогон на модели i8080
    outfile = os.path.join(OUT, "v16.unpacked")
    cfgfile = os.path.join(OUT, "run.json")
    cfg = dict(core=CORE, codeFile=rom, lzFile=lzfile, outFile=outfile,
               codeStart=ORG, codeLen=len(open(rom, "rb").read()),
               lzStart=LZ_AT, lzLen=len(blob),
               dstStart=DST, dstLen=DSTLEN,
               varStart=labels["unlz_len"], varLen=2,
               entry=labels["unlz"], sp=SP, spLow=SP - 0x100, limit=20_000_000)
    json.dump(cfg, open(cfgfile, "w"))
    r = subprocess.run(["node", os.path.join(HERE, "i8080_run.js"), cfgfile],
                       capture_output=True, text=True)
    if r.returncode != 0:
        die("модель i8080: %s%s" % (r.stdout, r.stderr))
    st = json.loads(r.stdout)

    # 5. приёмка
    if not st["finished"]:
        die("распаковщик не вернул управление (зациклился), %d команд" % st["instr"])
    if st["instr"] < 1000 or st["cycles"] < 1000:
        die("ПУСТАЯ ВЫБОРКА: распаковка фактически не запускалась (%d команд)"
            % st["instr"])
    if st["viol"]:
        for v in st["viol"]:
            print("  выход за границы: %s 0x%04X из pc=0x%04X"
                  % (v["kind"], v["addr"], v["pc"]))
        die("распаковщик лазит за пределы разрешённых областей")
    if st["covered"] != DSTLEN:
        die("ПУСТАЯ ВЫБОРКА: записано %d байт приёмника из %d"
            % (st["covered"], DSTLEN))
    if st["lzUsed"] != st["lzLen"]:
        die("прочитано %d байт сжатого блока из %d — формат разошёлся с распаковщиком"
            % (st["lzUsed"], st["lzLen"]))
    if st["sp"] != st["spExpected"]:
        die("стек не сбалансирован: SP=0x%04X, ждали 0x%04X" % (st["sp"], st["spExpected"]))
    got = open(outfile, "rb").read()
    if len(got) != len(raw):
        die("распаковано %d Б вместо %d" % (len(got), len(raw)))
    if got != raw:
        bad = [i for i in range(len(raw)) if got[i] != raw[i]]
        die("расхождение с исходным файлом: %d байт, первый по смещению %d (0x%04X)"
            % (len(bad), bad[0], DST + bad[0]))

    lit = sum(1 for it in items if it[0] == "L")
    print("ГЕЙТ ЗЕЛЁНЫЙ")
    print("  сжатие:      %d -> %d Б (%.1f%%), литералов %d, матчей %d"
          % (len(raw), len(blob), 100.0 * len(blob) / len(raw), lit, len(items) - lit))
    print("  распаковщик: %d Б кода (%d команд), из них %d Б — ячейка длины"
          % (codelen, ncmd, labels["unlz_end"] - labels["unlz_len"]))
    print("  прогон:      %d тактов, %d команд = %.1f такта на выходной байт"
          % (st["cycles"], st["instr"], st["cycles"] / DSTLEN))
    print("               %.3f с при 3 МГц; чтений %d, записей %d"
          % (st["cycles"] / 3e6, st["reads"], st["writes"]))
    print("  сверка:      32768 байт байт-в-байт с %s" % os.path.relpath(RAW, ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
