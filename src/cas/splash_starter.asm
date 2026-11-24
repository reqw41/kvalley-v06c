; Стартер ROM-версии с заставкой: показывает картинку 5 с, затем запускает игру.
; Файл .rom: [0x0100 jp 0x7800 + игра][0x7800 этот код][0x8000 плоскости заставки].
; 0x7600 занят оверлеем AY/ВИ53 (MapaRAM 0x75A5+): стартер там затирал бэкенд,
; и после обложки музыка поднималась с дырки. 0x7800 — после оверлея, до плоскостей.
; Уроки железа: ППА 0x88 (B выходом), палитра в гашении, первое прерывание холостое.
	org 0x7800
	di
	ld sp, 0x7E00
	ld a, 0x88
	out (0x00), a
	ld a, 0xC3	; RST7 -> jp isr_skip
	ld (0x38), a
	ld hl, isr_skip
	ld (0x39), hl
	xor a
	ld (frames), a
	ei
wait5s:
	halt
	ld a, (frames)
	cp 250	; 5 с по 50 Гц
	jp c, wait5s
; Погасить палитру до прыжка в игру: игра до своей чёрной палитры (vec_setpal) уже пишет в экран
; поверх обложки, и в палитре обложки это виден мусор. Палитру пишет ISR (в гашении), ждём два кадра.
	ld hl, zero+15
	ld (palp), hl
	xor a
	ld (paldone), a
	halt
	halt
; вернуть игре её первые 3 байта и стартовать
	di
	ld hl, orig3
	ld de, 0x0100
	ld a, (hl)
	ld (de), a
	inc hl
	inc de
	ld a, (hl)
	ld (de), a
	inc hl
	inc de
	ld a, (hl)
	ld (de), a
	jp 0x0100
; Читы включаются только F1+F3 на игровом титуле, как в ROM без заставки.
isr_skip:
	ld hl, isr
	ld (0x39), hl
	ei
	ret
isr:	; скролл + палитра один раз, дальше только счёт кадров
	push af
	push hl
	push de
	ld a, 0xFF
	out (0x03), a
	ld a, (paldone)
	or a
	jp nz, count
	ld a, 1
	ld (paldone), a
	ld hl, (palp)
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
count:
	ld a, (frames)
	inc a
	ld (frames), a
	pop de
	pop hl
	pop af
	ei
	ret
pal:
	incbin "v16_pal.bin"
orig3:
	incbin "orig3.bin"
palp:
	dw pal+15
zero:
	ds 16
frames:
	db 0
paldone:
	db 0
