; BEAMW — все ожидания луча в начале пачки. ЗА ВЫРАВНИВАНИЕМ: перед `.align 256` места мало.
;  ЗАЧЕМ. Ожидание ПЕРЕД restore растягивало окна уже стёртых: пара героя стирается первой и ждала
;  последствий ожиданий мумий (замер edge_bot: окно пары 64-76 тыс. тактов вместо оценки 35-38), а мумия,
;  стёртая раньше другой мумии, — её ожидания. Теперь ожидания идут ДО первого restore: проход по всем
;  позициям снизу вверх, у каждой vbw_wait (срок = префикс цен до её show); если кто-то ждал, проход
;  повторяется (ожидание сдвигает старт и чужие дуги) — до трёх проходов. Внутри пачки не ждём.
;  Позиция пары: слитая (vpr_sl=0) — без окна; медленная — один вызов на позицию vpr_mix, срок — вся пачка.
VBW_OFFC:	equ 3000	; смещение restore чужого объекта: нижние restore, отсчёты
VBW_OFFP:	equ 4000	; плюс слитая запись пары перед стиранием, отсчёты
vbw_all:
	push	af
	push	bc
	push	de
	push	hl
	ld	a, 5
	ld	(vbw_it), a
vba_p:
	xor	a
	ld	(vbw_chg), a
	ld	a, (vsp_n)
	ld	c, a
vba_l:
	dec	c
	ld	a, c
	call	vso_setord	; vec_nsp_idx = слот позиции C
	ld	a, (vpr_mix)
	cp	0x0FE
	jp	z, vba_np
	ld	b, a
	ld	a, c
	sub	b
	cp	2
	jp	nc, vba_np	; не позиция пары
	ld	a, (vpr_sl)
	or	a
	jp	z, vba_n	; слитая пара: окна restore->show нет
	ld	a, c
	cp	b
	jp	nz, vba_n	; второй слот пары — тот же срок, не повторяем
	ld	hl, 0
	ld	(vbw_ao), hl
	ld	a, (vsp_n)
	dec	a
	ld	b, a
	ld	a, (vpr_sl)	; right-half: не LAST — окно пары только её собственные позиции (vpr_s2x: show сразу)
	cp	2
	jp	z, vba_w
	ld	b, c
	inc	b
	jp	vba_w
vba_np:
	ld	a, (vsp_fast)	; apex-fast: в слитой пачке чужие объекты не стираются — ждать за них нечего
	or	a
	jp	nz, vba_n
	call	vso_static	; неподвижная створка не стирается
	or	a
	jp	nz, vba_n
;  Начало restore объекта отстоит от старта ожидания: восстановление нижних объектов и (слитая пара) запись пары
	ld	hl, VBW_OFFC
	ld	a, (vpr_mix)
	cp	0x0FE
	jp	z, vba_o
	ld	a, (vpr_sl)
	or	a
	jp	nz, vba_o
	ld	a, (vbw_pend)	; stair-gem: пара уже выведена vbw_pf — слитой записи пары перед restore нет
	or	a
	jp	nz, vba_o
	ld	hl, VBW_OFFC+VBW_OFFP
vba_o:
	ld	(vbw_ao), hl
	ld	b, c
vba_w:
	call	vbw_wait
vba_n:
	ld	a, c
	or	a
	jp	nz, vba_l
	ld	a, (vbw_chg)
	or	a
	jp	z, vba_d
	ld	hl, vbw_it
	dec	(hl)
	jp	nz, vba_p
vba_d:
	pop	hl
	pop	de
	pop	bc
	pop	af
	ret

;  --- vpz_f2 вынесен сюда: за .align место есть, перед ним — нет (иначе образ растёт на 256 Б) ---
;  vpz_f2: СТОЛБЕЦ ПАРЫ ЦЕЛИКОМ, плоскости A и B ЧЕРЕДУЮТСЯ КАЖДЫЕ 4 СТРОКИ (hud-flicker).
;  ДЕФЕКТ. Раньше столбец пары писался как A целиком (16 строк), затем B целиком: между записью
;  плоскости A и плоскости B одного байта проходило ~1700 тактов (9 строк луча), и луч, шедший по
;  строкам героя в это время, видел одну плоскость новой, другую старой — «промежуточный цвет»
;  (замер: 92% испорченных байт на верху поля, где пара пишется как раз под лучом). Теперь на один
;  байт плоскость B ложится через ~1 строку после A, а не через 9, и окно сужается в разы
;  (тот же объём записей, такты столбца не растут: пролог один на пару, а не по одному на плоскость).
;  Вход как у vpz_fast: H = страница слота A, A = B = страница fb A, C = смещение столбца. Страница слота B
;  и дельта страниц fb берутся из операндов vpz_pb/vpz_d (метки остаются на месте для стендов).
;  Выход: возврат из vpz_f2 заменён на прыжок в vpz_ce (вторая половина уже записана).
;  DI на весь хайджек держит vpz_wr; SP восстанавливается на единственном выходе.
vpz_f2:
	ld	(vpf_da+1), a
	ld	a, (vpz_d+1)
	add	a, b
	ld	(vpf_db+1), a
	ld	a, h
	ld	(vpf_sa+1), a
	ld	a, (vpz_pb+1)
	ld	(vpf_sb+1), a
	ld	a, (vsb_lo)
	add	a, 16	; right-half: верхняя четвёрка первой (lo0+12..15; lo0<240 => без переноса)
	ld	(vpf_dl+1), a
	ld	a, c
	add	a, 14	; [flicker-kv2] верхняя пара строк первой
	ld	(vpf_sl+1), a
	ld	a, b
	ld	(vpf_svb+1), a
	ld	hl, 0
	add	hl, sp
	ld	(vpz_sp), hl
	ld	b, 8
vpf_lp:
vpf_sa:
	ld	h, 0
vpf_sl:
	ld	l, 0
	ld	sp, hl
	pop	de
vpf_da:
	ld	h, 0
vpf_dl:
	ld	l, 0
	ld	sp, hl
	push	de
vpf_sb:
	ld	h, 0
	ld	a, (vpf_sl+1)
	ld	l, a
	ld	sp, hl
	pop	de
vpf_db:
	ld	h, 0
	ld	a, (vpf_dl+1)
	ld	l, a
	ld	sp, hl
	push	de
	ld	a, (vpf_sl+1)	; [flicker-kv2] чередование плоскостей по 2 строки (было по 4): окно между A и B вдвое уже
	sub	2
	ld	(vpf_sl+1), a
	ld	a, (vpf_dl+1)
	sub	2
	ld	(vpf_dl+1), a
	dec	b
	jp	nz, vpf_lp
vpf_svb:
	ld	b, 0
	ld	hl, (vpz_sp)
	ld	sp, hl
	pop	hl	; снять адрес возврата в vpz_col
	jp	vpz_ce
;  vpr_s2x (right-half): медленная пара, A = vpr_sl != 0. LAST (2) — как прежде: стереть сейчас, save+show после мумий
;  (под ней лежит пересечение с мумией, показ раньше мумий недопустим). Не LAST: объединённый габарит пары
;  (vmx_check) НЕ пересекается ни с чьим, поэтому restore->save->show можно подряд, как у vpr_fs2 в слитой пачке.
;  Раньше show шёл после стирания всех остальных (vpr_ssd после vso_rloop): герой был СТЁРТ 15-30 тыс. тактов, и луч
;  над верхними строками видел пустой фон, а vop_ow дописывал столбцы слева направо уже позади луча — «нет правой половины».
vpr_s2x:
	cp	2
	jp	z, vpr_so
	call	vpr_fs2
	xor	a
	ld	(vpr_sl), a	; фаза 2 после vso_rloop уже не нужна
	jp	vso_rloop
vpr_so:
	call	vpr_sout
	jp	vso_rloop
;  vbw_fs2 (apex-fast): слитая пачка, пара старым путём (vpr_fs2 — операнд vfa_cp). Раньше BEAMW в слитой пачке не звался
;  вовсе (vso_fastall стоит ДО vbw_all), и окно «пара стёрта -> показана» не учитывало луч. Здесь vbw_all зовётся ровно для
;  пары: vpr_sl=1 (в слитой пачке он 0) включает ветку медленной пары не LAST (окно = её позиции), vsp_fast=1 отсекает чужих.
VBW_PAIR:	equ 8000	; отсчётов на restore+save+show пары (2 слота x 2 столбца), программный счёт
vbw_pf:
	xor	a
	ld	(vbw_pend), a	; vbw_pend: 1 = пара уже выведена, идут ожидания остальных (vba_np)
;  [stair-gem] ПАРА ПЕРВОЙ ДО ЧУЖИХ ОЖИДАНИЙ. Обычная пачка, пара не LAST (vpr_sl != 0, != 2): её restore, save и show идут первыми
;  (vpr_fs2), но раньше стартовали ПОСЛЕ ожиданий луча всех мумий (vbw_all, до трёх проходов, трасса: 36 тыс. тактов), и окно пары
;  попадало на луч, а окно пары на нижних этажах ещё и не влезало в остаток кадра. Теперь: ожидание только пары (vsp_fast=1 отсекает
;  чужие позиции, как в vbw_fs2), пара выводится, затем ожидания остальных. LAST и слитая пара — как раньше.
	ld	a, (vpr_mix)
	cp	0x0FE
	jp	z, vbw_all
	ld	a, (vpr_sl)
	or	a
	jp	z, vbw_all
	cp	2
	jp	z, vbw_all
	ld	a, 1
	ld	(vsp_fast), a
	call	vbw_all
	xor	a
	ld	(vsp_fast), a
	call	vpr_fs2
	xor	a
	ld	(vpr_sl), a
	ld	hl, (vbw_s)	; программный счёт: пара заняла ~8000 отсчётов (замер: 16.1 тыс. тактов), иначе ожидания мумий считают время от старта пачки
	ld	de, VBW_PAIR
	add	hl, de
	ld	(vbw_s), hl
	ld	a, 1
	ld	(vbw_pend), a
	call	vbw_all
	xor	a
	ld	(vbw_pend), a
	pop	hl	; возврат в vec_spr_out не нужен: дальше стирание остальных
	jp	vso_rloop
vbw_fs2:
	ld	a, 1
	ld	(vpr_sl), a
	call	vbw_all
	xor	a
	ld	(vpr_sl), a
	jp	vpr_fs2
;  vbw_pfx (apex-fast): начало префикса стоимости окна в vbw_wait (D = 0, C = первая позиция). Было 0 всегда. В СЛИТОЙ пачке чужие
;  объекты пишутся без окна и в окно пары (restore -> save -> show подряд, vbw_ao=0) не входят, а префикс считал ВСЕ позиции от 0
;  до пары включительно: пара на позиции 2-3 давала C > VBW_LMAX, и ожидание отключалось («тяжёлую пачку не ждём»; трасса
;  кадра 391, rom_AB: vbw_wait -> vbw_out, vbw_poll не достигнут). Для слитой пачки префикс начинается с vpr_mix. Обычная пачка
;  (там чужие restore предшествуют, а правка того же префикса на ней дала рост брака, см. REPORT) — как раньше.
vbw_pfx:
	xor	a
	ld	d, a	; D = сумма ncols
	ld	c, a	; C = позиция
	ld	a, (vsp_fast)
	or	a
	ret	z	; обычная пачка: чужие restore стоят перед парой в расчёте, префикс с нуля (как было)
	ld	hl, (vbw_ao)
	ld	a, h
	or	l
	ret	nz	; не окно пары
	ld	a, (vpr_mix)
	ld	c, a
	ret

;  [mus-jitter, 2026-10-19] ДОГОН ТИКА МУЗЫКИ В КОНЦЕ ОКНА DI. Кадровый IRQ на Векторе не защёлкивается: пришёл под DI
;  (блит клетки/текста, dt_vec_draw) — пропал, и кадр остаётся без тика. Зовётся ПЕРЕД выходом из окна DI
;  (ei там сделает либо сам вызывающий, либо ISR): updateSound под DI не может быть прерван вложенным ISR.
;  Часы решают сами (vst_hw: накопитель смещён на VTM_BIAS, шапка ставит его после тика), поэтому в обслуженном кадре
;  вызов тика не даёт. Регистры сохраняются все: вызывающие держат в них своё.
;  В ПАЧКЕ ВЫВОДА НЕ ЗОВЁТСЯ (хайджеки vsu_*/vtm_*): замер mus_trace/polls.js — все 6262 хайджека стресс-сцены идут внутри
;  пачки, а она гонится за лучом, и каждый лишний такт там — мерцание (опрос в конце каждого хайджека удваивал bad_px
;  rh_eval). IRQ, потерянный в долгой пачке, догоняет опрос сразу после неё (vsnd_tick_clk в vec_isr_nr).
vsu_poll:
	push	af
	push	bc
	push	de
	push	hl
	call	vsnd_tick_clk	; часы: догон тика, если с прошлого тика прошёл кадр; без часов — ничего
	pop	hl
	pop	de
	pop	bc
	pop	af
	ret

;  vsm_pqs / vsm_p1q — в vec_xmum.asm (зазор перед .align vec_rev4) [flicker-kv2]

vpr_or2:
;  [flicker-kv2] пара при НЕнулевом фоне: столбец пары — обе плоскости ЧЕРЕДУЯСЬ ПО 2 СТРОКИ (как vpz_f2), а не
;  столбец первой, затем столбец второй (окно между плоскостями байта было ~768 тактов, луч видел промежуточный
;  цвет — трасса верха поля). Смещения столбца в слотах у обоих одни и те же (условие пары): переключение — XOR
;  страницы слота (P) и страницы fb (Q), обе разности постоянны по столбцам.
	ld	a, (vpr_pa)
	ld	h, a
	ld	d, a
	ld	a, (vpr_pb)
	xor	h
	ld	(vrw_p1+1), a
	ld	(vrw_p2+1), a
	ld	a, (vpr_ha)
	ld	b, a
	ld	a, (vpr_hb)
	xor	b
	ld	(vrw_q1+1), a
	ld	(vrw_q2+1), a
	ld	l, 6	; фон 6+16c, спрайт 0xA0+16c
	ld	e, 0x0A0
vpr_c:
	ld	a, (vsb_lo)
	ld	c, a
vrw_r:
	ld	a, (de)
	or	(hl)
	ld	(bc), a
	inc	l
	inc	e
	inc	c
	ld	a, (de)
	or	(hl)
	ld	(bc), a
	dec	l
	dec	e
	dec	c
	ld	a, h
vrw_p1:
	xor	0
	ld	h, a
	ld	d, a
	ld	a, b
vrw_q1:
	xor	0
	ld	b, a
	ld	a, (de)
	or	(hl)
	ld	(bc), a
	inc	l
	inc	e
	inc	c
	ld	a, (de)
	or	(hl)
	ld	(bc), a
	inc	l
	inc	e
	inc	c
	ld	a, h
vrw_p2:
	xor	0
	ld	h, a
	ld	d, a
	ld	a, b
vrw_q2:
	xor	0
	ld	b, a
	ld	a, l
	and	0x0F
	cp	6
	jp	nz, vrw_r
	inc	b	; следующий столбец (B снова — страница первого)
	ld	a, (vsb_nc)
	dec	a
	ld	(vsb_nc), a
	jp	nz, vpr_c
	ret
;  ===== [memory-for-speed] ПРЕДСДВИГ МУМИЙ (решение владельца 23.11.2026: место — снятые читы) =====================
;  Сдвиг кадра мумии (vsp_pat) стоит ~5,1 тыс. тактов на вызов (замер ms_mumshift, 0,94 вызова на шаг). Таблица хранит
;  уже сдвинутые кадры (формат буфера слота +0xA0: 3 столбца по 16 Б низ-вверх) для сдвигов 2, 4, 6 и шести кадров
;  (3 кадра x 2 направления): 18 записей по 48 Б. Нечётный сдвиг = чётный + досдвиг всей строки на 1 бит вправо (строка
;  16 px со сдвигом <= 6 в 24 бита укладывается). Сдвиги 0 и 1 — прежним путём.
;  ГДЕ ЛЕЖИТ: запись e — страница 0xE6 + e/2, смещение 0x36 + 48*(e&1): у слотов XOR-врагов 6..13 зона +0x36..+0x95
;  не пишется никогда (замер zcol), у слота 14 (0xEE) страница свободна (ms_ram). Флаг «запись собрана» — 0xEE:0x10+e.
;  hsClrSU (скрытие спрайтов, смена экрана) обнуляет страницы 0xE0..0xF4 целиком — таблица и флаги гаснут ВМЕСТЕ, и
;  записи собираются заново при первом использовании (сборка = прежний vsp_pat + копия).
vsp_patx:
	ld	hl, (vec_nsp_ptr)
	inc	hl
	inc	hl
	ld	a, (hl)	; pat
	sub	0x28
	cp	12
	jp	c, vpx_m	; прямая мумия: 0..11
	sub	0x60
	cp	12
	jp	nc, vsp_pat	; не мумия
	add	a, 12	; зеркальная: 12..23
vpx_m:
	and	0x1C	; 4*кадр (кадр 0..5)
	rrca
	rrca
	ld	c, a	; C = кадр
	ld	a, (vsp_sh)
	cp	2
	jp	c, vpx_s01	; сдвиг 0/1: копия кадра (+ досдвиг на 1 бит)
	rrca
	and	3
	dec	a	; sh/2-1 = 0..2
	ld	b, a
	ld	a, c
	add	a, a
	add	a, c	; 3*кадр
	add	a, b
	ld	(vpx_e), a	; e = 0..17
	add	a, 0x10
	ld	l, a
	ld	h, 0x0EE
	ld	a, (hl)
	or	a
	jp	nz, vpx_hit
	ld	(hl), 1	; собираем: прежний vsp_pat с чётным сдвигом, затем копия буфер -> запись
	ld	a, (vsp_sh)
	push	af
	and	6
	ld	(vsp_sh), a
	call	vsp_pat
	pop	af
	ld	(vsp_sh), a
	call	vpx_adr	; HL = запись, D = страница слота
	ex	de, hl	; DE = запись, HL = страница слота
	ld	l, 0x0A0
	ex	de, hl	; HL = запись (приёмник), DE = буфер (источник) — копия через SP от DE
	call	vpx_cp
	jp	vpx_odd
vpx_hit:
	call	vec_su_ptr	; H = страница слота
	ld	a, h
	ld	(vsp_pg), a	; её ждут vclp и проверка 3-го столбца (vsp_pat ставит в vsp_mset)
	call	vpx_adr
	ld	e, l	; DE = запись (источник)
	ld	d, h
	ld	a, (vsp_pg)
	ld	h, a
	ld	l, 0x0A0	; HL = буфер (приёмник)
	call	vpx_cp
vpx_odd:
	ld	a, (vsp_sh)
	rrca
	ret	nc	; чётный — готово
	ld	a, (vsp_pg)	; досдвиг на 1 бит: строка = столбцы 0xA0+r, 0xB0+r, 0xC0+r
	ld	h, a
	ld	d, a
	ld	b, a
	ld	l, 0x0A0
	ld	e, 0x0B0
	ld	c, 0x0C0
vpx_sr:	; [memory-for-speed] по строке за итерацию (было по 4): -36 Б под vxo_lo, +~260 т на нечётный сдвиг
	or	a	; перенос в первый байт строки = 0
	ld	a, (hl)
	rra
	ld	(hl), a
	ld	a, (de)
	rra
	ld	(de), a
	ld	a, (bc)
	rra
	ld	(bc), a
	inc	l
	inc	e
	inc	c
	ld	a, l
	cp	0x0B0
	jp	nz, vpx_sr
	ret
;  vpx_s01, vpx_adr — в vec_xmum.asm (зазор перед .align vec_rev4) [memory-for-speed]
;  vpx_adr: HL = адрес записи vpx_e, D = страница слота текущего объекта (vec_su_ptr). Клоб A.
vpx_adr:
	call	vec_su_ptr
	ld	d, h
	ld	a, (vpx_e)
	rrca
	ld	l, 0x36
	jp	nc, vpx_a0
	ld	l, 0x66
vpx_a0:
	and	0x7F
	add	a, 0x0E6
	ld	h, a
	ret
;  [memory-for-speed] vxo_lo: габарит сдвинулся ТОЛЬКО по строкам (тот же столбец и ширина; замер stress+tour1: 89 %
;  путей «стереть+вывести»). Раньше — стереть всё старое (vxx_r), потом вывести всё новое (vxw_r): байт, общий для
;  обоих габаритов, ~3 тыс. тактов стоял пустым, и луч на верхнем этаже ловил это окно (брак «рядом с мумией» зависел
;  от фазы пачки). Здесь один проход по строкам k: fb[lo0+k] ^= старое[k], fb[lo0'+k] ^= новое[k], старое[k] = новое[k].
;  Общий байт меняется дважды с промежутком в |lo0'-lo0| итераций (~65 т на строку смещения) — меньше строки луча.
;  Вход: H = страница слота, шапка валидна, pending=1. Смещение по строкам — операнды vxl_d1/vxl_d2 (код в ОЗУ).
vxo_lo:
	ld	l, 3
	ld	a, (hl)
	or	a
	ret	z
	ld	(vxm_cnt), a
	ld	l, 0x98
	ld	a, (hl)	; lo0 нового
	ld	l, 2
	ld	e, (hl)	; E = lo0 выведенного
	ld	(hl), a	; шапка: lo0 = новый (hi0, ncols те же)
	sub	e	; A = смещение t = lo0' - lo0
	ld	(vxl_d1+1), a
	cpl
	inc	a
	inc	a	; 1 - t
	ld	(vxl_d2+1), a
	dec	l
	ld	d, (hl)	; D = hi0
	ld	b, h
	ld	c, 0x0A0	; BC = новый
	ld	l, 6	; HL = выведенный
vxl_r:
	ld	a, (de)
	xor	(hl)
	ld	(de), a	; стереть старую строку k
	ld	a, e
vxl_d1:
	add	a, 0	; ОПЕРАНД: t
	ld	e, a
	ld	a, (bc)
	ld	(hl), a	; выведенный[k] = новый[k]
	ex	de, hl
	xor	(hl)
	ld	(hl), a	; вывести новую строку k
	ex	de, hl
	ld	a, e
vxl_d2:
	add	a, 0	; ОПЕРАНД: 1 - t -> lo0 + k + 1
	ld	e, a
	inc	l
	inc	c
	ld	a, c
	and	0x0F
	jp	nz, vxl_r
	ld	a, e
	sub	16
	ld	e, a
	inc	d
	ld	a, (vxm_cnt)
	dec	a
	ld	(vxm_cnt), a
	jp	nz, vxl_r
	ret
;  vpx_cp: 48 Б из (DE) в (HL) POP-хайджеком (DI на время подмены SP; правило vec_saveunder: внутри ни call, ни push).
;  Обе области внутри одной страницы (запись +0x36..+0x95, буфер +0xA0..+0xCF) — инкремент только младшего байта.
vpx_cp:
	di
	ld	(vpx_t), hl
	ld	hl, 0
	add	hl, sp
	ld	(vpx_sp), hl
	ex	de, hl
	ld	sp, hl	; SP = источник
	ld	hl, (vpx_t)	; HL = приёмник
	ld	b, 12	; [memory-for-speed] 2 POP за итерацию (было 4): -12 Б под vxo_lo, +~180 т на копию
vpx_cl:
	pop	de
	ld	(hl), e
	inc	l
	ld	(hl), d
	inc	l
	pop	de
	ld	(hl), e
	inc	l
	ld	(hl), d
	inc	l
	dec	b
	jp	nz, vpx_cl
	ld	hl, (vpx_sp)
	ld	sp, hl
	ei	; как vsu-хайджеки: зовётся только из игрового тика (там EI) — безусловный ei (фикс железа 2026-07-29)
	ret
