; Просмотрщик-«прямой»: плоскости лежат в файле по смещению 0x8000 и грузятся
; загрузчиком ПРЯМО в видеопамять — распаковки нет. Код ставит скролл и палитру.
; Палитра пишется со ВТОРОГО прерывания: первое после EI приходит с накопившимся
; INT посреди кадра, а запись попадает в слот, отображаемый лучом В МОМЕНТ записи.
	org 0x100
	di
	ld sp, 0x7F00
	ld a, 0x88	; ППА: порт B = ВЫХОД (кайма+mode512); вход (0x8A) даёт opb=0xFF -> 512-режим и слот 15
	out (0x00), a
	ld a, 0xC3
	ld (0x38), a
	ld hl, isr_skip
	ld (0x39), hl
	ei
stop:
	jp stop
isr_skip:
	ld hl, isr
	ld (0x39), hl
	ei
	ret
isr:
	ld a, 0xFF
	out (0x03), a
	ld hl, pal+15
	ld de, 0x100F
ploop:
	ld a, e
	out (0x02), a
	ld a, (hl)
	out (0x0C), a
	out (0x0C), a
	out (0x0C), a
	out (0x0C), a
	out (0x0C), a
	out (0x0C), a
	out (0x0C), a
	out (0x0C), a
	dec hl
	dec e
	dec d
	jp nz, ploop
	xor a
	out (0x02), a
	ld hl, isr2
	ld (0x39), hl
isr2:
	ei
	ret
pal:
	incbin "v13_pal.bin"
	ds 0x8000-$, 0
	incbin "v13_planes.raw"
