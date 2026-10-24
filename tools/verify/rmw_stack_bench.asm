; M3 rollout-B: stack-RMW mixed-byte investigation - isolated micro-benchmark.
; Measures REAL i8080 T-states (headless vector06js, same CPU model as
; render_profile.js) for current-style HL-indirect fused RMW vs stack-based
; POP/PUSH RMW, for the MASKED (per-byte-varying immediate) combine that
; spc_wrm_white/red/ochre perform in v2/driver_vector.asm - see
; m3-rollout-b-report.md for the conclusion (NO-GO for mixed bytes).
; i8080-only subset (checked via check_i8080.js) - assembled by tools/bin/sjasm.
        org     100h
        di
        jp      main

mask_var:       db      0
mask_var2:      db      0
data_base:      ds      32

main:
        ld      a, 5Ah
        ld      (mask_var), a
        ld      a, 0A5h
        ld      (mask_var2), a
        ld      hl, data_base+31
        ld      b, 32
initl:
        ld      (hl), 0FFh
        dec     l
        dec     b
        jp      nz, initl

; --- Method A: current spc_wrm_* style - single byte HL-indirect fused
; read+OR (or (hl), 7T) then write (ld (hl),a, 7T), mask reloaded via LDA
; each byte (13T) - mirrors spc_wrm_red/white plane1 OR-touch exactly.
methodA_start:
        ld      hl, data_base+31
        ld      b, 16
methA_loop:
        ld      a, (mask_var)
        or      (hl)
        ld      (hl), a
        dec     l
        dec     b
        jp      nz, methA_loop
methodA_end:
        jp      methodB_start

; --- Method B: stack-RMW paired - SP=HL (sphl), pop de (2 bytes), apply
; per-byte mask via mov-to-A/or/mov-back (unavoidable shuffle since ALU
; only operates via A), push de (write back same 2 addrs), advance HL by 2.
methodB_start:
        ld      hl, data_base+14        ; lower addr of first pair [14,15]
        ld      b, 8
methB_loop:
        ld      sp, hl
        pop     de
        ld      a, (mask_var)
        or      e
        ld      e, a
        ld      a, (mask_var2)
        or      d
        ld      d, a
        push    de
        dec     l
        dec     l
        dec     b
        jp      nz, methB_loop
methodB_end:
        ld      hl, 0C300h
        ld      sp, hl

; --- Positive control: solid-run current-style (per byte literal store) ---
methodC_start:
        ld      hl, data_base+31
        ld      b, 16
methC_loop:
        ld      (hl), 0FFh
        dec     l
        dec     b
        jp      nz, methC_loop
methodC_end:
        jp      methodD_start

; --- Positive control: solid-run PUSH (constant pair, no per-byte mask -
; this is the case rollout-A/recon ALREADY proved wins ~5.5T/byte; sanity
; check that THIS harness shows the same expected win, i.e. harness itself
; is not biased against the stack technique in general). ---
methodD_start:
        ld      hl, data_base+14
        ld      sp, hl
        ld      bc, 0FFFFh
        push    bc
        push    bc
        push    bc
        push    bc
        push    bc
        push    bc
        push    bc
        push    bc
methodD_end:
        ld      hl, 0C300h
        ld      sp, hl

; --- Method B with full DI/EI SP-hijack ceremony (as sps_restore_sprite
; does) wrapped around it, to measure REALISTIC overhead if rolled out. ---
realsp:         dw      0
methodE_start:
        di
        ld      hl, 0
        add     hl, sp
        ld      (realsp), hl
        ld      hl, data_base+14
        ld      b, 8
methE_loop:
        ld      sp, hl
        pop     de
        ld      a, (mask_var)
        or      e
        ld      e, a
        ld      a, (mask_var2)
        or      d
        ld      d, a
        push    de
        dec     l
        dec     l
        dec     b
        jp      nz, methE_loop
        ld      hl, (realsp)
        ld      sp, hl
        ei
methodE_end:
        halt
