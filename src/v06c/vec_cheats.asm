; Отладочные читы. Клавиатурные порты трогаем только из vec_scan_keys в VBlank.
; F1+F3 на титуле подмешивают SPACE и открывают замок через штатный StartGame_0.
; Обычный старт замок закрывает. S/P и кадровый звук от замка не зависят.
vec_cheat_scan:
	ld	a, (GameStatus)
	dec	a
	jp	z, vec_f13_scan
	ld	a, (vec_cheats)
	or	a
	ret	z	; в обычной партии ряды читов не опрашиваем
	ld	a, 0x0DF	; ряд 5: N/H
	out	(0x03), a
	in	a, (0x02)	; первый in даёт время матрице сменить ряд
	in	a, (0x02)
	cpl
	ld	b, a
	and	0x40
	ld	(vec_kbf), a
	ld	a, b
	and	1
	ld	(vec_kbh), a
	ld	a, 0x0EF	; ряд 4: G/E/D
	out	(0x03), a
	in	a, (0x02)
	in	a, (0x02)
	cpl
	and	0x0B0
	ld	(vec_kbe), a
	ret
vec_f13_scan:
	ld	a, 0x0FD	; ряд 1: F1=бит3, F3=бит5
	out	(0x03), a
	in	a, (0x02)
	in	a, (0x02)
	cpl
	and	0x28
	ld	(vec_kbf13), a
	cp	0x28
	ret	nz
	ld	a, (vec_kb8)
	and	0x0FE	; SPACE active-low; ReadKeys выполнит обычный запуск
	ld	(vec_kb8), a
	ret

; Вызывать при каждом входе на титул. Все читы, включая God, выключаются.
; Правило едино для обычного ROM и Splash. Клоб A/флаги; прочие регистры сохраняет.
vec_cheats_reset:
	xor	a
	ld	(vec_cheats), a
	ld	(vec_kbf13), a
	ld	(vec_kbf), a
	ld	(vec_kbh), a
	ld	(vec_kbe), a
	ld	(vec_kbf_p), a
	ld	(vec_kbh_p), a
	ld	(vec_kbe_p), a
	ld	(vec_god), a
	ret

; После проверки fire в StartGame_0. AF нужен следующему push af в игровом коде.
vec_cheats_latch:
	push	af
	ld	a, (vec_kbf13)
	cp	0x28
	ld	a, 0
	jp	nz, vcl_set
	inc	a
vcl_set:
	ld	(vec_cheats), a
	xor	a
	ld	(vec_kbf_p), a
	ld	(vec_kbh_p), a
	ld	(vec_kbe_p), a
	ld	(vec_god), a
	pop	af
	ret

; Только внешний ISR, после пачки, до H_TIMI. Фронты считаются по видеокадрам,
; поэтому 25-Гц делитель игровой логики не удваивает/не повторяет действие клавиши.
vec_cheats_tick:
	ld	a, (vec_kbf)
	ld	hl, vec_kbf_p
	cp	(hl)
	ld	(hl), a
	jp	z, vec_cheat_no
	or	a
	jp	z, vec_cheat_no
	ld	a, 1
	call	vec_hop
vec_cheat_no:
	ld	a, (vec_kbh)
	ld	hl, vec_kbh_p
	cp	(hl)
	ld	(hl), a
	jp	z, vec_hop5_no
	or	a
	jp	z, vec_hop5_no
	ld	a, 5
	call	vec_hop
vec_hop5_no:
	ld	a, (vec_kbe)
	ld	b, a
	ld	hl, vec_kbe_p
	ld	a, (hl)
	cpl
	and	b
	ld	(hl), b
	ld	c, a	; свежие биты G/E/D независимо друг от друга
	and	0x80
	rlca
	ld	hl, vec_god
	xor	(hl)
	ld	(hl), a
	ld	a, c
	and	0x10
	jp	z, vec_dth_no
	ld	a, (GameStatus)
	cp	5
	jp	z, vkp_kill	; штатная смерть обходит God; E одновременно не запускаем
vec_dth_no:
	ld	a, c
	and	0x20
	ret	z
	ld	a, (GameStatus)
	dec	a
	cp	8	; GS1..8; нельзя прерывать скролл GS9 или финал GS10
	ret	nc
	ld	a, 0x0A
	jp	setGameStatus	; штатные waitCounter=0x20 и subStatus=0

; N=+1, H=+5. Повторяет штатный выход: направление стрелки, дверь назначения,
; subStatus=0 и Stage Clear. Вход A=длина прыжка; за пирамиду15 не выходим.
vec_hop:
	ld	b, a
	ld	a, (GameStatus)
	cp	5
	ret	nz
	ld	a, (piramideActual)
	add	a, b
	cp	16
	jp	c, vhop_cap
	ld	a, 15
vhop_cap:
	ld	c, a
	ld	a, (piramideActual)
	cp	c
	ret	z
	inc	a
	ld	e, a	; выход через настоящую дверь в соседнюю пирамиду
	ld	d, 1
	ld	b, 4
	ld	hl, pyramidDoors
vhop_dr:
	ld	a, (hl)
	inc	hl
	inc	hl
	inc	hl
	inc	hl
	inc	hl
	inc	a
	jp	z, vhop_nx
	ld	a, (hl)
	cp	e
	jp	z, vhop_got
vhop_nx:
	inc	hl
	inc	hl
	ld	a, d
	add	a, a
	ld	d, a
	dec	b
	jp	nz, vhop_dr
	ret
vhop_got:
	ld	a, d
	ld	(puertaSalida), a
	ld	a, c
	ld	(piramideDest), a
	ld	hl, vec_hop_ent-1
	add	a, l
	ld	l, a
	ld	a, 0
	adc	a, h
	ld	h, a
	ld	a, (hl)
	ld	(puertaEntrada), a
	xor	a
	ld	(subStatus), a
	ld	a, 8
	ld	(GameStatus), a
	ret
