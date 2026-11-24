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
vxm_isa:	; [end-opaque] вход с A = номер слота (vfx_b1 в vec_blit.asm)
	sub	6	; мумии 6..13 -> 0..7: XOR всегда
	cp	8
	ret	c
	add	a, 2	; [hero-xor] герой (слоты 4, 5): 0xFE/0xFF + 2 -> перенос; прочие слоты — без переноса
	ret	nc
;  [end-opaque] НА ФИНАЛЕ ГЕРОЙ НЕПРОЗРАЧНЫЙ (save-under, как до XOR): одежда XOR-ом над кладкой
;  большой пирамиды давала тон B камня. Признак финала — развилка тайлов vbt8_ecp+1: 0x28 ставит
;  vec_ct_ending, 5 возвращает vec_ct_base (бит 0: 1 = игра, XOR; 0 = финал, обычный путь).
;  Шторка финала (HideSprites) чистит слоты до смены режима.
	ld	a, (vbt8_ecp+1)
	rrca
	ret
;  [mummy-zx шаг 1] XOR-враги НЕ в общем списке вывода (сортировка, быстрый путь, фронт сейвов их не видят).
;  Подготовка метит слот (+0xE0 = 1), пачка проходит слоты 6..13 сама и обновляет prev.
vxm_mark:
	call	vec_su_ptr
	ld	l, 0x0E0
	ld	(hl), 1
	ret
;  После петли стирания (и в начале слитой пачки, и вместо пустой пачки): все отмеченные XOR-враги.
;  [hero-xor] Два прохода: первый (vxw_m = 255) пишет только тех, кому луч не мешает, — vxw с vbw_np = 255 на первом
;  же «надо ждать» выходит с vbw_np = 0 (страховка 256 опросов), метка остаётся; второй (vxw_m = 1) ждёт и пишет
;  оставшихся. Пока ждёт герой, успевают мумии. XOR-записи разных объектов коммутируют — порядок не важен.
vxw_m:	equ	vsm_pq	; 1B: vbw_np на входе vxw — ячейка снятого vsm_pq (0xFFF0); 0xFD36 нельзя: верх стека (переменные с 0xFD38)
vxm_all:
	ld	a, 255
	call	vxm_ps	; второй проход: A = 14 после первого (конец петли) — ненулевой старт vbw_np, как и нужно
vxm_ps:
	ld	(vxw_m), a
	ld	a, 4	; [hero-xor опыт]
vxa_l:
	ld	(vec_nsp_idx), a
	add	a, 0x0E0
	ld	h, a
	ld	l, 0x0E0
	ld	a, (hl)
	or	a
	jp	z, vxa_n
	ld	a, (vxw_m)
	ld	(vbw_np), a
	call	vxw	; [hero-xor] луч: не писать объект, пока луч идёт по его строкам
	ld	a, (vbw_np)
	or	a
	jp	z, vxa_n	; первый проход: занят — во второй
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
vxm_fg:	; [hero-xor опыт] герой отмечен на XOR -> слитый путь запрещаем (у соседей нет стирания до XOR)
	ld	a, (0x0E4E0)
	ld	hl, 0x0E5E0
	or	(hl)
	ret	z
	xor	a
	ld	(vsp_fast), a
	ret
;  [mummy-zx шаг 2] H = страница отмеченного слота. Габарит записи = габарит выведенного -> ОДИН проход
;  fb ^= старое ^ новое (старое = новое заодно). Иначе: стереть выведенное, вывести новое с копией в один проход.
vxm_cnt:	equ	vec_ind_timer	; 1B p3 (была «свободна»): счётчик столбцов
vxm_one:
	ld	l, 0x96
	ld	a, (hl)
	cp	2	; [hero-xor опыт] pending=3 (дедуп снял сейв) = вывести
	jp	z, vxo_er	; pending=2: только стереть
	ld	l, 0
	ld	a, (hl)
	or	a
	jp	z, vxm_new	; ничего не выведено: только вывести
	inc	l
	ld	a, (hl)
	ld	l, 0x97
	cp	(hl)
	jp	nz, vxo_ed
	ld	l, 3	; [memory-for-speed] порядок: столбец, ширина, строка — сдвиг только по строкам идёт в vxo_lo
	ld	a, (hl)
	ld	l, 0x99
	cp	(hl)
	jp	nz, vxo_ed
	ld	l, 2
	ld	a, (hl)
	ld	l, 0x98
	cp	(hl)
	jp	nz, vxo_lo
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
;  [hero-xor] vxw: ОЖИДАНИЕ ЛУЧА ДЛЯ XOR-ОБЪЕКТА. Пачка без объектов общего списка сразу идёт в vxm_all и пишет
;  XOR-объекты подряд, не глядя на луч: на верхнем этаже мумии после пары героя (~12 тыс. т) попадали под луч в 65%
;  выводов (замер rhrace). Запретная дуга стартов — та же, что у vbw_wait: [T0-M+96*rmin-C, +96n+2M+C), строки —
;  объединение прежнего (шапка) и нового (запись) габарита, C = VXW_C (цена XOR-записи объекта, отсчёты). Опрос и
;  выход — общие (vbw_poll/vbw_out), только по часам ВИ53 (нет часов — не ждём). H = страница слота; регистры целы.
VXW_C:	equ	3200
vxw:
	push	af
	push	bc
	push	de
	push	hl
	ld	a, (vbw_ok)
	ld	b, a
	ld	a, (vtm_have)
	and	b
	jp	z, vbw_out
	ld	(vbw_hw), a
	ld	l, 0x98
	ld	d, (hl)	; D = min lo, E = max lo
	ld	e, d
	ld	l, 0
	ld	a, (hl)
	or	a
	jp	z, vxw2
	ld	l, 2
	ld	a, (hl)
	cp	d
	jp	nc, vxw1
	ld	d, a
vxw1:
	cp	e
	jp	c, vxw2
	ld	e, a
vxw2:
	jp	vxw2x
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
;  [flicker-kv2] ХВОСТ ПАРЫ — В ОБЕ ПЛОСКОСТИ ОДНИМ ПРОХОДОМ. Слитая запись пары (vmxp) готовит половины по очереди,
;  и каждая писала свой хвост (строки старого габарита, которые герой покинул, фаза 1 vsm_p1r) в начале СВОЕЙ
;  подготовки: одежда и кожа расходились на ~6,4 тыс. тактов (33 строки луча), луч между ними видел промежуточный
;  цвет (трасса rh_eval: 213 из 270 испорченных байт верха поля). Старая геометрия половин пары одна и та же (тот же
;  столбец, lo0, ncols — проверяется здесь), поэтому хвост первой половины пишется вместе с байтом второй: слот второй
;  ещё НЕ сдвинут, его данные по тому же смещению. Штатная подготовка второй потом пишет те же байты ещё раз.
;  ;  [hero-xor] vsm_pqs встроен в vmxp (vec_sprout.asm).
;  [lives-f13] vpv_lives (из pierdeVida): бесконечные жизни после старта F1+F3 с титула (vec_cheats, vec_scan_keys) —
;  гибель возвращает жизнь. Выход: A = Vidas, Z по A (от add), HL = Vidas.
vpv_lives:
	ld	a, (vec_cheats)
	ld	hl, Vidas
	add	a, (hl)	; Z/NZ по сумме — флаги для `jp nz,setGameMode` в pierdeVida
	ld	(hl), a
	ret
;  vpx_s01: сдвиг 0 — кадр как есть: столбец 0 = левая половина, 1 = правая (строки низ-вверх: строка r -> +15-r),
;  столбец 2 = 0; сдвиг 1 — то же + досдвиг (vpx_odd). Кадр: прямой — vec_spr_momia + 32*кадр, зеркальный — готовый
;  кэш vec_spr_buf_mir + 0x140 + 32*(кадр-3) (те же адреса, что берёт vsp_pat). C = кадр 0..5.
vpx_s01:
	ld	a, c
	ld	de, vec_spr_momia
	cp	3
	jp	c, vpx_d
	sub	3
	ld	de, vec_spr_buf_mir+0x140
vpx_d:
	rrca
	rrca
	rrca	; 32*кадр (кадр <= 2)
	ld	l, a
	ld	h, 0
	add	hl, de
	ex	de, hl	; DE = кадр (32 Б: L0-15, R0-15)
	call	vec_su_ptr
	ld	a, h
	ld	(vsp_pg), a
	di	; POP-хайджек (как vpx_cp): SP = кадр, строки по возрастанию, буфер — вниз
	ld	(vpx_t), hl
	ld	hl, 0
	add	hl, sp
	ld	(vpx_sp), hl
	ex	de, hl
	ld	sp, hl
	ld	hl, (vpx_t)
	ld	l, 0x0AF	; столбец 0, верхняя строка
	ld	c, 2	; два столбца
vpx_c:
	ld	b, 4
vpx_c4:
	pop	de
	ld	(hl), e
	dec	l
	ld	(hl), d
	dec	l
	pop	de
	ld	(hl), e
	dec	l
	ld	(hl), d
	dec	l
	dec	b
	jp	nz, vpx_c4
	ld	l, 0x0BF	; следующий столбец (после второго L уже не нужен)
	dec	c
	jp	nz, vpx_c
	ld	l, 0x0D0	; столбец 2 = 0: SP на +0xD0, 8 x push 0 -> +0xC0..+0xCF
	ld	sp, hl
	ld	de, 0
	push	de
	push	de
	push	de
	push	de
	push	de
	push	de
	push	de
	push	de
	ld	hl, (vpx_sp)
	ld	sp, hl
	ei	; из игрового тика — безусловный ei (как vsu-хайджеки)
	jp	vpx_odd
