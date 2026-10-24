#!/usr/bin/env python3
# make_splash_rom.py — ROM-версия с заставкой для MiSTer (.rom, автостарт):
# [0x0100 jp 0x7800 + игра] [0x7800 стартер: палитра в гашении, 5 c показа,
# возврат первых 3 байт игры, jp 0x0100] [0x8000 плоскости заставки — их кладёт
# в видеопамять сам загрузчик ядра, распаковка не нужна].
# Стартер НЕ на 0x7600: там оверлей AY/ВИ53 (0x75A5+), его нельзя затирать.
# Применение: make_splash_rom.py <игра.rom> <planes.raw> <pal.bin> <out.rom>
# Перед сборкой: собрать src/cas/splash_starter.asm (sjasm, org 0x7800) с orig3.bin
# (= первые 3 байта игры) и pal.bin рядом.
# Обложка не обрабатывает читы: единый вход F1+F3 на титуле самой игры.
import sys, subprocess, tempfile, os
STARTER_ORG = 0x7800
PLANES_ORG = 0x8000
game_p, planes_p, pal_p, out_p = sys.argv[1:5]
here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, "..", "..", "src", "cas", "splash_starter.asm")
game = bytearray(open(game_p, "rb").read())
game_end = 0x100 + len(game)
if game_end > STARTER_ORG:
    sys.exit("make_splash_rom: игра/оверлей до 0x%04X заходит на стартер 0x%04X"
             % (game_end, STARTER_ORG))
with tempfile.TemporaryDirectory() as td:
    open(os.path.join(td, "orig3.bin"), "wb").write(bytes(game[0:3]))
    open(os.path.join(td, "v16_pal.bin"), "wb").write(open(pal_p, "rb").read())
    asm = os.path.join(td, "starter.asm")
    open(asm, "w").write(open(src).read())
    sj = os.path.join(here, "..", "bin", "sjasm")
    subprocess.run([sj, "-s", asm, os.path.join(td, "starter.bin"),
                    os.path.join(td, "s.lst"), os.path.join(td, "s.sym")],
                   check=True, cwd=td, capture_output=True)
    starter = open(os.path.join(td, "starter.bin"), "rb").read()
if STARTER_ORG + len(starter) > PLANES_ORG:
    sys.exit("make_splash_rom: стартер %d Б не влезает в 0x%04X..0x%04X"
             % (len(starter), STARTER_ORG, PLANES_ORG))
game[0:3] = bytes([0xC3, STARTER_ORG & 0xFF, STARTER_ORG >> 8])
out = bytearray(0xFF00)
out[0:len(game)] = game
out[STARTER_ORG-0x100:STARTER_ORG-0x100+len(starter)] = starter
out[PLANES_ORG-0x100:PLANES_ORG-0x100+32768] = open(planes_p, "rb").read()
open(out_p, "wb").write(out)
print(f"{out_p}: {len(out)} Б (игра {len(game)}, стартер {len(starter)} @ 0x{STARTER_ORG:04X})")
