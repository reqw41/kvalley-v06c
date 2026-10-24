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
	add	a, 12
	ld	(vpf_sl+1), a
	ld	a, b
	ld	(vpf_svb+1), a
	ld	hl, 0
	add	hl, sp
	ld	(vpz_sp), hl
	ld	b, 4
vpf_lp:
vpf_sa:
	ld	h, 0
vpf_sl:
	ld	l, 0
	ld	sp, hl
	pop	hl
	ld	(vpz_th), hl
	pop	de
vpf_da:
	ld	h, 0
vpf_dl:
	ld	l, 0
	ld	sp, hl
	push	de
	ld	hl, (vpz_th)
	push	hl
vpf_sb:
	ld	h, 0
	ld	a, (vpf_sl+1)
	ld	l, a
	ld	sp, hl
	pop	hl
	ld	(vpz_th), hl
	pop	de
vpf_db:
	ld	h, 0
	ld	a, (vpf_dl+1)
	ld	l, a
	ld	sp, hl
	push	de
	ld	hl, (vpz_th)
	push	hl
	ld	a, (vpf_sl+1)
	sub	4
	ld	(vpf_sl+1), a
	ld	a, (vpf_dl+1)
	sub	4
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
