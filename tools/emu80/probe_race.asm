; Проба «гонка с лучом» для сверки тайминга vector06js <-> Emu80 headless.
; Каждый кадр: IRQ -> стереть байт fb (столбец 0, lo=0x9B, игровая строка Y=100),
; подождать D итераций + N nop'ов, записать 0xFF. Байт виден в кадре, если запись
; обогнала луч (модель: T(Y)=13780+192*Y тактов после IRQ при vec_vscroll=0x1F).
; Обвязка (tools/emu80/…) подкручивает операнд LXI (DVAL+1) и цель JMP (SJMP+1).
	org 0x100
START:	di
	ld sp, 0xC000
	ld a, 0x88		; режим PPI: A,B,C — вывод
	out (0x00), a
	ld a, 0xC3		; JMP IRQH
	ld (0x0038), a
	ld hl, IRQH
	ld (0x0039), hl
	ld a, 0x1F
	out (0x03), a		; скролл как в игре
	ei
MAIN:	halt
	jp MAIN

IRQH:				; луч в верхней рамке
	; палитра: вход 8 (план 0x8000) = белый, вход 0 = чёрный
	ld a, 0x08
	out (0x02), a		; индекс рамки = 8 -> палитра пишется во вход 8
	ld a, 0xFF
	out (0x0C), a
	xor a
	out (0x02), a		; индекс рамки = 0
	xor a
	out (0x0C), a		; вход 0 = чёрный
	; стереть целевой байт
	xor a
	ld (0x809B), a
	; грубая задержка: D итераций по 36 тактов
DVAL:	ld bc, 0x0000
DLOOP:	dec bc			; 8
	ld a, b			; 8
	or c			; 8
	jp nz, DLOOP		; 12
	; тонкая подстройка: вход в горку NOP (0..7 x 4 такта)
SJMP:	jp SLED
SLED:	nop
	nop
	nop
	nop
	nop
	nop
	nop
WRITE:	ld a, 0xFF
WSTA:	ld (0x809B), a		; хук здесь: точный такт записи
	ei
	jp MAIN
