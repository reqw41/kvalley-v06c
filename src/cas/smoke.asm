; ДЫМОВОЙ ТЕСТ КАССЕТНОЙ ЦЕПОЧКИ.
; Грузится штатным ПЗУ-загрузчиком (boots.bin, F1 при сбросе) в формате
; v06c-rom. Рисует 16 вертикальных полос индексами 0..15 и ставит палитру
; заставки. Если на экране 16 полос нужных цветов — цепочка «лента -> ПЗУ ->
; наш код -> видеопамять -> палитра» работает целиком.
;
; Уроки железа (см. docs/cas/README-cas.md):
;   ППА = 0x88 (порт B ВЫХОД). 0x8A даёт opb=0xFF -> mode512 и кайму 15.
;   Палитра пишется только в кадровом гашении: запись попадает в слот,
;   отображаемый лучом В МОМЕНТ записи.
;   Первое прерывание после долгого DI — холостое (накопившийся INT).
	org 0x100

	di
	ld sp, 0x7F00
	ld a, 0x88
	out (0x00), a

; ---- 16 вертикальных полос: байт-колонка j (0..31), цвет = j>>1 -----------
	ld c, 0			; номер плоскости 0..3
	ld b, 0x80		; старший байт базы плоскости
plane:
	ld h, b
	ld e, 0			; байт-колонка
column:
	ld a, e
	or a
	rra			; a = цвет 0..15
	ld d, c
	inc d
shift:
	dec d
	jp z, gotbit
	or a
	rra
	jp shift
gotbit:
	rra			; CY = бит плоскости
	ld a, 0x00
	jp nc, fill
	ld a, 0xFF
fill:
	ld d, a
	ld l, 0
fillrow:
	ld (hl), d
	inc l
	jp nz, fillrow
	inc h
	inc e
	ld a, e
	cp 32
	jp nz, column
	ld a, b
	add a, 0x20
	ld b, a
	inc c
	ld a, c
	cp 4
	jp nz, plane

; ---- палитра через прерывание (только в гашении) --------------------------
	ld a, 0xC3
	ld (0x38), a
	ld hl, isr_skip
	ld (0x39), hl
	ei
stop:
	jp stop

isr_skip:			; холостое: INT накопился за время DI
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
	incbin "../../docs/cas/v16_pal.bin"
