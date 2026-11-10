;  [mummy-zx] Пауза по схеме Monty: пока стоит пауза, АР2 — выход на титул. Тишина (команда 0x20, как
;  у initHardware/stageClear; SetMusic_ без di/ei — мы в ISR), затем штатный конец Game Over (reiniciaJuego:
;  игрок больше не управляет героем, GameStatus = 0). Вызов — из ISR на месте паузы, после пачки.
vec_isr_pq:
	ld	a, (vec_kbs)
	and	0x08	; АР2
	jp	z, vec_isr_pause
	xor	a
	ld	(vec_paused), a
	ld	a, 0x20
	call	SetMusic_
	ld	de, controlPlayer
	call	reiniciaJuego
	jp	vec_isr_pause
