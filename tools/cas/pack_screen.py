#!/usr/bin/env python3
# pack_screen.py — PNG (256x256, до 16 цветов) -> данные просмотрщика/заставки Вектора-06Ц:
# 16 байт палитры (BBGGGRRR) + RLE (count,byte) четырёх плоскостей 0x8000/A000/C000/E000.
# Раскладка: H = база плоскости + столбец (0..31), L = строка, 255 = верхняя.
# Индекс цвета = 8*p(0x8000) + 4*p(0xA000) + 2*p(0xC000) + 1*p(0xE000).
# Применение: pack_screen.py in.png out.rle
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
colors = [c for _,c in sorted(im.getcolors(16), reverse=True)]
lut = {c:i for i,c in enumerate(colors)}
px = im.load()
vb=[((b*3//255)<<6)|((g*7//255)<<3)|(r*7//255) for r,g,b in colors]; vb += [0]*(16-len(vb))
planes=[bytearray(8192) for _ in range(4)]
for col in range(32):
    for x in range(8):
        for y in range(256):
            idx = lut[px[col*8+x, y]]
            for p,bit in enumerate((8,4,2,1)):
                if idx & bit: planes[p][col*256+(255-y)] |= 0x80>>x
raw=b"".join(bytes(p) for p in planes)
out=bytearray(); i=0
while i<len(raw):
    j=i
    while j<len(raw) and j-i<255 and raw[j]==raw[i]: j+=1
    out += bytes((j-i, raw[i])); i=j
open(sys.argv[2],"wb").write(bytes(vb)+bytes(out))
print(f"{sys.argv[2]}: палитра 16 Б + RLE {len(out)} Б (сырых 32768)")
