#!/usr/bin/env python3
# Компилятор карт: src/res/maps/pyramids.txt -> src/res/res_maps.asm
# Вызывается из build.sh ПЕРЕД ассемблированием. Байт-в-байт с оригиналом (проверено гейтом).
import re, sys

TXT = "src/res/maps/pyramids.txt"
OUT = "src/res/res_maps.asm"
# физический порядок блоков MapStage в ROM (адреса запечены — НЕ менять)
ROM_ORDER = [1,2,5,4,3,6,8,11,7,9,10,15,12,13,14]

lines = [l.rstrip("\n") for l in open(TXT, encoding="utf-8")]
halves = {}    # "b.s" -> [22 ряда по 16 бит]
pyr = {}       # n -> dict
i = 0
def err(m): sys.exit("maps_compile: %s (строка %d)" % (m, i+1))
while i < len(lines):
    l = lines[i].strip()
    if not l or l.startswith("#"): i += 1; continue
    if l.startswith("HALF "):
        name = l.split()[1]; rows = []
        for r in range(22):
            i += 1
            row = lines[i].strip()
            if len(row) != 16 or set(row) - set("#."): err("HALF %s ряд %d: '%s'" % (name, r, row))
            rows.append(int("".join("1" if c == "#" else "0" for c in row), 2))
        halves[name] = rows; i += 1; continue
    if l.startswith("PYRAMID "):
        n = int(l.split()[1]); p = {"doors": [], "mummy": [], "gem": [], "knife": [],
                                    "pick": [], "rot": [], "trap": [], "stair": []}
        pyr[n] = p; i += 1
        def kv(s):
            return {k: v for k, v in re.findall(r"(\w+)=(\S+)", s)}
        def num(v): return int(v, 0)
        while i < len(lines):
            l = lines[i].strip()
            if not l or l.startswith("#"): i += 1; continue
            if l.startswith("PYRAMID ") or l.startswith("HALF "): break
            tag = l.split()[0]
            if tag == "HALVES": p["halves"] = l.split()[1:]
            elif tag == "DOOR":
                if l.split()[1] == "-": p["doors"].append(None)
                else:
                    d = kv(l); p["doors"].append((num(d["y"]), num(d["x"]), (num(d["dest"])<<4)|num(d["dir"])))
            elif tag == "MUMMY":
                d = kv(l); p["mummy"].append((num(d["y"]), num(d["x"])|num(d.get("room","0"))|(num(d.get("xtra","0"))<<1), num(d["type"])))
            elif tag == "GEM":
                d = kv(l); p["gem"].append(((num(d["color"])<<4)|num(d.get("lo","0")), num(d["y"]), num(d["x"])))
            elif tag == "KNIFE":
                d = kv(l); p["knife"].append((num(d["y"]), num(d["x"])))
            elif tag == "PICK":
                d = kv(l); p["pick"].append((num(d["y"]), num(d["x"])))
            elif tag == "ROTDOOR":
                d = kv(l); p["rot"].append((num(d["h"]), num(d["y"]), num(d["x"])|(num(d["room"])<<2)|num(d["dir"])))
            elif tag == "TRAP":
                d = kv(l); p["trap"].append((num(d["y"]), num(d["x"])))
            elif tag == "STAIR":
                d = kv(l)
                xp = num(d["x"]) | (num(d["room"])<<1) | (1 if d["dir"]=="L" else 0) | (num(d.get("xtra","0"))<<2)
                p["stair"].append((num(d["y"]), xp))
            elif tag == "END": pass
            else: err("неизвестный тег "+tag)
            i += 1
        continue
    err("неожиданная строка: "+l)

# --- эмиссия ---
def db(bs): return "\tdb " + ", ".join("0x%02X" % b for b in bs)
o = []
o.append(";==============================================================================")
o.append("; СГЕНЕРИРОВАНО tools/maps_compile.py из src/res/maps/pyramids.txt — НЕ ПРАВИТЬ")
o.append("; РУКАМИ, правится текстовый исходник. Порядок блоков = порядок ROM (запечён).")
o.append(";==============================================================================")
# --- пул полуэкранов: СЛОВАРЬ СТРОК ------------------------------------------------
# Полуэкран — это 22 ряда по 16 бит (кирпич/пусто). Хранить их сырьём = 14*22*2 = 616 Б,
# но РАЗНЫХ рядов среди 308 всего 63: сплошная стена, сплошная пустота, «пол справа» и
# прочие повторяются десятками. Поэтому полуэкран стал СТРОКОЙ ИЗ 22 ИНДЕКСОВ, а сами
# ряды лежат один раз в словаре halfRows. 308 + 63*2 = 434 Б, экономия 182 Б.
# Раскладка halfMapN не изменилась по смыслу: слот s по-прежнему адресуется как
# halfMapN + s*ЕДИНИЦА, только единица теперь 22 байта вместо 44 (см. unpackMap).
GRP = "ABCD"
base_slots = {}
for name in halves: base_slots.setdefault(GRP.index(name[0]), []).append(int(name[1:]))
rowpool, rowidx = [], {}
for b in sorted(base_slots):
    for s in sorted(base_slots[b]):
        for r in halves["%s%d" % (GRP[b], s)]:
            if r not in rowidx:
                rowidx[r] = len(rowpool); rowpool.append(r)
assert len(rowpool) <= 256, "словарь рядов не влезает в байтовый индекс: %d" % len(rowpool)
for b in sorted(base_slots):
    o.append("halfMap%d:" % (b+1))
    for s in sorted(base_slots[b]):
        rows = halves["%s%d" % (GRP[b], s)]
        o.append("; --- полуэкран %s%d (22 индекса в halfRows) ---" % (GRP[b], s))
        o.append(db([rowidx[r] for r in rows]))
o.append("; --- словарь рядов: %d уникальных из %d (по 2 Б, старший байт первым) ---"
         % (len(rowpool), sum(len(halves[n]) for n in halves)))
o.append("halfRows:")
for i in range(0, len(rowpool), 8):
    o.append(db([b for r in rowpool[i:i+8] for b in (r >> 8, r & 0xFF)]))
# пирамиды
for n in ROM_ORDER:
    p = pyr[n]
    o.append("MapStage%d:" % n)
    hs = p["halves"]
    assert hs[-1][0] == "D", "пирамида %d: последний полуэкран должен быть из группы D" % n
    assert all(h[0] != "D" for h in hs[:-1]), "пирамида %d: группа D только последней" % n
    assert len(hs) <= 4, "пирамида %d: максимум 4 полуэкрана" % n
    hb = [ (GRP.index(h[0]) << 4) | int(h[1:]) for h in hs ]
    o.append(db(hb) + "\t; полуэкраны (последний из D = терминатор)")
    for d in p["doors"]:
        o.append(db([0xFF]) + "\t; дверь: нет" if d is None else db(list(d)) + "\t; дверь Y,X,dest|dir")
    o.append(db([len(p["mummy"])]) + "\t; мумии")
    for m in p["mummy"]: o.append(db(list(m)))
    o.append(db([len(p["gem"])]) + "\t; гемы")
    for m in p["gem"]: o.append(db(list(m)))
    o.append(db([len(p["knife"])]) + "\t; ножи")
    for m in p["knife"]: o.append(db(list(m)))
    o.append(db([len(p["pick"])]) + "\t; кирки")
    for m in p["pick"]: o.append(db(list(m)))
    o.append(db([len(p["rot"])]) + "\t; вращающиеся двери")
    for m in p["rot"]: o.append(db(list(m)))
    o.append(db([len(p["trap"])]) + "\t; стены-ловушки")
    for m in p["trap"]: o.append(db(list(m)))
    o.append(db([len(p["stair"])]) + "\t; лестницы")
    for m in p["stair"]: o.append(db(list(m)))
open(OUT, "w", encoding="utf-8").write("\n".join(o) + "\n")

# --- ГЕЙТ ЁМКОСТИ МАССИВОВ ОЗУ (задача #47, 2026-08-03) --------------------------------
# Блок игровых переменных уплотнён по РЕАЛЬНЫМ максимумам этого файла: массивы объектов
# больше не размера «как в MSX-оригинале», а ровно под максимум по 15 пирамидам (напр.
# doorGiraData было 223 Б = 31 запись, стало 21 Б = 3 записи при максимуме 2). Добавишь
# сюда третью вращающуюся дверь или седьмой гем — загрузчик уровня (getGiratorias,
# getGemas и т.п.) молча запишет в СОСЕДНЮЮ переменную. Поэтому ёмкости продублированы
# здесь и проверяются при каждой сборке. Менять числа только ВМЕСТЕ с size-константами
# в src/game/kvalley_vars.asm (адреса там — цепочка equ, пересчитывать вручную).
CAP = {                # тег в pyramids.txt -> (сколько записей влезает, имя массива)
    "DOOR":    (4,  "pyramidDoors"),
    "MUMMY":   (4,  "momiasPiramid/momiaDat"),
    "GEM":     (6,  "datosGemas"),
    "KNIFE":   (4,  "knifesData"),
    "PICK":    (12, "picosData"),
    "ROTDOOR": (3,  "doorGiraData"),
    "TRAP":    (3,  "muroTrampaDat"),
}
for n in sorted(pyr):
    for tag, key in (("DOOR", "doors"), ("MUMMY", "mummy"), ("GEM", "gem"), ("KNIFE", "knife"),
                     ("PICK", "pick"), ("ROTDOOR", "rot"), ("TRAP", "trap")):
        cap, arr = CAP[tag]
        if len(pyr[n][key]) > cap:
            sys.exit("maps_compile: пирамида %d — %s %d шт., в %s влезает %d "
                     "(увеличь массив в src/game/kvalley_vars.asm и ёмкость здесь)"
                     % (n, tag, len(pyr[n][key]), arr, cap))

# Двери последовательного прохода: проверка карт и таблица входов для читов N/H.
hop = [0] * 16
for n in sorted(pyr):
    for d in pyr[n]["doors"]:
        if d is None: continue
        dest, dirn = d[2] >> 4, d[2] & 0x0F
        if dest == n + 1: hop[dest] = dirn
for n in range(2, 16):
    assert hop[n], "нет двери из пирамиды %d в %d" % (n-1, n)

# Индекс таблицы = номер пирамиды минус 1; вход в первую не используется.
hop_out = "src/gen/vec_hoptab.asm"
with open(hop_out, "w", encoding="utf-8") as f:
    f.write("; generated by tools/maps_compile.py: входы пирамид для N/H\nvec_hop_ent:\n")
    for n in range(1, 16):
        f.write("\tdb 0x%02X\t; пирамида %d\n" % (hop[n], n))

print("res_maps.asm сгенерирован: %d полуэкранов, %d пирамид" % (len(halves), len(pyr)))
