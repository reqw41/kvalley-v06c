;  Прыжок на 25 Гц: между двумя полушагами doSalto_once проверка столкновения, как между двумя
;  тиками 50 Гц (раньше проверка стояла один раз после обоих: при нечётном X пара шагов X+-1 не
;  попадала на X&7==4, боковая стена не смотрелась и актор входил в тайл стены).
;  Вход: jp из doSalto после первого полушага. Стек: [адрес возврата в вызывавшего doSalto] ...
;  HL входа doSalto = структура актора + 2 (направление). Герой: HL == sentidoProta; адреса
;  мумий momiaDat+2+k*0x16 имеют младший байт != 0x21.
;  Z после проверки: setFinSalto уже выровнял Y, второй полушаг не делается; адрес возврата
;  снимается и идёт ветка падения вызывающего (protaSaltaFin / momiaCayendo).
saltoMid:
		pop	hl
		ld	a, l
		cp	sentidoProta & 0xFF
		jp	z, saltoMidP
;  Мумия: chkChocaSalto1 с NZ вместо флага героя, как в momiaSaltando после doSalto. chkPasaRoom
;  (смена комнаты по X==0/255) между полушагами НЕ вызывается: вариант с ним дал на стенде те же
;  проходы (outputs/fix-jump-wall/variant_pasaroom). На стеке у momiaSaltando ещё два слова
;  (сохранённый IX и указатель Y): при Z снимаются.
		dec	hl
		dec	hl
		ld	(z80_ix), hl	; chkChocaCae читает структуру мумии через IX
		inc	hl
		xor	a
		cp	1
		call	chkChocaSalto1
		ld	hl, (z80_ix)
		inc	hl
		inc	hl
		jp	nz, doSalto_once
		pop	af		; возврат в momiaSaltando
		pop	af		; сохранённый IX
		pop	af		; указатель Y (для chkPasaRoom после doSalto)
		jp	momiaCayendo
saltoMidP:
		ld	hl, protaStatus
		ld	(z80_ix), hl
		call	chkChocaSalto
		ld	hl, sentidoProta
		jp	nz, doSalto_once
		pop	af		; возврат в protaSalta
		jp	protaSaltaFin

;  Состояние 6 (проход вращающейся двери), герой-игрок на 25 Гц. Оригинал идёт каждый ВТОРОЙ КАДР
;  50 Гц (accionWaitCnt 0x20 => 32 шага по 0xA8 = ~21 px, стена между шагами не смотрится), а тик
;  порта на 25 Гц и есть два кадра: шаг на каждый тик, один mueveProta. Прежний код оставил
;  гейт `timer&1` (тик порта = 2 кадра => шаг через тик, 64 тика) и вёл шаги через protaWalk2
;  (два шага за ход): 58 шагов, ~38 px вместо ~21; герой выходил из двери внутрь ступеньки за ней.
;  Демо (controlPlayer bit6=0) идёт как на 50 Гц: гейт по timer сохранён, шаг тот же.
;  A=0 на входе в setProtaAndar (в оригинале он приходит с `and 1`).
protaGirMid:
		ld	a, (controlPlayer)
		and	0x40
		jp	nz, protaGirGo	; игрок: каждый тик
		ld	a, (timer)
		and	1
		ret	nz		; демо: каждый второй кадр
protaGirGo:
		xor	a
		ld	hl, accionWaitCnt
		dec	(hl)		; закончил проходить дверь?
		jp	z, setProtaAndar
		ld	hl, protaMovCnt
		inc	(hl)
		jp	protaAnda4s	; один шаг mueveProta + calcFrame

;  Темп вращения двери. Оригинал: раз в 8 кадров 50 Гц (timer&7), поворот 6 шагов = 48 кадров. Тик порта
;  = 2 кадра и timer растёт на 1 за тик, так что маска 7 давала 8 тиков = 16 кадров (вдвое медленнее):
;  игрок &3 (4 тика = 8 кадров), демо (controlPlayer бит 6 = 0) идёт как на 50 Гц и сохраняет &7.
;  E свободен: DE пишется ниже по ходу (ld de,tilesGiroDoor), B/A перетираются.
spinGate:
		ld	a, (controlPlayer)
		and	0x40
		ld	a, 3
		jp	nz, spinGate1
		ld	a, 7
spinGate1:
		ld	e, a
		ld	a, (timer)
		and	e
		ret	nz
		jp	spiningDoors3b

;  [door-wall r3] Темп по timer под тик 25 Гц (тик = 2 кадра оригинала, timer +1 за тик).
;  tmrAnd: вход A = маска оригинала; выход Z = (timer & маска) == 0, где у игрока маска>>1 (событие раз в
;  (N+1)/2 тиков = N+1 кадров), в демо (controlPlayer бит 6 = 0, шаг как на 50 Гц) маска прежняя. A,F портятся.
tmrAnd:
		push	bc
		ld	b, a
		ld	a, (controlPlayer)
		and	0x40
		ld	a, b
		jp	z, tmrAnd1
		or	a
		rra
tmrAnd1:
		ld	b, a
		ld	a, (timer)
		and	b
		pop	bc
		ret
;  Состояния героя 4 (бросок ножа) и 5 (копание): счётчики accionWaitCnt/agujeroCnt уменьшаются ПО КАДРУ
;  оригинала, поэтому у игрока тело состояния идёт дважды за тик (второй раз только если состояние то же).
protaLanza2:
		ld	hl, protaLanzaKnife
		ld	c, 4
		jp	protaX2
protaPica2:
		ld	hl, protaPicando
		ld	c, 5
protaX2:
		ld	a, (controlPlayer)
		and	0x40
		jp	z, protaX2j
		push	bc
		push	hl
		call	protaX2j
		pop	hl
		pop	bc
		ld	a, (protaStatus)
		cp	c
		ret	nz
protaX2j:
		jp	(hl)

;  goGate: HL = &timer; NZ = обрабатывать (игрок всегда, демо — при нечётном timer, как `and 1` оригинала).
goGate:
		ld	hl, timer
		ld	a, (controlPlayer)
		and	0x40
		ret	nz
		ld	a, (hl)
		and	1
		ret

;  tmrSpr: A = (timer & 0x0C) для демо, ((timer*2) & 0x0C) для игрока: кадр вращения ножа меняется раз в 4 кадра оригинала.
tmrSpr:
		ld	a, (controlPlayer)
		and	0x40
		ld	a, (timer)
		jp	z, tmrSpr1
		add	a, a
tmrSpr1:
		and	0x0C
		ret
