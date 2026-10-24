// Headless MSX1 для локстеп-верификации рекомпилятора.
// Z80-ядро из vector06js/Z80_v06.js + мини-C-BIOS-стабы (WRTVRM/RDVRM/WRTPSG/
// RDPSG/SNSMAT + ISR 0x38 -> H.TIMI 0xFD9F). Никакого настоящего BIOS не нужно:
// MSX-glue таргет самодостаточен, ему нужны только эти точки входа.
"use strict";
const Z80 = require("/Users/boris/Projects/vector06js/Z80_v06.js");

function MsxHeadless(romBytes) {
  const mem = new Uint8Array(0x10000);
  const vram = new Uint8Array(0x4000);
  mem.fill(0xC9, 0, 0x4000);                    // любой незнакомый BIOS-вызов = RET
  mem.set(romBytes.subarray(0, 0x8000), 0x4000); // 32К картридж 0x4000-0xBFFF
  mem[0xFD9A] = 0xC9;                            // H.TIMI (C-BIOS: 0xFD9A!): ret до хука

  // --- мини-BIOS (машинный код) ---
  // BIOS-точки плотные (0x47/0x4A/0x4D по 3 байта) -> каждая = JP на тело в 0x0100+.
  const put = (a, bytes) => mem.set(bytes, a);
  const JP = (a, t) => put(a, [0xC3, t & 0xFF, t >> 8]);
  // 0x0038 ISR: компактный (до 0x0047!): push af,bc,de,hl / call H.TIMI / pops / ei / ret
  put(0x0038, [0xF5, 0xC5, 0xD5, 0xE5,
               0xCD, 0x9A, 0xFD,
               0xE1, 0xD1, 0xC1, 0xF1,
               0xFB, 0xC9]);                     // 13 байт: 0x38..0x44
  // ВАЖНО: тела в 0x200+ - зона 0x100-0x1FF содержит BIOS-точки (RDVDP 0x13E,
  // SNSMAT 0x141!), тело по 0x140 однажды затёрло SNSMAT и SPACE читался из PSG.
  JP(0x0047, 0x0200);                            // WRTVDP
  JP(0x004A, 0x0210);                            // RDVRM
  JP(0x004D, 0x0220);                            // WRTVRM
  JP(0x0093, 0x0240);                            // WRTPSG
  JP(0x0096, 0x0250);                            // RDPSG
  JP(0x0141, 0x0260);                            // SNSMAT
  JP(0x0138, 0x0270);                            // RSLREG
  // тела:
  put(0x0200, [0xF5, 0x78, 0xD3, 0x99, 0x79, 0xF6, 0x80, 0xD3, 0x99, 0xF1, 0xC9]); // WRTVDP: B=data,C=reg
  put(0x0210, [0x7D, 0xD3, 0x99, 0x7C, 0xE6, 0x3F, 0xD3, 0x99, 0xDB, 0x98, 0xC9]); // RDVRM
  put(0x0220, [0xF5, 0x7D, 0xD3, 0x99, 0x7C, 0xE6, 0x3F, 0xF6, 0x40, 0xD3, 0x99,
               0xF1, 0xD3, 0x98, 0xC9]);                                            // WRTVRM
  put(0x0240, [0xD3, 0xA0, 0x7B, 0xD3, 0xA1, 0xC9]);                                // WRTPSG
  put(0x0250, [0xD3, 0xA0, 0xDB, 0xA2, 0xC9]);                                      // RDPSG
  put(0x0260, [0xD3, 0xAA, 0xDB, 0xA9, 0xC9]);                                      // SNSMAT
  put(0x0270, [0xDB, 0xA8, 0xC9]);                                                  // RSLREG

  // --- IO ---
  let vaddr = 0, vlatch = -1, slotReg = 0, psgSel = 0;
  const vdpReg = new Uint8Array(8);
  const psg = new Uint8Array(16);
  psg[14] = 0x3F;                                // джойстик: все линии неактивны
  const kbd = new Uint8Array(11).fill(0xFF);
  let kbdRow = 0;
  const io = {
    read(p) {
      p &= 0xFF;
      if (p === 0x98) { const v = vram[vaddr]; vaddr = (vaddr + 1) & 0x3FFF; return v; }
      if (p === 0x99) return 0x00;                 // VDP status (без спрайт-коллизий)
      if (p === 0xA8) return slotReg;
      if (p === 0xA2) return psg[psgSel & 15];
      if (p === 0xA9) return kbd[kbdRow % 11];
      return 0xFF;
    },
    write(p, v) {
      p &= 0xFF; v &= 0xFF;
      if (p === 0x98) { vram[vaddr] = v; vaddr = (vaddr + 1) & 0x3FFF; vlatch = -1; return; }
      if (p === 0x99) {
        if (vlatch < 0) vlatch = v;
        else {
          if ((v & 0xC0) === 0x80) { vdpReg[v & 7] = vlatch; }
          else vaddr = ((v & 0x3F) << 8) | vlatch;
          vlatch = -1;
        }
        return;
      }
      if (p === 0xA8) { slotReg = v; return; }
      if (p === 0xA0) { psgSel = v & 15; return; }
      if (p === 0xA1) { psg[psgSel & 15] = v; return; }
      if (p === 0xAA) { kbdRow = v & 0x0F; return; }
    },
  };

  const hooks = { onMemWrite: null };                // onMemWrite(addr, val) -> val|undefined
  const core = {
    mem_read: (a) => mem[a & 0xFFFF],
    mem_write: (a, v) => {
      const x = a & 0xFFFF;
      if (hooks.onMemWrite) { const r = hooks.onMemWrite(x, v & 0xFF); if (r !== undefined) v = r; }
      if (x >= 0xC000 || x < 0x4000) mem[x] = v & 0xFF;
    },
    io_read: (p) => io.read(p),
    io_write: (p, v) => io.write(p, v),
  };
  const cpu = new Z80(core);
  cpu.reset && cpu.reset();
  cpu.sp = 0xF380;
  // bootstrap: IM 1 (ядро в im0 после RST делает pc+1 и теряет первый байт ISR
  // -> накопительный underflow стека), затем jp INIT из заголовка "AB".
  const init = mem[0x4002] | (mem[0x4003] << 8);
  mem.set([0xED, 0x56, 0xFB ? 0xC3 : 0xC3, init & 0xFF, init >> 8], 0x0000);
  cpu.pc = 0x0000;

  const CYC_FRAME = 59736;
  let acc = 0;
  function frame() {                               // один видеокадр
    while (acc < CYC_FRAME) {
      const c = cpu.instruction();
      acc += (c || 4);
    }
    acc -= CYC_FRAME;
    cpu.interrupt(false, 0xFF);                    // im0/im1: попадает на 0x0038
  }
  return { cpu, mem, vram, kbd, frame, hooks,
           nameBase: () => (vdpReg[2] & 0x0F) * 0x400 };
}
module.exports = MsxHeadless;
