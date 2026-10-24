; ===== Построитель ЗЕРКАЛО-КЭША (RENDER-опт): предзеркалить спрайты hero/momia =====
; src(off) -> vec_spr_buf_mir(off): обмен 16Б-половин + бит-реверс (LUT).
; Один раз на loadAnimation. 13 блоков = hero (10) + momia (3), off 0..0x180.
; ЗАДАЧА #12 / фаза 2: герой — карта (vsp_hbase) + vec_spr_pool; каждый кадр собирается
; в vec_spr_asml через vsp_asm, затем зеркалится в кэш. Мумия — линейная таблица образа.
; Приёмник сплошной: смещения зеркал и адресация vsp_pat не менялись.
vec_spr_mkmir:
	ld	de, vec_spr_buf_mir
	xor	a		; pat = 0,4,...,0x24
	ld	b, 10
smk_hero:
	push	af
	push	bc
	push	de		; dest в кэше
	ld	c, a		; C = pat
	ld	hl, (vsp_hbase+1)
	ex	de, hl		; DE = карта текущего набора
	ld	l, c
	call	vsp_asm		; HL = asml
	pop	de
	ld	b, 1
	call	smk_blk
	pop	bc
	pop	af
	add	a, 4
	dec	b
	jp	nz, smk_hero
	ld	hl, vec_spr_momia	; мумия — постоянная таблица образа
	ld	b, 3
	call	smk_blk
;  ===== ЗАДАЧА #44 ШАГ 1: ДОСДВИГ ЗЕРКАЛ МУМИИ ВЛЕВО ================================
;  Арт мумии в образе прижат к ЛЕВОМУ краю клетки (сдвинут влево на 3, см.
;  momia_push_left в tools/gfx/spr_unpack.py). Отзеркаливание 16-битной строки переносит
;  сдвиг в ДРУГУЮ сторону: rev16(x<<3) = rev16(x)>>3, то есть зеркало вышло бы прижатым
;  ВПРАВО — а геометрия вывода пустой ЛЕВЫЙ столбец отбрасывать не умеет, и весь выигрыш
;  терялся бы на мумиях, идущих в другую сторону.
;  Раньше досдвигали на 6 = 3+3, пока силуэт был 9 px и сидел в [0..8]/[1..9].
;  После cap8 прямые кадры в [0..7] (стойка [2..7]). <<6 оставлял шаг в [2..9], и загиб
;  в пиксель 7 СРЕЗАЛ левый ход (8→6). <<8 кладёт шаг обратно в [0..7] без загиба;
;  стойка зеркала уезжает в [0..5] — на 2 px левее прямой, зато силуэт целый.
;  Старшие биты нулевые, теряться нечему.
;  ЦЕНА: ~6 тыс. тактов ОДИН РАЗ на loadAnimation (загрузка уровня, подбор предмета).
;  В геймплее — ноль тактов.
smk_shift:
	ld	hl, vec_spr_buf_mir+0x140	; 3 блока мумии в кэше зеркал
	ld	c, 3
sms_blk:
	ld	b, 16
sms_row:
	ld	d, (hl)		; D = левый байт строки
	push	hl
	ld	a, l		; HL -> правый байт той же строки (+16)
	add	a, 16
	ld	l, a
	ld	a, h
	adc	a, 0
	ld	h, a
	ld	e, (hl)		; E = правый байт
	ex	de, hl		; HL = строка целиком
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl		; <<8: [8..15] -> [0..7]
	ex	de, hl		; HL снова адрес правого байта, DE = сдвинутая строка
	ld	(hl), e
	pop	hl
	ld	(hl), d
	inc	hl
	dec	b
	jp	nz, sms_row
	ld	a, l		; следующий блок: пропустить правую половину (+16)
	add	a, 16
	ld	l, a
	ld	a, h
	adc	a, 0
	ld	h, a
	dec	c
	jp	nz, sms_blk
	ret
smk_blk:
	push	hl		; сохранить базу блока-источника
	ld	a, l
	add	a, 16
	ld	l, a
	ld	a, h
	adc	a, 0
	ld	h, a	; HL = src+16
	ld	c, 16
smk_lo:		; mir[0..15] = rev8[ src[16..31] ]
	ld	a, (hl)
	inc	hl
	push	hl
	call	vec_rev8
	pop	hl
	ld	(de), a
	inc	de
	dec	c
	jp	nz, smk_lo
	pop	hl		; HL = база блока-источника
	ld	c, 16
smk_hi:		; mir[16..31] = rev8[ src[0..15] ]
	ld	a, (hl)
	inc	hl
	push	hl
	call	vec_rev8
	pop	hl
	ld	(de), a
	inc	de
	dec	c
	jp	nz, smk_hi
	ld	a, l
	add	a, 16
	ld	l, a
	ld	a, h
	adc	a, 0
	ld	h, a	; HL = src+32
	dec	b
	jp	nz, smk_blk
	ret
