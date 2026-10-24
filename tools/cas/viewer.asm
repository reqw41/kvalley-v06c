; Просмотрщик заставки Вектор-06Ц: 256x256, 16 цветов, RLE (count,byte).
; Палитра пишется ОДИН РАЗ из первого прерывания: сразу после IRQ идёт кадровое
; гашение — записи не гонятся с лучом (каждокадровая перезапись на MiSTer давала
; вертикальные полосы). Формат данных: 16 байт палитры (BBGGGRRR) + RLE плоскостей.
	org 0x100
	di
	ld sp, 0x7F00
	ld a, 0x88	; ППА: порт B = ВЫХОД (кайма+mode512); вход (0x8A) даёт opb=0xFF -> 512-режим и слот 15
	out (0x00), a
	ld a, 0xC3	; RST7 (0x38) -> jp isr_skip
	ld (0x38), a
	ld hl, isr_skip
	ld (0x39), hl
; распаковка RLE в экран 0x8000..0xFFFF
	ld de, data+16
	ld hl, 0x8000
unp:
	ld a, (de)
	inc de
	ld b, a
	ld a, (de)
	inc de
	ld c, a
runl:
	ld (hl), c
	inc hl
	dec b
	jp nz, runl
	ld a, h
	or l
	jp nz, unp
	ei
stop:
	jp stop
;  ПЕРВОЕ прерывание — холостое: после долгого DI-периода EI впускает НАКОПИВШИЙСЯ INT
;  посреди кадра, а запись палитры попадает в слот, который луч отображает В МОМЕНТ
;  записи (palette[color_idx] в RTL ядра). Пишем со ВТОРОГО прерывания — оно приходит
;  строго в начале кадрового гашения, луч в кайме, слот = индексу каймы из порта 0x02.
isr_skip:
	ld hl, isr
	ld (0x39), hl
	ei
	ret
; --- второй VBlank: скролл + палитра, затем ISR подменяет себя пустышкой ---
isr:
	ld a, 0xFF	; строка fb 255 наверху
	out (0x03), a
	ld hl, data+15
	ld de, 0x100F
pal:
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
	jp nz, pal
	xor a	; индекс на 0, чтобы кайма не осталась цветом последнего слота
	out (0x02), a
	ld hl, isr2	; больше палитру не трогаем
	ld (0x39), hl
isr2:
	ei
	ret
data:
	incbin "IMG.rle"
