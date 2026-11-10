;  ===== ВЫРОВНЕННЫЕ ТАБЛИЦЫ (page-aligned LUT) =====================================
;  Вынесены из vec_blit.asm в отдельный модуль (2026-07-29). ПРИЧИНА: `.align 256` посреди
;  кода создавал НЕИСПОЛЬЗУЕМУЮ дыру в середине образа (до 255 Б), а хвост кода при этом
;  упирался в границу игровых переменных 0x6C00. Пока таблицы сидели в середине, модули
;  нельзя было свободно переставлять — любой сдвиг кода до них менял размер дыры.
;  ТЕПЕРЬ: этот модуль подключается ПОСЛЕДНИМ (см. src/kvalley_8c.asm), код идёт сплошняком,
;  а выравнивающий зазор оказывается ПЕРЕД таблицами в самом конце — туда можно осознанно
;  доложить код (build.sh печатает карту памяти и размер зазора).
;  ТРЕБОВАНИЕ: обе таблицы индексируются как base+byte (H=старший байт), поэтому ОБЯЗАНЫ
;  начинаться на границе 256. vec_col8 идёт сразу за vec_revtab (ровно 256 Б) — выравнивание
;  для неё выполняется автоматически.
	.align	256
;  LUT бит-реверса ужата 256 -> 16 Б (как 2+2): rev8(x) = rev4[x&15]<<4 | rev4[x>>4].
;  Индексация сложением с младшим байтом базы, страница одна (таблица сразу после align).
vec_rev4:
	db	0x000,0x008,0x004,0x00C,0x002,0x00A,0x006,0x00E
	db	0x001,0x009,0x005,0x00D,0x003,0x00B,0x007,0x00F
;  A = байт -> A = бит-реверс. Клоб A,H,L; B,C,D,E целы (smk_blk держит B = число блоков).
;  [mummy-zx] ТАБЛИЦЫ С ИНДЕКСОМ БЕЗ ПЕРЕНОСА (`add a,l / ld l,a`) — СРАЗУ ЗА vec_rev4, то есть в
;  начале выровненной страницы: здесь они не пересекут её границу ни при какой правке кода.
;  ДО ЭТОГО они стояли в kvalley_logic_pre.asm, и сдвиг кода перед ними на 27 Б (снятый
;  SetVideoMode) положил gmo_tab на 0x3EF7: ряды 5+ брали старший байт адреса из чужой
;  страницы, гем ставился в код (vsm_p2u), пачка героя писала в 0x40xx — падение. Стенд
;  lo_gate проверял только gmd_tab. Теперь границы страниц проверяет tools/page_guard.py
;  на каждой сборке.
gmo_tab:
	dw	MapaRAMRoot+0, MapaRAMRoot+96, MapaRAMRoot+192, MapaRAMRoot+288
	dw	MapaRAMRoot+384, MapaRAMRoot+480, MapaRAMRoot+576, MapaRAMRoot+672
	dw	MapaRAMRoot+768, MapaRAMRoot+864, MapaRAMRoot+960, MapaRAMRoot+1056
	dw	MapaRAMRoot+1152, MapaRAMRoot+1248, MapaRAMRoot+1344, MapaRAMRoot+1440
	dw	MapaRAMRoot+1536, MapaRAMRoot+1632, MapaRAMRoot+1728, MapaRAMRoot+1824
	dw	MapaRAMRoot+1920, MapaRAMRoot+2016, MapaRAMRoot+2112, MapaRAMRoot+2208
	dw	MapaRAMRoot+2304, MapaRAMRoot+2400, MapaRAMRoot+2496, MapaRAMRoot+2592
	dw	MapaRAMRoot+2688, MapaRAMRoot+2784, MapaRAMRoot+2880, MapaRAMRoot+2976
gmd_tab:	dw	momiaDat, momiaDat+22, momiaDat+44, momiaDat+66
vec_rev8:
	push	bc
	ld	l, a
	rrca
	rrca
	rrca
	rrca
	and	0x0F
	add	a, vec_rev4&255
	ld	b, a
	ld	a, l
	and	0x0F
	add	a, vec_rev4&255
	ld	l, a
	ld	h, vec_rev4>>8
	ld	a, (hl)
	rlca
	rlca
	rlca
	rlca
	ld	l, b
	or	(hl)
	pop	bc
	ret
;  Ходьба 25 Гц: два тика 0xA8. Иначе 0x150 даёт +2 px и минует X&7==0 (стену).
protaWalk2:
	call	mueveProta
	call	chkChocaAndar
	ret	c
	jp	mueveProta
;  То же для мумии: chkChocaAndar2 с HL = CONTROL текущей записи.
mumWalk2:
	call	mueveMomia
	ld	hl, (pMomiaProceso)
	inc	l
	call	chkChocaAndar2
	ret	c
	jp	mueveMomia
;  ФАЗА 1 8-ЦВЕТ: vec_col8 LUT (256Б, page-aligned сразу за vec_revtab; ROM). Только KV_8COLOR.
;  [2026-07-29] ТАБЛИЦА vec_col8 (256 Б) УДАЛЕНА — заменена проверкой диапазонов в
;  vbt8_ent (vec_blit.asm). В таблице было всего 8 ненулевых байт, все = 1.
