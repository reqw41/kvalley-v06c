; Проба «длительности инструкций»: блоки известных инструкций между метками-хуками.
; Обвязка снимает такт на каждой метке; дельта = точная сумма длительностей блока.
; Эталон (наша таблица, слоты шины по 4): NOP=4, MOV r,r=8, LHLD=20, SHLD=20,
; CALL=24, RET=12, PUSH=16, POP=12, DCX=8, ORA=8, JNZ(взят)=12, JMP=12.
	org 0x100
START:	di
	ld sp, 0xC000
T0:	rept 256
	ld b, c			; MOV r,r: 256 x 8 = 2048
	endm
T1:	rept 256
	nop			; NOP: 256 x 4 = 1024
	endm
T2:	rept 64
	ld hl, (TMP)		; LHLD: 64 x 20 = 1280
	endm
T3:	rept 64
	ld (TMP), hl		; SHLD: 64 x 20 = 1280
	endm
T4:	rept 64
	call CSUB		; CALL+RET: 64 x (24+12) = 2304
	endm
T5:	rept 64
	push bc			; PUSH+POP: 64 x (16+12) = 1792
	pop bc
	endm
T6:	ld bc, 256		; петля: DCX+MOV+ORA+JNZ = 36/итер, посл. JNZ не взят
	; (не взятый JNZ у i8080 те же 10 базовых тактов -> 12)
LP:	dec bc
	ld a, b
	or c
	jp nz, LP		; 256 x 36 = 9216
T7:	jp T7			; конец замера, вечный цикл

CSUB:	ret
TMP:	dw 0
