;  [mummy-zx-a V1] Подготовка героя без лишних проходов (хвост за выравниванием).
;  1) vsp_hcel: кадр героя больше НЕ собирается в vec_spr_asml (vsp_asm копировал 4 ячейки
;     по 8 Б из pool, ~870 тактов на объект). Строчная петля vsp_row читает ячейки прямо из
;     vec_spr_pool четвертями по 8 строк: половина 0 = ячейки 0,1, половина 1 = ячейки 2,3 —
;     ровно тот порядок, в каком их раскладывал vsp_asm. Зеркальный герой идёт по-старому
;     (готовый кэш vec_spr_buf_mir), мумии/нож/карта — линейные таблицы, их путь не тронут.
;  2) vsd_orl: слияние кожи в буфер одежды — развёрнуто на 8 и только по НАШИМ столбцам
;     (ncols*16 байт вместо всех 48: узкий объект свой 3-й столбец уже признал пустым).
;  vsp_mp — указатель в карте на время одного vsp_pat (скретч vec_spr_asml: он нужен только
;  vec_spr_mkmir, а та из подготовки не зовётся).
vsp_mp:	equ	vec_spr_asml

;  Маски, вход в цепочку rrca, страница слота (общая часть vsp_msk).
vsp_mset:
	ld	a, (vsp_sh)
	ld	l, a
	ld	h, 0
	ld	de, vsp_masks
	add	hl, de
	ld	a, (hl)	; маска своего столбца = 0xFF>>s
	ld	(vsp_m1+1), a
	cpl	; ~маска = перелив в соседний столбец
	ld	(vsp_m2+1), a
	ld	hl, vsp_r0	; вход в цепочку rrca = vsp_r0 - s (каждый rrca = 1 байт)
	ld	a, (vsp_sh)
	ld	c, a
	ld	a, l
	sub	c
	ld	l, a
	ld	a, h
	sbc	a, 0
	ld	h, a
	ld	(vsp_jp+1), hl
	call	vec_su_ptr	; H = страница слота
	ld	a, h
	ld	(vsp_pg), a
	ret

;  Вход: L = pat&0xFC, DE = база карты героя (операнд vsp_hbase).
vsp_hcel:
	ld	h, 0
	add	hl, de
	ld	(vsp_mp), hl
	call	vsp_mset
	xor	a	; половина 0: столбец 0 пишется поверх (nop вместо or (hl))
	ld	(vsp_orm), a
	ld	(vsp_orm2), a
	ld	a, (vsp_pg)
	ld	h, a
	ld	d, a
	ld	l, 0x0AF
	ld	e, 0x0BF
	ld	a, 0x0A7	; строки 0-7 из ячейки 0
	call	vsp_hq
	ld	a, 0x09F	; строки 8-15 из ячейки 1
	call	vsp_hq
	ld	a, 0x0B6	; половина 1: столбец 1 через OR (там перелив половины 0)
	ld	(vsp_orm), a
	ld	(vsp_orm2), a
	ld	a, (vsp_pg)
	ld	h, a
	ld	d, a
	ld	l, 0x0BF
	ld	e, 0x0CF
	ld	a, 0x0B7	; ячейка 2
	call	vsp_hq
	ld	a, 0x0AF	; ячейка 3 (возврат из vsp_row — сразу вызывающему vsp_pat)
;  Четверть: A = конец (операнд vsp_cpe), BC := pool + 8*map[mp++], HL/DE не трогаем.
vsp_hq:
	ld	(vsp_cpe+1), a
	ld	(vsp_cpe2+1), a
	push	hl
	ld	hl, (vsp_mp)
	ld	a, (hl)
	inc	hl
	ld	(vsp_mp), hl
	ld	l, a
	ld	h, 0
	add	hl, hl
	add	hl, hl
	add	hl, hl
	ld	bc, vec_spr_pool
	add	hl, bc
	ld	b, h
	ld	c, l
	pop	hl
	jp	vsp_row

;  DE = буфер соседа +0xA0, HL = наш буфер +0xA0 (одна страница на каждого, шаг inc).
vsd_orl:
	ld	a, (vsu_nc)
	add	a, a	; 2 витка по 8 байт на столбец
	ld	b, a
vsd_or8:
	ld	a, (de)
	or	(hl)
	ld	(de), a
	inc	l
	inc	e
	ld	a, (de)
	or	(hl)
	ld	(de), a
	inc	l
	inc	e
	ld	a, (de)
	or	(hl)
	ld	(de), a
	inc	l
	inc	e
	ld	a, (de)
	or	(hl)
	ld	(de), a
	inc	l
	inc	e
	ld	a, (de)
	or	(hl)
	ld	(de), a
	inc	l
	inc	e
	ld	a, (de)
	or	(hl)
	ld	(de), a
	inc	l
	inc	e
	ld	a, (de)
	or	(hl)
	ld	(de), a
	inc	l
	inc	e
	ld	a, (de)
	or	(hl)
	ld	(de), a
	inc	l
	inc	e
	dec	b
	jp	nz, vsd_or8
	ret
