	org 0x100
start:
	di
	ld sp,0x7000
a_start:
	ld hl,0x9448
	ld sp,hl
	ld hl,0x9048
	ld b,11
ca_row:
	pop de
	ld (hl),e
	inc l
	ld (hl),d
	inc l
	pop de
	ld (hl),e
	inc l
	ld (hl),d
	inc l
	pop de
	ld (hl),e
	inc l
	ld (hl),d
	inc l
	pop de
	ld (hl),e
	inc l
	ld (hl),d
	inc l
	pop de
	ld (hl),e
	inc l
	ld (hl),d
	inc l
	pop de
	ld (hl),e
	inc l
	ld (hl),d
	inc l
	pop de
	ld (hl),e
	inc l
	ld (hl),d
	inc l
	pop de
	ld (hl),e
	inc l
	ld (hl),d
	inc l
	dec b
	jp nz,ca_row
	ld sp,0x7000
a_end:
bp0:	ld sp,0x9448
	pop bc
	pop de
	pop hl
	pop af
bq0:	ld sp,0x9050
	push af
	push hl
	push de
	push bc
bp1:	ld sp,0x9450
	pop bc
	pop de
	pop hl
	pop af
bq1:	ld sp,0x9058
	push af
	push hl
	push de
	push bc
bp2:	ld sp,0x9458
	pop bc
	pop de
	pop hl
	pop af
bq2:	ld sp,0x9060
	push af
	push hl
	push de
	push bc
bp3:	ld sp,0x9460
	pop bc
	pop de
	pop hl
	pop af
bq3:	ld sp,0x9068
	push af
	push hl
	push de
	push bc
bp4:	ld sp,0x9468
	pop bc
	pop de
	pop hl
	pop af
bq4:	ld sp,0x9070
	push af
	push hl
	push de
	push bc
bp5:	ld sp,0x9470
	pop bc
	pop de
	pop hl
	pop af
bq5:	ld sp,0x9078
	push af
	push hl
	push de
	push bc
bp6:	ld sp,0x9478
	pop bc
	pop de
	pop hl
	pop af
bq6:	ld sp,0x9080
	push af
	push hl
	push de
	push bc
bp7:	ld sp,0x9480
	pop bc
	pop de
	pop hl
	pop af
bq7:	ld sp,0x9088
	push af
	push hl
	push de
	push bc
bp8:	ld sp,0x9488
	pop bc
	pop de
	pop hl
	pop af
bq8:	ld sp,0x9090
	push af
	push hl
	push de
	push bc
bp9:	ld sp,0x9490
	pop bc
	pop de
	pop hl
	pop af
bq9:	ld sp,0x9098
	push af
	push hl
	push de
	push bc
bp10:	ld sp,0x9498
	pop bc
	pop de
	pop hl
	pop af
bq10:	ld sp,0x90a0
	push af
	push hl
	push de
	push bc
bp11:	ld sp,0x94a0
	pop bc
	pop de
	pop hl
	pop af
bq11:	ld sp,0x90a8
	push af
	push hl
	push de
	push bc
bp12:	ld sp,0x94a8
	pop bc
	pop de
	pop hl
	pop af
bq12:	ld sp,0x90b0
	push af
	push hl
	push de
	push bc
bp13:	ld sp,0x94b0
	pop bc
	pop de
	pop hl
	pop af
bq13:	ld sp,0x90b8
	push af
	push hl
	push de
	push bc
bp14:	ld sp,0x94b8
	pop bc
	pop de
	pop hl
	pop af
bq14:	ld sp,0x90c0
	push af
	push hl
	push de
	push bc
bp15:	ld sp,0x94c0
	pop bc
	pop de
	pop hl
	pop af
bq15:	ld sp,0x90c8
	push af
	push hl
	push de
	push bc
bp16:	ld sp,0x94c8
	pop bc
	pop de
	pop hl
	pop af
bq16:	ld sp,0x90d0
	push af
	push hl
	push de
	push bc
bp17:	ld sp,0x94d0
	pop bc
	pop de
	pop hl
	pop af
bq17:	ld sp,0x90d8
	push af
	push hl
	push de
	push bc
bp18:	ld sp,0x94d8
	pop bc
	pop de
	pop hl
	pop af
bq18:	ld sp,0x90e0
	push af
	push hl
	push de
	push bc
bp19:	ld sp,0x94e0
	pop bc
	pop de
	pop hl
	pop af
bq19:	ld sp,0x90e8
	push af
	push hl
	push de
	push bc
bp20:	ld sp,0x94e8
	pop bc
	pop de
	pop hl
	pop af
bq20:	ld sp,0x90f0
	push af
	push hl
	push de
	push bc
bp21:	ld sp,0x94f0
	pop bc
	pop de
	pop hl
	pop af
bq21:	ld sp,0x90f8
	push af
	push hl
	push de
	push bc
	ld sp,0x7000
b_end:
	ld a,0x94
	ld (bp0+2),a
	ld (bp1+2),a
	ld (bp2+2),a
	ld (bp3+2),a
	ld (bp4+2),a
	ld (bp5+2),a
	ld (bp6+2),a
	ld (bp7+2),a
	ld (bp8+2),a
	ld (bp9+2),a
	ld (bp10+2),a
	ld (bp11+2),a
	ld (bp12+2),a
	ld (bp13+2),a
	ld (bp14+2),a
	ld (bp15+2),a
	ld (bp16+2),a
	ld (bp17+2),a
	ld (bp18+2),a
	ld (bp19+2),a
	ld (bp20+2),a
	ld (bp21+2),a
	ld a,0x90
	ld (bq0+2),a
	ld (bq1+2),a
	ld (bq2+2),a
	ld (bq3+2),a
	ld (bq4+2),a
	ld (bq5+2),a
	ld (bq6+2),a
	ld (bq7+2),a
	ld (bq8+2),a
	ld (bq9+2),a
	ld (bq10+2),a
	ld (bq11+2),a
	ld (bq12+2),a
	ld (bq13+2),a
	ld (bq14+2),a
	ld (bq15+2),a
	ld (bq16+2),a
	ld (bq17+2),a
	ld (bq18+2),a
	ld (bq19+2),a
	ld (bq20+2),a
	ld (bq21+2),a
c_end:
ep0:	ld sp,0x9448
	pop bc
	pop de
	pop hl
eq0:	ld sp,0x904e
	push hl
	push de
	push bc
ep1:	ld sp,0x944e
	pop bc
	pop de
	pop hl
eq1:	ld sp,0x9054
	push hl
	push de
	push bc
ep2:	ld sp,0x9454
	pop bc
	pop de
	pop hl
eq2:	ld sp,0x905a
	push hl
	push de
	push bc
ep3:	ld sp,0x945a
	pop bc
	pop de
	pop hl
eq3:	ld sp,0x9060
	push hl
	push de
	push bc
ep4:	ld sp,0x9460
	pop bc
	pop de
	pop hl
eq4:	ld sp,0x9066
	push hl
	push de
	push bc
ep5:	ld sp,0x9466
	pop bc
	pop de
	pop hl
eq5:	ld sp,0x906c
	push hl
	push de
	push bc
ep6:	ld sp,0x946c
	pop bc
	pop de
	pop hl
eq6:	ld sp,0x9072
	push hl
	push de
	push bc
ep7:	ld sp,0x9472
	pop bc
	pop de
	pop hl
eq7:	ld sp,0x9078
	push hl
	push de
	push bc
ep8:	ld sp,0x9478
	pop bc
	pop de
	pop hl
eq8:	ld sp,0x907e
	push hl
	push de
	push bc
ep9:	ld sp,0x947e
	pop bc
	pop de
	pop hl
eq9:	ld sp,0x9084
	push hl
	push de
	push bc
ep10:	ld sp,0x9484
	pop bc
	pop de
	pop hl
eq10:	ld sp,0x908a
	push hl
	push de
	push bc
ep11:	ld sp,0x948a
	pop bc
	pop de
	pop hl
eq11:	ld sp,0x9090
	push hl
	push de
	push bc
ep12:	ld sp,0x9490
	pop bc
	pop de
	pop hl
eq12:	ld sp,0x9096
	push hl
	push de
	push bc
ep13:	ld sp,0x9496
	pop bc
	pop de
	pop hl
eq13:	ld sp,0x909c
	push hl
	push de
	push bc
ep14:	ld sp,0x949c
	pop bc
	pop de
	pop hl
eq14:	ld sp,0x90a2
	push hl
	push de
	push bc
ep15:	ld sp,0x94a2
	pop bc
	pop de
	pop hl
eq15:	ld sp,0x90a8
	push hl
	push de
	push bc
ep16:	ld sp,0x94a8
	pop bc
	pop de
	pop hl
eq16:	ld sp,0x90ae
	push hl
	push de
	push bc
ep17:	ld sp,0x94ae
	pop bc
	pop de
	pop hl
eq17:	ld sp,0x90b4
	push hl
	push de
	push bc
ep18:	ld sp,0x94b4
	pop bc
	pop de
	pop hl
eq18:	ld sp,0x90ba
	push hl
	push de
	push bc
ep19:	ld sp,0x94ba
	pop bc
	pop de
	pop hl
eq19:	ld sp,0x90c0
	push hl
	push de
	push bc
ep20:	ld sp,0x94c0
	pop bc
	pop de
	pop hl
eq20:	ld sp,0x90c6
	push hl
	push de
	push bc
ep21:	ld sp,0x94c6
	pop bc
	pop de
	pop hl
eq21:	ld sp,0x90cc
	push hl
	push de
	push bc
ep22:	ld sp,0x94cc
	pop bc
	pop de
	pop hl
eq22:	ld sp,0x90d2
	push hl
	push de
	push bc
ep23:	ld sp,0x94d2
	pop bc
	pop de
	pop hl
eq23:	ld sp,0x90d8
	push hl
	push de
	push bc
ep24:	ld sp,0x94d8
	pop bc
	pop de
	pop hl
eq24:	ld sp,0x90de
	push hl
	push de
	push bc
ep25:	ld sp,0x94de
	pop bc
	pop de
	pop hl
eq25:	ld sp,0x90e4
	push hl
	push de
	push bc
ep26:	ld sp,0x94e4
	pop bc
	pop de
	pop hl
eq26:	ld sp,0x90ea
	push hl
	push de
	push bc
ep27:	ld sp,0x94ea
	pop bc
	pop de
	pop hl
eq27:	ld sp,0x90f0
	push hl
	push de
	push bc
ep28:	ld sp,0x94f0
	pop bc
	pop de
	pop hl
eq28:	ld sp,0x90f6
	push hl
	push de
	push bc
	ld sp,0x94f6
	pop de
	ld hl,0x90f6
	ld (hl),e
	inc l
	ld (hl),d
	ld sp,0x7000
e_end:
	ld a,0x94
	ld (ep0+2),a
	ld (ep1+2),a
	ld (ep2+2),a
	ld (ep3+2),a
	ld (ep4+2),a
	ld (ep5+2),a
	ld (ep6+2),a
	ld (ep7+2),a
	ld (ep8+2),a
	ld (ep9+2),a
	ld (ep10+2),a
	ld (ep11+2),a
	ld (ep12+2),a
	ld (ep13+2),a
	ld (ep14+2),a
	ld (ep15+2),a
	ld (ep16+2),a
	ld (ep17+2),a
	ld (ep18+2),a
	ld (ep19+2),a
	ld (ep20+2),a
	ld (ep21+2),a
	ld (ep22+2),a
	ld (ep23+2),a
	ld (ep24+2),a
	ld (ep25+2),a
	ld (ep26+2),a
	ld (ep27+2),a
	ld (ep28+2),a
	ld a,0x90
	ld (eq0+2),a
	ld (eq1+2),a
	ld (eq2+2),a
	ld (eq3+2),a
	ld (eq4+2),a
	ld (eq5+2),a
	ld (eq6+2),a
	ld (eq7+2),a
	ld (eq8+2),a
	ld (eq9+2),a
	ld (eq10+2),a
	ld (eq11+2),a
	ld (eq12+2),a
	ld (eq13+2),a
	ld (eq14+2),a
	ld (eq15+2),a
	ld (eq16+2),a
	ld (eq17+2),a
	ld (eq18+2),a
	ld (eq19+2),a
	ld (eq20+2),a
	ld (eq21+2),a
	ld (eq22+2),a
	ld (eq23+2),a
	ld (eq24+2),a
	ld (eq25+2),a
	ld (eq26+2),a
	ld (eq27+2),a
	ld (eq28+2),a
f_end:
hang:	jp hang
