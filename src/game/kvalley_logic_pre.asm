;  === ГОРЯЧИЕ ПРОЦЕДУРЫ ЛОГИКИ (задача logic-opt), pre-align часть ===================
;  Стоит сразу за kvalley_game.asm и заполняет зазор перед `.align 256` (его освободила
;  замена прежних getMomiaDat/getMapOffset): перед выравниванием зазор был ровно ноль, так
;  что всё, что лежит ЗДЕСЬ, обязано умещаться в него, иначе образ растёт на страницу 256 Б.
;  Размер зазора смотри в выводе tools/mem_map.py. Остальной новый код — в хвосте
;  (kvalley_logic_tail.asm).

;  getMomiaProcDat / getMomiaDat (тело в игре стояло в pre-align части).
;  In: A = индекс мумии (0..3) [getMomiaProcDat берёт его из momiaEnProceso].
;  Out: HL = (z80_ix) = (pMomiaProceso) = momiaDat + 22*A. Остальные регистры не нужны
;  вызывателям: A/B/F на выходе мертвы (все четыре вызова перечитывают A и HL, B пишется
;  позже: chkNextMomia `ld b,a`, chkKnifeMomia `ld b,a`, AI_Momias — диспетчер), C цел.
;  Раньше: 22*A цепочкой из 12 команд и обмен alt-регистрами через ячейки (z80_de_alt,
;  z80_hl_alt: запись без читателей; il_tmp: каждый читатель пишет его сам) ~250-330 т,
;  теперь таблица из четырёх слов ~95 т. Таблица в одной странице (проверка — lo_gate.sh).
getMomiaProcDat:
		ld	a, (momiaEnProceso)
getMomiaDat:
		add	a, a
		ld	hl, gmd_tab
		add	a, l
		ld	l, a
		ld	a, (hl)
		inc	l
		ld	h, (hl)
		ld	l, a
		ld	(pMomiaProceso), hl
		ld	(z80_ix), hl
		ret
;  gmd_tab — в vec_tables.asm сразу за vec_rev4 (одна страница гарантирована, см. там).

;  getMapOffset / getMapOffset00 — карта по координатам элемента.
;  In: HL = (Y, X дробная, X, комната); getMapOffset: B = смещение X (знаковое), C = смещение Y.
;  Out: HL = адрес в MapaRAM, A = (HL); BC сохранены; getMapOffset00 сохраняет и DE.
;  Результат побайтно тот же, что у прежней версии (проверка — tools/verify/lo_unit.js на
;  сотнях тысяч случайных входов). Что изменено, тактов на вызов:
;   * таблица рядов хранит сразу MapaRAMRoot+96*ряд: нет `ld de,MapaRAMRoot / add hl,de`;
;   * чтение таблицы без push/pop HL: указатель на данные прячется в DE (ex de,hl);
;     таблица лежит целиком в одной странице, `add a,l / ld l,a` без переноса;
;   * индекс ряда*2 = (Y >> 2) & 0x3E вместо rra*3 / and 0x1F / add a,a;
;   * getMapOffset00 — свой вход без смещений: нет push bc / ld bc,0 / call / pop bc и
;     знакового расширения B.
getMapOffset00:
		push	de
		ld	a, (hl)		; Y
		rra
		rra
		and	0x3E		; 2 * (Y >> 3)
		ex	de, hl		; DE = указатель на данные
		ld	hl, gmo_tab
		add	a, l
		ld	l, a
		ld	a, (hl)
		inc	l
		ld	h, (hl)
		ld	l, a		; HL = MapaRAMRoot + 96 * ряд
		ex	de, hl		; DE = база ряда, HL = данные
		inc	hl
		inc	hl
		ld	a, (hl)		; X
		inc	hl
		ld	h, (hl)		; комната
		ld	l, a		; HL = глобальный X
		jp	gmo_shift

getMapOffset:
		ld	a, (hl)		; Y
		add	a, c		; + смещение Y
		rra
		rra
		and	0x3E		; 2 * ((Y + dy) >> 3)
		ex	de, hl
		ld	hl, gmo_tab
		add	a, l
		ld	l, a
		ld	a, (hl)
		inc	l
		ld	h, (hl)
		ld	l, a
		ex	de, hl		; DE = база ряда, HL = данные
		inc	hl
		inc	hl
		ld	a, (hl)		; X
		inc	hl
		ld	h, (hl)		; комната
		ld	l, a		; HL = глобальный X
		push	bc
		ld	c, b
		ld	a, b
		rlca
		sbc	a, a		; A = 0x00 (B >= 0) / 0xFF (B < 0)
		ld	b, a
		add	hl, bc		; + знаковое смещение X
		pop	bc
		ld	a, l
		rrca
		rrca
		rrca
		and	0x1F
		ld	l, a
		ld	a, h
		rrca
		rrca
		rrca
		ld	h, a
		and	0x0E0
		or	l
		ld	l, a
		ld	a, h
		and	0x1F
		ld	h, a		; HL = X16 >> 3 (логический сдвиг)
		add	hl, de		; + MapaRAMRoot + 96 * ряд
		ld	a, (hl)
		ret

gmo_shift:
		ld	a, l
		rrca
		rrca
		rrca
		and	0x1F
		ld	l, a
		ld	a, h
		rrca
		rrca
		rrca
		ld	h, a
		and	0x0E0
		or	l
		ld	l, a
		ld	a, h
		and	0x1F
		ld	h, a		; HL = X16 >> 3 (логический сдвиг)
		add	hl, de		; + MapaRAMRoot + 96 * ряд
		pop	de
		ld	a, (hl)
		ret

;  gmo_tab — в vec_tables.asm сразу за vec_rev4 (одна страница гарантирована, см. там).

;  [demo-sync] Эти две процедуры стоят ЗДЕСЬ (pre-align), чтобы занять зазор, освобождённый правками демо; вызывают их
;  и хвост (vec_jumpmid.asm), и логика.
;  isPl: Z = демо (controlPlayer бит 6 = 0, шаг как на 50 Гц), NZ = игрок. Портит A.
isPl:
		ld	a, (controlPlayer)
		and	0x40
		ret
;  bajaSnap: игрок — дробь X в 0 и X в центр тайла (точка схода); демо — как оригинал, ничего. Вход/выход HL -> Y.
bajaSnap:
		call	isPl
		ret	z
		inc	hl
		xor	a
		ld	(hl), a
		inc	hl
		ld	a, (hl)
		and	0xF8
		or	4
		ld	(hl), a
		dec	hl
		dec	hl
		ret
;  getMomiaTimer: HL = (z80_ix) + ACTOR_TIMER. Портит DE, CY. Шесть мест держали по 7 Б (ld hl,(z80_ix) / ld de,17 / add hl,de).
getMomiaTimer:
		ld	hl, (z80_ix)
		ld	de, ACTOR_TIMER
		add	hl, de
		ret

;  demoRun: тик 25 Гц = два тика 50 Гц оригинала. Демо записано по тикам оригинала (20 мс), и с одним тиком оригинала на тик порта
;  (51 мс при загрузке кадра) оно шло в 2.5 раза дольше оригинала. Второй тик — без отрисовки (tickGame3), её делает следующий тик.
demoRun:
		call	runGame
		call	isPl
		ret	nz
		ld	a, (GameStatus)
		cp	5
		ret	nz
		ld	hl, timer
		inc	(hl)
		call	chkControls
		call	tickGame3
		jp	chkVivo
