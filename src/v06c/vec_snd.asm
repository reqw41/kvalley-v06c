;============================================================================================
;  ЗВУК ВИ53: ПРОИГРЫВАТЕЛЬ ГОТОВЫХ ПОТОКОВ СОБЫТИЙ (задача snd-vi53, 2026-10-14).
;  Заменяет драйвер Konami (разбор нот, огибающие, микшер AY, WRTPSG-оверлеи, vec_ay2vi).
;  Игра поддерживает ТОЛЬКО ВИ53: AY и его проба удалены.
;
;  ОТКУДА ПОТОКИ. tools/snd_gen/snd_gen.js снял с ИСХОДНОГО драйвера (сборка e2b8f32, режим
;  ВИ53) покадровые состояния трёх каналов для каждого звука и записал их потоком событий
;  (src/gen/snd_streams.asm, формат — в шапке tools/snd_gen/encode.js). Состояние канала
;  после каждого ТИКА ЗВУКА совпадает с прежним режимом ВИ53 (проверяется стендом).
;
;  ГОЛОС = ячейка канала 1/2/3 (адреса и шаг 14 Б прежние: игра читает MusicChanData и
;  musicCh1/2 — «что-то играет» — и ждёт конца мелодии смерти и фанфар):
;    +0 сон (тиков до следующего события; 0 = голос свободен)     <- прежний CNT_NOTA
;    +1 DW  сон по умолчанию
;    +2 ID  номер звука 1..34 (приоритет)                          <- прежний MUSIC_ID (musicChN)
;    +3,+4  указатель в потоке
;  ХОЧУ-СОСТОЯНИЕ КАНАЛА (vwant, 3 Б на канал: включён, делитель lo, hi) живёт ВНЕ блока обнуления
;  игры, как прежняя тень регистров AY: пауза/клавиша S пересылают его в чип. Делитель помнится и при
;  погашенном канале: кирка (ON_L) играет на «остатке» периода прошлого звука, как играла на AY.
;  vec_vch (3 Б) — что реально запрограммировано в чипе (для часов: аренда канала 3).
;============================================================================================
vwant:	equ	0x7ECC		; 9 Б: на канал [включён, делитель lo, делитель hi]; сразу перед vec_vch
vsn_dirty:	equ	0x7EC5	; 1 Б: 1 = чип заглушен hush'ем, следующий тик пересылает ему vwant (см. updateSound)

;  Тик звука. A, BC, DE, HL разрешено ломать (как старому драйверу).
;  Прежний драйвер первой строкой тика писал микшер AY, а оверлей пересчитывал по тени все три канала ВИ53.
;  Заглушённый hush'ем чип (вход в паузу: шапка ISR тикает и на паузе) оживал уже следующим тиком. Сохраняем:
;  после hush первый тик пересылает чипу vwant.
updateSound:
	ld	a, (vsn_dirty)
	or	a
	call	nz, vsn_resync
	ld	hl, MusicChanData
	ld	a, (hl)
	or	a
	jp	z, us_2
	dec	(hl)
	ld	c, 0
	call	z, vpl
us_2:	ld	hl, MusicChanData2
	ld	a, (hl)
	or	a
	jp	z, us_3
	dec	(hl)
	ld	c, 1
	call	z, vpl
us_3:	ld	hl, MusicChanData3
	ld	a, (hl)
	or	a
	ret	z
	dec	(hl)
	ld	c, 2
	ret	nz
	; голос 3 дошёл до события: vpl вернётся прямо в вызвавшего

;  Разбор потока одного голоса. HL = ячейка голоса (сон только что стал 0), C = номер голоса.
vpl:
	inc	hl
	inc	hl
	inc	hl
	ld	a, (hl)
	inc	hl
	ld	h, (hl)
	ld	l, a		; HL = указатель в потоке
	ld	b, 0		; B = сон следующего события, если задан токеном W
vpl_t:
	ld	a, (hl)
	inc	hl
	or	a
	jp	m, vpl_on	; >=0x80: ON idx
	jp	z, vpl_end	; 0: END
	dec	a
	jp	z, vpl_off	; 1: OFF
	dec	a
	jp	z, vpl_onl	; 2: ON_L
	dec	a
	jp	z, vpl_jmp	; 3: JMP
	dec	a
	jp	z, vpl_w	; 4: W
	dec	a
	jp	z, vpl_dw	; 5: DW
	dec	a
	jp	z, vpl_per	; 6: PERIOD
;  7: FALL — падение: делитель += 108 (P += 8), канал включён, сон 1 тик, указатель остаётся на FALL.
	dec	hl
	push	hl
	call	vw_addr
	inc	hl
	ld	e, (hl)
	inc	hl
	ld	d, (hl)
	ld	hl, 108
	add	hl, de
	ld	a, h
	cp	0xD8		; период AY 12-битный: после 4095 делитель сворачивается (13*4096+2048 = 0xD800)
	jp	c, vf_ok
	sub	0xD8
	ld	h, a
vf_ok:	ex	de, hl
	pop	hl
	ld	b, 1
	jp	vpl_set

vpl_on:
	add	a, a
	ld	e, a
	ld	d, 0
	push	hl
	ld	hl, vsn_div
	add	hl, de
	ld	e, (hl)
	inc	hl
	ld	d, (hl)		; DE = делитель
	pop	hl
vpl_set:			; HL = указатель, DE = делитель, B = сон: канал ВКЛ с делителем
	push	hl
	call	vw_addr
	ld	(hl), 1
	inc	hl
	ld	(hl), e
	inc	hl
	ld	(hl), d
	pop	hl
	call	vpl_fin
	jp	vc_on

vpl_onl:			; ON_L: делитель тот, что помнит голос
	push	hl
	call	vw_addr
	ld	(hl), 1
	pop	hl
	call	vpl_fin
	jp	vc_on

vpl_per:			; PERIOD idx: канал выключить, делитель запомнить
	ld	a, (hl)
	inc	hl
	add	a, a
	ld	e, a
	ld	d, 0
	push	hl
	ld	hl, vsn_div
	add	hl, de
	ld	e, (hl)
	inc	hl
	ld	d, (hl)
	pop	hl
	push	hl
	call	vw_addr
	ld	(hl), 0
	inc	hl
	ld	(hl), e
	inc	hl
	ld	(hl), d
	pop	hl
	call	vpl_fin
	jp	vc_off

vpl_off:
	push	hl
	call	vw_addr
	ld	(hl), 0
	pop	hl
	call	vpl_fin
	jp	vc_off

vpl_end:			; END: канал выключить, голос свободен (сон уже 0)
	call	vw_addr
	ld	(hl), 0
	call	vrec_addr
	inc	hl
	inc	hl
	ld	(hl), 0		; ID := 0
	jp	vc_off

vpl_jmp:
	ld	e, (hl)
	inc	hl
	ld	h, (hl)
	ld	l, e
	jp	vpl_t

vpl_w:
	ld	b, (hl)
	inc	hl
	jp	vpl_t

vpl_dw:
	ld	a, (hl)
	inc	hl
	push	hl
	push	af
	call	vrec_addr
	inc	hl
	pop	af
	ld	(hl), a
	pop	hl
	jp	vpl_t

;  Записать в ячейку голоса: сон (B или DW) и указатель HL. Ломает A, DE, HL.
vpl_fin:
	ex	de, hl
	call	vrec_addr
	ld	a, b
	or	a
	jp	nz, vf_w
	inc	hl
	ld	a, (hl)
	dec	hl
vf_w:	ld	(hl), a
	inc	hl
	inc	hl
	inc	hl
	ld	(hl), e
	inc	hl
	ld	(hl), d
	ret

;  HL = ячейка голоса C: MusicChanData + 14*C. Ломает A. Адрес считается, а не хранится: нет общей
;  ячейки, поэтому вложенный тик (кадровое прерывание в кооп-тике) не портит разбор прерванного.
vrec_addr:
	ld	a, c
	add	a, a
	ld	l, a
	add	a, a
	add	a, a
	add	a, a
	sub	l
	add	a, 255 & MusicChanData
	ld	l, a
	ld	h, MusicChanData >> 8
	ret

;  HL = vwant + 3*C. Ломает A.
vw_addr:
	ld	a, c
	add	a, a
	add	a, c
	add	a, 255 & vwant
	ld	l, a
	ld	h, vwant >> 8
	ret

;  Канал C ВКЛЮЧИТЬ с делителем из vwant, если режим слушания (клавиша S) допускает: режим 0 — все
;  каналы, 1 — только канал 3 (эффекты), 2 — тишина. Не включённый в чипе канал получает управляющее
;  слово (канал 3 — через аренду часов, vtm_grab), затем делитель.
vc_on:
	ld	a, (vec_snd_mode)
	or	a
	jp	z, vco_go
	cp	2
	ret	nc
	ld	a, c
	cp	2
	ret	nz
vco_go:
	call	vw_addr
	inc	hl
	ld	e, (hl)
	inc	hl
	ld	d, (hl)		; DE = делитель
	ld	hl, vec_vch
	ld	b, 0
	add	hl, bc
	ld	a, (hl)
	or	a
	jp	nz, vco_wr
	ld	(hl), 1
	ld	a, c
	cp	2
	jp	nz, vco_ab
	call	vtm_grab	; клоб: только A
	jp	vco_wr
vco_ab:	rrca
	rrca
	add	a, 0x36		; 0x36 / 0x76: канал 0/1, LSB+MSB, режим 3, двоичный
	out	(0x08), a
vco_wr:	ld	a, c
	or	a
	jp	z, vco_p0
	dec	a
	jp	z, vco_p1
	ld	a, e
	out	(0x09), a
	ld	a, d
	out	(0x09), a
	ret
vco_p0:	ld	a, e
	out	(0x0B), a
	ld	a, d
	out	(0x0B), a
	ret
vco_p1:	ld	a, e
	out	(0x0A), a
	ld	a, d
	out	(0x0A), a
	ret

;  Канал C ВЫКЛЮЧИТЬ, если он включён в чипе. Канал 3 возвращается часам (vtm_start).
vc_off:
	ld	hl, vec_vch
	ld	b, 0
	add	hl, bc
	ld	a, (hl)
	or	a
	ret	z
	ld	(hl), 0
	ld	a, c
	cp	2
	jp	z, vtm_start
	rrca
	rrca
	add	a, 0x36
	out	(0x08), a
	ret

;  Переслать чипу состояние vwant (каналы, допущенные режимом S). Ломает A, BC, DE, HL.
vsn_resync:
	xor	a
	ld	(vsn_dirty), a
	ld	c, a
vsr_l:	call	vw_addr
	ld	a, (hl)
	or	a
	call	nz, vc_on
	inc	c
	ld	a, c
	cp	3
	jp	nz, vsr_l
	ret

;  Включить звук после смены режима S или паузы: заглушить всё и вернуть чипу состояние vwant.
;  Все регистры сохраняются (вызывается из ISR; C там живой).
vec_snd_apply:
	call	vec_snd_hush
	push	af
	push	bc
	push	de
	push	hl
	call	vsn_resync
	call	vtm_start
	pop	hl
	pop	de
	pop	bc
	pop	af
	ret

;  Заглушить чип (три канала ВИ53 стоп), сбросить признак «включён в чипе» и часы. vwant не трогаем.
vec_snd_hush:
	push	af
	push	bc
	push	de
	push	hl
	ld	a, 0x36
	out	(0x08), a
	ld	a, 0x76
	out	(0x08), a
	ld	a, 0xB6
	out	(0x08), a
	xor	a
	ld	(vec_vch+0), a
	ld	(vec_vch+1), a
	ld	(vec_vch+2), a
	ld	(vtm_have), a
	inc	a
	ld	(vsn_dirty), a
	pop	hl
	pop	de
	pop	bc
	pop	af
	ret

;----------------------------------------------------
; включить музыку / эффект
; In: A = номер звука (биты 6-7 прежних флагов игнорируются)
;   1-10 — эффект на канал 3; 11-16 — музыка на каналы 1-2; 17+ — все три канала.
;   Приоритет: звук с меньшим номером, чем звучащий на ПЕРВОМ канале набора, отбрасывается.
;----------------------------------------------------
setMusic:
	di
	call	SetMusic_
	ei
	ret

SetMusic_:
	and	0x3F
	ld	c, a		; C = номер звука
	ld	b, 2		; число голосов
	ld	hl, musicCh1
	cp	0x0B		; эффект поверх основной музыки?
	jp	c, setSFX
	cp	0x11		; музыка на двух каналах?
	jp	c, setMus
	inc	b		; на трёх
	jp	setMus
setSFX:	dec	b
	ld	hl, musicCh3	; эффекты — только на канале 3
setMus:	ld	a, (hl)
	ld	e, a		; E = звучащий
	ld	a, c
	cp	e
	ret	c		; у звучащего приоритет выше
	add	a, a
	ld	de, vsn_tab-2
	call	ADD_A_DE	; DE = слово потока первого голоса
	dec	hl
	dec	hl		; HL = ячейка голоса (+0)
setChanData:
	ld	(hl), 1		; событие — в ближайшем тике
	inc	hl
	inc	hl
	ld	(hl), c		; ID
	inc	hl
	ld	a, (de)
	ld	(hl), a		; указатель потока
	inc	hl
	inc	de
	ld	a, (de)
	ld	(hl), a
	inc	de
	ld	a, 10		; +4 -> +14: следующий голос
	call	ADD_A_HL
	dec	b
	jp	nz, setChanData
	ret

	.include "../gen/snd_streams.asm"
