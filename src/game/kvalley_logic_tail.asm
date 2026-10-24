;  === ХВОСТ ЛОГИКИ (задача logic-opt) =================================================
;  Код, который заменяет или дополняет горячие процедуры игры, лежит ЗА выровненными
;  таблицами (как vec_ending/vec_jumpmid): перед `.align 256` зазор равен нулю, и каждый
;  лишний байт в pre-align части стоил бы целой страницы 256 Б. Вызовы абсолютные, такты
;  от места не зависят.
;
;  AI_Salidas: пред-скан дверей. Пока гемы собраны не все, дверь со статусом 0 (старший
;  ниббл) делает в chkAllGemas ровно `cp / ret nz`, а дверь с Y=#FF не делает ничего;
;  статус отключённой двери нулевой (буфер чистится на старте уровня). Значит, если
;  гемы не собраны и у всех четырёх дверей старший ниббл статуса 0, общий проход
;  (4 x getExitDat/jumpIndex, ~1300 т) ничего не пишет, кроме двух ячеек: ElemEnProceso
;  кончает циклом на 4, puertaCerrada = 0. Их и пишем. Статусы лежат через 7 Б в одной
;  странице (проверка раскладки — tools/verify/lo_gate.sh); OR четырёх байт: старший
;  ниббл 0 <=> все четыре 0. Любой другой исход (гемы собраны, статус != 0) идёт общим
;  путём as_full, один в один.
AI_Salidas:
		ld	a, (gemasCogidas)
		ld	hl, gemasTotales
		cp	(hl)
		jp	z, as_full
		ld	hl, pyramidDoors+4
		ld	a, (hl)
		ld	l, 255 & (pyramidDoors+11)
		or	(hl)
		ld	l, 255 & (pyramidDoors+18)
		or	(hl)
		ld	l, 255 & (pyramidDoors+25)
		or	(hl)
		and	0x0F0
		jp	nz, as_full
		ld	a, 4
		ld	(ElemEnProceso), a
		xor	a
		ld	(puertaCerrada), a
		ret


;  itmGate. Четыре байта позиции (ProtaY/ProtaXdecimal/ProtaX/ProtaRoom подряд) сравниваются
;  с тенью двумя 16-битными парами вместо цикла из 4 витков (~366 -> ~200 т). Результат тот же:
;  itmGSh := позиция при любом расхождении, itmGSkip := (itmGShOk при полном совпадении, иначе 0),
;  itmGShOk := 1. itmGShOk бывает только 0 или 1 (писатели — нули и эта единица).
itmGate:
		ld	hl, (itmGSh)
		ex	de, hl
		ld	hl, (ProtaY)
		ld	a, l
		xor	e
		ld	c, a
		ld	a, h
		xor	d
		or	c
		ld	c, a
		ld	hl, (itmGSh+2)
		ex	de, hl
		ld	hl, (ProtaX)
		ld	a, l
		xor	e
		or	c
		ld	c, a
		ld	a, h
		xor	d
		or	c
		jp	nz, itmGate_diff
		ld	a, (itmGShOk)	; совпало: пропуск = действительность тени
		ld	(itmGSkip), a
		ld	a, 1
		ld	(itmGShOk), a
		ret
itmGate_diff:
		ld	(itmGSh+2), hl	; HL = ProtaX/ProtaRoom
		ld	hl, (ProtaY)
		ld	(itmGSh), hl
		ld	a, 1
		ld	(itmGShOk), a
		xor	a
		ld	(itmGSkip), a
		ret

;  chkTocaProta: chkArea встроена (экономия call/ret ~27 т на проверку; зовётся ~3.7 раза за тик).
;  Выход как у chkArea: CY = внутри; A, F — от последнего sub/add; HL сдвинут на те же inc.
chkAreaItem:
		ld	hl, itemHitArea	; проваливается в chkTocaProta
chkTocaProta:
		push	bc
		ld	a, (ProtaY)
		ld	c, a
		ld	a, (ProtaX)
		ld	b, a
		sub	e		; X области - X точки
		sub	(hl)		; Смещение X точки
		inc	hl
		add	a, (hl)		; Ширина области
		jp	nc, ctp_end	; Не внутри
		ld	a, c		; Y области
		sub	d		; Y точки
		inc	hl
		sub	(hl)		; Смещение Y точки
		inc	hl
		add	a, (hl)		; Высота области
ctp_end:
		pop	bc
		ret
