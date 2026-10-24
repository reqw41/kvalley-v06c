"use strict";
/** Скопировать оверлей AY/ВИ53 в дырку WRTPSG из образа ROM.
 *  Зона snd_ov_* лежит в MapaRAM и после распаковки карты в RAM стёрта —
 *  брать байты только из файла .rom, не из текущей памяти. */
function sndOvLoad(memory, L, img, vi) {
  const a = vi ? L.snd_ov_vi : L.snd_ov_ay;
  const e = vi ? L.snd_ov_vi_end : L.snd_ov_ay_end;
  if (a == null || e == null || L.WRTPSG == null)
    throw new Error("нет меток оверлея (snd_ov_ay/vi, WRTPSG)");
  const n = e - a, off = a - 0x100;
  for (let i = 0; i < n; i++) memory.write(L.WRTPSG + i, img[off + i], false);
}
module.exports = { sndOvLoad };
