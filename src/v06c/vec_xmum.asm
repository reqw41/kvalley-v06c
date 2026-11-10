;  ===== ВАРИАНТ A (mummy-zx, прототип): ВРАГИ 6..13 — XOR ОДНОЙ ПЛОСКОСТЬЮ, БЕЗ СЕЙВА ФОНА =====
;  ЗАЧЕМ. Цена мумии в 3p — подготовка композита (гашение чужих плоскостей vom_check, сейв
;  до трёх плоскостей, restore). Здесь враг пишет ОДНУ свою плоскость XOR-ом: стирание —
;  тот же XOR по запомненной картинке, фон не сохраняется. Цвет: над пустотой — цвет своей
;  плоскости (как раньше), над фоном с той же плоскостью — «дырка» (XOR), чужие плоскости
;  не гасятся (мумия полупрозрачна, как до задачи #41).
;  ПОЧЕМУ НЕ «ПЕРЕРИСОВКА КЛЕТОК», КАК В MONTY: клетка фона здесь не копия из кэша, а
;  сборка цвета по трём плоскостям (vbt8_ent) — замер 1,9 тыс. тактов на клетку плюс
;  3,8 тыс. на подновление слотов; габарит мумии — до 9 клеток. Дороже всей подготовки.
;  ЗАПИСЬ «ЧТО ВЫВЕДЕНО» — ШАПКА СЛОТА: valid=1, hi0, lo0, ncols, hi0b=hi0c=0, а данные слота
;  (+0x06, ncols*16 Б низ-вверх, формат буфера +0xA0) — копия выведенной картинки. Поэтому
;  все штатные сбросы слотов (скролл, flush) и fixup после блита клетки работают как есть.
;  ПОРЯДОК В ПАЧКЕ (иначе призраки): стирание всех прочих (restore) -> XOR мумий (стереть
;  старую, вывести новую) -> сейвы и вывод остальных. Сейв героя тогда снимает фон ВМЕСТЕ с
;  мумией, его restore возвращает ровно то, что мумия потом сотрёт своим XOR.
;  CY=1, если объект vec_nsp_idx идёт XOR-путём. Клоб A.
vxm_is:
	ld	a, (vec_nsp_idx)
	sub	6
	cp	8
	ret
;  [mummy-zx шаг 1] XOR-враги НЕ в общем списке вывода (сортировка, быстрый путь, фронт сейвов их не видят).
;  Подготовка метит слот (+0xE0 = 1), пачка проходит слоты 6..13 сама и обновляет prev.
vxm_mark:
	call	vec_su_ptr
	ld	l, 0x0E0
	ld	(hl), 1
	ret
;  После петли стирания (и в начале слитой пачки, и вместо пустой пачки): все отмеченные XOR-враги.
vxm_all:
	ld	a, 6
vxa_l:
	ld	(vec_nsp_idx), a
	add	a, 0x0E0
	ld	h, a
	ld	l, 0x0E0
	ld	a, (hl)
	or	a
	jp	z, vxa_n
	ld	(hl), 0
	call	vxm_one	; [шаг 2] дельта / стереть+вывести / только стереть
	call	vso_prev	; снапшот prev = то, что выведено (раньше это делала петля пачки)
vxa_n:
	ld	a, (vec_nsp_idx)
	inc	a
	cp	14
	jp	c, vxa_l
	ret
;  vxm_fg (в тике, после vsp_fastmark): если пачка слитая, а отмеченный XOR-враг рядом с героем
;  (его новая или прошлая позиция против новой или прошлой позиции героя, |dY|<20, |dX|<28),
;  слитый путь запрещаем: у героя в нём нет отдельного стирания до XOR и сейва после.
vxm_fg:
	ld	a, (vsp_fast)
	or	a
	ret	z
	ld	b, 6
vfg_l:
	ld	a, b
	add	a, 0x0E0
	ld	h, a
	ld	l, 0x0E0
	ld	a, (hl)
	or	a
	jp	z, vfg_n
	ld	a, b
	add	a, a
	add	a, a
	add	a, 255 & sprAttrib
	ld	l, a
	ld	h, sprAttrib >> 8
	call	vfg_pt
	jp	c, vfg_hit
	ld	a, b
	add	a, a
	add	a, b
	add	a, 255 & vec_nsp_prev
	ld	l, a
	ld	h, vec_nsp_prev >> 8
	call	vfg_pt
	jp	c, vfg_hit
vfg_n:
	inc	b
	ld	a, b
	cp	14
	jp	c, vfg_l
	ret
vfg_hit:
	xor	a
	ld	(vsp_fast), a
	ret
vfg_pt:	; HL -> Y,X врага; CY=1, если близко к герою (новому или прошлому)
	ld	d, (hl)
	inc	l
	ld	e, (hl)
	ld	hl, sprAttrib+16
	call	vfg_c
	ret	c
	ld	hl, vec_nsp_prev+12
vfg_c:	; HL -> Y,X героя; CY=1, если |dY|<20 и |dX|<28 (по модулю 256)
	ld	a, (hl)
	sub	d
	jp	p, vfc_y
	cpl
	inc	a
vfc_y:
	cp	20
	ret	nc
	inc	l
	ld	a, (hl)
	sub	e
	jp	p, vfc_x
	cpl
	inc	a
vfc_x:
	cp	28
	ret
;  [mummy-zx шаг 2] H = страница отмеченного слота. Габарит записи = габарит выведенного -> ОДИН проход
;  fb ^= старое ^ новое (старое = новое заодно). Иначе: стереть выведенное, вывести новое с копией в один проход.
vxm_cnt:	equ	vec_ind_timer	; 1B p3 (была «свободна»): счётчик столбцов
vxm_one:
	ld	l, 0x96
	ld	a, (hl)
	dec	a
	jp	nz, vxo_er	; pending=2: только стереть
	ld	l, 0
	ld	a, (hl)
	or	a
	jp	z, vxm_new	; ничего не выведено: только вывести
	inc	l
	ld	a, (hl)
	ld	l, 0x97
	cp	(hl)
	jp	nz, vxo_ed
	ld	l, 2
	ld	a, (hl)
	ld	l, 0x98
	cp	(hl)
	jp	nz, vxo_ed
	ld	l, 3
	ld	a, (hl)
	ld	l, 0x99
	cp	(hl)
	jp	nz, vxo_ed
;  дельта: D = hi0, E = lo0, счётчик = ncols; HL = новый (+0xA0), BC = выведенный (+0x06)
	ld	l, 1
	ld	d, (hl)
	inc	l
	ld	e, (hl)
	inc	l
	ld	a, (hl)
	or	a
	ret	z
	ld	(vxm_cnt), a
	ld	b, h
	ld	c, 6
	ld	l, 0x0A0
vxd_r:
	ld	a, (bc)
	xor	(hl)
	ex	de, hl
	xor	(hl)
	ld	(hl), a
	ex	de, hl
	ld	a, (hl)
	ld	(bc), a
	inc	l
	inc	c
	inc	e
	ld	a, l
	and	0x0F
	jp	nz, vxd_r
	ld	a, e
	sub	16
	ld	e, a
	inc	d
	ld	a, (vxm_cnt)
	dec	a
	ld	(vxm_cnt), a
	jp	nz, vxd_r
	ret
vxo_ed:
	call	vxm_er
	jp	vxm_new
vxo_er:
	ld	l, 0
	ld	a, (hl)
	or	a
	ret	z
	jp	vxm_er
;  вывести новое: запись -> шапка; fb ^= новый, выведенный (+0x06) = новый — один проход.
vxm_new:
	ld	l, 0x97
	ld	d, (hl)
	inc	l
	ld	e, (hl)
	inc	l
	ld	a, (hl)
	ld	l, 0
	ld	(hl), 1
	inc	l
	ld	(hl), d
	inc	l
	ld	(hl), e
	inc	l
	ld	(hl), a	; hi0b/hi0c (+4/+5) не пишем: у слотов 6..13 их пишет только vec_su_save, а он для
	or	a	; XOR-врагов не зовётся — поля нулевые с бута (зануление p3) и такими остаются
	ret	z
	ld	(vxm_cnt), a
	ld	b, h
	ld	c, 6
	ld	l, 0x0A0
vxw_r:
	ld	a, (hl)
	ld	(bc), a
	ex	de, hl
	xor	(hl)
	ld	(hl), a
	ex	de, hl
	inc	l
	inc	c
	inc	e
	ld	a, l
	and	0x0F
	jp	nz, vxw_r
	ld	a, e
	sub	16
	ld	e, a
	inc	d
	ld	a, (vxm_cnt)
	dec	a
	ld	(vxm_cnt), a
	jp	nz, vxw_r
	ret
;  Вход из vec_su_restore (flush и прочие): стереть выведенное сразу (проваливается в vxm_er).
vxm_rs:
	call	vec_su_ptr
	ld	a, (hl)
	or	a
	ret	z
;  H = страница слота, шапка валидна: стереть выведенное и погасить шапку.
vxm_er:
	ld	l, 0
	ld	(hl), 0
	inc	l
	ld	d, (hl)
	inc	l
	ld	e, (hl)
	inc	l
	ld	c, (hl)
vxm_x6:
	ld	l, 6
;  fb ^= данные: HL = данные (столбцы по 16 Б низ-вверх), D = страница fb, E = lo0, C = ncols.
vxm_xor:
	ld	a, c
	or	a
	ret	z
vxx_c:
	push	de
	ld	b, 16
vxx_r:
	ld	a, (de)
	xor	(hl)
	ld	(de), a
	inc	l
	inc	e
	dec	b
	jp	nz, vxx_r
	pop	de
	inc	d
	dec	c
	jp	nz, vxx_c
	ret
;  [mummy-zx] vxm_eqw: обе половины пары героя (слоты 4, 5) выводятся, у них один первый столбец, а ширина
;  разная (сужение footprint у одной из них) -> обеим большую. Иначе одежда гасит плоскость кожи силуэтом в
;  столбце, фон которого никто не сохранил (у кожи сейв уже), и XOR мумии потом возвращает погашенный бит.
;  Третий столбец узкой половины в её буфере нулевой: сужение и делалось только по пустому столбцу.
vxm_eqw:
	ld	a, (0x0E496)
	dec	a
	ret	nz
	ld	a, (0x0E596)
	dec	a
	ret	nz
	ld	a, (0x0E497)
	ld	hl, 0x0E597
	xor	(hl)
	and	0x1F	; первый столбец одинаков?
	ret	nz
	ld	a, (0x0E499)
	ld	l, 0x99
	cp	(hl)
	ret	z
	jp	nc, veq_s5
	ld	a, (hl)
	ld	(0x0E499), a
	ret
veq_s5:
	ld	(hl), a
	ret
