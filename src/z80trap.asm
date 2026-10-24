; ============================================================================
; src/z80trap.asm  — RST 0x10 trap dispatcher + JR / JRcc / DJNZ / CB handlers
; Task 7v2 + Task 8v2.  Assembled with:  zasm --asm8080 (Intel 8080 mnemonics).
;
; Strategy = ADDRESS-PRESERVING.  Every pure-Z80 instruction in the game image
; had its first byte replaced by  RST 0x10 (0xD7); trailing bytes preserved.
; The CPU pushes return addr r = S+1 and jumps to vector 0x0010, which is
; patched (T13v2 / by the test) to  JMP z80_dispatch.
;
; The dispatcher reads r from the stack, computes the site address S = r-1,
; binary-searches the side-table { addr:uint16LE, kind:uint8 } for S, and
; dispatches by KIND to the matching handler.  It is FULLY TRANSPARENT: all
; program registers/flags (A,F,BC,DE,HL) are saved to private cells, the work
; is done on scratch, then state is restored and control transfers (JMP) to
; the resolved program PC.  No RET — the return address is consumed.
;
; KIND integers (must match tools/recompiler/patch.py):
;   0 JR_UNCOND  1 JR_NZ  2 JR_Z  3 JR_NC  4 JR_C  5 DJNZ
;   6 CB  7 ED  8 IXIY_DD  9 IXIY_FD  10 EXX  11 EXAF  12 EI  13 DI
;   14 JR_SELF  (idle `JR $` wait -> EI;HLT, see h_jr_self)
;
; Side-table labels  z80_table / z80_table_end  are provided by the linkee
; (the patched game image / the test).  This file references them only.
; ============================================================================

; Runtime origin: the real rom build (build_rom.py / Makefile) defines
; RUNTIME_ORG (and BUILD_ROM) in src/z80state.inc, which the wrapper includes
; BEFORE this file.  Unit tests #include this file directly and rely on the
; default 0x6000 origin below.
#if !defined(RUNTIME_ORG)
RUNTIME_ORG equ 06000h
#endif
            org  RUNTIME_ORG

; FINISH_EI_DELAY — EI accept-window NOP count, defined EARLY so the lean
; EXAF/EXX fast paths (which use it before the main finish block) can reference
; it in pass 1.  Full rationale at the finish/FINISH_EI_DELAY block below.
FINISH_EI_DELAY equ 8

; ---- private state cells (saved program context) ---------------------------
sv_af:      dw   0          ; A in hi byte, F in lo byte (as PUSH PSW order)
sv_bc:      dw   0
sv_de:      dw   0
sv_hl:      dw   0
sv_ret:     dw   0          ; r = S+1  (return address pushed by RST)
sv_site:    dw   0          ; S = r-1  (search key / record addr)
sv_kind:    db   0          ; resolved KIND
sv_target:  dw   0          ; computed jump target (for taken branches)
sv_midaddr: dw   0          ; scratch: addr field of current bsearch midpoint
sv_lo:      dw   0          ; bsearch lo index
sv_hi:      dw   0          ; bsearch hi index (one-past-end)
sv_mididx:  dw   0          ; bsearch mid index
; Software shadow of the PROGRAM's interrupt-enable (INTE) state.
; The 8080 has no instruction to read INTE, so the trap runtime maintains this
; shadow: the program's own EI/DI are trapped (KIND EI_OP/DI_OP) and mirror their
; effect here, and resume_stub initialises it from RESUME_IFF1.  The dispatcher
; entry does a hard DI (to make each ~150-insn handler interrupt-atomic), and
; finish/finish_reti re-enable interrupts on exit ONLY when prog_inte != 0 — i.e.
; they RESTORE the program's INTE rather than unconditionally enabling it.  This
; is essential: the game runs trapped Z80 ops inside its OWN DI critical sections
; (e.g. the per-frame mutex at 0x401D..0x4029) where an always-EI would wrongly
; reopen the interrupt window mid-section and corrupt state.
prog_inte:  db   1          ; 1 = program interrupts enabled, 0 = disabled

; Single-entry dispatch cache (Task 16): last site resolved by the universal
; binary search and its kind.  cache_site is initialised to 0xFFFF (an address
; no site can have here) so the first lookup always misses cleanly.
cache_site: dw   0FFFFh     ; last bsearch-resolved site address
cache_kind: db   0          ; kind for cache_site

; Scratch for the ultra-lean EXAF/EXX fast paths (Task 16): they bypass the
; generic prologue/finish entirely, so they need a private HL save slot.  Under
; the handler's DI these are interrupt-atomic (no nesting can corrupt them).
lean_hl:    dw   0          ; program HL save for lean EXAF/EXX

; ============================================================================
; TRAP_PROLOGUE — shared dispatcher entry prologue (Task 16)
; ----------------------------------------------------------------------------
; Common to the universal RST 0x10 dispatcher AND the dedicated fast IX/IY
; vectors (RST 0x18 = DD, RST 0x20 = FD).  On entry the only stack item is r
; (the return addr pushed by the RST); HL/AF/BC/DE still hold program values.
; The prologue:
;   - DI (make the ~150-insn handler body interrupt-atomic),
;   - save program HL/AF/BC/DE into sv_*,
;   - POP r off the stack -> sv_ret (so SP == program SP for the body),
;   - sv_site = r-1.
; After it runs, real SP == program SP, exactly as the handler body expects
; (DAD SP reads the live program SP, finish rebuilds from it).
; ============================================================================
TRAP_PROLOGUE macro
            di
            shld sv_hl              ; save HL  (does not affect flags)
            push psw                ; A,F -> stack
            pop  h                  ; H=A, L=F
            shld sv_af              ; sv_af = A,F
            mov  h,b
            mov  l,c
            shld sv_bc              ; sv_bc = B,C
            mov  h,d
            mov  l,e
            shld sv_de              ; sv_de = D,E
            ; stack top is again r (PUSH PSW / POP balanced)
            pop  h                  ; HL = r  (return addr consumed; SP=program SP)
            shld sv_ret
            dcx  h                  ; HL = S = r-1
            shld sv_site
            endm

; HEXX_SWAP_BYTE — swap one byte between [HL] (saved block) and [DE] (shadow),
; advancing both pointers.  Uses A and B as temps.  Used unrolled by the lean
; EXX fast path to avoid loop counter/branch overhead on the hot delay loop.
HEXX_SWAP_BYTE macro
            ldax d                 ; A = shadow byte
            mov  b,m               ; B = main byte (temp)
            mov  m,a               ; main := shadow
            mov  a,b
            stax d                 ; shadow := main
            inx  h
            inx  d
            endm

; ============================================================================
; FAST IX/IY dispatch (Task 16) — dedicated RST vectors, NO binary search.
; ----------------------------------------------------------------------------
; The blitter's IX/IY ops are the hottest traps (~57 sites, fired thousands of
; times per title draw).  Instead of the universal RST 0x10 -> bsearch(table)
; -> kind-jump -> h_ixiy_dd, patch.py emits these sites with a DEDICATED first
; byte:
;   IX sites (DD prefix) -> RST 0x18 (0xDF)  -> vector 0x0018 -> here
;   IY sites (FD prefix) -> RST 0x20 (0xE7)  -> vector 0x0020 -> here
; build_rom.py bakes 0x0018 = JMP h_ixiy_dd_fast and 0x0020 = JMP h_ixiy_fd_fast.
; The handler reads the preserved sub-opcode straight from [r] (= [S+1]); the
; IX-vs-IY choice comes from WHICH vector was taken (no table lookup at all).
; This removes the ~190-instruction bsearch from the hot path.  The other (rare)
; kinds keep the universal RST 0x10 + table + bsearch path.
; ============================================================================
h_ixiy_dd_fast:
            TRAP_PROLOGUE
            lxi  h,z80_ix
            jmp  ixiy_fast_common
h_ixiy_fd_fast:
            TRAP_PROLOGUE
            lxi  h,z80_iy
ixiy_fast_common:
            shld ixiy_ptr
            jmp  ixiy_core         ; straight into the shared IX/IY core, no bsearch

; ============================================================================
; FAST EXX / EX AF,AF' dispatch (Task 16) — dedicated RST vectors.
; ----------------------------------------------------------------------------
; The title-screen timing/music loop hammers EXX and EX AF,AF' (it uses the
; alternate register bank as a fast delay counter), so these become the next
; hottest traps after IX/IY.  Give them their own free RST vectors so they
; skip BOTH the binary search AND the kind jump-table:
;   EXAF (08) sites -> RST 0x28 (0xEF) -> vector 0x28 = JMP h_exaf_fast
;   EXX  (D9) sites -> RST 0x30 (0xF7) -> vector 0x30 = JMP h_exx_fast
; Both vectors are verified free in the post-init image (cells zero, never
; executed as RST instructions).  After the prologue they fall into the shared
; h_exx / h_exaf bodies, which already end at finish.
; ============================================================================
; --- ultra-lean EXAF / EXX (Task 16) ----------------------------------------
; EX AF,AF' and EXX touch ONLY the alternate-bank shadow; they need neither the
; full register save (sv_bc/de/hl/af) nor the generic finish.  These hand-rolled
; paths swap directly with the live registers and exit via lean_exit (conditional
; EI + EI-delay + RET to r), the cheapest possible trap.  Both 1-byte ops resume
; at r (the byte after the RST), which is the stack top RET pops.
;
; lean EXAF: swap program AF (in PSW) with z80_afp, leave BC/DE/HL untouched.
h_exaf_fast:
            di
            shld lean_hl           ; save program HL
            push psw               ; save program AF: [SP]=AF, [SP+2]=r
            ; A is now free: pre-patch the shared lean EI slot from prog_inte
            lda  prog_inte
            ora  a
            mvi  a,000h
            jz   exaf_eip
            mvi  a,0FBh
exaf_eip:
            sta  lean_ei
            ; swap z80_afp <-> [SP] (program AF)
            lhld z80_afp           ; HL = AF'
            xthl                   ; HL = program AF ; [SP] = AF'
            shld z80_afp           ; z80_afp = old program AF
            pop  psw               ; program AF = AF' ; [SP] = r
            lhld lean_hl           ; restore HL
            jmp  lean_exit

; lean EXX: swap program BC/DE/HL with the contiguous shadow z80_bcp/dep/hlp,
; via the contiguous saved-state block sv_bc..sv_hl and the 6-byte swap, with the
; lean entry/exit (no generic prologue/finish).  AF is preserved (PSW saved on
; the stack so prog_inte can be read with A free).
h_exx_fast:
            di
            shld sv_hl             ; save program HL first (it is live in HL)
            push psw               ; save program AF; [SP]=AF, r below
            ; A free: pre-patch the shared lean EI slot from prog_inte
            lda  prog_inte
            ora  a
            mvi  a,000h
            jz   exx_eip
            mvi  a,0FBh
exx_eip:
            sta  lean_ei
            ; stash program BC and DE into the sv_ block (sv_bc/sv_de)
            mov  h,b
            mov  l,c
            shld sv_bc
            mov  h,d
            mov  l,e
            shld sv_de
            ; swap the 6 contiguous bytes sv_bc..sv_hl <-> z80_bcp..z80_hlp,
            ; UNROLLED (no loop counter / branch overhead — hot delay-loop path).
            ; HL walks the saved block, DE walks the shadow block; A/B are temps.
            lxi  h,sv_bc
            lxi  d,z80_bcp
            HEXX_SWAP_BYTE
            HEXX_SWAP_BYTE
            HEXX_SWAP_BYTE
            HEXX_SWAP_BYTE
            HEXX_SWAP_BYTE
            HEXX_SWAP_BYTE
            ; reload program BC/DE/HL from the swapped block
            lhld sv_bc
            mov  b,h
            mov  c,l
            lhld sv_de
            mov  d,h
            mov  e,l
            lhld sv_hl             ; HL = swapped HL
            pop  psw               ; restore program AF; [SP]=r
            ; fall through to lean_exit

; lean_exit — shared tail for the lean EXAF/EXX paths.  All program registers
; are restored; [SP]=r.  Apply the pre-patched conditional EI, burn the
; FINISH_EI_DELAY accept window, then RET to r.
lean_exit:
lean_ei:    db   000h             ; self-modified: EI (0xFB) if prog_inte else NOP
            rept FINISH_EI_DELAY
            nop
            endm
            ret                   ; pop r -> PC ; SP = program SP

; ============================================================================
; z80_dispatch — entry from vector 0x0010 (stack top = r)
; ============================================================================
z80_dispatch:
            ; --- INTERRUPT ATOMICITY (interrupt-safe trap runtime) -------------
            ; The trap handler uses STATIC scratch cells (sv_af/sv_hl/ed_scratch/
            ; cb_val_b/ixiy_ptr/...).  On real i8080 the maskable 50 Hz vblank
            ; interrupt is sampled at ANY instruction boundary, so it could fire
            ; mid-handler; the game's ISR contains its OWN trapped Z80 ops (PUSH
            ; IX / EXX) that re-enter this dispatcher and clobber the interrupted
            ; handler's scratch -> wrong `finish` -> corruption.
            ;
            ; Fix: DISABLE interrupts as the very FIRST thing, before any scratch
            ; cell is touched.  The ~2-instruction window between the RST 0x10 and
            ; this DI is safe: no scratch is written yet, and the program stack
            ; stays balanced even if an interrupt sneaks in there (it would push
            ; r, run the ISR atomically, and RET back to re-enter cleanly).
            ; After DI no hardware interrupt can fire until `finish`/`finish_reti`
            ; re-enable it, so the ISR cannot re-enter and clobber scratch.
            TRAP_PROLOGUE

; ---- single-entry dispatch cache (Task 16) ---------------------------------
; The universal path's binary search (~190 insns) dominated the remaining hot
; traps after the IX/IY/EXX/EXAF fast vectors — in particular a tight loop that
; re-fires the SAME JR site every iteration.  A one-entry cache turns that into
; ~10 insns: if sv_site == cache_site, reuse cache_kind and skip the search.
; The cache is just a hint (always validated by a real bsearch on a miss), and
; under the DI-atomic handler body it cannot be corrupted mid-update.
            lhld cache_site
            xchg                    ; DE = cache_site
            lhld sv_site            ; HL = current site
            mov  a,l
            cmp  e
            jnz  cache_miss
            mov  a,h
            cmp  d
            jnz  cache_miss
            ; hit: kind = cache_kind -> dispatch directly
            lda  cache_kind
            sta  sv_kind
            jmp  bs_dispatch
cache_miss:

; ---- binary search of z80_table for record.addr == sv_site ------------------
; record = 3 bytes { addr LE, kind }.  Table sorted ascending by addr.
;
; INDEX-based search (O(log n), no per-iteration division):
;   DE = lo (record INDEX), BC = hi (one-past-end INDEX = record count).
;   loop:
;     if lo >= hi -> not found
;     mid = (lo + hi) >> 1                       ; one 16-bit add + shift
;     ptr = z80_table + mid*3                    ; mid*3 via DAD
;     compare sv_site with [ptr].addr
;       equal -> found (kind = [ptr+2])
;       site < addr -> hi = mid
;       site > addr -> lo = mid + 1
;
; Z80_TABLE_COUNT is computed by the assembler from the table labels, so the
; record count costs zero runtime instructions.  mid and the pointer are kept
; in dedicated cells (sv_midaddr reused as the lo/hi index pair is in DE/BC).

Z80_TABLE_COUNT equ (z80_table_end - z80_table) / 3

            ; Bounds (record indices) live in sv_lo / sv_hi memory cells so the
            ; pointer arithmetic below is free to clobber HL/DE/BC.
            lxi  h,0
            shld sv_lo              ; lo = 0
            lxi  h,Z80_TABLE_COUNT
            shld sv_hi             ; hi = count (one-past-end)
bs_loop:
            ; if lo == hi -> not found  (lo never exceeds hi)
            lhld sv_lo
            xchg                    ; DE = lo
            lhld sv_hi             ; HL = hi
            mov  a,l
            sub  e
            mov  c,a                ; C = (hi-lo).lo
            mov  a,h
            sbb  d
            ora  c                  ; (hi-lo)==0 ?
            jz   bs_notfound
            ; mid = (lo + hi) >> 1   ; HL=hi, DE=lo
            dad  d                  ; HL = hi + lo  (CY = carry out)
            mov  a,h
            rar                     ; bit15 := add-carry ; CY := old h.bit0
            mov  h,a
            mov  a,l
            rar
            mov  l,a                ; HL = (lo+hi) >> 1 = mid index
            shld sv_mididx
            ; ptr = z80_table + 3*mid
            dad  h                  ; HL = 2*mid
            xchg                    ; DE = 2*mid
            lhld sv_mididx          ; HL = mid
            dad  d                  ; HL = 3*mid
            lxi  d,z80_table
            dad  d                  ; HL = ptr
            shld sv_target
            ; load mid.addr
            mov  a,m
            sta  sv_midaddr
            inx  h
            mov  a,m
            sta  sv_midaddr+1
            ; compare sv_site (16-bit) with mid.addr (full-word equality)
            lhld sv_site
            mov  a,l
            lxi  h,sv_midaddr
            sub  m                  ; A = site.lo - mid.lo ; CY=borrow
            mov  c,a                ; C = low result byte
            lhld sv_site
            mov  a,h
            lxi  h,sv_midaddr+1
            sbb  m                  ; A = site.hi - mid.hi - borrow ; CY=final borrow
            jc   bs_less            ; site < mid.addr
            ora  c                  ; no borrow: equal iff both result bytes 0
            jz   bs_found
            jmp  bs_greater         ; site > mid.addr
bs_found:
            lhld sv_target          ; HL = ptr
            inx  h
            inx  h                  ; HL = ptr+2
            mov  a,m
            sta  sv_kind
            ; populate the single-entry dispatch cache for next time
            sta  cache_kind
            lhld sv_site
            shld cache_site
            jmp  bs_dispatch
bs_less:
            lhld sv_mididx
            shld sv_hi             ; hi = mid
            jmp  bs_loop
bs_greater:
            lhld sv_mididx
            inx  h
            shld sv_lo             ; lo = mid + 1
            jmp  bs_loop

bs_notfound:
#if defined(BS_NOTFOUND_GRACEFUL)
            ; No record for this site. Ordinarily this means a bug in the
            ; recompiler/codemap — but a game can also genuinely execute a
            ; NATIVE RST instruction we never patched, either statically (a
            ; real RST n used as a compact ROM call, e.g. RST 0x10 = ROM
            ; PRINT-A) or via self-modifying code that WRITES a fresh RST
            ; byte into RAM at runtime (impossible to see in the static
            ; codemap). We have no real ROM behind these vectors — EXCEPT
            ; for RST 0x10 (opcode 0xD7, same byte our OWN trap vector
            ; uses): a genuine unpatched 0xD7 at this site is, by
            ; construction, never one WE inserted (inserted sites are
            ; always in z80_table) — it is the GAME's own "RST 10h" meaning
            ; real ZX ROM PRINT-A. Route those to a native PRINT-A instead
            ; of silently no-op'ing them (see native_print_a below) —
            ; otherwise every character the game ever prints via the
            ; standard screen channel silently vanishes.
            ; Opt-in (see BS_NOTFOUND_GRACEFUL) because for a fully-covered
            ; game reaching here IS a real recompiler bug that should crash
            ; loud, not be silently swallowed.
            lhld sv_site
            mov  a,m
            cpi  0D7h
            jnz  bs_notfound_plain
            call native_print_a
bs_notfound_plain:
            lhld sv_ret
            shld sv_target
            jmp  finish
#else
            jmp  z80_unimpl         ; no record => treat as error
#endif

#if defined(BS_NOTFOUND_GRACEFUL)
; ============================================================================
; native_print_a — minimal native re-implementation of real ZX ROM PRINT-A
; (vector 0x0010 -> PRINT-A-2 @0x15F2 -> CURCHL's OUT-routine; for the
; standard screen channel 'S' that OUT-routine is PR-ALL-1 @0x09F4).  We have
; no real ROM, so genuine "RST 10h" bytes the GAME executes (see
; bs_notfound above) land here instead, with A = the character to print
; (read from sv_af, exactly as TRAP_PROLOGUE saved it — the trap that
; caught this RST never touched it).
;
; Reimplements only the common control codes + printable-character path;
; cursor state is OUR OWN simple (0-31 col, 0-23 line) pair — NOT the real
; ROM's S-POSN encoding — since nothing else in this build reads/writes
; those cells in the ROM's convention (self-consistent is all that matters).
; Disassembled from roms/zx48.rom (PRINT-A-2/PR-ALL-1) to confirm which
; control codes take how many parameter bytes.
; ============================================================================
pr_pending:  db 0        ; параметров ещё ожидается для текущего контрол-кода (0=нет)
pr_code:     db 0        ; какой контрол-код сейчас копит параметры
pr_at_row:   db 0        ; временное хранение первого параметра AT (row)
pr_col:      db 0        ; курсор: столбец 0-31
pr_line:     db 0        ; курсор: строка 0-23

PR_AT    equ 016h
PR_TAB   equ 017h
PR_INK   equ 010h
PR_PAPER equ 011h
PR_FLASH equ 012h
PR_BRIGHT equ 013h
PR_INVERSE equ 014h
PR_OVER  equ 015h

native_print_a:
            lhld sv_af              ; H=A(символ), L=F
            mov  a,h
            lda  pr_pending
            ora  a
            jnz  npa_param
            mov  a,h                ; восстановить символ (lda выше затёрла A)
            cpi  020h
            jnc  npa_printable       ; >=32 -> печатаемый/UDG
            cpi  00Dh                ; CR
            jz   npa_cr
            cpi  PR_AT
            jz   npa_set_at
            cpi  PR_TAB
            jz   npa_set_tab
            cpi  PR_INK
            jz   npa_set1
            cpi  PR_PAPER
            jz   npa_set1
            cpi  PR_FLASH
            jz   npa_set1
            cpi  PR_BRIGHT
            jz   npa_set1
            cpi  PR_INVERSE
            jz   npa_set1
            cpi  PR_OVER
            jz   npa_set1
            ret                     ; неизвестный контрол-код (<32) — игнорируем
npa_set_at:
            sta  pr_code
            mvi  a,2
            sta  pr_pending
            ; настоящее ПЗУ пересчитывает ATTR_T из ATTR_P перед каждой новой
            ; последовательностью печати (аналог TEMPS) — воспроизведено здесь,
            ; привязано к самому частому наблюдаемому триггеру (AT), а не к
            ; точному месту вызова в настоящем ПЗУ (не найдено статическим
            ; сканом — вероятно, внутренний вызов PR-ALL, не CALL из игры).
            lda  ATTR_P
            sta  ATTR_T2
            xra  a
            sta  MASK_T             ; сброс маски прозрачности — по умолчанию всё перезаписывается
            ret
npa_set_tab:
            sta  pr_code
            mvi  a,2
            sta  pr_pending
            ret
npa_set1:
            sta  pr_code
            mvi  a,1
            sta  pr_pending
            ret
npa_cr:
            xra  a
            sta  pr_col
            lda  pr_line
            inr  a
            cpi  24
            jc   npa_cr_store
            xra  a
npa_cr_store:
            sta  pr_line
            ret

; --- обработка байта-параметра текущего контрол-кода ---
npa_param:
            lhld sv_af
            mov  b,h                ; B = очередной байт-параметр
            lda  pr_pending
            dcr  a
            sta  pr_pending
            lda  pr_code
            cpi  PR_AT
            jz   npa_p_at
            cpi  PR_TAB
            jz   npa_p_ignore        ; TAB — не поддерживаем позиционирование по пикселю, просто съедаем байты
            cpi  PR_INK
            jz   npa_p_ink
            cpi  PR_PAPER
            jz   npa_p_paper
            cpi  PR_BRIGHT
            jz   npa_p_bright
            cpi  PR_FLASH
            jz   npa_p_flash
            ret                     ; INVERSE/OVER — параметр принят, эффект не реализован
npa_p_ignore:
            ret
npa_p_at:
            lda  pr_pending
            ora  a
            jnz  npa_p_at_row       ; pr_pending был 2 перед декрементом? нет — уже декрементирован выше
            ; сюда попадаем когда pr_pending стал 0 -> это ВТОРОЙ параметр (col)
            mov  a,b
            cpi  32
            jc   npa_p_at_col_ok
            mvi  a,31
npa_p_at_col_ok:
            sta  pr_col
            lda  pr_at_row
            sta  pr_line
            ret
npa_p_at_row:
            ; pr_pending==1 после декремента -> это ПЕРВЫЙ параметр (row)
            mov  a,b
            cpi  24
            jc   npa_p_at_row_ok
            mvi  a,23
npa_p_at_row_ok:
            sta  pr_at_row
            ret
npa_p_ink:
            mov  a,b
            cpi  8
            jnc  npa_p_ink_transp    ; 8/9 = "не менять" (прозрачно) — см. ниже
            lda  ATTR_T2
            ani  0F8h
            ora  b
            sta  ATTR_T2
            lda  MASK_T              ; явный INK задан -> перестаём сохранять старые ink-биты экрана
            ani  0F8h
            sta  MASK_T
            ret
npa_p_ink_transp:
            lda  MASK_T              ; INK 8/9 -> помечаем ink-биты как "сохранить существующий атрибут"
            ori  007h
            sta  MASK_T
            ret
npa_p_paper:
            mov  a,b
            cpi  8
            jnc  npa_p_paper_transp
            mov  a,b
            add  a
            add  a
            add  a                  ; A = n<<3
            mov  c,a
            lda  ATTR_T2
            ani  0C7h
            ora  c
            sta  ATTR_T2
            lda  MASK_T              ; явный PAPER задан -> перестаём сохранять старые paper-биты
            ani  0C7h
            sta  MASK_T
            ret
npa_p_paper_transp:
            lda  MASK_T              ; PAPER 8/9 -> сохранить существующие paper-биты (найдено эмпирически:
            ori  038h                ; формула ((old XOR ATTR_T) AND MASK_T) XOR ATTR_T с MASK_T=0x38
            sta  MASK_T              ; точно воспроизводит настоящий ПЗУ на экране "Fase 01")
            ret
npa_p_bright:
            mov  a,b
            cpi  2
            jnc  npa_p_bright_done   ; только 0/1 поддержаны
            ora  a
            lda  ATTR_T2
            jz   npa_p_bright_off
            ori  040h
            sta  ATTR_T2
            ret
npa_p_bright_off:
            ani  0BFh
            sta  ATTR_T2
npa_p_bright_done:
            ret
npa_p_flash:
            mov  a,b
            cpi  2
            jnc  npa_p_flash_done
            ora  a
            lda  ATTR_T2
            jz   npa_p_flash_off
            ori  080h
            sta  ATTR_T2
            ret
npa_p_flash_off:
            ani  07Fh
            sta  ATTR_T2
npa_p_flash_done:
            ret

ATTR_P  equ 05C8Dh   ; постоянный атрибут (меняется только BASIC-командами INK/PAPER, не встроенными кодами в PRINT-строке)
ATTR_T2 equ 05C8Fh   ; временный атрибут — INK/PAPER/BRIGHT/FLASH в PRINT-строке правят ЕГО, не постоянный ATTR_P (подтверждено сравнением с настоящим ПЗУ)
MASK_T  equ 05C90h   ; маска прозрачности для ATTR_T (бит=1 -> сохранить старый бит экрана, см. npa_printable)
pr_tmp: db 0         ; scratch для формулы атрибута

; --- печатаемый символ: нарисовать глиф из шрифта ПЗУ, продвинуть курсор ---
npa_printable:
            cpi  090h                ; UDG начинаются с кода 144 (0x90)
            jnc  npa_maybe_udg
            cpi  080h
            jnc  npa_advance         ; 128-143 блок-графика — не реализовано, просто продвигаем курсор
            sui  020h                ; A = код-32 (индекс глифа 0-95 в шрифте ПЗУ)
            lxi  d,pr_font
            jmp  npa_glyph_common
npa_maybe_udg:
            cpi  0A5h                ; коды выше 164 — неизвестно, просто продвигаем курсор
            jnc  npa_advance
            sui  090h                ; A = код-144 (индекс UDG 0-20)
            lhld 05C7Bh              ; HL = UDG (системная переменная — указатель на пользовательскую графику; LHLD не трогает A)
            xchg                     ; DE = указатель UDG
npa_glyph_common:
            mvi  h,0
            mov  l,a
            dad  h
            dad  h
            dad  h                   ; HL = индекс*8
            dad  d                   ; HL = адрес байтов глифа (шрифт ПЗУ либо UDG-таблица)
            shld npa_fontptr
            lda  pr_line
            mov  e,a
            mvi  d,0
            lxi  h,pr_linebase
            dad  d
            dad  d
            mov  e,m
            inx  h
            mov  d,m                 ; DE = базовый адрес экрана для (line,col=0)
            lda  pr_col
            add  e
            mov  e,a                 ; DE += col (безопасно: col<32 не переносит в старший байт)
            xchg                     ; HL = адрес экрана (то, что было в DE)
            shld npa_scrptr
            lhld npa_fontptr
            mvi  b,8
npa_draw_row:
            mov  a,m                 ; A = очередной байт глифа
            inx  h
            shld npa_fontptr
            lhld npa_scrptr
            mov  m,a                 ; записать байт глифа в экран
            mov  a,h
            inr  a
            mov  h,a                 ; HL += 0x100 (следующая из 8 строк символа)
            shld npa_scrptr
            lhld npa_fontptr
            dcr  b
            jnz  npa_draw_row
            ; атрибут
            lda  pr_line
            mov  e,a
            mvi  d,0
            lxi  h,pr_attrbase
            dad  d
            dad  d
            mov  e,m
            inx  h
            mov  d,m
            lda  pr_col
            add  e
            mov  e,a
            ; Итоговый атрибут — НЕ прямая копия ATTR_T! Настоящее ПЗУ (PO-ATTR,
            ; ~0x0BDB) считает: new=((old XOR ATTR_T) AND MASK_T) XOR ATTR_T —
            ; классическая маска прозрачности: там, где MASK_T=1, старый бит
            ; экрана СОХРАНЯЕТСЯ (INK/PAPER 8 = "не менять"), где MASK_T=0 —
            ; берётся ATTR_T. Без этой формулы PAPER 8 не работал: старый бит
            ; экрана игнорировался, вместо этого просвечивал ATTR_T (найдено
            ; на экране "Fase 01": экран должен быть чёрным, показывал жёлтый).
            xchg                     ; HL = адрес атрибута (было в DE)
            mov  b,m                 ; B = существующий (старый) атрибут экрана
            lda  ATTR_T2
            mov  c,a                 ; C = ATTR_T
            xra  b                   ; A = ATTR_T XOR old
            sta  pr_tmp
            lda  MASK_T
            mov  d,a                 ; D = MASK_T
            lda  pr_tmp
            ana  d                   ; A = (ATTR_T XOR old) AND MASK_T
            xra  c                   ; A = итоговый атрибут
            mov  m,a
npa_advance:
            lda  pr_col
            inr  a
            cpi  32
            jc   npa_advance_store
            xra  a
            lda  pr_line
            inr  a
            cpi  24
            jc   npa_advance_line
            xra  a
npa_advance_line:
            sta  pr_line
            xra  a
npa_advance_store:
            sta  pr_col
            ret

npa_fontptr: dw 0
npa_scrptr:  dw 0

pr_linebase:
            dw 04000h,04020h,04040h,04060h,04080h,040A0h,040C0h,040E0h
            dw 04800h,04820h,04840h,04860h,04880h,048A0h,048C0h,048E0h
            dw 05000h,05020h,05040h,05060h,05080h,050A0h,050C0h,050E0h
pr_attrbase:
            dw 05800h,05820h,05840h,05860h,05880h,058A0h,058C0h,058E0h
            dw 05900h,05920h,05940h,05960h,05980h,059A0h,059C0h,059E0h
            dw 05A00h,05A20h,05A40h,05A60h,05A80h,05AA0h,05AC0h,05AE0h
pr_font:
            db 000h,000h,000h,000h,000h,000h,000h,000h,000h,010h,010h,010h,010h,000h,010h,000h
            db 000h,024h,024h,000h,000h,000h,000h,000h,000h,024h,07Eh,024h,024h,07Eh,024h,000h
            db 000h,008h,03Eh,028h,03Eh,00Ah,03Eh,008h,000h,062h,064h,008h,010h,026h,046h,000h
            db 000h,010h,028h,010h,02Ah,044h,03Ah,000h,000h,008h,010h,000h,000h,000h,000h,000h
            db 000h,004h,008h,008h,008h,008h,004h,000h,000h,020h,010h,010h,010h,010h,020h,000h
            db 000h,000h,014h,008h,03Eh,008h,014h,000h,000h,000h,008h,008h,03Eh,008h,008h,000h
            db 000h,000h,000h,000h,000h,008h,008h,010h,000h,000h,000h,000h,03Eh,000h,000h,000h
            db 000h,000h,000h,000h,000h,018h,018h,000h,000h,000h,002h,004h,008h,010h,020h,000h
            db 000h,03Ch,046h,04Ah,052h,062h,03Ch,000h,000h,018h,028h,008h,008h,008h,03Eh,000h
            db 000h,03Ch,042h,002h,03Ch,040h,07Eh,000h,000h,03Ch,042h,00Ch,002h,042h,03Ch,000h
            db 000h,008h,018h,028h,048h,07Eh,008h,000h,000h,07Eh,040h,07Ch,002h,042h,03Ch,000h
            db 000h,03Ch,040h,07Ch,042h,042h,03Ch,000h,000h,07Eh,002h,004h,008h,010h,010h,000h
            db 000h,03Ch,042h,03Ch,042h,042h,03Ch,000h,000h,03Ch,042h,042h,03Eh,002h,03Ch,000h
            db 000h,000h,000h,010h,000h,000h,010h,000h,000h,000h,010h,000h,000h,010h,010h,020h
            db 000h,000h,004h,008h,010h,008h,004h,000h,000h,000h,000h,03Eh,000h,03Eh,000h,000h
            db 000h,000h,010h,008h,004h,008h,010h,000h,000h,03Ch,042h,004h,008h,000h,008h,000h
            db 000h,03Ch,04Ah,056h,05Eh,040h,03Ch,000h,000h,03Ch,042h,042h,07Eh,042h,042h,000h
            db 000h,07Ch,042h,07Ch,042h,042h,07Ch,000h,000h,03Ch,042h,040h,040h,042h,03Ch,000h
            db 000h,078h,044h,042h,042h,044h,078h,000h,000h,07Eh,040h,07Ch,040h,040h,07Eh,000h
            db 000h,07Eh,040h,07Ch,040h,040h,040h,000h,000h,03Ch,042h,040h,04Eh,042h,03Ch,000h
            db 000h,042h,042h,07Eh,042h,042h,042h,000h,000h,03Eh,008h,008h,008h,008h,03Eh,000h
            db 000h,002h,002h,002h,042h,042h,03Ch,000h,000h,044h,048h,070h,048h,044h,042h,000h
            db 000h,040h,040h,040h,040h,040h,07Eh,000h,000h,042h,066h,05Ah,042h,042h,042h,000h
            db 000h,042h,062h,052h,04Ah,046h,042h,000h,000h,03Ch,042h,042h,042h,042h,03Ch,000h
            db 000h,07Ch,042h,042h,07Ch,040h,040h,000h,000h,03Ch,042h,042h,052h,04Ah,03Ch,000h
            db 000h,07Ch,042h,042h,07Ch,044h,042h,000h,000h,03Ch,040h,03Ch,002h,042h,03Ch,000h
            db 000h,0FEh,010h,010h,010h,010h,010h,000h,000h,042h,042h,042h,042h,042h,03Ch,000h
            db 000h,042h,042h,042h,042h,024h,018h,000h,000h,042h,042h,042h,042h,05Ah,024h,000h
            db 000h,042h,024h,018h,018h,024h,042h,000h,000h,082h,044h,028h,010h,010h,010h,000h
            db 000h,07Eh,004h,008h,010h,020h,07Eh,000h,000h,00Eh,008h,008h,008h,008h,00Eh,000h
            db 000h,000h,040h,020h,010h,008h,004h,000h,000h,070h,010h,010h,010h,010h,070h,000h
            db 000h,010h,038h,054h,010h,010h,010h,000h,000h,000h,000h,000h,000h,000h,000h,0FFh
            db 000h,01Ch,022h,078h,020h,020h,07Eh,000h,000h,000h,038h,004h,03Ch,044h,03Ch,000h
            db 000h,020h,020h,03Ch,022h,022h,03Ch,000h,000h,000h,01Ch,020h,020h,020h,01Ch,000h
            db 000h,004h,004h,03Ch,044h,044h,03Ch,000h,000h,000h,038h,044h,078h,040h,03Ch,000h
            db 000h,00Ch,010h,018h,010h,010h,010h,000h,000h,000h,03Ch,044h,044h,03Ch,004h,038h
            db 000h,040h,040h,078h,044h,044h,044h,000h,000h,010h,000h,030h,010h,010h,038h,000h
            db 000h,004h,000h,004h,004h,004h,024h,018h,000h,020h,028h,030h,030h,028h,024h,000h
            db 000h,010h,010h,010h,010h,010h,00Ch,000h,000h,000h,068h,054h,054h,054h,054h,000h
            db 000h,000h,078h,044h,044h,044h,044h,000h,000h,000h,038h,044h,044h,044h,038h,000h
            db 000h,000h,078h,044h,044h,078h,040h,040h,000h,000h,03Ch,044h,044h,03Ch,004h,006h
            db 000h,000h,01Ch,020h,020h,020h,020h,000h,000h,000h,038h,040h,038h,004h,078h,000h
            db 000h,010h,038h,010h,010h,010h,00Ch,000h,000h,000h,044h,044h,044h,044h,038h,000h
            db 000h,000h,044h,044h,028h,028h,010h,000h,000h,000h,044h,054h,054h,054h,028h,000h
            db 000h,000h,044h,028h,010h,028h,044h,000h,000h,000h,044h,044h,044h,03Ch,004h,038h
            db 000h,000h,07Ch,008h,010h,020h,07Ch,000h,000h,00Eh,008h,030h,008h,008h,00Eh,000h
            db 000h,008h,008h,008h,008h,008h,008h,000h,000h,070h,010h,00Ch,010h,010h,070h,000h
            db 000h,014h,028h,000h,000h,000h,000h,000h,03Ch,042h,099h,0A1h,0A1h,099h,042h,03Ch
#endif

; ============================================================================
; dispatch by KIND
; ============================================================================
bs_dispatch:
            lda  sv_kind
            ; KIND 0..15 handled; >=16 -> unimpl
            cpi  16
            jnc  z80_unimpl
            ; jump table:  HL = kind_table + kind*2 ; load addr ; PCHL
            mov  e,a
            mvi  d,0
            lxi  h,kind_table
            dad  d
            dad  d                  ; HL = kind_table + 2*kind
            mov  e,m
            inx  h
            mov  d,m                ; DE = handler addr
            xchg                    ; HL = handler addr
            pchl

kind_table:
            dw   h_jr_uncond        ; 0 JR_UNCOND
            dw   h_jr_nz            ; 1 JR_NZ
            dw   h_jr_z             ; 2 JR_Z
            dw   h_jr_nc            ; 3 JR_NC
            dw   h_jr_c             ; 4 JR_C
            dw   h_djnz             ; 5 DJNZ
            dw   h_cb               ; 6 CB
            dw   h_ed               ; 7 ED
            dw   h_ixiy_dd          ; 8 IXIY_DD
            dw   h_ixiy_fd          ; 9 IXIY_FD
            dw   h_exx              ; 10 EXX
            dw   h_exaf             ; 11 EXAF
            dw   h_ei               ; 12 EI_OP  (shadow INTE := 1, real EI)
            dw   h_di               ; 13 DI_OP  (shadow INTE := 0, real DI)
            dw   h_jr_self          ; 14 JR_SELF (idle wait -> EI;HLT, see h_jr_self)
            dw   h_safe_sphl        ; 15 SAFE_SPHL (see h_safe_sphl)

; ============================================================================
; helpers
; ----------------------------------------------------------------------------
; compute_target: target = (r+1) + signext8( byte[r] )  -> sv_target
;   r = sv_ret (= S+1), byte[r] is the displacement dd (the preserved tail).
; ----------------------------------------------------------------------------
compute_target:
            lhld sv_ret            ; HL = r
            mov  e,m               ; E = dd (displacement)  (byte[r])
            inx  h                 ; HL = r+1  (= base for relative)
            ; sign-extend E -> D
            mvi  d,0
            mov  a,e
            ora  a
            jp   ct_pos            ; if bit7 clear, D=0
            mvi  d,0FFh
ct_pos:
            dad  d                 ; HL = (r+1) + signext(dd)
            shld sv_target
            ret

; fall_through: sv_target = r+1  (next instruction after the 2-byte op)
set_fallthrough:
            lhld sv_ret            ; HL = r
            inx  h                 ; HL = r+1
            shld sv_target
            ret

; ============================================================================
; handlers
; ============================================================================
h_jr_uncond:
            call compute_target
            jmp  finish

; --- JRcc: test SAVED program flags; taken -> compute_target else fallthrough
h_jr_nz:                            ; jump if Z flag == 0
            call test_z
            jz   jr_taken           ; A(Z)==0 -> taken
            jmp  jr_nottaken
h_jr_z:                             ; jump if Z flag == 1
            call test_z
            jnz  jr_taken           ; A!=0 means Z set -> taken
            jmp  jr_nottaken
h_jr_nc:                            ; jump if CY == 0
            call test_cy
            jz   jr_taken           ; A(CY)==0 -> taken
            jmp  jr_nottaken
h_jr_c:                             ; jump if CY == 1
            call test_cy
            jnz  jr_taken           ; CY set -> taken
            jmp  jr_nottaken

jr_taken:
            call compute_target
            jmp  finish
jr_nottaken:
            call set_fallthrough
            jmp  finish

; test_z:  A := saved-Z-flag (0 or nonzero), Z80/8080 flags bit 6 = Z
test_z:
            lhld sv_af             ; H=A, L=F
            mov  a,l
            ani  040h              ; Z flag mask (bit 6)
            ret
; test_cy: A := saved-CY-flag (bit 0)
test_cy:
            lhld sv_af
            mov  a,l
            ani  001h              ; CY flag mask (bit 0)
            ret

; --- DJNZ: B := B-1 (real); if B != 0 -> taken else fallthrough.
;     flags of program must be left = saved flags (we restore them anyway).
h_djnz:
            lhld sv_bc             ; H=B, L=C
            dcr  h                 ; B := B-1
            shld sv_bc             ; store decremented B back
            mov  a,h
            ora  a                 ; set Z if B==0  (scratch, discarded on restore)
            jz   jr_nottaken       ; B==0 -> fall through
            call compute_target
            jmp  finish

; ============================================================================
; h_jr_self — KIND JR_SELF: the game's interrupts-enabled idle wait (Task 15d).
; ----------------------------------------------------------------------------
; THE LIVE STARVATION FIX (root cause: vector06js oneInterrupt).
;
; The game's idle wait is a single `EI; JR $` (the JR-to-self at sv_site).  On
; real Z80 this spins with iff=true, so the 50 Hz vblank is caught.  In our port
; the self-JR is trapped; a normal JR handler does the dispatcher's hard DI, so
; iff=false for ~the whole idle window.  vector06js delivers the vblank ONLY when
; (CPU.iff && filler.irq) is true AT the scanline moment and does NOT latch it
; (oneInterrupt: `this.irq = this.CPU.iff && this.filler.irq;`).  With iff=false
; during idle the vblank window passes -> the interrupt is LOST -> the ISR never
; runs -> frozen/garbage.  No EI-delay in finish helps (those iff windows don't
; coincide with the scanline).
;
; vector06js EXPLICITLY supports HLT for interrupt-wait (checkInterrupt: if
; last_opcode==0x76 it does pc+=1 then RST7).  So the idle wait must become an
; interrupts-enabled HALT:
;   - restore ALL program registers (exactly as finish does);
;   - real EI (the idle wait is ALWAYS interrupts-enabled; iff MUST be true so
;     the vblank scanline is caught — this deliberately does NOT stay DI-masked,
;     the dispatcher's entry DI is cleared here);
;   - HLT (CPU halts with iff=true; at the scanline filler.irq && iff -> irq=true
;     -> checkInterrupt accepts, sees last_opcode==HLT, does pc+1 + RST7 -> ISR);
;   - after the HLT (the instruction the ISR returns to), JMP back to the self-JR
;     site so the next idle traps here and HALTs again.
;
; The JMP-back operand is patched from sv_site now, while scratch is still free.
; The Z80.js Tier-1 core also supports HALT (halts until interrupt; the harness
; fires the per-frame interrupt which un-halts), so Tier-1 stays functional and
; the per-frame ISR draws identically -> the frame diff still matches.
; ============================================================================
h_jr_self:
            ; The displacement at (sv_ret) may have been SELF-MODIFIED since
            ; classification.  Classification is a static snapshot check
            ; ("does this JR currently target itself?"); some games reuse the
            ; identical byte pattern as a dynamically-patched branch (e.g. a
            ; cheap 2/3-way switch toggled by foreground code) that only
            ; TRANSIENTLY reads as self-targeting.  Re-resolve the CURRENT
            ; target from the live byte before committing to the idle wait:
            ; if it still targets itself, this really is the EI;JR$ idiom and
            ; we take the EI;HLT path unchanged; otherwise treat it exactly
            ; like a plain unconditional JR to wherever it now points.
            call compute_target     ; sv_target = (r+1) + signext(CURRENT byte[r])
            lhld sv_target
            xchg                    ; DE = target
            lhld sv_site            ; HL = site
            mov  a,l
            sub  e
            jnz  h_jr_self_diff
            mov  a,h
            sub  d
            jnz  h_jr_self_diff
            ; still self-targeting -> idle EI;HLT wait (unchanged behaviour)
            ; patch the trailing JMP-back operand = sv_site (HL == sv_site here)
            shld jrself_jmp+1
            ; --- restore ALL program registers (same order as finish) ---
            lhld sv_bc
            mov  b,h
            mov  c,l
            lhld sv_de
            mov  d,h
            mov  e,l
            lhld sv_af             ; H=A, L=F
            push h
            pop  psw               ; restore A,F
            lhld sv_hl             ; restore HL last
            ; --- interrupts-enabled HALT wait ---
            ; EI clears the dispatcher's DI: iff becomes true so the vblank
            ; scanline is caught while the CPU is halted.
            ei
            hlt                    ; halt until vblank; checkInterrupt: pc+1 + RST7
            ; ISR ran and returned here.  Loop back to the self-JR site so the
            ; next idle re-enters this handler and HALTs again.
jrself_jmp:
            jmp  0                 ; operand patched to sv_site

h_jr_self_diff:
            ; self-modified away from self-target: sv_target already holds
            ; the resolved live target (computed above) -> plain unconditional
            ; jump, same exit path as h_jr_uncond.
            jmp  finish

; ============================================================================
; FINISH_EI_DELAY — number of NOP instructions inserted AFTER the conditional EI
; and BEFORE the resume JMP in finish / finish_reti (Task 15c).
; ----------------------------------------------------------------------------
; THE STARVATION FIX.  vector06js interrupt semantics (confirmed): EI sets
; iff_pending=2; each execute() decrements it; iff becomes true when it hits 0.
; checkInterrupt accepts when (irq && iff), and irq (the 50 Hz vblank) is LATCHED
; until accepted.  So we only need iff=true for ONE step while irq is latched.
;
; Pre-15a bug: `EI; JMP target` put the EI right next to the JMP, so iff_pending
; counted down to 0 only AFTER re-entering the program — and the program's idle
; "EI; JR $" is a trapped JR, so the dispatcher's DI fired before iff ever went
; true OUTSIDE a handler -> the latched vblank never had an accept window -> the
; interrupt starved.
;
; Fix: after restoring ALL program registers and issuing the conditional EI, burn
; FINISH_EI_DELAY extra instructions (NOPs — they touch NO register/scratch, the
; program state is already fully restored) so iff_pending(=2) reaches 0 and iff
; turns true WHILE PC is still here in finish, with registers already = program
; values.  A latched vblank is then accepted at this clean boundary, BEFORE the
; JMP returns to the game / next trap.  This cures the starvation while keeping
; handler bodies atomic (the body ran under the dispatcher's DI).
;
; Default 2 (EI's iff_pending=2 needs 2 post-EI steps to reach iff=true).  Easily
; tunable: the controller may raise it if vector06js needs a wider accept window.
; (The equ itself is defined EARLY, just after `org RUNTIME_ORG`, so the lean
; EXAF/EXX paths can use it in pass 1.)
; ============================================================================

; ============================================================================
; finish — restore program context, jump to sv_target
; ============================================================================
finish:
            ; --- push the resume target so the exit is a plain RET (Task 16) ----
            ; SP == program SP here (DI-atomic).  Pushing sv_target makes the
            ; trailing RET pop it into PC with SP back at program SP, so we avoid
            ; self-modifying a JMP operand on every trap (the old `lhld sv_target;
            ; shld finish_jmp+1`).  The push/pop pairs below are stack-balanced,
            ; and the target sits ABOVE SP during the EI window so a vblank that
            ; fires there leaves it untouched.
            lhld sv_target
            push h                 ; [SP] = resume target ; SP = program SP - 2
            ; --- restore the program's INTE (interrupt-safe trap runtime) -------
            ; The dispatcher entered with a hard DI.  On exit we must put INTE
            ; back to what the program had (prog_inte), NOT force it on: the game
            ; runs trapped ops inside its own DI critical sections, where an
            ; unconditional EI would reopen the interrupt window mid-section and
            ; corrupt state.
            ;
            ; The exit code is `<EI-or-NOP>; <FINISH_EI_DELAY NOPs>; RET`.  We
            ; self-modify the slot at finish_ei to EI (0xFB) when prog_inte=1,
            ; else NOP (0x00).  The EI MUST come AFTER all registers are restored,
            ; and the NOP delay (see FINISH_EI_DELAY) lets vector06js's iff_pending
            ; count down to 0 -> iff true while PC is still here -> the latched
            ; vblank is accepted at this clean boundary (cures starvation).
            ; This patch is done now, while scratch registers are still free.
            lda  prog_inte
            ora  a
            mvi  a,000h            ; default: NOP (interrupts stay disabled)
            jz   fin_patch
            mvi  a,0FBh            ; prog_inte=1 -> EI opcode
fin_patch:
            sta  finish_ei
            lhld sv_bc
            mov  b,h
            mov  c,l
            lhld sv_de
            mov  d,h
            mov  e,l
            lhld sv_af             ; H=A, L=F
            push h
            pop  psw               ; restore A,F  (stack-balanced)
            lhld sv_hl             ; restore HL (last, so HL is program value)
finish_ei:
            db   000h             ; self-modified: EI (0xFB) if prog_inte else NOP
            ; --- EI accept-window delay (Task 15c): registers already restored;
            ;     NOPs let iff_pending reach 0 so a latched vblank is accepted
            ;     HERE, at a clean boundary, before RET returns control. ---
            rept FINISH_EI_DELAY
            nop
            endm
            ret                   ; pop resume target -> PC ; SP = program SP

; ============================================================================
; finish_reti — like finish but also sets the real SP to sv_newsp.
; Used by RETI/RETN to advance the program stack pointer by 2.
; Sequence: restore BC/DE/AF, then LHLD sv_newsp; SPHL sets real SP,
; then LHLD sv_hl restores HL, then JMP (self-modified) to sv_target.
; ============================================================================
finish_reti:
            lhld sv_target
            shld finish_reti_jmp+1 ; self-modify JMP operand
            ; restore program INTE on exit (see `finish` for full rationale):
            ; patch the finish_reti_ei slot to EI (0xFB) if prog_inte else NOP.
            lda  prog_inte
            ora  a
            mvi  a,000h
            jz   finr_patch
            mvi  a,0FBh
finr_patch:
            sta  finish_reti_ei
            lhld sv_bc
            mov  b,h
            mov  c,l
            lhld sv_de
            mov  d,h
            mov  e,l
            lhld sv_af             ; H=A, L=F
            push h
            pop  psw               ; restore A,F
            lhld sv_newsp          ; HL = new program SP (prog_SP+2)
            sphl                   ; real SP = new program SP
            lhld sv_hl             ; restore HL (last)
finish_reti_ei:
            db   000h             ; self-modified: EI (0xFB) if prog_inte else NOP
            ; --- EI accept-window delay (Task 15c); see finish for rationale. ---
            rept FINISH_EI_DELAY
            nop
            endm
finish_reti_jmp:
            jmp  0                 ; operand patched to sv_target

; ============================================================================
; h_cb — handle Z80 CB-prefix bit operations (Task 8v2)
; ============================================================================
; Site layout:  [RST 0x10 at S] [cb_sub at S+1]
;   sv_ret = r = S+1 = address of cb_sub byte
;   Resume address = r+1 = S+2  (set_fallthrough gives r+1)
;
; cb_sub decode:
;   bits[7:6] = group:  00=rot/shift  01=BIT  10=RES  11=SET
;   bits[5:3] = op_code (group 00) or bit-number b (groups 01/10/11)
;   bits[2:0] = reg_code: 0=B 1=C 2=D 3=E 4=H 5=L 6=(HL) 7=A
;
; Saved-register byte layout — SHLD stores L at word_addr, H at word_addr+1:
;   sv_af:  [sv_af+0]=F  [sv_af+1]=A
;   sv_bc:  [sv_bc+0]=C  [sv_bc+1]=B
;   sv_de:  [sv_de+0]=E  [sv_de+1]=D
;   sv_hl:  [sv_hl+0]=L  [sv_hl+1]=H
;
; 8080 PSW F bits: 7=S 6=Z 4=AC 2=P 1=1(always) 0=CY
;
; Private scratch cells:
cb_sub_b:   db   0       ; CB sub-opcode
cb_val_b:   db   0       ; operand value read from reg/mem
cb_res_b:   db   0       ; computed result (rot/shift/RES/SET)
cb_cy_b:    db   0       ; CY_out for rot/shift (0 or 1)

; ============================================================================
; cb_regaddr: reg_code in A (bits[2:0], already masked) ->
;             HL = address of saved byte in sv_* area.
; NOTE: reg_code 6 (HL) must NOT be passed here; handle before calling.
; Destroys A, DE, HL.
; ============================================================================
cb_regaddr:
            ; A = reg_code 0..7 (6 is the (HL) case, handled by caller)
            mov  e,a
            mvi  d,0
            lxi  h,cb_reg_tab
            dad  d
            dad  d                  ; HL = cb_reg_tab + 2*reg_code
            mov  e,m
            inx  h
            mov  d,m                ; DE = target address from table
            xchg                    ; HL = target address
            ret

cb_reg_tab:
            dw  sv_bc+1             ; 0=B  hi byte of sv_bc word
            dw  sv_bc+0             ; 1=C  lo byte of sv_bc word
            dw  sv_de+1             ; 2=D
            dw  sv_de+0             ; 3=E
            dw  sv_hl+1             ; 4=H
            dw  sv_hl+0             ; 5=L
            dw  sv_hl               ; 6=(HL) — sentinel, caller must intercept
            dw  sv_af+1             ; 7=A

; ============================================================================
h_cb:
; ---- read cb_sub ----
            lhld sv_ret             ; HL = r = address of cb_sub byte
            mov  a,m
            sta  cb_sub_b

; ---- read operand into cb_val_b ----
            ani  007h               ; A = reg_code
            cpi  006h
            jnz  hcb_reg_read
            ; reg=6: operand is mem[(sv_hl)]
            lhld sv_hl              ; HL = Z80 HL (program's HL address)
            mov  a,m                ; A = mem[HL]
            jmp  hcb_got_val
hcb_reg_read:
            lda  cb_sub_b
            ani  007h
            call cb_regaddr         ; HL = address of saved register byte
            mov  a,m                ; A = register value
hcb_got_val:
            sta  cb_val_b

; ---- dispatch by group bits[7:6] ----
            lda  cb_sub_b
            ani  0C0h
            jz   hcb_rot            ; 00 = rotate/shift
            cpi  040h
            jz   hcb_bit            ; 01 = BIT
            cpi  080h
            jz   hcb_res            ; 10 = RES
            jmp  hcb_set            ; 11 = SET

; ============================================================
; GROUP 00 — rotate / shift
; op_code = (cb_sub >> 3) & 7:
;   0=RLC  1=RRC  2=RL  3=RR  4=SLA  5=SRA  6=SLL*  7=SRL
;
; Each sub-handler sets:
;   A       = 8-bit result
;   cb_cy_b = CY output (0 or 1)
; Then jumps to hcb_rot_done.
; ============================================================
hcb_rot:
            lda  cb_sub_b
            rrc                     ; shift right 3 positions to get op_code
            rrc
            rrc
            ani  007h               ; A = op_code (0..7)
            cpi  0
            jz   hcb_do_rlc
            cpi  1
            jz   hcb_do_rrc
            cpi  2
            jz   hcb_do_rl
            cpi  3
            jz   hcb_do_rr
            cpi  4
            jz   hcb_do_sla
            cpi  5
            jz   hcb_do_sra
            cpi  6
            jz   hcb_do_sll
            jmp  hcb_do_srl         ; op=7

; ---- RLC: result=(val<<1)|(val>>7); CY_out=old_bit7 ----
hcb_do_rlc:
            lda  cb_val_b
            mov  b,a                ; B = val
            ani  080h               ; isolate bit7
            rlc                     ; shift bit7 to bit0 position
            ani  001h
            sta  cb_cy_b            ; CY_out = old_bit7
            mov  a,b
            rlc                     ; 8080 RLC: A = (val<<1)|(val>>7) circular
            jmp  hcb_rot_done

; ---- RRC: result=(val>>1)|(val<<7); CY_out=old_bit0 ----
hcb_do_rrc:
            lda  cb_val_b
            mov  b,a
            ani  001h               ; old_bit0
            sta  cb_cy_b
            mov  a,b
            rrc                     ; 8080 RRC: A=(val>>1)|(val<<7) circular = Z80 RRC
            jmp  hcb_rot_done

; ---- RL: result=(val<<1)|CY_in; CY_out=old_bit7 ----
hcb_do_rl:
            lda  cb_val_b
            mov  b,a                ; B = val
            ani  080h               ; isolate bit7 for CY_out
            rlc
            ani  001h
            sta  cb_cy_b            ; CY_out = old_bit7
            ; result = (val<<1) | CY_in
            lda  sv_af              ; F byte
            ani  001h               ; CY_in (bit0)
            mov  c,a                ; C = CY_in
            mov  a,b                ; A = val
            add  a                  ; A = val<<1 (bit0=0); 8080 CY = old_bit7 (irrelevant)
            ora  c                  ; set bit0 = CY_in
            jmp  hcb_rot_done

; ---- RR: result=(CY_in<<7)|(val>>1); CY_out=old_bit0 ----
hcb_do_rr:
            lda  cb_val_b
            ani  001h               ; old_bit0
            sta  cb_cy_b            ; CY_out
            ; result = (CY_in<<7) | (val>>1)
            lda  sv_af
            ani  001h               ; CY_in
            ; CY_in << 7: 0->0x00, 1->0x80
            ora  a                  ; test CY_in
            mvi  a,000h
            jz   hcb_rr_no_cy
            mvi  a,080h
hcb_rr_no_cy:
            mov  d,a                ; D = (CY_in << 7)
            lda  cb_val_b
            rrc                     ; 8080 RRC circular: A=(val>>1)|(val<<7)
            ani  07Fh               ; clear bit7 (logical right shift: bit7=0)
            ora  d                  ; OR in CY_in<<7
            jmp  hcb_rot_done

; ---- SLA: result=(val<<1); CY_out=old_bit7; bit0=0 ----
hcb_do_sla:
            lda  cb_val_b
            mov  b,a
            ani  080h               ; extract bit7
            rlc
            ani  001h
            sta  cb_cy_b            ; CY_out = old_bit7
            mov  a,b
            add  a                  ; A = val<<1 (bit0=0 naturally via ADD A)
            jmp  hcb_rot_done

; ---- SRA: result=(val>>1)|(val&0x80); CY_out=old_bit0 ----
hcb_do_sra:
            lda  cb_val_b
            ani  001h               ; old_bit0
            sta  cb_cy_b
            lda  cb_val_b
            mov  b,a
            ani  080h               ; sign bit
            mov  d,a                ; D = original sign bit (0x00 or 0x80)
            mov  a,b
            rrc                     ; 8080 RRC: A=(val>>1)|(val<<7)
            ani  07Fh               ; clear bit7 (remove rotation artefact)
            ora  d                  ; restore original sign bit
            jmp  hcb_rot_done

; ---- SLL (undocumented): result=(val<<1)|1; CY_out=old_bit7 ----
hcb_do_sll:
            lda  cb_val_b
            mov  b,a
            ani  080h
            rlc
            ani  001h
            sta  cb_cy_b
            mov  a,b
            add  a                  ; val<<1
            ori  001h               ; bit0 = 1 (SLL shifts in 1)
            jmp  hcb_rot_done

; ---- SRL: result=(val>>1) logical; CY_out=old_bit0 ----
hcb_do_srl:
            lda  cb_val_b
            ani  001h
            sta  cb_cy_b
            lda  cb_val_b
            rrc                     ; 8080 RRC circular
            ani  07Fh               ; clear bit7 (logical shift: bit7=0)
            jmp  hcb_rot_done

; ---- hcb_rot_done: A=result, cb_cy_b=CY_out ----
; Update sv_af: clear old CY (bit0) and Z (bit6), set new CY from cb_cy_b,
; set new Z = (result==0) -> bit6.
; Then write result to destination register/memory and finish.
hcb_rot_done:
            sta  cb_res_b           ; save result

            ; compute new Z bit: 0x40 if result==0, else 0
            ora  a                  ; test result
            mvi  b,000h
            jnz  hcb_rot_z0
            mvi  b,040h             ; Z flag bit = bit6
hcb_rot_z0:
            ; B = new Z-bit

            lda  sv_af              ; old F
            ani  0BEh               ; clear bit0(CY) and bit6(Z); 0xBE = ~0x41
            ora  b                  ; set new Z
            mov  b,a                ; B = F with new Z, CY=0

            lda  cb_cy_b            ; CY_out (0 or 1)
            ora  b                  ; set new CY (bit0)
            sta  sv_af              ; update F byte

            ; write result to destination register or memory
            lda  cb_sub_b
            ani  007h               ; reg_code
            cpi  006h
            jz   hcb_rot_wb_mem

            call cb_regaddr         ; HL = addr of saved register byte
            lda  cb_res_b
            mov  m,a

            call set_fallthrough
            jmp  finish

hcb_rot_wb_mem:
            lhld sv_hl              ; HL = Z80 program's HL address
            lda  cb_res_b
            mov  m,a

            call set_fallthrough
            jmp  finish

; ============================================================
; GROUP 01 — BIT b,r
; BIT b,r: Z = NOT(bit_b of val); CY unchanged; register unchanged.
; b = bits[5:3] of cb_sub.
;
; Uses a loop to compute mask = (1 << b).
; ============================================================
hcb_bit:
            ; extract bit number: b = (cb_sub >> 3) & 7
            lda  cb_sub_b
            rrc
            rrc
            rrc
            ani  007h               ; A = b (bit number)
            mov  b,a                ; B = shift count
            mvi  a,001h             ; start with mask = 1
hcb_bit_shl:
            mov  c,a                ; C = current mask
            mov  a,b
            ora  a                  ; test B==0
            mov  a,c                ; restore mask
            jz   hcb_bit_shifted
            add  a                  ; mask <<= 1
            dcr  b
            jmp  hcb_bit_shl
hcb_bit_shifted:
            ; A = (1 << b)
            mov  b,a                ; B = mask
            lda  cb_val_b
            ana  b                  ; Z80_Z=1 if bit clear (AND result=0), Z80_Z=0 if bit set

            ; Update F: set Z=1 if bit is clear (AND==0), Z=0 if bit is set (AND!=0)
            mvi  b,000h
            jnz  hcb_bit_nz         ; AND != 0 => bit is SET => Z80_Z=0 => clear bit6
            mvi  b,040h             ; AND == 0 => bit is CLEAR => Z80_Z=1 => set bit6
hcb_bit_nz:
            lda  sv_af
            ani  0BFh               ; clear bit6 (Z flag only)  [~0x40 & 0xFF = 0xBF]
            ora  b                  ; set new Z
            sta  sv_af

            ; register unchanged (BIT does not modify source)
            call set_fallthrough
            jmp  finish

; ============================================================
; GROUP 10 — RES b,r: result = val & ~(1<<b); flags unchanged
; ============================================================
hcb_res:
            ; b = (cb_sub >> 3) & 7
            lda  cb_sub_b
            rrc
            rrc
            rrc
            ani  007h
            mov  b,a
            mvi  a,001h
hcb_res_shl:
            mov  c,a
            mov  a,b
            ora  a
            mov  a,c
            jz   hcb_res_shifted
            add  a
            dcr  b
            jmp  hcb_res_shl
hcb_res_shifted:
            ; A = (1 << b)
            cma                     ; A = ~(1<<b)
            mov  b,a
            lda  cb_val_b
            ana  b                  ; result = val & ~(1<<b)
            sta  cb_res_b

            ; flags unchanged; write back result
            lda  cb_sub_b
            ani  007h
            cpi  006h
            jz   hcb_res_wb_mem

            call cb_regaddr
            lda  cb_res_b
            mov  m,a

            call set_fallthrough
            jmp  finish

hcb_res_wb_mem:
            lhld sv_hl
            lda  cb_res_b
            mov  m,a

            call set_fallthrough
            jmp  finish

; ============================================================
; GROUP 11 — SET b,r: result = val | (1<<b); flags unchanged
; ============================================================
hcb_set:
            ; b = (cb_sub >> 3) & 7
            lda  cb_sub_b
            rrc
            rrc
            rrc
            ani  007h
            mov  b,a
            mvi  a,001h
hcb_set_shl:
            mov  c,a
            mov  a,b
            ora  a
            mov  a,c
            jz   hcb_set_shifted
            add  a
            dcr  b
            jmp  hcb_set_shl
hcb_set_shifted:
            ; A = (1 << b)
            mov  b,a
            lda  cb_val_b
            ora  b                  ; result = val | (1<<b)
            sta  cb_res_b

            ; flags unchanged; write back result
            lda  cb_sub_b
            ani  007h
            cpi  006h
            jz   hcb_set_wb_mem

            call cb_regaddr
            lda  cb_res_b
            mov  m,a

            call set_fallthrough
            jmp  finish

hcb_set_wb_mem:
            lhld sv_hl
            lda  cb_res_b
            mov  m,a

            call set_fallthrough
            jmp  finish

; ============================================================================
; h_ed — handle Z80 ED-prefix instructions (Task 9v2)
; ============================================================================
; Site layout:  [RST 0x10 at S] [ed_sub at S+1] [optional extra bytes]
;   sv_ret = r = S+1 = address of ed_sub byte
;   Resume = r+1  (S+2) for 2-byte ED forms (most instructions)
;   Resume = r+3  (S+4) for 4-byte forms: LD (nn),dd / LD dd,(nn)
;     where ed_sub in {43,53,63,73,4B,5B,6B,7B} and nn is at r+1/r+2
;
; Register pair encoding (bits[5:4] of ed_sub for 16-bit ops):
;   00=BC  01=DE  10=HL  11=SP
;
; Private scratch cells:
ed_sub_b:   db   0          ; ED sub-opcode
ed_scratch: dw   0          ; 16-bit scratch: program SP captured at h_ed entry
ed_lo_b:    db   0          ; scratch low byte
ed_hi_b:    db   0          ; scratch high byte
ed_cyin:    db   0          ; CY_in stash for SBC/ADC HL,dd (separate from ed_scratch)
sv_newsp:   dw   0          ; new program SP for RETI/RETN (prog_SP+2)

; ============================================================================
; ed_regpair_get: bits[5:4] of ed_sub_b -> HL = 16-bit register pair value
;   from saved state.  Pair 00=BC 01=DE 10=HL 11=SP(read live).
; Result in HL.  Destroys A.
; ============================================================================
ed_regpair_get:
            lda  ed_sub_b
            rrc
            rrc
            rrc
            rrc
            ani  003h               ; A = pair code 0..3
            cpi  0
            jz   edpg_bc
            cpi  1
            jz   edpg_de
            cpi  2
            jz   edpg_hl
            ; pair=3: SP.  We don't have sv_sp; read actual SP.
            ; This is safe: the handler CALL frame is balanced,
            ; and the program SP is intact at this point.
            ; However SP currently points at our CALL return; load
            ; it with LHLD trick via the stack isn't easy.
            ; Use: mov h,SPH is not 8080. Use SPHL/XTHL approach.
            ; Easiest: write SP to a temp cell via PUSH trick.
            ; SP at entry to h_ed is program SP (dispatcher saved no SP).
            ; But we did CALL ed_regpair_get, so SP now = sp_prog-2.
            ; We just return (RET) from this sub, SP restores.
            ; Best approach: LHLD ed_scratch where we pre-stored SP.
            ; We store SP in ed_scratch at start of h_ed (see below).
            lhld ed_scratch         ; ed_scratch = saved program SP
            ret
edpg_bc:
            lhld sv_bc              ; HL = BC word (H=B, L=C)
            ret
edpg_de:
            lhld sv_de
            ret
edpg_hl:
            lhld sv_hl
            ret

; ============================================================================
; ed_regpair_set: store HL into the register pair indicated by bits[5:4] of
;   ed_sub_b.  Pair 00=BC 01=DE 10=HL 11=SP (ignored / warn).
; Destroys A, DE.
; ============================================================================
ed_regpair_set:
            lda  ed_sub_b
            rrc
            rrc
            rrc
            rrc
            ani  003h
            cpi  0
            jz   edps_bc
            cpi  1
            jz   edps_de
            cpi  2
            jz   edps_hl
            ; pair=3: SP — store to ed_scratch as placeholder (SP restore is hard)
            shld ed_scratch
            ret
edps_bc:
            shld sv_bc
            ret
edps_de:
            shld sv_de
            ret
edps_hl:
            shld sv_hl
            ret

; ============================================================================
; h_ed entry point
; ============================================================================
h_ed:
; Save program SP to ed_scratch (for SBC/ADC HL,SP / LD SP,... support).
; At this point: dispatcher has balanced PUSH PSW/POP HL/stack,
; and the program stack pointer is intact in the actual SP register.
; We capture it via a known-depth snapshot.
; Trick: SPHL gives us nothing. Instead do: PUSH H; MOV H,SP? No 8080 lacks that.
; Use: MVI to stack and read: also complex.
; Simple: SP points to our return address from h_ed CALL chain:
;   z80_dispatch: POP H (consumed r), then CALL ... eventually CALL h_ed?
; Actually h_ed is jumped to (PCHL), not called.  So SP = program SP exactly.
; Capture via dummy PUSH / immediate read:
            lxi  h,0
            dad  sp                 ; HL = SP (8080: DAD SP adds SP to HL=0)
            shld ed_scratch         ; ed_scratch = program SP

; Read ed_sub
            lhld sv_ret             ; HL = r = address of ed_sub byte
            mov  a,m
            sta  ed_sub_b

; Dispatch by ed_sub
; We use a chain of CPI comparisons grouped by category.

; ---- Block move: LDI A0, LDIR B0, LDD A8, LDDR B8 ----
            cpi  0A0h
            jz   hed_ldi
            cpi  0B0h
            jz   hed_ldir
            cpi  0A8h
            jz   hed_ldd
            cpi  0B8h
            jz   hed_lddr

; ---- Block compare: CPI A1, CPIR B1, CPD A9, CPDR B9 ----
            cpi  0A1h
            jz   hed_cpi
            cpi  0B1h
            jz   hed_cpir
            cpi  0A9h
            jz   hed_cpd
            cpi  0B9h
            jz   hed_cpdr

; ---- NEG: 44 ----
            cpi  044h
            jz   hed_neg

; ---- SBC HL,dd: 42/52/62/72 ----
            cpi  042h
            jz   hed_sbc_hl
            cpi  052h
            jz   hed_sbc_hl
            cpi  062h
            jz   hed_sbc_hl
            cpi  072h
            jz   hed_sbc_hl

; ---- ADC HL,dd: 4A/5A/6A/7A ----
            cpi  04Ah
            jz   hed_adc_hl
            cpi  05Ah
            jz   hed_adc_hl
            cpi  06Ah
            jz   hed_adc_hl
            cpi  07Ah
            jz   hed_adc_hl

; ---- LD (nn),dd: 43/53/63/73 ----
            cpi  043h
            jz   hed_store_nn
            cpi  053h
            jz   hed_store_nn
            cpi  063h
            jz   hed_store_nn
            cpi  073h
            jz   hed_store_nn

; ---- LD dd,(nn): 4B/5B/6B/7B ----
            cpi  04Bh
            jz   hed_load_nn
            cpi  05Bh
            jz   hed_load_nn
            cpi  06Bh
            jz   hed_load_nn
            cpi  07Bh
            jz   hed_load_nn

; ---- IM 0/1/2: 46/56/5E ----
            cpi  046h
            jz   hed_im
            cpi  056h
            jz   hed_im
            cpi  05Eh
            jz   hed_im

; ---- RETI 4D / RETN 45 ----
            cpi  04Dh
            jz   hed_reti
            cpi  045h
            jz   hed_reti

; ---- OUT (C),r: 41/49/51/59/61/69/71/79 — pattern x1h where x in 4..7 ----
; These are ED 40-7F group:  bits[7:6]=01, bits[2:0]=001 for OUT
; OUT (C),r: ed_sub = 0b01_rrr_001 where rrr=reg_code
; Pattern check: (ed_sub & 0xC7) == 0x41
            lda  ed_sub_b
            ani  0C7h
            cpi  041h
            jz   hed_out_c_r

; ---- IN r,(C): 40/48/50/58/60/68/70/78 — pattern x0h where x in 4..7 ----
; IN r,(C): ed_sub = 0b01_rrr_000
; Pattern check: (ed_sub & 0xC7) == 0x40
            lda  ed_sub_b
            ani  0C7h
            cpi  040h
            jz   hed_in_r_c

; ---- LD A,I (57) / LD A,R (5F) — return arbitrary, don't crash ----
            lda  ed_sub_b
            cpi  057h
            jz   hed_ld_a_i
            cpi  05Fh
            jz   hed_ld_a_i

; ---- LD I,A (47) / LD R,A (4F) — no-op for us ----
            cpi  047h
            jz   hed_noop_2
            cpi  04Fh
            jz   hed_noop_2

; ---- RLD (6F) / RRD (67) ----
            cpi  06Fh
            jz   hed_rld
            cpi  067h
            jz   hed_rrd

; ---- Unknown: fail loud ----
            jmp  z80_unimpl

; ============================================================
; Helper: ed_resume_2 — set sv_target = r+1 (2-byte form resume)
; ============================================================
ed_resume_2:
            lhld sv_ret             ; HL = r
            inx  h                  ; HL = r+1
            shld sv_target
            ret

; Helper: ed_resume_4 — set sv_target = r+3 (4-byte form resume)
ed_resume_4:
            lhld sv_ret             ; HL = r
            inx  h
            inx  h
            inx  h                  ; HL = r+3
            shld sv_target
            ret


; ============================================================
; LDI (A0): (DE) <- (HL); HL++; DE++; BC--;  no Z/CY change
; ============================================================
hed_ldi:
            lhld sv_hl              ; HL = prog HL
            mov  a,m                ; A = (HL)
            lhld sv_de              ; HL = prog DE
            mov  m,a                ; (DE) = A
            ; HL++ -> sv_de
            inx  h
            shld sv_de
            ; sv_hl++
            lhld sv_hl
            inx  h
            shld sv_hl
            ; sv_bc--
            lhld sv_bc
            dcx  h
            shld sv_bc
            call ed_resume_2
            jmp  finish

; ============================================================
; LDIR (B0): repeat LDI while BC != 0
; ============================================================
hed_ldir:
hed_ldir_loop:
            lhld sv_hl
            mov  a,m                ; A = (HL)
            lhld sv_de
            mov  m,a                ; (DE) = A
            lhld sv_de
            inx  h
            shld sv_de
            lhld sv_hl
            inx  h
            shld sv_hl
            lhld sv_bc
            dcx  h
            shld sv_bc
            ; check BC == 0
            mov  a,h
            ora  l
            jnz  hed_ldir_loop
            call ed_resume_2
            jmp  finish

; ============================================================
; LDD (A8): (DE) <- (HL); HL--; DE--; BC--;  no Z/CY change
; ============================================================
hed_ldd:
            lhld sv_hl
            mov  a,m                ; A = (HL)
            lhld sv_de
            mov  m,a                ; (DE) = A
            lhld sv_de
            dcx  h
            shld sv_de
            lhld sv_hl
            dcx  h
            shld sv_hl
            lhld sv_bc
            dcx  h
            shld sv_bc
            call ed_resume_2
            jmp  finish

; ============================================================
; LDDR (B8): repeat LDD while BC != 0
; ============================================================
hed_lddr:
hed_lddr_loop:
            lhld sv_hl
            mov  a,m
            lhld sv_de
            mov  m,a
            lhld sv_de
            dcx  h
            shld sv_de
            lhld sv_hl
            dcx  h
            shld sv_hl
            lhld sv_bc
            dcx  h
            shld sv_bc
            mov  a,h
            ora  l
            jnz  hed_lddr_loop
            call ed_resume_2
            jmp  finish

; ============================================================
; CPI (A1): A - (HL); HL++; BC--; Z = (A==(HL)); CY unchanged
; ============================================================
hed_cpi:
            ; get A from sv_af+1
            lda  sv_af+1            ; A = saved A
            mov  b,a                ; B = A
            lhld sv_hl
            mov  a,m                ; A = (HL)
            mov  c,a                ; C = (HL)
            ; increment HL
            inx  h
            shld sv_hl
            ; decrement BC
            lhld sv_bc
            dcx  h
            shld sv_bc
            ; Z = (B == C)  i.e. saved_A == mem[HL]
            mov  a,b
            sub  c                  ; A = saved_A - (HL); Z set if equal
            ; Update Z in sv_af (bit6), leave CY alone
            mvi  b,0
            jnz  hed_cpi_nz
            mvi  b,040h             ; Z=1
hed_cpi_nz:
            lda  sv_af
            ani  0BFh               ; clear Z (bit6)
            ora  b                  ; set new Z
            sta  sv_af
            call ed_resume_2
            jmp  finish

; ============================================================
; CPIR (B1): repeat CPI while BC != 0 and no match
; ============================================================
hed_cpir:
hed_cpir_loop:
            lda  sv_af+1            ; saved A
            mov  b,a
            lhld sv_hl
            mov  a,m                ; (HL)
            mov  c,a
            inx  h
            shld sv_hl
            lhld sv_bc
            dcx  h
            shld sv_bc
            ; test match
            mov  a,b
            sub  c                  ; Z=1 if match
            jz   hed_cpir_found
            ; no match: check BC == 0
            lhld sv_bc
            mov  a,h
            ora  l
            jnz  hed_cpir_loop
            ; BC=0, not found: Z=0
            lda  sv_af
            ani  0BFh               ; clear Z
            sta  sv_af
            call ed_resume_2
            jmp  finish
hed_cpir_found:
            ; match: Z=1
            lda  sv_af
            ani  0BFh
            ori  040h               ; set Z
            sta  sv_af
            call ed_resume_2
            jmp  finish

; ============================================================
; CPD (A9): A - (HL); HL--; BC--; Z = match; CY unchanged
; ============================================================
hed_cpd:
            lda  sv_af+1
            mov  b,a
            lhld sv_hl
            mov  a,m
            mov  c,a
            dcx  h
            shld sv_hl
            lhld sv_bc
            dcx  h
            shld sv_bc
            mov  a,b
            sub  c
            mvi  b,0
            jnz  hed_cpd_nz
            mvi  b,040h
hed_cpd_nz:
            lda  sv_af
            ani  0BFh
            ora  b
            sta  sv_af
            call ed_resume_2
            jmp  finish

; ============================================================
; CPDR (B9): repeat CPD while BC != 0 and no match
; ============================================================
hed_cpdr:
hed_cpdr_loop:
            lda  sv_af+1
            mov  b,a
            lhld sv_hl
            mov  a,m
            mov  c,a
            dcx  h
            shld sv_hl
            lhld sv_bc
            dcx  h
            shld sv_bc
            mov  a,b
            sub  c
            jz   hed_cpdr_found
            lhld sv_bc
            mov  a,h
            ora  l
            jnz  hed_cpdr_loop
            lda  sv_af
            ani  0BFh
            sta  sv_af
            call ed_resume_2
            jmp  finish
hed_cpdr_found:
            lda  sv_af
            ani  0BFh
            ori  040h
            sta  sv_af
            call ed_resume_2
            jmp  finish

; ============================================================
; NEG (44): A = 0 - A; CY = (A != 0 before); Z = (result == 0)
; ============================================================
hed_neg:
            lda  sv_af+1            ; A = saved A
            mov  b,a                ; B = original A
            ; CY = (original A != 0)
            mvi  c,0                ; C = new CY
            mov  a,b
            ora  a
            jz   hed_neg_zy
            mvi  c,1                ; CY=1 because A was nonzero
hed_neg_zy:
            ; result = 0 - B
            mvi  a,0
            sub  b                  ; A = 0 - B
            sta  sv_af+1            ; store result back to A
            ; compute new Z
            mvi  b,0
            jnz  hed_neg_nz
            mvi  b,040h             ; Z=1
hed_neg_nz:
            lda  sv_af
            ani  0BEh               ; clear CY(bit0) and Z(bit6)
            ora  b                  ; set Z
            ora  c                  ; set CY
            sta  sv_af
            call ed_resume_2
            jmp  finish

; ============================================================
; SBC HL,dd (42/52/62/72): HL = HL - dd - CY_in
; Uses 8080 SUB/SBB instructions for exact 16-bit borrow propagation.
;
; Strategy:
;   1. Set 8080 CY = CY_in (via STC + CMC trick or dummy sub)
;   2. A = L_prog; SBB dd_lo  => lo_result; CY_out_lo = borrow
;      (But SBB needs CY set first — step 1 covers this)
;   3. A = H_prog; SBB dd_hi  => hi_result; CY_out = final borrow
;   4. Record CY_out and result.
;
; To set 8080 CY = CY_in:
;   if CY_in=1: STC
;   if CY_in=0: STC; CMC   (or: XRA A resets CY)
; ============================================================
hed_sbc_hl:
            ; get CY_in from sv_af bit0
            lda  sv_af
            ani  001h
            sta  ed_cyin            ; save CY_in in dedicated cell (not ed_scratch!)

            ; get dd pair into ed_lo_b/ed_hi_b
            call ed_regpair_get     ; HL = dd
            mov  a,l
            sta  ed_lo_b
            mov  a,h
            sta  ed_hi_b

            ; set 8080 CY = CY_in
            lda  ed_cyin
            ora  a
            jz   hed_sbc_cy_zero
            stc                     ; CY = 1
            jmp  hed_sbc_cy_set
hed_sbc_cy_zero:
            stc
            cmc                     ; CY = 0
hed_sbc_cy_set:
            ; low byte: A = L_prog; SBB dd_lo -> A = L - dd_lo - CY_in
            lhld sv_hl
            ; HL = [L_prog, H_prog].  L in L, H in H.
            mov  a,l                ; A = L_prog
            lda  ed_lo_b
            mov  c,a                ; C = dd_lo
            mov  a,l                ; A = L_prog (reload; lda ed_lo_b trashed A)
            sbb  c                  ; A = L - C - CY (8080 SBB), CY=borrow_lo
            sta  ed_lo_b            ; lo result
            ; high byte: A = H_prog; SBB dd_hi -> A = H - dd_hi - borrow_lo
            mov  a,h                ; A = H_prog (HL still loaded from lhld sv_hl)
            lda  ed_hi_b
            mov  c,a                ; C = dd_hi
            mov  a,h                ; A = H_prog (reload)
            sbb  c                  ; A = H - C - borrow_lo, CY=borrow_hi
            sta  ed_hi_b            ; hi result
            ; capture CY_out from 8080 flag
            mvi  b,0
            jnc  hed_sbc_cy_out_0
            mvi  b,1
hed_sbc_cy_out_0:
            ; B = CY_out
            ; build result in HL, store to sv_hl
            lda  ed_hi_b
            mov  h,a
            lda  ed_lo_b
            mov  l,a
            shld sv_hl
            ; set Z = (result16 == 0)
            mov  a,h
            ora  l                  ; Z=1 if result==0
            mvi  a,040h
            jz   hed_sbc_z_set
            mvi  a,0
hed_sbc_z_set:
            ; A = new Z-bit (0x40 or 0)
            mov  c,a
            ; update sv_af: clear CY(bit0) and Z(bit6), set new values
            lda  sv_af
            ani  0BEh               ; clear bit0(CY) and bit6(Z)
            ora  c                  ; set Z
            ora  b                  ; set CY
            sta  sv_af
            call ed_resume_2
            jmp  finish

; ============================================================
; ADC HL,dd (4A/5A/6A/7A): HL = HL + dd + CY_in
; Uses 8080 ADD/ADC instructions.
;
; Strategy:
;   1. Set 8080 CY = CY_in
;   2. A = L_prog; ADC dd_lo -> lo_result; CY_out_lo = carry
;   3. A = H_prog; ADC dd_hi -> hi_result; CY_out = final carry
; ============================================================
hed_adc_hl:
            ; get CY_in from sv_af bit0
            lda  sv_af
            ani  001h
            sta  ed_cyin            ; save CY_in in dedicated cell (not ed_scratch!)

            ; get dd pair into ed_lo_b/ed_hi_b
            call ed_regpair_get     ; HL = dd
            mov  a,l
            sta  ed_lo_b
            mov  a,h
            sta  ed_hi_b

            ; set 8080 CY = CY_in
            lda  ed_cyin
            ora  a
            jz   hed_adc_cy_zero
            stc                     ; CY = 1
            jmp  hed_adc_cy_set
hed_adc_cy_zero:
            stc
            cmc                     ; CY = 0
hed_adc_cy_set:
            ; low byte: A = L_prog; ADC dd_lo -> A = L + dd_lo + CY_in
            lhld sv_hl              ; HL = prog HL
            mov  a,l                ; A = L_prog
            lda  ed_lo_b
            mov  c,a                ; C = dd_lo
            mov  a,l                ; A = L_prog
            adc  c                  ; A = L + C + CY (8080 ADC), CY=carry_lo
            sta  ed_lo_b            ; lo result
            ; high byte: A = H_prog; ADC dd_hi -> A = H + dd_hi + carry_lo
            mov  a,h                ; A = H_prog
            lda  ed_hi_b
            mov  c,a                ; C = dd_hi
            mov  a,h                ; A = H_prog (reload)
            adc  c                  ; A = H + C + carry_lo, CY=carry_hi
            sta  ed_hi_b            ; hi result
            ; capture CY_out
            mvi  b,0
            jnc  hed_adc_cy_out_0
            mvi  b,1
hed_adc_cy_out_0:
            ; B = CY_out
            ; build result in HL, store to sv_hl
            lda  ed_hi_b
            mov  h,a
            lda  ed_lo_b
            mov  l,a
            shld sv_hl
            ; set Z = (result16 == 0)
            mov  a,h
            ora  l
            mvi  a,040h
            jz   hed_adc_z_set
            mvi  a,0
hed_adc_z_set:
            mov  c,a
            lda  sv_af
            ani  0BEh
            ora  c
            ora  b
            sta  sv_af
            call ed_resume_2
            jmp  finish

; ============================================================
; LD (nn),dd (43/53/63/73): mem[nn] = dd_lo; mem[nn+1] = dd_hi
; 4-byte form: ed_sub at r, nn_lo at r+1, nn_hi at r+2
; Resume = r+3
; ============================================================
hed_store_nn:
            call ed_regpair_get     ; HL = dd value
            mov  d,h
            mov  e,l                ; DE = dd (H=hi, L=lo)
            ; get nn from r+1/r+2
            lhld sv_ret             ; HL = r
            inx  h                  ; HL = r+1
            mov  a,m                ; A = nn_lo
            sta  ed_lo_b
            inx  h                  ; HL = r+2
            mov  a,m                ; A = nn_hi
            sta  ed_hi_b
            ; HL = nn
            lda  ed_hi_b
            mov  h,a
            lda  ed_lo_b
            mov  l,a                ; HL = nn
            ; store: mem[nn] = lo(dd) = E, mem[nn+1] = hi(dd) = D
            mov  m,e                ; mem[nn] = lo byte
            inx  h
            mov  m,d                ; mem[nn+1] = hi byte
            call ed_resume_4
            jmp  finish

; ============================================================
; LD dd,(nn) (4B/5B/6B/7B): dd = mem[nn] | (mem[nn+1]<<8)
; 4-byte form. Resume = r+3.
; ============================================================
hed_load_nn:
            ; get nn from r+1/r+2
            lhld sv_ret
            inx  h
            mov  a,m
            sta  ed_lo_b
            inx  h
            mov  a,m
            sta  ed_hi_b
            ; HL = nn
            lda  ed_hi_b
            mov  h,a
            lda  ed_lo_b
            mov  l,a
            ; load: H_new = mem[nn+1], L_new = mem[nn]
            mov  a,m                ; A = mem[nn] = lo byte
            sta  ed_lo_b
            inx  h
            mov  a,m                ; A = mem[nn+1] = hi byte
            mov  h,a
            lda  ed_lo_b
            mov  l,a                ; HL = loaded value
            ; LD SP,(nn) (sub=7B, pair=11) needs the REAL sp register set —
            ; ed_regpair_set only has a placeholder for that pair ("SP restore
            ; is hard": it can't touch the real SP mid-dispatch without going
            ; through the finish_reti mechanism). Detect it here and route
            ; through finish_reti (same trick hix_ld_sp_nn already uses).
            ;
            ; (Earlier in the same session this fix was tried and reverted
            ; for measuring WORSE — but that regression traced to an
            ; UNRELATED self-inflicted bug (the CALL/JP-conflict scanner
            ; corrupting the runtime's own bytes), fixed later. Direct
            ; comparison against the untranslated reference confirms this
            ; LD SP,(nn) really does update SP on real hardware — the
            ; placeholder was silently wrong. Re-applying now that the
            ; scanner bug is fixed.)
            lda  ed_sub_b
            rrc
            rrc
            rrc
            rrc
            ani  003h
            cpi  3
            jz   hed_load_nn_sp
            call ed_regpair_set
            call ed_resume_4
            jmp  finish
hed_load_nn_sp:
            shld sv_newsp           ; HL = loaded value -> real SP at finish_reti
            call ed_resume_4        ; (clobbers HL; sv_newsp already saved)
            jmp  finish_reti

; ============================================================
; IM 0/1/2 (46/56/5E): no-op on our platform (RST7 fixed)
; ============================================================
hed_im:
            call ed_resume_2
            jmp  finish

; ============================================================
; RETI/RETN (4D/45): pop program PC from program stack, jump there
; The program stack is intact (dispatcher balanced its own frame).
; We need to POP from the program stack (pointed to by SP right now).
; ============================================================
hed_reti:
            ; Program SP is in ed_scratch (captured at h_ed entry).
            ; Read program stack top: lo at [SP], hi at [SP+1]
            lhld ed_scratch         ; HL = program SP
            mov  a,m                ; A = lo byte of return addr
            sta  ed_lo_b
            inx  h
            mov  a,m                ; A = hi byte of return addr
            sta  ed_hi_b
            ; new program SP = orig_SP + 2 (word consumed by pop)
            inx  h                  ; HL = prog_SP + 2
            shld sv_newsp           ; save new SP in dedicated cell
            ; target = popped address
            lda  ed_hi_b
            mov  h,a
            lda  ed_lo_b
            mov  l,a
            shld sv_target
            jmp  finish_reti

; ============================================================
; OUT (C),r (41/49/51/59/61/69/71/79)
; ed_sub = 0b01_rrr_001; reg_code = (ed_sub >> 3) & 7
; port = C (sv_bc lo byte); value = reg r
; Emulate via 8080 OUT instruction (port in immediate).
; We can't do OUT with variable port directly in 8080.
; Use self-modifying code: patch the OUT operand.
; ============================================================
hed_out_c_r:
            ; get reg_code = (ed_sub >> 3) & 7
            lda  ed_sub_b
            rrc
            rrc
            rrc
            ani  007h               ; A = reg_code
            ; get value from register
            cpi  006h
            jz   hed_out_mem
            call cb_regaddr         ; HL = addr of saved reg byte
            mov  a,m                ; A = register value (the value to output)
            jmp  hed_out_do
hed_out_mem:
            lhld sv_hl
            mov  a,m                ; A = (HL) (value to output)
hed_out_do:
            ; A = value to output; get port = C (sv_bc lo byte = sv_bc+0).
            ; Re-entrant OUT: E = port, A = value, CALL out_emit (no self-mod).
            mov  b,a                ; B = value to output (save across LDA)
            lda  sv_bc              ; A = C (port); sv_bc+0=C (L byte, stored by SHLD)
            mov  e,a                ; E = port number
            mov  a,b                ; A = value to output (8080 OUT outputs A)
            call out_emit           ; re-entrant OUT (table dispatch by E)
            call ed_resume_2
            jmp  finish

; ============================================================
; IN r,(C) (40/48/50/58/60/68/70/78)
; ed_sub = 0b01_rrr_000; reg_code = (ed_sub >> 3) & 7
; port = C; value from port -> reg r.  We return 0 (IN -> 0).
; ============================================================
hed_in_r_c:
            lda  ed_sub_b
            rrc
            rrc
            rrc
            ani  007h               ; A = reg_code
            cpi  006h
            jz   hed_in_mem
            call cb_regaddr         ; HL = addr of saved reg byte
            mvi  a,0
            mov  m,a                ; reg = 0 (IN returns 0)
            jmp  hed_in_done
hed_in_mem:
            lhld sv_hl
            mvi  m,0                ; (HL) = 0
hed_in_done:
            call ed_resume_2
            jmp  finish

; ============================================================
; LD A,I / LD A,R (57/5F): return A=0 (I/R not modelled)
; ============================================================
hed_ld_a_i:
            mvi  a,0
            sta  sv_af+1            ; A = 0 (arbitrary)
            call ed_resume_2
            jmp  finish

; ============================================================
; hed_noop_2: generic 2-byte no-op (LD I,A / LD R,A)
; ============================================================
hed_noop_2:
            call ed_resume_2
            jmp  finish

; ============================================================
; RLD (6F): hi nibble of (HL) -> A low nibble; A low nibble -> (HL) low nibble;
;   old (HL) hi nibble -> (HL) hi nibble ... actually:
; Z80 RLD: A[3:0] -> (HL)[3:0]; (HL)[7:4] -> A[3:0]; (HL)[3:0] -> (HL)[7:4]
; i.e.: newA = (A & 0xF0) | ((HL) >> 4)
;       new(HL) = (((HL) & 0x0F) << 4) | (A & 0x0F)
; ============================================================
hed_rld:
            lhld sv_hl
            mov  b,m                ; B = (HL)
            lda  sv_af+1            ; A = saved A
            mov  c,a                ; C = saved A
            ; newA = (C & 0xF0) | (B >> 4)
            mov  a,c
            ani  0F0h               ; A = A & 0xF0
            mov  d,a                ; D = A & 0xF0
            mov  a,b
            rrc
            rrc
            rrc
            rrc
            ani  00Fh               ; A = (HL) >> 4
            ora  d                  ; A = newA
            sta  sv_af+1
            ; new(HL) = ((B & 0x0F) << 4) | (C & 0x0F)
            mov  a,b
            ani  00Fh               ; A = (HL) & 0x0F
            add  a
            add  a
            add  a
            add  a                  ; A = ((HL) & 0x0F) << 4
            mov  d,a
            mov  a,c
            ani  00Fh               ; A = A_old & 0x0F
            ora  d                  ; A = new(HL)
            lhld sv_hl
            mov  m,a
            call ed_resume_2
            jmp  finish

; ============================================================
; RRD (67): reverse direction nibble rotation
; newA = (A & 0xF0) | ((HL) & 0x0F)
; new(HL) = ((A & 0x0F) << 4) | ((HL) >> 4)
; ============================================================
hed_rrd:
            lhld sv_hl
            mov  b,m                ; B = (HL)
            lda  sv_af+1
            mov  c,a                ; C = saved A
            ; newA = (C & 0xF0) | (B & 0x0F)
            mov  a,c
            ani  0F0h
            mov  d,a
            mov  a,b
            ani  00Fh
            ora  d                  ; A = newA
            sta  sv_af+1
            ; new(HL) = ((C & 0x0F) << 4) | (B >> 4)
            mov  a,c
            ani  00Fh
            add  a
            add  a
            add  a
            add  a
            mov  d,a
            mov  a,b
            rrc
            rrc
            rrc
            rrc
            ani  00Fh
            ora  d
            lhld sv_hl
            mov  m,a
            call ed_resume_2
            jmp  finish

; ============================================================================
; h_ixiy_dd / h_ixiy_fd — handle IX/IY (DD/FD prefix) instructions (Task 10v2)
; ============================================================================
; Site layout: [RST 0x10 at S] [sub at S+1] [disp at S+2] [imm at S+3]
;   sv_ret = r = S+1 = address of sub byte
;   IX vs IY determined ONLY by KIND (not by any byte in the image).
;
; sub opcode dispatch:
;   0x21        LD I,nn     (4-byte: r, lo, hi)             resume r+3
;   0x70..0x77  LD (I+d),r  (3-byte: sub, disp)             resume r+2
;   0x46/4E/56/5E/66/6E/7E  LD r,(I+d)                      resume r+2
;   0x34        INC (I+d)   (3-byte: sub, disp)             resume r+2
;   0x35        DEC (I+d)   (3-byte: sub, disp)             resume r+2
;   0x36        LD (I+d),n  (4-byte: sub, disp, imm)        resume r+3
;   0x86        ADD A,(I+d) (3-byte: sub, disp)             resume r+2
;   0x8E        ADC A,(I+d)                                  resume r+2
;   0x96        SUB (I+d)                                    resume r+2
;   0x9E        SBC A,(I+d)                                  resume r+2
;   0xA6        AND (I+d)                                    resume r+2
;   0xAE        XOR (I+d)                                    resume r+2
;   0xB6        OR  (I+d)                                    resume r+2
;   0xBE        CP  (I+d)                                    resume r+2
;   0xCB        DDCB/FDCB   (4-byte: sub, disp, cb_sub)     resume r+3
;   0xE1        POP I       (2-byte: sub)                    resume r+1
;   0xE5        PUSH I      (2-byte: sub)                    resume r+1
;   0x09/19/29/39  ADD I,dd (2-byte: sub)                   resume r+1
;   0xD3        OUT (n),A   (3-byte: sub, n)                resume r+2
;   0x31        LD SP,nn    (4-byte: sub, lo, hi)           resume r+3
;
; Shared core: ix_core — parameterized by ixiy_ptr (address of shadow word).
; h_ixiy_dd sets ixiy_ptr -> z80_ix; h_ixiy_fd sets ixiy_ptr -> z80_iy.
;
; Private scratch cells:
z80_ix:     dw   0          ; IX shadow word
z80_iy:     dw   0          ; IY shadow word
ixiy_ptr:   dw   0          ; address of active shadow word (z80_ix or z80_iy)
ixiy_sub:   db   0          ; sub-opcode
ixiy_disp:  db   0          ; displacement byte (signed)
ixiy_lo:    db   0          ; scratch lo byte
ixiy_hi:    db   0          ; scratch hi byte
ixiy_ptr2:  dw   0          ; scratch: ptr = IX/IY + signext8(disp)

; ============================================================================
h_ixiy_dd:
            lxi  h,z80_ix
            shld ixiy_ptr
            jmp  ixiy_core

h_ixiy_fd:
            lxi  h,z80_iy
            shld ixiy_ptr
            jmp  ixiy_core

; ============================================================================
; ixiy_core — shared implementation
; ============================================================================
ixiy_core:
            ; read sub from r = sv_ret
            lhld sv_ret             ; HL = r
            mov  a,m
            sta  ixiy_sub
            ; dispatch
            cpi  021h
            jz   hix_ld_i_nn
            cpi  022h
            jz   hix_st_i_nn
            cpi  02Ah
            jz   hix_ld_i_mem
            cpi  034h
            jz   hix_inc_id
            cpi  035h
            jz   hix_dec_id
            cpi  036h
            jz   hix_ld_id_n
            cpi  086h
            jz   hix_add_a_id
            cpi  08Eh
            jz   hix_adc_a_id
            cpi  096h
            jz   hix_sub_id
            cpi  09Eh
            jz   hix_sbc_a_id
            cpi  0A6h
            jz   hix_and_id
            cpi  0AEh
            jz   hix_xor_id
            cpi  0B6h
            jz   hix_or_id
            cpi  0BEh
            jz   hix_cp_id
            cpi  0CBh
            jz   hix_ddcb
            cpi  0E1h
            jz   hix_pop_i
            cpi  0E5h
            jz   hix_push_i
            ; ADD I,dd: sub 0x09/0x19/0x29/0x39
            cpi  009h
            jz   hix_add_i_dd
            cpi  019h
            jz   hix_add_i_dd
            cpi  029h
            jz   hix_add_i_dd
            cpi  039h
            jz   hix_add_i_dd
            ; LD (I+d),r: sub 0x70..0x77 (except 0x76 HALT which won't appear)
            lda  ixiy_sub
            ani  0F8h               ; mask lower 3 bits
            cpi  070h
            jz   hix_ld_id_r
            ; LD r,(I+d): sub 0x46/4E/56/5E/66/6E/7E
            ; check bits[7:6]=01 and bits[2:0]=110 pattern: sub & 0xC7 == 0x46
            lda  ixiy_sub
            ani  0C7h
            cpi  046h
            jz   hix_ld_r_id
            ; prefix-nop cases: OUT (n),A and LD SP,nn and CP n
            lda  ixiy_sub
            cpi  0D3h
            jz   hix_out_n_a
            cpi  031h
            jz   hix_ld_sp_nn
            cpi  0FEh
            jz   hix_cp_n
            ; unknown sub — fail loud
            jmp  z80_unimpl

; ============================================================================
; Helper: compute ptr = IX/IY + signext8(disp)
;   disp byte is at r+1 = sv_ret+1
;   Result stored in ixiy_ptr2.
;   On return: HL = ptr.
; ============================================================================
ixiy_calc_ptr:
            ; read disp from byte[r+1]
            lhld sv_ret             ; HL = r
            inx  h                  ; HL = r+1
            mov  a,m                ; A = disp byte (signed)
            sta  ixiy_disp
            ; sign-extend disp -> DE
            mov  e,a
            mvi  d,0
            ora  a
            jp   ixcp_pos
            mvi  d,0FFh             ; negative: D=0xFF
ixcp_pos:
            ; HL = ixiy_ptr (address of shadow word)
            lhld ixiy_ptr
            ; load shadow word value into BC
            mov  c,m
            inx  h
            mov  b,m                ; BC = IX or IY value (lo=C, hi=B)
            ; ptr = BC + signext(disp)
            mov  h,b
            mov  l,c                ; HL = IX/IY
            dad  d                  ; HL = IX/IY + signext(disp)
            shld ixiy_ptr2
            ret

; ============================================================================
; LD I,nn  sub=0x21  4-byte: [D7][21][lo][hi]
; z80_ix/iy = word[r+1, r+2]
; ============================================================================
hix_ld_i_nn:
            lhld sv_ret             ; HL = r
            inx  h                  ; HL = r+1 (lo byte)
            mov  a,m
            sta  ixiy_lo
            inx  h                  ; HL = r+2 (hi byte)
            mov  a,m
            sta  ixiy_hi
            ; store to shadow word
            lhld ixiy_ptr           ; HL = &z80_ix or &z80_iy
            lda  ixiy_lo
            mov  m,a                ; [ptr+0] = lo
            inx  h
            lda  ixiy_hi
            mov  m,a                ; [ptr+1] = hi
            ; resume = r+3
            lhld sv_ret
            inx  h
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; LD (nn),I  sub=0x22  4-byte: [D7][22][lo][hi] — сохранить IX/IY в память[nn]
; ============================================================================
hix_st_i_nn:
            lhld sv_ret             ; HL = r
            inx  h                  ; HL = r+1 (nn lo)
            mov  e,m
            inx  h                  ; HL = r+2 (nn hi)
            mov  d,m                ; DE = nn (адрес назначения)
            lhld ixiy_ptr           ; HL = &z80_ix/iy (теневой регистр)
            mov  a,m                ; A = lo(IX/IY)
            stax d                  ; mem[nn] = lo
            inx  h
            inx  d
            mov  a,m                ; A = hi(IX/IY)
            stax d                  ; mem[nn+1] = hi
            ; resume = r+3
            lhld sv_ret
            inx  h
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; LD I,(nn)  sub=0x2A  4-byte: [D7][2A][lo][hi] — загрузить IX/IY из памяти[nn]
; ============================================================================
hix_ld_i_mem:
            lhld sv_ret             ; HL = r
            inx  h                  ; HL = r+1 (nn lo)
            mov  e,m
            inx  h                  ; HL = r+2 (nn hi)
            mov  d,m                ; DE = nn (адрес источника)
            ldax d                  ; A = mem[nn] (lo)
            sta  ixiy_lo
            inx  d
            ldax d                  ; A = mem[nn+1] (hi)
            sta  ixiy_hi
            lhld ixiy_ptr           ; HL = &z80_ix/iy
            lda  ixiy_lo
            mov  m,a
            inx  h
            lda  ixiy_hi
            mov  m,a
            ; resume = r+3
            lhld sv_ret
            inx  h
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; LD (I+d),r  sub=0x70..0x77 (except 0x76)
; ptr = I+disp; mem[ptr] = reg[bits[2:0]]
; ============================================================================
hix_ld_id_r:
            call ixiy_calc_ptr      ; HL = ptr; also stored in ixiy_ptr2
            ; save ptr in ixiy_ptr2 (already done by ixiy_calc_ptr)
            ; reg_code = sub & 7
            lda  ixiy_sub
            ani  007h               ; A = reg_code
            ; get register value
            cpi  006h
            jz   hix_id_r_mem_src   ; reg=6=(HL)
            call cb_regaddr         ; HL = addr of saved reg byte; cb_regaddr destroys DE
            mov  a,m                ; A = register value
            jmp  hix_id_r_write
hix_id_r_mem_src:
            lhld sv_hl
            mov  a,m                ; A = mem[HL]
hix_id_r_write:
            ; A = value to store; ptr is in ixiy_ptr2
            sta  ixiy_lo            ; save value temporarily
            lhld ixiy_ptr2          ; HL = ptr
            lda  ixiy_lo
            mov  m,a                ; mem[ptr] = reg value
            ; resume = r+2
            lhld sv_ret
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; LD r,(I+d)  sub=0x46/4E/56/5E/66/6E/7E
; reg = bits[5:3]; mem[ptr] -> reg
; ============================================================================
hix_ld_r_id:
            call ixiy_calc_ptr      ; HL = ptr
            mov  a,m                ; A = mem[ptr]
            sta  ixiy_lo            ; save value
            ; reg_code = (sub >> 3) & 7
            lda  ixiy_sub
            rrc
            rrc
            rrc
            ani  007h               ; A = reg_code
            ; write to register
            cpi  006h
            jz   hix_rd_to_mem      ; reg=6=(HL) — write to mem[sv_hl]
            call cb_regaddr         ; HL = addr of saved reg byte
            lda  ixiy_lo
            mov  m,a
            jmp  hix_rd_resume
hix_rd_to_mem:
            lhld sv_hl
            lda  ixiy_lo
            mov  m,a
hix_rd_resume:
            ; resume = r+2
            lhld sv_ret
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; INC (I+d)  sub=0x34
; mem[ptr] += 1; Z by result; CY preserved (Z80: INC does NOT change CY)
; ============================================================================
hix_inc_id:
            call ixiy_calc_ptr      ; HL = ptr
            mov  a,m                ; A = old value
            inr  a                  ; A++ (8080 INR: sets Z, S, P, AC; does NOT change CY)
            ; 8080 INR does NOT change CY — matches Z80 INC behaviour
            mov  m,a                ; write back
            ; update Z in sv_af from 8080 flags (INR sets Z correctly on 8080)
            ; We need to update sv_af Z bit; CY bit must remain unchanged.
            ; Use the 8080 Z flag set by INR above.
            ; Save result, build new F.
            mov  b,a                ; B = result
            ; compute Z bit: 0x40 if result==0, else 0
            mvi  c,000h
            mov  a,b
            ora  a
            jnz  hix_inc_nz
            mvi  c,040h             ; Z=1
hix_inc_nz:
            lda  sv_af              ; old F
            ani  0BFh               ; clear Z (bit6), keep all others incl. CY
            ora  c                  ; set new Z
            sta  sv_af
            ; resume = r+2
            lhld sv_ret
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; DEC (I+d)  sub=0x35
; mem[ptr] -= 1; Z by result; CY preserved
; ============================================================================
hix_dec_id:
            call ixiy_calc_ptr      ; HL = ptr
            mov  a,m                ; A = old value
            dcr  a                  ; A-- (8080 DCR: does NOT change CY)
            mov  m,a                ; write back
            ; update Z in sv_af; CY unchanged
            mov  b,a
            mvi  c,000h
            ora  a
            jnz  hix_dec_nz
            mvi  c,040h
hix_dec_nz:
            lda  sv_af
            ani  0BFh               ; clear Z
            ora  c
            sta  sv_af
            ; resume = r+2
            lhld sv_ret
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; LD (I+d),n  sub=0x36  4-byte: [sub][disp][n]
; ptr = I+disp; mem[ptr] = byte[r+2]
; ============================================================================
hix_ld_id_n:
            call ixiy_calc_ptr      ; HL = ptr (uses r+1 for disp)
            mov  d,h
            mov  e,l                ; DE = ptr
            ; n = byte[r+2]
            lhld sv_ret
            inx  h
            inx  h                  ; HL = r+2
            mov  a,m                ; A = n
            xchg                    ; HL = ptr
            mov  m,a                ; mem[ptr] = n
            ; resume = r+3
            lhld sv_ret
            inx  h
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; Arithmetic (I+d) forms: ADD/ADC/SUB/SBC/AND/XOR/OR/CP
; All 3-byte (sub, disp); resume r+2
;
; Helper: hix_arith_prep — loads operand from mem[ptr] into B,
;         and saves current A (from sv_af+1) into A register.
;         Returns: A=saved_A, B=mem[ptr], HL=ptr (scratch)
; ============================================================================
hix_arith_prep:
            call ixiy_calc_ptr      ; HL = ptr
            mov  b,m                ; B = mem[ptr]
            lda  sv_af+1            ; A = saved A
            ret

; ---- store result to A and update flags (CY and Z) ----
; On entry: A=result, B=new_CY (0 or 1)
; Clobbers: A, C
hix_arith_set_flags:
            mov  c,a                ; C = result
            mvi  a,000h
            ora  c
            mvi  a,040h
            jz   hix_af_z1
            mvi  a,000h
hix_af_z1:
            ; A = new Z bit (0x40 or 0)
            mov  d,a
            lda  sv_af
            ani  0BEh               ; clear CY(bit0) and Z(bit6)
            ora  d                  ; set new Z
            ora  b                  ; set new CY
            sta  sv_af
            ; store result to A
            mov  a,c
            sta  sv_af+1
            ret

; ============================================================================
; ADD A,(I+d)  sub=0x86
; ============================================================================
hix_add_a_id:
            call hix_arith_prep     ; A=saved_A, B=mem[ptr]
            add  b                  ; A = A + mem[ptr]
            ; CY from 8080 ADD
            mvi  b,0
            jnc  hix_add_cy0
            mvi  b,1
hix_add_cy0:
            call hix_arith_set_flags
            lhld sv_ret
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; ADC A,(I+d)  sub=0x8E
; ============================================================================
hix_adc_a_id:
            ; set 8080 CY = saved CY_in
            lda  sv_af
            ani  001h               ; CY_in
            jz   hix_adc_cy0
            stc
            jmp  hix_adc_do
hix_adc_cy0:
            stc
            cmc
hix_adc_do:
            call hix_arith_prep     ; A=saved_A, B=mem[ptr]
            ; but CY was set above — now do ADC
            ; We need to redo: set CY again (hix_arith_prep reloads A but 8080 flags...)
            ; Actually: hix_arith_prep calls ixiy_calc_ptr (which does DAD — modifies CY!)
            ; We must set CY AFTER hix_arith_prep.
            ; Redo: do prep first, then set CY, then ADC.
            ; Store B and A from prep
            sta  ixiy_hi            ; save A=saved_A
            mov  a,b
            sta  ixiy_lo            ; save B=mem[ptr]
            ; set CY
            lda  sv_af
            ani  001h
            jz   hix_adc2_cy0
            stc
            jmp  hix_adc2_do
hix_adc2_cy0:
            stc
            cmc
hix_adc2_do:
            lda  ixiy_lo
            mov  b,a                ; B=mem[ptr]
            lda  ixiy_hi            ; A=saved_A
            adc  b                  ; A = A + mem[ptr] + CY_in
            mvi  b,0
            jnc  hix_adc2_nc
            mvi  b,1
hix_adc2_nc:
            call hix_arith_set_flags
            lhld sv_ret
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; SUB (I+d)  sub=0x96
; ============================================================================
hix_sub_id:
            call hix_arith_prep     ; A=saved_A, B=mem[ptr]
            sub  b
            mvi  b,0
            jnc  hix_sub_cy0
            mvi  b,1
hix_sub_cy0:
            call hix_arith_set_flags
            lhld sv_ret
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; SBC A,(I+d)  sub=0x9E
; ============================================================================
hix_sbc_a_id:
            call hix_arith_prep
            sta  ixiy_hi
            mov  a,b
            sta  ixiy_lo
            lda  sv_af
            ani  001h
            jz   hix_sbc2_cy0
            stc
            jmp  hix_sbc2_do
hix_sbc2_cy0:
            stc
            cmc
hix_sbc2_do:
            lda  ixiy_lo
            mov  b,a
            lda  ixiy_hi
            sbb  b
            mvi  b,0
            jnc  hix_sbc2_nc
            mvi  b,1
hix_sbc2_nc:
            call hix_arith_set_flags
            lhld sv_ret
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; AND (I+d)  sub=0xA6
; ============================================================================
hix_and_id:
            call hix_arith_prep
            ana  b                  ; AND: CY=0 always
            mvi  b,0                ; CY=0
            call hix_arith_set_flags
            lhld sv_ret
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; XOR (I+d)  sub=0xAE
; ============================================================================
hix_xor_id:
            call hix_arith_prep
            xra  b                  ; XOR: CY=0 always
            mvi  b,0
            call hix_arith_set_flags
            lhld sv_ret
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; OR (I+d)  sub=0xB6
; ============================================================================
hix_or_id:
            call hix_arith_prep
            ora  b                  ; OR: CY=0 always
            mvi  b,0
            call hix_arith_set_flags
            lhld sv_ret
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; CP (I+d)  sub=0xBE
; A - mem[ptr]; flags updated (CY, Z); A not changed
; ============================================================================
hix_cp_id:
            call hix_arith_prep     ; A=saved_A, B=mem[ptr]
            sub  b                  ; A = A - mem[ptr] (temp, for flags)
            mvi  b,0
            jnc  hix_cp_cy0
            mvi  b,1
hix_cp_cy0:
            ; compute Z
            mvi  c,000h
            ora  a
            jnz  hix_cp_nz
            mvi  c,040h
hix_cp_nz:
            ; update flags in sv_af (do NOT store result to A)
            lda  sv_af
            ani  0BEh
            ora  c
            ora  b
            sta  sv_af
            ; resume = r+2
            lhld sv_ret
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; DDCB/FDCB  sub=0xCB
; 4-byte: [D7][CB][disp][cb_sub]
; ptr = I + signext(disp); bit-op on mem[ptr]
; Reuse h_cb logic but force operand to mem[ptr] regardless of cb_sub reg field.
; resume = r+3
; ============================================================================
hix_ddcb:
            call ixiy_calc_ptr      ; HL = ptr; also stores disp from r+1
            mov  a,m                ; A = mem[ptr]
            sta  cb_val_b           ; reuse cb_val_b scratch cell

            ; cb_sub is at byte[r+2]
            lhld sv_ret
            inx  h
            inx  h                  ; HL = r+2
            mov  a,m                ; A = cb_sub
            sta  cb_sub_b           ; reuse cb_sub_b scratch cell

            ; dispatch by group bits[7:6]
            ani  0C0h
            jz   hix_ddcb_rot       ; 00 = rot/shift
            cpi  040h
            jz   hix_ddcb_bit       ; 01 = BIT
            cpi  080h
            jz   hix_ddcb_res       ; 10 = RES
            jmp  hix_ddcb_set       ; 11 = SET

; ---- rot/shift on mem[ptr]: reuse h_cb rotate logic ----
; After dispatch, write result back to mem[ptr] = ixiy_ptr2 directly.
hix_ddcb_rot:
            ; cb_val_b is already loaded with mem[ptr] by the DDCB dispatcher.
            ; Decode op from cb_sub_b bits[5:3] and dispatch to inline rotate handler.
            ; The handler leaves result in A and CY in cb_cy_b, then falls into
            ; hix_ddcb_rot_done which writes A to mem[ixiy_ptr2] directly.
            lda  cb_sub_b
            rrc
            rrc
            rrc
            ani  007h               ; op_code
            ; jump table for rot ops:
            cpi  0
            jz   hix_ddcb_rlc
            cpi  1
            jz   hix_ddcb_rrc
            cpi  2
            jz   hix_ddcb_rl
            cpi  3
            jz   hix_ddcb_rr
            cpi  4
            jz   hix_ddcb_sla
            cpi  5
            jz   hix_ddcb_sra
            cpi  6
            jz   hix_ddcb_sll
            jmp  hix_ddcb_srl

; Each rot handler sets A=result, cb_cy_b=CY, then falls into hix_ddcb_rot_done
hix_ddcb_rlc:
            lda  cb_val_b
            mov  b,a
            ani  080h
            rlc
            ani  001h
            sta  cb_cy_b
            mov  a,b
            rlc
            jmp  hix_ddcb_rot_done
hix_ddcb_rrc:
            lda  cb_val_b
            mov  b,a
            ani  001h
            sta  cb_cy_b
            mov  a,b
            rrc
            jmp  hix_ddcb_rot_done
hix_ddcb_rl:
            lda  cb_val_b
            mov  b,a
            ani  080h
            rlc
            ani  001h
            sta  cb_cy_b
            lda  sv_af
            ani  001h
            mov  c,a
            mov  a,b
            add  a
            ora  c
            jmp  hix_ddcb_rot_done
hix_ddcb_rr:
            lda  cb_val_b
            ani  001h
            sta  cb_cy_b
            lda  sv_af
            ani  001h
            ora  a
            mvi  a,000h
            jz   hix_ddcb_rr_nc
            mvi  a,080h
hix_ddcb_rr_nc:
            mov  d,a
            lda  cb_val_b
            rrc
            ani  07Fh
            ora  d
            jmp  hix_ddcb_rot_done
hix_ddcb_sla:
            lda  cb_val_b
            mov  b,a
            ani  080h
            rlc
            ani  001h
            sta  cb_cy_b
            mov  a,b
            add  a
            jmp  hix_ddcb_rot_done
hix_ddcb_sra:
            lda  cb_val_b
            ani  001h
            sta  cb_cy_b
            lda  cb_val_b
            mov  b,a
            ani  080h
            mov  d,a
            mov  a,b
            rrc
            ani  07Fh
            ora  d
            jmp  hix_ddcb_rot_done
hix_ddcb_sll:
            lda  cb_val_b
            mov  b,a
            ani  080h
            rlc
            ani  001h
            sta  cb_cy_b
            mov  a,b
            add  a
            ori  001h
            jmp  hix_ddcb_rot_done
hix_ddcb_srl:
            lda  cb_val_b
            ani  001h
            sta  cb_cy_b
            lda  cb_val_b
            rrc
            ani  07Fh
            jmp  hix_ddcb_rot_done

hix_ddcb_rot_done:
            sta  cb_res_b
            ; update sv_af Z and CY
            ora  a
            mvi  b,000h
            jnz  hix_ddcb_rot_z0
            mvi  b,040h
hix_ddcb_rot_z0:
            lda  sv_af
            ani  0BEh
            ora  b
            mov  b,a
            lda  cb_cy_b
            ora  b
            sta  sv_af
            ; write result to mem[ptr] using the computed pointer directly
            lhld ixiy_ptr2          ; HL = ptr = IX/IY + signext8(disp)
            lda  cb_res_b
            mov  m,a
            ; resume = r+3
            lhld sv_ret
            inx  h
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ---- BIT b,(ptr): Z=NOT(bit_b of mem[ptr]); CY unchanged ----
hix_ddcb_bit:
            ; extract bit number b = (cb_sub >> 3) & 7
            lda  cb_sub_b
            rrc
            rrc
            rrc
            ani  007h
            mov  b,a
            mvi  a,001h
hix_ddcb_bit_shl:
            mov  c,a
            mov  a,b
            ora  a
            mov  a,c
            jz   hix_ddcb_bit_done
            add  a
            dcr  b
            jmp  hix_ddcb_bit_shl
hix_ddcb_bit_done:
            mov  b,a                ; B = (1<<bit)
            lda  cb_val_b
            ana  b
            ; Z=1 if AND==0 (bit clear), Z=0 if bit set
            mvi  b,000h
            jnz  hix_ddcb_bit_nz
            mvi  b,040h
hix_ddcb_bit_nz:
            lda  sv_af
            ani  0BFh               ; clear Z
            ora  b
            sta  sv_af
            ; mem[ptr] unchanged
            ; resume = r+3
            lhld sv_ret
            inx  h
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ---- RES b,(ptr): mem[ptr] &= ~(1<<b); flags unchanged ----
hix_ddcb_res:
            lda  cb_sub_b
            rrc
            rrc
            rrc
            ani  007h
            mov  b,a
            mvi  a,001h
hix_ddcb_res_shl:
            mov  c,a
            mov  a,b
            ora  a
            mov  a,c
            jz   hix_ddcb_res_done
            add  a
            dcr  b
            jmp  hix_ddcb_res_shl
hix_ddcb_res_done:
            cma
            mov  b,a
            lda  cb_val_b
            ana  b
            ; write to mem[ptr]
            lhld ixiy_ptr2
            mov  m,a
            ; resume = r+3
            lhld sv_ret
            inx  h
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ---- SET b,(ptr): mem[ptr] |= (1<<b); flags unchanged ----
hix_ddcb_set:
            lda  cb_sub_b
            rrc
            rrc
            rrc
            ani  007h
            mov  b,a
            mvi  a,001h
hix_ddcb_set_shl:
            mov  c,a
            mov  a,b
            ora  a
            mov  a,c
            jz   hix_ddcb_set_done
            add  a
            dcr  b
            jmp  hix_ddcb_set_shl
hix_ddcb_set_done:
            mov  b,a
            lda  cb_val_b
            ora  b
            lhld ixiy_ptr2
            mov  m,a
            lhld sv_ret
            inx  h
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; PUSH I  sub=0xE5 — push z80_ix/iy onto program stack
; Program SP is live (like h_ed, we capture it via DAD SP trick)
; ============================================================================
hix_push_i:
            ; HL = ixiy value to push
            lhld ixiy_ptr           ; HL = &shadow_word
            mov  e,m
            inx  h
            mov  d,m                ; DE = ix/iy value (lo=E, hi=D)
            ; SP -= 2 and write DE
            lxi  h,0
            dad  sp                 ; HL = SP
            dcx  h                  ; SP-1
            mov  m,d                ; mem[SP-1] = hi byte
            dcx  h                  ; SP-2
            mov  m,e                ; mem[SP-2] = lo byte
            ; decrement real SP by 2
            lxi  h,0
            dad  sp
            dcx  h
            dcx  h
            sphl                    ; SP = SP-2
            ; resume = r+1
            lhld sv_ret
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; POP I  sub=0xE1 — pop word from program stack into z80_ix/iy
; ============================================================================
hix_pop_i:
            ; read 2 bytes from current SP
            lxi  h,0
            dad  sp                 ; HL = SP
            mov  a,m                ; A = mem[SP] = lo byte
            sta  ixiy_lo
            inx  h
            mov  a,m                ; A = mem[SP+1] = hi byte
            sta  ixiy_hi
            ; SP += 2
            lxi  h,0
            dad  sp
            inx  h
            inx  h
            sphl
            ; write to shadow word
            lhld ixiy_ptr           ; HL = &shadow_word
            lda  ixiy_lo
            mov  m,a
            inx  h
            lda  ixiy_hi
            mov  m,a
            ; resume = r+1
            lhld sv_ret
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; ADD I,dd  sub=0x09/0x19/0x29/0x39 — z80_ix/iy += pair; CY by 16-bit carry
; pair code from sub bits[5:4]: 00=BC 01=DE 10=I(IX/IY) 11=SP
; ============================================================================
hix_add_i_dd:
            ; get pair code from sub: bits[5:4] = (sub >> 4) & 3
            lda  ixiy_sub
            rrc
            rrc
            rrc
            rrc
            ani  003h               ; A = pair code
            ; load pair value into DE
            cpi  0
            jz   hix_add_pair_bc
            cpi  1
            jz   hix_add_pair_de
            cpi  2
            jz   hix_add_pair_self
            ; pair=3: SP
            lxi  h,0
            dad  sp                 ; HL = SP (program SP)
            mov  d,h
            mov  e,l
            jmp  hix_add_do
hix_add_pair_bc:
            lhld sv_bc
            mov  d,h
            mov  e,l
            jmp  hix_add_do
hix_add_pair_de:
            lhld sv_de
            mov  d,h
            mov  e,l
            jmp  hix_add_do
hix_add_pair_self:
            ; add I to itself: load shadow word value
            lhld ixiy_ptr
            mov  a,m
            mov  e,a
            inx  h
            mov  a,m
            mov  d,a                ; DE = IX/IY (hi=D, lo=E)
            jmp  hix_add_do
hix_add_do:
            ; On entry: DE = pair value (H=hi, L=lo after lhld, so D=hi, E=lo)
            ; Load IX/IY value: lo at mem[ixiy_ptr], hi at mem[ixiy_ptr+1]
            lhld ixiy_ptr           ; HL = &shadow_word
            mov  c,m                ; C = lo byte of IX/IY
            inx  h
            mov  b,m                ; B = hi byte of IX/IY
            ; BC = IX/IY (B=hi, C=lo); DE = pair (D=hi, E=lo)
            ; Compute result = BC + DE as 16-bit
            ; Use: L=C+E, H=B+D+carry
            mov  a,c
            add  e                  ; A = lo+lo, CY=carry_lo
            mov  l,a                ; L = result lo
            mov  a,b
            adc  d                  ; A = hi+hi+CY, CY=carry_hi
            mov  h,a                ; H = result hi; CY = 16-bit carry out
            ; save result and CY
            mvi  b,0
            jnc  hix_add_dd_cy0
            mvi  b,1
hix_add_dd_cy0:
            ; HL = result; store to shadow word
            shld ixiy_ptr2          ; save result
            lhld ixiy_ptr           ; HL = &shadow_word
            lda  ixiy_ptr2          ; lo
            mov  m,a
            inx  h
            lda  ixiy_ptr2+1        ; hi
            mov  m,a
            ; update CY in sv_af
            lda  sv_af
            ani  0FEh               ; clear CY (bit0)
            ora  b                  ; set new CY
            sta  sv_af
            ; resume = r+1
            lhld sv_ret
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; OUT (n),A  sub=0xD3 — prefix-nop, behaves as plain 8080 OUT (n),A
; n = byte[r+1]; value = sv_af+1 (saved A)
; Uses self-modifying OUT pattern from h_ed.
; ============================================================================
hix_out_n_a:
            ; get n from byte[r+1]
            lhld sv_ret
            inx  h                  ; HL = r+1
            mov  a,m                ; A = n (port number)
            mov  e,a                ; E = port number
            ; load A value to output
            lda  sv_af+1            ; A = saved A
            call out_emit           ; re-entrant OUT (table dispatch by E)
            ; resume = r+2
            lhld sv_ret
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; LD SP,nn  sub=0x31 — sets REAL program SP to nn
; nn = word[r+1, r+2] (lo at r+1, hi at r+2)
; Uses finish_reti mechanism (sv_newsp) to set SP at finish time.
; ============================================================================
hix_ld_sp_nn:
            ; read nn from r+1/r+2
            lhld sv_ret
            inx  h                  ; HL = r+1
            mov  a,m
            sta  ixiy_lo            ; lo byte
            inx  h                  ; HL = r+2
            mov  a,m
            sta  ixiy_hi            ; hi byte
            ; build sv_newsp = nn
            lda  ixiy_hi
            mov  h,a
            lda  ixiy_lo
            mov  l,a                ; HL = nn
            shld sv_newsp           ; save new SP for finish_reti
            ; resume = r+3
            lhld sv_ret
            inx  h
            inx  h
            inx  h
            shld sv_target
            jmp  finish_reti

; ============================================================================
; CP n  (DD/FD prefix-nop) sub=0xFE  3-byte: [D7][FE][n]
; The index-register prefix has no effect on CP n (it doesn't reference
; (IX+d)/(IY+d)) — same idea as the OUT (n),A / LD SP,nn prefix-nop cases
; above.  Flags computed exactly like hix_cp_id (Z/CY only, A unchanged),
; just against an immediate operand instead of mem[ptr].
; ============================================================================
hix_cp_n:
            lhld sv_ret
            inx  h                  ; HL = r+1 (immediate n)
            mov  b,m                ; B = n
            lda  sv_af+1            ; A = saved A
            sub  b                  ; A - n (temp, for flags only)
            mvi  b,0
            jnc  hcpn_cy0
            mvi  b,1
hcpn_cy0:
            mvi  c,000h
            ora  a
            jnz  hcpn_nz
            mvi  c,040h
hcpn_nz:
            lda  sv_af
            ani  0BEh
            ora  c
            ora  b
            sta  sv_af
            ; resume = r+2
            lhld sv_ret
            inx  h
            inx  h
            shld sv_target
            jmp  finish

; ============================================================================
; h_exx / h_exaf — EXX (D9) and EX AF,AF' (08)  (Task 11v2)
; ============================================================================
;
; Shadow register bank (Z80 alternate register set, power-on = 0):
z80_bcp:    dw   0          ; BC' shadow (lo=C', hi=B')
z80_dep:    dw   0          ; DE' shadow (lo=E', hi=D')
z80_hlp:    dw   0          ; HL' shadow (lo=L', hi=H')
z80_afp:    dw   0          ; AF' shadow (lo=F', hi=A')

; ============================================================================
; exx_swap16: swap the word at address in HL with the word in sv_* at DE.
;   On entry: HL = address of shadow word (e.g. z80_bcp)
;             DE = address of saved-state word (e.g. sv_bc)
;   Swaps [HL]/[HL+1] <-> [DE]/[DE+1].
;   Destroys A, B, C.
; ============================================================================
exx_swap16:
            ; load [DE] lo byte
            xchg                    ; HL<->DE so we can use M
            mov  b,m                ; B = sv_*.lo (old main lo)
            inx  h
            mov  c,m                ; C = sv_*.hi (old main hi)
            dcx  h                  ; HL = &sv_* again
            xchg                    ; HL = &shadow, DE = &sv_*

            ; load [HL] lo byte
            mov  a,m                ; A = shadow.lo (old shadow lo)
            ; store main.lo -> shadow.lo
            mov  m,b                ; shadow.lo = old_main.lo
            ; store old shadow.lo -> main.lo
            xchg
            mov  m,a                ; sv_*.lo = old_shadow.lo
            xchg                    ; HL = &shadow again

            inx  h                  ; HL = &shadow.hi
            mov  a,m                ; A = shadow.hi (old shadow hi)
            mov  m,c                ; shadow.hi = old_main.hi
            xchg
            inx  h                  ; DE = &sv_*.hi
            mov  m,a                ; sv_*.hi = old_shadow.hi
            ret

; ============================================================================
; h_exx — EXX: swap BC/DE/HL <-> BC'/DE'/HL'.  AF unaffected.
; 1-byte instruction: resume = sv_ret (the byte after the RST site).
; ============================================================================
h_exx:
            ; Fast inline 6-byte swap (Task 16): sv_bc/sv_de/sv_hl are contiguous
            ; (BC,DE,HL saved-state words) and z80_bcp/z80_dep/z80_hlp are
            ; contiguous (the alternate-bank shadow words), each in matching
            ; lo/hi byte order, so swapping the 6 bytes pairwise is exactly
            ; EXX (BC<->BC', DE<->DE', HL<->HL').  No per-pair CALL overhead —
            ; this is on the title-screen delay loop's hot path.
            lxi  h,sv_bc            ; HL -> saved BC/DE/HL bytes
            lxi  d,z80_bcp          ; DE -> shadow BC'/DE'/HL' bytes
            mvi  c,6
hexx_swap:
            ldax d                  ; A = shadow byte
            mov  b,m                ; B = main byte
            mov  m,a                ; main := shadow
            mov  a,b
            stax d                  ; shadow := main
            inx  h
            inx  d
            dcr  c
            jnz  hexx_swap
            ; resume = sv_ret (1-byte instruction: no operand byte to skip)
            lhld sv_ret
            shld sv_target
            jmp  finish

; ============================================================================
; h_exaf — EX AF,AF': swap AF <-> AF'.  BC/DE/HL unaffected.
; 1-byte instruction: resume = sv_ret.
; ============================================================================
; ============================================================================
; h_safe_sphl — KIND SAFE_SPHL: trapped SPHL (0xF9) sites that the game uses
; to walk a data table via SP (idiom: LXI H,delta; DAD SP; SPHL — "SP += delta"
; used both to advance a table-read pointer AND as an ordinary stack-adjust
; epilogue). On real hardware SP occasionally drifts high enough that this
; wraps 16-bit and lands SP near 0x0000-0x3FFF — harmless there because real
; ZX ROM occupies that range as genuine read-only ROM (writes vanish, reads
; return fixed known bytes). In our build that same range is our OWN
; writable RST-trap runtime, so the identical wrap corrupts the dispatcher
; itself (found and root-caused this session — see project memory). Fix:
; whenever the new SP (=program HL, already computed by the preceding
; DAD SP) would land below 0x4000, add 0x4000 before committing it. Every
; confirmed-legitimate use of this idiom in this game already keeps SP in
; 0xf3xx-0xff8a (well above 0x4000), so this is a no-op for the common case
; and only engages for the rare wraparound.
; 1-byte instruction: resume = sv_ret (the byte after the RST site).
; ============================================================================
h_safe_sphl:
            lhld sv_hl              ; HL = program HL (the value SPHL would use)
            mov  a,h
            cpi  040h                ; H>=0x40 (i.e. HL>=0x4000) -> already safe
            jnc  hsphl_safe
            mvi  a,040h
            add  h                   ; H += 0x40 (HL += 0x4000, no 16-bit overflow: H<0x40)
            mov  h,a
hsphl_safe:
            shld sv_newsp            ; finish_reti will SPHL this into the real SP
            lhld sv_ret
            shld sv_target
            jmp  finish_reti

h_exaf:
            ; Fast inline 2-byte swap (Task 16): swap sv_af <-> z80_afp directly
            ; (no CALL overhead — hot on the title-screen delay loop).
            lhld sv_af              ; HL = saved A,F  (H=A, L=F)
            xchg                    ; DE = saved A,F
            lhld z80_afp            ; HL = AF' shadow
            shld sv_af              ; sv_af := AF'
            xchg                    ; HL = saved A,F (original)
            shld z80_afp            ; AF' := old saved A,F
            ; resume = sv_ret (1-byte instruction)
            lhld sv_ret
            shld sv_target
            jmp  finish

; ============================================================================
; h_ei / h_di — program EI (0xFB) / DI (0xF3), trapped to shadow INTE.
; 1-byte instructions: resume = sv_ret (the byte after the RST site).
;
; These mirror the program's interrupt-enable intent into prog_inte, which
; finish/finish_reti consult to RESTORE (not force) INTE on every handler exit.
; The handler need not execute a real EI/DI here: the dispatcher already did a
; hard DI on entry, and `finish` re-issues the real EI exactly when prog_inte=1.
; So updating the shadow is sufficient and correct for ALL exits (incl. this one)
;   h_ei: prog_inte := 1  -> finish will EI   (interrupts become enabled)
;   h_di: prog_inte := 0  -> finish will skip EI (interrupts stay disabled)
; This matches 8080 EI semantics (effect after the following instruction): the
; finish EI;JMP makes a pending interrupt fire at the resume boundary.
; ============================================================================
h_ei:
            mvi  a,1
            sta  prog_inte          ; program INTE := enabled
            lhld sv_ret             ; resume = sv_ret (1-byte instruction)
            shld sv_target
            jmp  finish

h_di:
            xra  a
            sta  prog_inte          ; program INTE := disabled
            lhld sv_ret
            shld sv_target
            jmp  finish

; ============================================================================
; isr_inte_stub — interposed on the RST7 vblank vector (0x38).
;
; CRITICAL real-hardware correctness (T13v2-review):  accepting a maskable
; interrupt on real i8080 CLEARS the hardware INTE.  The RST7 -> 0x38 -> JMP
; <isr> entry is NATIVE/untrapped, so without this stub the software shadow
; `prog_inte` would NOT see that clear: the idle loop sits with prog_inte=1, the
; vblank ISR's first trapped op enters the dispatcher, and `finish` would read
; prog_inte=1 and emit EI -> re-enable interrupts MID-ISR (before the ISR's own
; intended EI), risking a nested re-entrant vblank ISR on a latched 50 Hz line.
;
; build_rom.py redirects vector 0x38 to JMP isr_inte_stub and patches the JMP
; operand below (isr_inte_jmp+1) to the ORIGINAL ISR target (0x01DF, read from
; the post-init image).  The stub runs at ISR ENTRY, BEFORE the real ISR pushes
; any registers, so it must NOT disturb program state: it preserves A and flags
; around the store.  push/pop is stack-balanced (the just-accepted interrupt
; already pushed the return PC; the real ISR will push more — all fine).
;
; This re-establishes the invariant: after a HW interrupt accept, prog_inte=0;
; the ISR's first trapped op then keeps INTE off (NOP in finish) until the ISR's
; own real EI (trapped) sets prog_inte=1 again — no premature mid-ISR EI.
;
; The default operand (RESUME-less unit tests) is 0; build_rom.py / the test
; patches isr_inte_jmp+1 to the real target.
; ============================================================================
isr_inte_stub:
            push psw                ; preserve A and flags (stub runs pre-ISR-save)
            xra  a
            sta  prog_inte          ; mirror HW INTE-clear into the shadow
            pop  psw                ; restore A and flags
isr_inte_jmp:
            jmp  0                  ; operand patched to original ISR target (0x01DF)

; ============================================================================
; z80_unimpl — KIND not yet handled or not found.
; Write FAIL marker and halt.
; ============================================================================
z80_unimpl:
            mvi  a,05Ah            ; TEST_FAIL
            sta  07000h
            hlt
            jmp  z80_unimpl

; ============================================================================
; out_tab — RE-ENTRANT OUT dispatch table (Task 15b)
; ----------------------------------------------------------------------------
; The OUT handlers (ED OUT (C),r and the DD/FD prefix-nop OUT (n),A) must emit
; an 8080 OUT to a RUN-TIME-computed port.  The 8080 OUT instruction takes an
; IMMEDIATE port byte, so the only way to vary it is either self-modifying code
; (a SHARED mutable instruction operand — NOT re-entrant; a vblank firing
; between the operand write and the OUT execute lets the ISR's own OUT handler
; clobber the operand, so the outer OUT writes to the WRONG port) OR a static
; per-port code path.  This table is the per-port path: 256 entries, each
;   OUT <n> ; RET   (3 bytes/entry, 768 bytes total)
; indexed by port number.  The OUT handler loads A = value and CALLs
;   out_tab + port*3
; No shared mutable instruction byte exists, so the mechanism is fully
; re-entrant with NO interrupt masking and NO DI window required.  (Kept from
; Task 15b even though Task 15c restores DI-atomic handler bodies: the table is
; harmless, faster than self-mod patching, and keeps the OUT path re-entrant.)
;
; Placed after z80_unimpl (which HLTs) so control never falls through into it;
; it is reached ONLY via CALL.  It lives outside the BUILD_ROM guard so both the
; unit-test (direct #include) and the rom build include it.
; ============================================================================
OUTTAB_PORT defl 0
out_tab:
            rept 256
            out  OUTTAB_PORT
            ret
OUTTAB_PORT defl OUTTAB_PORT+1
            endm

; ============================================================================
; out_emit — emit a re-entrant OUT.  IN: A = value to output, E = port number.
; Computes out_tab + E*3 and CALLs it.  Destroys H,L (and B,C,D,E here).
; A is preserved into the OUT (the table's OUT instruction outputs A).
; ============================================================================
out_emit:
            ; HL = E * 3 = E + E + E
            mov  l,e
            mvi  h,0           ; HL = E
            mov  c,l
            mov  b,h           ; BC = E
            dad  b             ; HL = 2E
            dad  b             ; HL = 3E
            lxi  d,out_tab
            dad  d             ; HL = out_tab + 3*E
            pchl               ; jump into the entry; its RET returns to caller
                               ; (A already holds the value to output)

; ============================================================================
; resume_stub + side-table — only assembled for the real rom build.
; The wrapper (build/runtime_main.asm) defines BUILD_ROM and includes
; src/z80state.inc (RESUME_* equs) BEFORE this file, then includes the
; generated side-table from src/z80table.inc here.
; ============================================================================
#if defined(BUILD_ROM)

; ----------------------------------------------------------------------------
; resume_stub — entry point reached via  0x0100: JMP resume_stub.
; Restores the captured post-init CPU state (frame 20) and jumps to RESUME_PC.
;
; The shipped image is post-init: init already ran, vectors built, real code at
; 0x4000.  We cannot re-run init, so we RESUME from the captured register file.
;
; ORDER (critical): first restore everything that needs scratch registers
; (the IX/IY shadow words and the alternate register bank), THEN load the
; program register pairs BC/DE/HL/AF, THEN set SP, THEN EI/DI, THEN JMP PC.
; ----------------------------------------------------------------------------
resume_stub:
            ; --- shadow IX / IY ---
            lxi  h,RESUME_IX
            shld z80_ix
            lxi  h,RESUME_IY
            shld z80_iy

            ; --- alternate register bank (Z80 BC'/DE'/HL'/AF') ---
            ; word layout matches SHLD: lo byte stored first.
            ; RESUME_BCp = B'<<8 | C'  etc. so SHLD stores C' at +0, B' at +1,
            ; which is exactly how exx_swap16 / EXX expects the shadow bank.
            lxi  h,RESUME_BCp
            shld z80_bcp
            lxi  h,RESUME_DEp
            shld z80_dep
            lxi  h,RESUME_HLp
            shld z80_hlp
            lxi  h,RESUME_AFp
            shld z80_afp

            ; --- initialise the software INTE shadow from the captured state ---
            ; prog_inte must reflect the program's interrupt-enable at resume so
            ; the FIRST trap handler restores the correct INTE on exit (before any
            ; trapped EI/DI updates the shadow).  A is free here.
#if RESUME_IFF1
            mvi  a,1
#else
            xra  a
#endif
            sta  prog_inte

            ; --- SP first: PUSH/POP PSW below needs a valid program stack
            ;     (at entry SP is the loader default and a stray PUSH would
            ;     scribble into VRAM, corrupting the frame diff). ---
            lxi  sp,RESUME_SP

            ; --- program register pairs ---
            lxi  b,RESUME_BC       ; B = B, C = C
            lxi  d,RESUME_DE       ; D = D, E = E

            ; --- A and F via PSW ---
            ; RESUME_AF = A<<8 | F  -> LXI H loads H=A, L=F; PUSH H / POP PSW.
            lxi  h,RESUME_AF
            push h
            pop  psw               ; A = RESUME_A, flags = RESUME_F

            ; --- HL (after PSW, since we needed H/L above) ---
            lxi  h,RESUME_HL       ; H = H, L = L

            ; --- interrupt enable state ---
#if RESUME_IFF1
            ei
#else
            di
#endif
            ; --- transfer control to the captured PC ---
            jmp  RESUME_PC

; ----------------------------------------------------------------------------
; Side-table: generated by tools/recompiler/patch.py (emit_table_inc).
; Bracketed by z80_table / z80_table_end, referenced by the dispatcher.
; ----------------------------------------------------------------------------
            include "z80table.inc"

#endif
