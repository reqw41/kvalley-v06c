
;-------------------------------------------------------------------------------
;
; King's Valley (RC727)
;
; Copyright 1985 Konami
;
; Дизассемблировано и прокомментировано Manuel Pazos (jose.manuel.pazos@gmail.com)
; Santander, 17-07-2009
;
;-------------------------------------------------------------------------------


VERSION2	equ	1	; Вторая версия ROM с исправлением ошибок

;-------------------------------------------------------------------------------
; Изменяя константу VERSION2, можно собрать обе существующие версии игры
; Версия 2 [A1] исправляет некоторые ошибки предыдущей версии, например:
;
; - Запрещает бросать нож, пока дверь открывается.
;   Так предотвращается порча графики двери при пролёте ножа над ней
;
; - Запрещает бросать нож, когда герой вплотную к объекту (гем, кирка и т.п.)
;   В оригинальной версии нож пролетал сквозь объект
;
; - Можно копать по стене-ловушке
;
; - Исправлена позиция стены-ловушки пирамиды 10 на левом экране, внизу слева (появляется при взятии ножа)
;   В оригинальной версии она была на правом экране под лестницами, но чтобы она появилась, надо было выкопать пару кирпичей пола.
;
; - Изменена позиция стены-ловушки пирамиды 12 на правом экране, внизу справа (появляется при взятии кирки). Сдвинута на один тайл вправо (?)
;
; - Стены-ловушки останавливаются при столкновении с объектом. В прежней версии объект стирался (ошибочно декрементировались дробные X вместо координаты Y)
;-------------------------------------------------------------------------------

; В пирамиде 10-2 есть мумия, которая появляется над полом (!?)

;-------------------------------------------------------------------------------
; Структуры
;-------------------------------------------------------------------------------

;--------------------------------------
; ACTOR
;--------------------------------------
ACTOR_STATUS:	 equ	0
ACTOR_CONTROL:	 equ	1			; 1 = вверх, 2 = вниз, 4 = влево, 8 = вправо
ACTOR_SENTIDO:	 equ	2			; 1 = влево, 2 = вправо
ACTOR_Y:	 equ	3
ACTOR_X_DECIMAL: equ	4
ACTOR_X:	 equ	5
ACTOR_ROOM:	 equ	6
ACTOR_SPEEDXDEC: equ	7
ACTOR_SPEED_X:	 equ	8
ACTOR_SPEEDROOM: equ	9
ACTOR_MOV_CNT:	 equ	0x0A
ACTOR_FRAME:	 equ	0x0B
ACTOR_JMP_P:	 equ	0x0C		; Указатель на таблицу значений прыжка
ACTOR_JMP_P_H:	 equ	0x0D
ACTOR_JUMPSENT:	 equ	0x0E		; 0 = подъём, 1 = падение
ACTOR_SENT_ESC:	 equ	0x0F		; Направление лестниц. 0 = \  1 = /
ACTOR_POS_RELAT: equ	0x10		; 0 = на той же высоте (или почти), 1 = мумия выше, 2 = ниже
ACTOR_TIMER:	 equ	0x11
ACTOR_TIPO:	 equ	0x14
ACTOR_STRESS:	 equ	0x15		; Счётчик стресса мумии (чтобы знать, не сталкивается ли она слишком часто)

;--------------------------------------
; Вращающаяся дверь
;--------------------------------------
SPINDOOR_STATUS: equ	0
SPINDOOR_Y:	 equ	1
SPINDOOR_X_DEC:	 equ	2
SPINDOOR_X:	 equ	3
SPINDOOR_ROOM:	 equ	4
SPINDOOR_SENT:	 equ	5
SPINDOOR_TIMER:	 equ	6

;--------------------------------------
; MUSIC
;--------------------------------------
MUSIC_CNT_NOTA:	 equ	0
MUSIC_DURAC_NOTA: equ	1
MUSIC_ID:	 equ	2
MUSIC_ADD_LOW:	 equ	3
MUSIC_ADD_HIGH:	 equ	4
MUSIC_OCTAVA:	 equ	5			; Октава?
MUSIC_VOLUME_CH: equ	6			; Громкость канала
MUSIC_VOLUME:	 equ	7
MUSIC_CNT_LOOP:	 equ	9			; Сколько раз проигран паттерн
MUSIC_TEMPO:	 equ	0x0A

;-------------------------------------------------------------------------------
; BIOS
;-------------------------------------------------------------------------------

byte_6:		equ	6
byte_7:		equ	7






;-------------------------------------------------------------------------------
;
; Заголовок ROM
;
;-------------------------------------------------------------------------------
; [conv] SIZE 28 * 1024 ; Vector .rom (0x100..0x70FF, ниже фреймбуфера)

		org	0x100
		jp	vec_init	; Точка входа Vector .rom @0x100 (грузится по 0x100; vec_init ставит вектор RST7)
		dw	0

;----------------------------------------------------
; Сложение HL + A
;----------------------------------------------------

ADD_A_HL:
		add	a, l
		ld	l, a
		ret	nc
		inc	h
		ret

;----------------------------------------------------
; Сложение DE + A
;----------------------------------------------------

ADD_A_DE:
		add	a, e
		ld	e, a
		ret	nc
		inc	d
		ret


;-------------------------------------------------------------------------------
;
; MAIN
;
; Главная функция, вызывается из хука прерывания (50 или 60 Гц)
; Обновляет проигрыватель звука
; Не даёт выполнять логику при прерывании, если не
; завершилась предыдущая итерация
;-------------------------------------------------------------------------------

tickMain:
		call	RDVDP		; Сбрасывает флаг прерывания
		di
		call	vsnd_tick	; Обновляет драйвер звука (через часы ВИ53, см. vec_isr)

		call	vec_25_logic	; NZ = пауза 25 Гц или прошлый тик ещё идёт
		jp	nz, tickMain2

		inc	(hl)		; HL = tickInProgress, начало итерации
		ld	a, 2
		ld	(vec_fr_par), a	; следующий старт через 2 видеокадра (25 Гц)
		ei
		call	chkControls	; Обновляет состояние управления
		call	demoRun		; Выполняет логику игры (демо: два тика 50 Гц оригинала)

		xor	a
		ld	(tickInProgress), a ; Отмечает завершение текущей итерации

tickMain2:
		call	RDVDP		; Читает и сбрасывает флаг прерывания
		or	a		; Было ли прерывание во время выполнения логики игры?
		di
		call	m, vsnd_tick	; Да — обновляет звук (через часы ВИ53)
		ei
		ret


;----------------------------------------------------
; Читает состояние клавиш
; Защита от копирования (!?)
; При запуске из RAM затирает программу
;----------------------------------------------------

;----------------------------------------------------
; Переход по индексу
; (SP) = указатель на таблицу функций
;  A = индекс функции
;----------------------------------------------------

jumpIndex:
		add	a, a

JumpIndex2:
		pop	hl
;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ: `call getIndexHL_A` развёрнут по месту — это
;  копия его тела инструкция-в-инструкцию, убраны только call/ret (-27 тактов на каждый
;  диспетч; jumpIndex зовётся ~8 раз/кадр: статусы игры, мумий, дверей, гемов).
;  Регистры и флаги в точке `jp (hl)` побайтно те же (флаги — от add a,l / inc h, как
;  и внутри getIndexHL_A); глубина стека в момент перехода та же, транзитный возвратный
;  адрес просто не кладётся. getIndexHL_A остаётся для остальных вызывателей. +7 Б.
		add	a, l
		ld	l, a
		jp	nc, vec_ji2
		inc	h
vec_ji2:
		ld	a, (hl)
		inc	hl
		ld	h, (hl)
		ld	l, a
		jp	(hl)


;----------------------------------------------------
; То же, что WriteDataVRAM, но всегда пишет 0
;----------------------------------------------------

ClearDataVRAM:
		ld	c, 0		; Маска AND для записываемого байта
	jp writeDataVRAM2


;----------------------------------------------------
; Записывает в VRAM данные в формате
; Вход:
;   C = маска AND для записываемых данных
;  DE = адрес данных
;  0-1: адрес VRAM
;  2...: данные
; Данные:
;  FE: следующий блок (новый адрес + данные)
;  FF: конец данных
;----------------------------------------------------

WriteDataVRAM:
		ld	c, 0x0FF		; Маска AND для записываемого байта

writeDataVRAM2:
		ex	de, hl
		ld	e, (hl)
		inc	hl
		ld	d, (hl)
		ex	de, hl
		inc	de

writeDataVRAM3:
		ld	a, (de)
		inc	de
		ld	b, a
		inc	b		; Это #FF?
		ret	z		; Конец данных

		inc	b		; Это #FE?
	jp z,writeDataVRAM2	; Меняет указатель VRAM

		and	c		; Применяет маску AND к байту, записываемому в VRAM
		call	vec_text_blit	; NAT: прямой блит тайла -> фреймбуфер (было WRTVRM->dirty)
		inc	hl
	jp writeDataVRAM3

;-------------------------------------------------------------------------------
;
; Код запуска
;
; Устанавливает процедуру прерывания, вызывающую логику игры каждый кадр
; Очищает область переменных
; Инициализирует железо (видеорежим, PSG)
; Запускает бесконечный цикл, типично для Konami.
;-------------------------------------------------------------------------------

;  [mummy-zx] startCode (исполняется один раз после vec_init) — в бут-оверлее src/v06c/vec_bootov.asm;
;  здесь остался только вечный цикл ожидания.
dummyLoop:
		ei
	ld	a, (vnz_dly)	; [кирка] шумит -> вместо halt биты шума до следующего прерывания (vec_pick.asm)
	or	a
	jp	nz, vnz_idle
		halt
	jp dummyLoop

;----------------------------------------------------
; Запись в VRAM с защитой от копирования
; Перед записью в VRAM затирает код, если выполняется из RAM
;----------------------------------------------------

;-------------------------------------------------------------------------------
;
; Тик игры
;
;-------------------------------------------------------------------------------

runGame:
		ld	hl, timer
		inc	(hl)		; +1 за логический тик (25 Гц)

;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ (каждый тик): (1) push hl/pop hl вокруг чтения
;  GameStatus сняты — старый HL (указатель timer) мёртв: z-путь пишет HL (`ld hl,
;  chkPushAnyKey`), runGame2 идёт в jumpIndex, где `pop hl` затирает HL; (2) спилл A
;  через il_a вокруг bit-теста снят — A мёртв: runGame2 начинает с `ld a,c`, z-путь
;  доходит туда же. Флаги для jp nz — от того же and. -47 т/тик, -8 Б.
	ld hl,(GameStatus)	;  C = Game status, B = подстатус
	ld b,h
	ld c,l
		ld	a, (controlPlayer) ; bit 6 = героем управляет игрок
	and 1<<6
	jp nz,runGame2	; Да, не в режиме демо и не в меню

		ld	hl, chkPushAnyKey ; Эта функция добавлена, чтобы проверить нажатие клавиши и начать партию
		push	hl

runGame2:
		ld	a, c
		call	jumpIndex

		dw TitleScreen		; 0 = подготовка и вывод титула King's Valley
		dw WaitMainMenu		; 1 = ожидание в меню. Если клавиша не нажата — переход к демо
		dw SetDemo		; 2 = подготовка режима демо
		dw iniciaPartida	; 3 = музыка старта, мигание PLAY START и переход в игровой режим
		dw StartGame		; 4 = стирает меню, рисует пирамиду, дверь и вход героя
		dw gameLogic		; 5 = логика пергамента или игры
		dw tickMuerto		; 6 = потеря жизни / вывод сообщения Game Over
		dw tickGameOver		; 7 = Game Over
		dw stageClear		; 8 = Stage clear (добавляет жизнь и включает пергамент)
		dw ScrollPantalla	; 9 = скролл экрана
		dw ShowEnding		; 10 = показ финала игры


;----------------------------------------------------------------------------
; Титул King's Valley (0): подстатус 0 = очистка/загрузка, 1 = вывод меню.
; Экран Konami удалён: освободившиеся код и графика отданы читам и рендереру.
;----------------------------------------------------------------------------

TitleScreen:
	dec b
	jp nz,InitTitle
		call	drawGameLogo
		ret	c
		xor	a
		jp	NextGameStatus_

InitTitle:
		call	vec_cheats_reset
;  Общий вход при загрузке, после демо и Game Over. Снять save-under перед
;  очисткой обязательно: его старый фон уже не относится к новому экрану.
		call	vec_su_menu
		call	LoadIntroGfx
		call	setColor
		xor	a
		ld	(gameLogoCnt), a
		jp	NextSubStatus

;----------------------------------------------------------------------------
; Меню (1)
; Ждёт и переходит к демо
;----------------------------------------------------------------------------

WaitMainMenu:
		ld	hl, waitCounter
		dec	(hl)
		ret	nz		; Надо ждать дальше

		jp	NextGameStatusT	; Переход в режим демо

;----------------------------------------------------------------------------
;
; Демо игры (2)
; Ставит игровой статус и инициализирует переменные демо
;
;----------------------------------------------------------------------------

SetDemo:
		ld	hl, 4		; Статус Start game, подстатус = 0
		ld	(GameStatus), hl
		ld	l, 0
		ld	(PiramidesPasadas), hl ; Каждый бит — пройдена ли соответствующая пирамида
		ld	a, l
		ld	(numFinishGame), a ; Сколько раз игра пройдена
		ld	(timer), a	; [demo-sync] фаза timer известна: темп лестниц и мумий в демо зависит от чётности

		call	setDatosPartida

		ld	hl, 0x805	; Пирамида 5, правая дверь
		ld	(piramideDest),	hl

		ld	hl, DemoKeyData	; Записанные управления демо
		ld	(keyPressDemo),	hl ; Указатель на записанные управления

		ld	a, 8		; первый KEY держится 8 тиков (формат KEY,DUR)
		ld	(KeyHoldCntDemo), a
		ret

UpdateSubstatus:
		ld	(waitCounter), a

NextSubStatus:
		ld	hl, subStatus
		inc	(hl)

doNothing:
		ret

;----------------------------------------------------------------------------
;
; Старт игры (4)
;
;
;----------------------------------------------------------------------------

StartGame:
		ld	a, (flagPiramideMap) ; 0 = показ карты, 1 = внутри пирамиды
		rra			; Показывается ли карта пирамид?
		jp	nc, showMap

;  ЗАДАЧА #35: здесь стоял `call drawBrilloGemas` (под условием «подстатус != 0») — холостая
;  перезапись MSX-таблицы цвета. Снят вместе с самой процедурой, см. комментарий на её месте.

; Sub1: ожидание на лестнице входа


waitEntrada:
	dec b
	jp nz,bajaEscaleras
		ld	hl, waitCounter
		dec	(hl)
		ret	nz
	jp UpdateSubstatus

; Sub2: спуск по лестнице

bajaEscaleras:
	dec b
	jp nz,initStage2
		call	vec_nat_sprites
		jp	escalerasEntrada



;-------------------------------------------------------------------------------
; Выполняется после потери жизни или при старте партии.
; Стирает экран чёрной шторкой слева направо.
; Подстатус = 0
;-------------------------------------------------------------------------------

InitStage:
		call	drawCortinilla
		ret	p


		call	hideSprAttrib	; Убирает спрайты с экрана
		ld	hl, Vidas
		dec	(hl)		; Отнимает жизнь

		ld	a, (flagMuerte)
		or	a
	jp nz,dummyJump	; (!?)

dummyJump:				; Распаковывает графику и карту со всеми элементами
		call	unpackStage
		call	AI_Salidas	; Рисует открытый выход
		call	setSprDoorProta
		call	setAttribProta	; Обновляет атрибуты спрайтов героя
		call	vec_nat_sprites	; Обновляет атрибуты спрайтов (RAM->VRAM)
		call	setupRoom	; Рисует экран
		call	renderHUD	; Рисует табло, очки, жизни
		ld	a, 0x10
	jp UpdateSubstatus

; Sub3: начало фазы

initStage2:
	dec b
	jp nz,InitStage
; Спустился по лестнице, дверь уже закрылась
		ld	hl, waitCounter
		dec	(hl)
		ret	nz

		xor	a
		ld	(flagStageClear), a
		call	AI_Salidas

		call	isPl		; Z = демо
	jp z,initStage3

		ld	a, 0x8B		; Игровая музыка
		call	setMusic

initStage3:
		ld	hl, flagVivo
		ld	(hl), 1

NextGameStatusT:
		ld	a, 0x20

NextGameStatus_:
		ld	(waitCounter), a

NextGameStatus:
		ld	hl, GameStatus
		inc	(hl)

ResetSubStatus:
		xor	a
		ld	(subStatus), a
		ret

showMap:
	dec b
	jp nz,doCortinilla
		ld	hl, waitCounter
		dec	(hl)
		ret	nz

		call	renderMarcador
		call	setupPergamino
	jp initStage3

doCortinilla:
		call	drawCortinilla
		ret	p

		ld	hl, Vidas
		dec	(hl)
		ld	a, 1
		jp	UpdateSubstatus

;----------------------------------------------------
;
; Логика игры
;
;----------------------------------------------------

gameLogic:
		ld	a, (flagPiramideMap) ; 0 = показ карты, 1 = внутри пирамиды
		rra			; Режим игры или карты?
		push	af
		call	c, tickGame	; Логика игры
		pop	af
		call	nc, tickPergamino ; Логика пергамента

		ld	a, (flagEndPergamino) ;	1 = показ пергамента/карты завершён
		or	a
	jp z,chkVivo

		ld	a, 7
		ld	(GameStatus), a
	jp NextGameStatus

chkVivo:
		ld	a, (flagVivo)
		or	a		; Жив?
		ret	nz		; Да
	jp NextGameStatusT	; Нет, переход к следующему статусу

;----------------------------------------------------
;
; Потеря жизни / показ Game Over
;
;----------------------------------------------------

tickMuerto:
		ld	a, (MusicChanData)
		or	a
		ret	nz		; Играет музыка смерти

;  [2026-08-04] A мёртв (pierdeVida начинает с `ld a,(Vidas)`, z-путь — с `xor a`).
		call	isPl		; NZ = игрок
	jp nz,pierdeVida

		xor	a
		jp	setGameStatus	; Перезапуск игры при смерти в режиме демо

pierdeVida:
		ld	a, (Vidas)
		or	a
	jp nz,setGameMode

; Очищает область, где будет выведено сообщение GAME OVER
		xor	a
		ld	hl, 0x3929
		ld	b, 5

clrGameOverArea:
		push	bc
		xor	a
		ld	bc, 0x0C
		call	setFillVRAM
		ld	a, 0x20
		call	ADD_A_HL
		pop	bc
	dec b
	jp nz,clrGameOverArea

		ld	a, 0x9A		; Музыка GAME OVER
		call	setMusic

		ld	de, TXT_GameOver
		call	WriteDataVRAM	; Выводит сообщение GAME OVER

		ld	a, 6
		ld	(GameStatus), a	; (!?) Зачем ставить это, если в следующем вызове меняется?
		ld	a, 0x0B8
		jp	NextGameStatus_	; Переход в состояние Game Over

setGameMode:
		ld	a, 4		; Начало партии

setGameStatus:
		ld	(GameStatus), a
		ld	a, 0x20
		ld	(waitCounter), a
		jp	ResetSubStatus

;----------------------------------------------------
;
; Логика Game Over
; Пауза достаточно длинная, чтобы музыка успела закончиться
; Если нажато какое-то направление — возврат в меню, иначе повторный показ титула.
;
;----------------------------------------------------

tickGameOver:
		call	goGate		; [door-wall r3] игрок: каждый тик (= 2 кадра оригинала), демо: одна из двух
		ret	z		; Обрабатывает одну итерацию из двух

		inc	hl
		dec	(hl)
		ret	nz		; Декрементирует время ожидания

		call	chkPushAnyKey	; Проверяет нажатие клавиши для возврата в меню

		ld	a, (GameStatus)
		cp	7		; Режим Game Over?
		ld	de, controlPlayer ; bit 6 = героем управляет игрок
	jp z,reiniciaJuego

		ld	a, (de)
		and	0xbf	; Сбрасывает bit 6
		ld	(de), a
		ret

reiniciaJuego:
		ld	a, (de)
		and	0xbf	; Сбрасывает bit 6
		ld	(de), a
		xor	a
	jp setGameStatus	; Возвращает титул

;----------------------------------------------------
;
; Stage clear
;
; Глушит звук, добавляет жизнь и включает пергамент
;
;----------------------------------------------------

stageClear:
		ld	a, 0x20		; Тишина
		call	setMusic

		ld	hl, Vidas
		inc	(hl)		; Инкрементирует жизни
		inc	hl
		ld	a, (hl)
		add	a, 1
		daa
		ld	(hl), a		; Включает пергамент/карту
		xor	a
		ld	(flagEndPergamino), a ;	1 = показ пергамента/карты завершён
	jp setGameMode


;----------------------------------------------------
;
; Скролл экрана
; Двигает экран и обновляет позицию героя
; при переходе из одной комнаты в другую
;
;----------------------------------------------------

ScrollPantalla:
		call	tickScroll
		ret	c		; Скролл не завершён

		ld	hl, GameStatus
		ld	(hl), 5		; Режим = игра
		ld	a, (sentidoProta) ; 1 = влево, 2 = вправо
		rra
		ld	a, (ProtaRoom)	; Старшая часть координаты X. Указывает комнату пирамиды
		ld	c, 0x0F0		; Координата X героя в правой части экрана
		ld	b, a
		dec	b		; Сдвигает героя на экран влево
	jp c,scrollPantalla2
		inc	b
		inc	b		; Сдвигает героя на экран вправо
		ld	c, 4		; Координата X в левой части

scrollPantalla2:
	push hl	; Ставит героя в правильную позицию
	ld h,b
	ld l,c
	ld (ProtaX),hl
	pop hl
		jp	setAttribProta	; Обновляет атрибуты спрайтов героя

;----------------------------------------------------
;
; Финал игры
;
;----------------------------------------------------

;----------------------------------------------------
;
; Начинает партию
;
; - Играет музыку начала партии
; - Мигает PLAY START
; - Инициализирует переменные партии и переключает игровой статус
;
;----------------------------------------------------

iniciaPartida:
	dec b
	jp nz,PlayIntroMusic
		ld	hl, waitCounter
		dec	(hl)
	jp z,ComienzaPartida

		ld	a, (hl)		; Мигает каждые 4 кадра
		and	1<<2
		ld	de, TXT_PLAY_START
		jp	nz, ClearDataVRAM ; Стирает текст

		jp	WriteDataVRAM	; Выводит "PLAY START"

ComienzaPartida:
		call	IniciaDatosPartida
		jp	NextGameStatusT

PlayIntroMusic:
		ld	a, 0x97		; Музыка начала партии
		call	setMusic
		ld	a, 0x50
		ld	(waitCounter), a
		jp	NextSubStatus


;----------------------------------------------------
;
;----------------------------------------------------

setColor:
		push	af
		push	de
		push	hl
;  ГРАДИЕНТ ЛОГО: setColor зовут РОВНО два титульных входа (InitTitle и возврат из демо),
;  поэтому это «палитра титула» -> грузим vec_pal_title (7 слотов градиента + чёрный фон),
;  а не игровую vec_pal (её вернёт vec_setpal_a в setupStage). vsp_defer вместо vsp_load:
;  mid-frame запись палитры латчится в цвет пикселя ПОД ЛУЧОМ и портит случайный слот
;  (в базе так протухал idx7 — было не видно, т.к. idx6/7 пустовали; с градиентом расхлопка
;  пары показала бы служебное ОЗУ p3). Отложенная загрузка применяется в VBlank (замер: +1 кадр).
		ld	hl, vec_pal_title+15
		call	vsp_title	; = vsp_defer + сброс flagPiramideMap (см. хвост vec_blit)
		pop	hl
		pop	de
		pop	af
		; 8col: backdrop idx0 -> чёрный (титул/меню, reg-transparent)
		ld	b, 0x0E0
		ld	c, 7
		ret	; peephole: было `jp WRTVDP`, а WRTVDP на Векторе = одинокий `ret`
			; (регистры VDP не программируются). B/C всё равно грузим — вдруг
			; вызыватель на них смотрит; -2 Б и -10 тактов.

;----------------------------------------------------
;
; Загрузка шрифта и графики титула
;
;----------------------------------------------------

LoadIntroGfx:
;  ЦВЕТ ТАЙЛОВ ГОТОВОЙ ТАБЛИЦЕЙ (2026-07-30): раньше его сводил vec_col_store по ходу
;  распаковки цветов, теперь профиль сцены просто копируется. Ставим ДО распаковки —
;  порядок не важен, таблица от неё не зависит.
		ld	hl, vec_ct_intro
		ld	de, vec_ct_intro_mix
		call	vec_ct_load
		call	loadFont	; Шрифт

;  ЗАДАЧА #35 (2026-07-31): здесь стояла распаковка GFX_Space в VDP 0x0008 («паттерн пробела»
;  по комментарию MSX-исходника — на деле адрес 0x0008 лежит в ТАБЛИЦЕ ЦВЕТА, а не паттернов).
;  Снята вместе с данными: на Векторе диапазон 0x0000-0x17FF уходит в vec_fill_col/vec_de_col,
;  а те упираются в vec_col_store = одинокий `ret` (задача #27, цвет считается офлайн).

setGfxMenu:
		ld	de, GFX_Menu	; Логотип King's Valley и пирамида меню
		ld	hl, 0x2200	; BG char (Вектор: тайлсет титула 0x90->0x40, хвост p2 освобождён)
;  ЗАДАЧА #35: ниже шли ТРИ холостых заливки MSX-таблицы цвета, снятые вместе с данными:
;    * ATTRIB_Menu (20 Б) -> VDP 0x200  — цветовые атрибуты пирамиды меню;
;    * COLORES_LOGO (17 Б) x 22 колонки (петля coloreaLogo, 0x4258 шагом 0x10) — цвет логотипа;
;    * fillVRAM3Bank A=0x40, BC=0x10 -> VDP 0x43B8 (H&0x3F=3 => цвет) — хвост логотипа.
;  Всё это писалось в MSX color table, которая на Векторе никуда не оседает: замер
;  tools/verify/coltab_dead_audit.js — 0 записей в тень паттернов / vec_spr_buf / vec_tilemode /
;  vec_mixbuf / плоскости экрана на 26 заходов (10392+5772+22×~2000 = ~66 тыс. тактов).
;  Цвет титула и меню целиком даёт офлайн-профиль vec_ct_intro (vec_ct_load выше).
		jp	UnpackPatterns


;----------------------------------------------------
; Инициализирует переменные для новой партии
;----------------------------------------------------

IniciaDatosPartida:
		ld	hl, score_0000xx
		ld	bc, 0x0E7
		ld	d, h
		ld	e, l
		inc	e
		ld	(hl), 0
	call vec_ldir_fwd

;----------------------------------------------------
;
; Инициализирует значения для новой партии
;
;----------------------------------------------------

setDatosPartida:
		ld	hl, ValoresIniciales
		ld	de, Vidas
		ld	bc, 7
	jp vec_ldir_fwd	; peephole: был `call ... / ret` -> хвостовой jp
ValoresIniciales:	db    5
					; Жизни
		db    1			; Не показывать пергамент
		db    0			; Счётчик доп. жизней
		db    2			; Флаг «жив»
		db    1			; Текущая пирамида
		db    1			; Пирамида назначения
		db    8			; Направление стрелки

;----------------------------------------------------
;
; Загружает графику и готовит текущую пирамиду
;
;----------------------------------------------------

unpackStage:
		call	loadGameGfx	; Загружает графику и спрайты
		jp	setupStage	; Распаковывает текущую карту

;----------------------------------------------------
; Вертикальная шторка
;----------------------------------------------------

drawCortinilla:
		ld	hl, timer
		dec	(hl)
		inc	hl
		dec	(hl)
		jp	m, cort_done	; timer_hi<0 -> очистка 16K ОДИН РАЗ + SIGN=M
;  СПРЯТАТЬ СПРАЙТОВ НА ПЕРВОМ ЖЕ КАДРЕ ШТОРКИ — КАК В ОРИГИНАЛЕ.
;  В MSX-исходнике drawCortinilla НЕ кончается на `djnz drawCortinilla2`: она ПРОВАЛИВАЕТСЯ
;  в HideSprites (заливка таблицы атрибутов VRAM 0x3B00 значением 0xC3), то есть КАЖДЫЙ
;  кадр шторки гасит все 32 аппаратных спрайта. Герой и мумии исчезают с первого кадра
;  шторки, а стирается только лабиринт. У нас HideSprites уехал в cort_done («один раз, а
;  не каждый кадр») — и это сняло гашение целиком: спрайты у нас не атрибуты, а ПИКСЕЛИ в
;  планах, и на Векторе они доживали до конца очистки (замер shutter_sprite_probe.js:
;  91 кадр из 100 при смерти, 89 из 98 при чите N).
;  Гашение пикселей = restore-under всех слотов, это ровно vec_spr_flush (он же снимает
;  спрайты перед скроллом в chkScroll3): фон под спрайтом возвращается ЦЕЛЫМ, слоты
;  инвалидируются, prev метится скрытым, невыведенная подготовка отменяется (vsp_n/vsp_rdy
;  = 0, протокол «список либо целиком, либо никак» соблюдён). Контекст тот же, что у
;  vec_nat_sprites — игровой тик (vec_isr_depth==1), поэтому нереентерабельность безопасна.
;  ЗОВЁМ ДО блита столбца: на первом кадре шторки фон в слотах ещё точен, restore кладёт
;  настоящий лабиринт, а не протухшую копию.
;  ГЕЙТ vsu_any: валидных слотов нет — снимать нечего. Флаг гасит сам vec_spr_flush, так
;  что дорогой проход по 21 слоту случается РОВНО ОДИН РАЗ за шторку, остальные её кадры
;  платят 18 тактов. Кадр шторки при этом не дорожает: тик и так идёт раз в 3 кадра.
		push	hl
		ld	a, (vsu_any)
		or	a
		call	nz, vec_spr_flush
		pop	hl
		ld	a, (hl)
		ld	h, 0x38		; HL = 0x3800 + col (адрес name table), как в оригинале
		xor	0x1F
		ld	l, a
		di		; атомарный блит-цикл (24 клетки)
		ld	a, (vec_isr_depth)
		push	af		; сохранить реальную глубину
		ld	a, 1
		ld	(vec_isr_depth), a ; принудительно !=0: vbt_row сохраняет DI
;  26 РЯДОВ, А НЕ 24 (2026-08-12, перекомпоновка кадра). Шторка гасит столбец сверху вниз,
;  и раньше ей хватало 24 рядов = ровно поле (ряды 0..23), потому что нижняя строка UI жила
;  в ряду 23. Теперь в кайме ДВА ряда UI — 24 (©KONAMI/PYRAMID-NN) и 25 (метка версии на
;  титуле), см. res_ui_gfx.asm; шторка обязана гасить ОБА:
;  setupEnding зовёт шторку и подпись НЕ перерисовывает — иначе «©KONAMI PYRAMID-15»
;  осталось бы висеть под сценой концовки, а метка версии V1-01B — поверх игры. Заодно
;  гасится метка режима звука (vec_snd_show, ряд 24, столбцы 28-31). Цена: НОЛЬ БАЙТ (то
;  же ld b, другая константа) и два блита пустого тайла на кадр шторки — она транзиент.
;  ВЫШЕ НЕЛЬЗЯ: ряд 30 — табло, его шторка стирать не должна (счёт живёт сквозь сцены).
		ld	b, 0x1A		; 26 рядов: поле 0..23 + кайма 24 (подпись) и 25 (метка версии)
drawCortinilla2:
		push	bc		; сохранить счётчик рядов B
		xor	a
		ld	(vw_byte), a	; тайл 0 = пустой
		call	vec_rc		; ФАЗА 5: B = ряд, C = столбец (общее с vec_text_blit)
		push	hl		; КРИТ: vec_blit_tile НЕ сохраняет HL -> держим в стеке
		call	vec_blit_tile	; B=ряд C=столбец vw_byte=0
		pop	hl		; HL = адрес name table (иначе ряды 1..23 блитятся в мусор)
		ld	de, 0x20
		add	hl, de		; Следующий ряд
		pop	bc
	dec b
	jp nz,drawCortinilla2
		pop	af
		ld	(vec_isr_depth), a ; восстановить реальную глубину
		dec	a		; [mus-jitter] глубина 1 (игровой тик) -> EI
	jp nz,dt_cort_keepdi	; вложенный ISR -> оставить DI
		ei
dt_cort_keepdi:
		xor	a		; SIGN=P (вызывающий продолжает стирание)
		ret
cort_done:
		call	HideSprites	; очистка 0xC000-0xF4FF (p2 + 21 страница слотов) + сброс prev
					; (ОДИН РАЗ, не каждый кадр). ПОПРАВКА 2026-08-03: стояло
					; «16K p2+p3» — выше 0xF500 она НЕ идёт, см. cp 0x0F5.
;  Штатный HW-скролл (тот же, что на титуле: vec_vs_menu = vec_vscroll). Шторка —
;  единственная дорога в геймплей. После HideSprites: на случай, если лого Konami
;  ещё держал vec_vs_cur выше штатного.
		ld	a, vec_vscroll
		ld	(vec_vs_cur), a
		out	(0x03), a
		ld	a, 0x0FF
		or	a		; SIGN=M (шторка завершена)
		ret


;----------------------------------------------------
; Стирает атрибуты спрайтов в VRAM
;----------------------------------------------------

HideSprites:
		ld	e, 0x0E0
		ld	hl, 0x0C000
hsClrP3:
		ld	(hl), 0
		inc	hl
		ld	(hl), 0
		inc	hl
		ld	(hl), 0
		inc	hl
		ld	(hl), 0
		inc	hl
		ld	(hl), 0
		inc	hl
		ld	(hl), 0
		inc	hl
		ld	(hl), 0
		inc	hl
		ld	(hl), 0
		inc	hl
		ld	(hl), 0
		inc	hl
		ld	(hl), 0
		inc	hl
		ld	(hl), 0
		inc	hl
		ld	(hl), 0
		inc	hl
		ld	(hl), 0
		inc	hl
		ld	(hl), 0
		inc	hl
		ld	(hl), 0
		inc	hl
		ld	(hl), 0
		inc	hl
		ld	a, h
		cp	e
		jp	nz, hsClrP3
;  [2026-07-29] ДУБЛЬ УДАЛЁН: вторая петля hsClrP3b чистила тот же 0xC000-0xDFFF
;  (обе до H==E=0xE0) — идемпотентный повтор, ~44Б кода возвращено в бюджет.
		ld	hl, vec_spr_save
hsClrSU:
		ld	(hl), 0
		inc	hl
		ld	a, h
		cp	0x0F5	; ФИКС 2026-07-29: чистить ВСЕ 21 слот-страницу (0xE000-0xF4FF).
		jp	nz, hsClrSU	; Старая граница 0xEB — реликт 64Б-слотов: слоты 11-20 оставались
				; валидными, и на карте restore рисовал их геймплейный фон ПОВЕРХ
				; карты (карта рисовалась и стиралась). Выше 0xF5 — кэши, не трогать.
		ld	hl, vec_nsp_prev
		ld	b, 19
hsRstPrev:
		ld	(hl), 0x0D0
		inc	hl
		inc	hl
		inc	hl
		dec	b
		jp	nz, hsRstPrev
		xor	a
		ret


;----------------------------------------------------
; Скрывает спрайты, устанавливая координату Y
; в RAM-атрибутах в #E1
;----------------------------------------------------

hideSprAttrib:
		ld	b, 0x20

hideSprAttrib2:
		ld	hl, sprAttrib	; Таблица атрибутов спрайтов в RAM (Y, X, Spr, Col)

hideSprAttrib3:
		ld	(hl), 0x0E1
		inc	hl
		inc	hl
		inc	hl
		inc	hl
	dec b
	jp nz,hideSprAttrib3
		ret

;----------------------------------------------------
; Убирает мумий
;----------------------------------------------------

quitaMomias:
		ld	hl, enemyAttrib
		ld	b, 0x0A
	jp hideSprAttrib3


;----------------------------------------------------
; Рисует тексты
; (C) KONAMI PYRAMID-xx
; Номер пирамиды вычисляется:
; число прохождений игры * 15 + текущая пирамида
;----------------------------------------------------

drawPyramidNumber:
		ld	de, TXT_KONAMI_PYR
		call	WriteDataVRAM
		ld	a, (numFinishGame) ; Сколько раз игра пройдена
		ld	b, a
		add	a, a
		add	a, a
		add	a, a
		add	a, a
		sub	b		; x15
		ld	b, a
		ld	a, (piramideActual)
		add	a, b
		ld	hl, 0x3B18	; Номер пирамиды (кайма: ряд 24, столбцы 24-25 — см. res_ui_gfx.asm)
		jp	drawDigit


;----------------------------------------------------
; Рисует число жизней
;----------------------------------------------------

dibujaVidas:
		ld	hl, 0x3BDD	; Координаты жизней (кайма: ряд 30, см. res_ui_gfx.asm)
		ld	a, (Vidas)

drawDigit:
		call	convDecimal
		ld	b, 1
		jp	renderNumber3

;----------------------------------------------------
; Преобразует значение в десятичное
;----------------------------------------------------

convDecimal:
		ld	b, a
		sub	0x64
	jp nc,convDecimal
		ld	c, 0

convDecimal2:
		ld	a, b
		sub	0x0A
	jp c,convDecimal3
		push	af
		ld	a, c
		add	a, 0x10
		ld	c, a
		pop	af
		ld	b, a
	jp nz,convDecimal2

convDecimal3:
		ld	a, c
		or	b
		ret


;----------------------------------------------------
; Настройка меню
;----------------------------------------------------

SetUpMenu:
		call	setGfxMenu	; Загружает графику логотипа меню
		xor	a
		ld	(gameLogoCnt), a

loopDrawLogo:
		call	drawGameLogo
	jp c,loopDrawLogo
		ret
;---------------------------------------------------
;
; Рисует логотип KING'S VALLEY в меню
; Рисует каждое слово столбец за столбцом
;
;---------------------------------------------------

drawGameLogo:
		ld	hl, gameLogoCnt	; Счётчик — какая часть логотипа меню рисуется
		ld	a, (hl)
		inc	(hl)
		cp	0x16		; Закончил рисовать KING'S VALLEY?

copyProtect_:
		jp	nc, drawMenuEnd
		ld	hl, 0x3867	; Координаты KING'S
		cp	9		; Закончил рисовать "KING'S"?
	jp c,drawGameLogo2
		ld	hl, 0x38C4	; Координаты VALLEY

drawGameLogo2:
		ld	c, a
		add	a, l
		ld	l, a
		ld	a, c
		add	a, a
		add	a, 0x4B		; #9B — первый паттерн логотипа. KING'S(#9B-#AC), VALLEY(#AD-C6)
		ld	c, a
		ld	b, 2		; Число паттернов за итерацию

drawGameLogo3:
		ld	a, c
		call	vec_logo_blit	; NATLOGO+градиент: буква KING'S VALLEY -> фреймбуфер построчно
		ld	a, 0x20		; Инкремент координаты Y (следующий ряд паттернов)
		call	ADD_A_HL
		inc	c
	dec b
	jp nz,drawGameLogo3

		ld	a, l
		sub	0x0EC		; Nametable + #EC = нижняя часть G
		cp	2
	jp nc,drawGameLogo4
		add	a, 0x77		; Паттерн нижней части G в KING'S
		call	vec_logo_blit	; NATLOGO+градиент: низ «g» KING'S (тайлы 0x77/0x78, синий)

drawGameLogo4:
		scf
		ret

drawMenuEnd:
		ld	de, TXT_MainMenu
		call	WriteDataVRAM	; Выводит "KONAMI 1985" и "PUSH SPACE KEY"

		ld	hl, vec_logo_blit ; пирамида: построчный бело-серый блит вместо кирпичного
		ld	(vbr_call+1), hl  ; пути vbt8_brick (тайлы 0x40-0x44!). См. vec_logo_msk.
		ld	de, GFX_PiramidLogo
		ld	hl, 0x3852	; Координаты
		ld	bc, 0x306	; Высота x ширина
		call	vec_blit_rect	; NATLOGO(t5): пирамида титула -> фреймбуфер (было DEtoVRAM_NXNY)
		call	vec_pyr_end	; вернуть vec_blit_rect на штатный vec_text_blit
		xor	a		; [СНЯТО] здесь рисовалось меню сложности
		ret


;----------------------------------------------------
; Показывает информацию экрана: табло, жизни
;----------------------------------------------------

renderHUD:
		call	drawPyramidNumber

renderMarcador:
		ld	de, TXT_Marcador ; "REST SCORE"
		call	WriteDataVRAM
		call	dibujaVidas
	jp renderRecord

;----------------------------------------------------
; Обновляет очки и рекорд
;
; DE = очки к добавлению
; На 10000 очков — доп. жизнь
; Затем каждые 20000
;----------------------------------------------------

SumaPuntos:
		call	isPl
		ret	z		; Режим демо — очки не начисляются

		ld	hl, score_0000xx
		ld	a, (hl)
		add	a, e
		daa
		ld	(hl), a		; Обновляет единицы/десятки

		ld	e, a
		inc	l
		ld	a, (hl)
		adc	a, d		; Добавляет перенос предыдущей операции
		daa
		ld	(hl), a		; Обновляет сотни/тысячи

		ld	d, a
		inc	hl
	jp nc,setRecord	; Десятки тысяч не изменились

		ld	a, (hl)
		add	a, 1		; Инкремент десятков тысяч x0000
		daa
		ld	(hl), a
	jp nc,chkExtraLife	; Проверяет получение доп. жизни

		ld	bc, 0x9999	; Максимально возможные очки
	push hl
	ld h,b
	ld l,c
	ld (record_0000xx),hl
	pop hl
	push hl	;	Рекорд = 999999
	ld h,b
	ld l,c
	ld (record_0000xx+1),hl
	pop hl
	jp renderRecord

chkExtraLife:
		ld	a, (extraLifeCounter)
		cp	(hl)
	jp nc,setRecord

		push	de
		push	hl
		add	a, 2		; Каждые 20000 очков
		daa
	jp nc,chkExtraLife2
		ld	a, 0x0FF

chkExtraLife2:
		ld	(extraLifeCounter), a ;	Следующее кратное 10 000, на котором будет доп. жизнь
		call	VidaExtra	; Добавляет доп. жизнь
		pop	hl
		pop	de

setRecord:
		ld	a, (record_xx0000)
		ld	b, (hl)
		sub	b
	jp c,setRecord2	; Очки больше текущего рекорда — обновляет рекорд

	jp nz,renderScore	; Меньше

		ld	hl, (record_0000xx)
	call vec_sbcd	; HL -= DE с флагами Z80-ного `sbc hl,de` (см. хвост файла)
	jp nc,renderScore

setRecord2:
	push hl
	ld h,d
	ld l,e
	ld (record_0000xx),hl
	pop hl
		ld	a, b
		ld	(record_xx0000), a

renderRecord:
		ld	de, record_xx0000
		ld	hl, 0x3BD1	; Рекорд (кайма: ряд 30, см. res_ui_gfx.asm)
		call	renderNumber

renderScore:
		ld	hl, 0x3BC7	; Очки (кайма: ряд 30, см. res_ui_gfx.asm)
		ld	de, score_xx0000

renderNumber:
		ld	b, 3		; Выводит 3 пары цифр (в каждом байте две цифры)

renderNumber2:
		ld	a, (de)

renderNumber3:
		push	bc
		call	AL_C__AH_B	; Копирует старший ниббл A в B, младший в C
		ld	a, b
		add	a, 0x10		; Номер паттерна, соответствующего '0'
		call	vec_text_blit	; NAT: прямой блит тайла цифры -> фреймбуфер

		inc	hl		; Инкремент координаты X
		ld	a, c
		add	a, 0x10		; Номер паттерна, соответствующего '0'
		call	vec_text_blit	; NAT: прямой блит тайла цифры -> фреймбуфер

		dec	de		; Следующая пара (байт)
		inc	hl		; Следующая позиция VRAM
		pop	bc
	dec b
	jp nz,renderNumber2
		ret


;----------------------------------------------------
; Копирует старший ниббл A в B, младший в C
;----------------------------------------------------

AL_C__AH_B:
		push	af		; Копирует старший ниббл A в B, младший в C
		rra
		rra
		rra
		rra
		and	0x0F
		ld	b, a
		pop	af
		and	0x0F
		ld	c, a
		ret

;----------------------------------------------------
;
; Очищает экран
;
; Скрывает спрайты и очищает name table
;
;----------------------------------------------------

clearScreen:
		call	HideSprites
		ld	hl, 0x7800	; Name table (#3800), VRAM = 16K #0000-#3FFF
		ld	bc, 0x300	; Размер name table
		xor	a

;----------------------------------------------------
; Заполняет VRAM
; HL = адрес VRAM
; A = данные
; BC = число байт
;----------------------------------------------------

setFillVRAM:
		ld	(vec_fill_val), a
		ld	a, b
		cp	0x40
		jp	nc, vec_fill_all
		ld	a, h
		and	0x3F
		cp	0x38
		jp	nz, vfn_no
		ld	a, l
		or	a
		jp	nz, vfn_no
		ld	a, b
		cp	3
		jp	nz, vfn_no
		ld	a, c
		or	a
		jp	nz, vfn_no
		jp	vec_fill_name
;  ЗДЕСЬ БЫЛ ОТБОР В vec_fill_col (27 Б): «BC<=0x40 И адрес < 0x1800» -> быстрый заливщик
;  MSX-таблицы цвета. Снят вместе с самим vec_fill_col — см. комментарий на его месте ниже.
vfn_no:
vec_fill_sl0:
		ld	a, (vec_fill_val)
		jp	vec_fill_slow
;  [СНЯТО] vec_fill_col (65 Б) — быстрый заливщик MSX-таблицы цвета, остаток soft-VDP.
;  Он в цикле звал vec_col_store, который с задачи #27 — ОДИНОКИЙ `ret` (цвет считается
;  офлайн и грузится готовой таблицей vec_ct_load). То есть весь полезный эффект процедуры
;  сводился к продвижению vec_vdp_ptr на BC, и то только на адресах < 0x1800.
;  ДОКАЗАТЕЛЬСТВО НЕДОСТИЖИМОСТИ (не «на глаз»): в ROM на её первый байт ставилась ловушка
;  `jp $` (вечная петля), и в таком виде ЗЕЛЁНЫМИ прошли все гейты — coltab_frame_parity,
;  screens_palette_check, palette_lag_gate, stageclear_recolor, spr_resid_gate, atomic_gate,
;  beam_late, door_fixup, map_fidelity, bonus_ending_gate, ending_door_fidelity,
;  spr_tables_gate, snd_tempo/source/firstnote. Войди игра сюда хоть раз — она бы встала.
;  Плюс PC-ловушка на прогоне бут+логотип+титры+демо+меню+геймплей+ходьба+6 пирамид+чит H:
;  0 входов. Оба отбора, которые вели сюда (в setFillVRAM и в fillVRAM), сняты; их диапазон
;  теперь идёт общим медленным путём vec_fill_slow/VRAM_write2 -> vec_cache_wr -> vcw_col ->
;  vec_col_store, то есть в тот же `ret`.
vec_fill_all:
		push	hl
		ld	hl, 0x8000
vec_fa_fb:
		xor	a
		ld	(hl), a
		inc	hl
		ld	a, h
		cp	0x0C0
		jp	c, vec_fa_fb
		ld	hl, 0x0C000
vec_fa_sh:
		ld	a, (vec_fill_val)
		ld	(hl), a
		inc	hl
		ld	a, h
		cp	0x0CD
		jp	c, vec_fa_sh
		ld	hl, vec_mixbuf
		ld	b, 120
vec_fa_col:
		ld	a, (vec_fill_val)
		ld	(hl), a
		inc	hl
		dec	b
		jp	nz, vec_fa_col
		ld	hl, vec_tilemode
		ld	b, 0
vec_fa_md:
		ld	(hl), 0x0FF
		inc	hl
		dec	b
		jp	nz, vec_fa_md
		pop	hl
		xor	a
		ret
vec_fill_name:
		push	hl
		push	de
;  peephole: было развёрнутое HL += BC на шести инструкциях (ld a,l/add a,c/ld l,a/
;  ld a,h/adc a,b/ld h,a) — точный эквивалент i8080-инструкции `add hl,bc`. -5 Б и
;  28 тактов -> 10. Разница только в A и флагах: A ниже перезаписывает `xor a`,
;  флаги там же и пересчитываются.
		add	hl, bc
		ld	(vec_vdp_ptr), hl
		ld	hl, 0x8000
vfn_fb:
		xor	a
		ld	(hl), a
		inc	hl
		ld	a, h
		cp	0x0C0
		jp	c, vfn_fb
		pop	de
		pop	hl
		ld	a, (vec_fill_val)
		ret
vec_fill_slow:
		call	setVDPWrite

fillVRAM:
		ld	(vec_fill_val), a
;  ЗДЕСЬ БЫЛ ВТОРОЙ ОТБОР В vec_fill_col (28 Б), тот же по смыслу, что в setFillVRAM.
;  Снят вместе с процедурой: диапазон таблицы цвета идёт общим путём VRAM_write2.
;  HL СОХРАНЯЕТСЯ (2 Б, жалоба с железа 2026-08-11 «на GAME OVER пропали два тайла стены»).
;  В оригинале заливка идёт `out (c),a` по защёлкнутому адресу VDP и HL НЕ ТРОГАЕТ вовсе;
;  у нас адрес — рабочий указатель, и он уезжал на BC вперёд. Кто на этом горел:
;  clrGameOverArea делает `call setFillVRAM / ld a,20h / call ADD_A_HL` пять раз — с уехавшим
;  HL шаг ряда становился 0x20+0x0C=0x2C, и вместо прямоугольника (ряды 9-13, столбцы 9-20)
;  чистились ленты 0x3929, 0x3955, 0x3981, 0x39AD, 0x39D9, срезая куски стен лабиринта.
;  Тот же контракт нужен fillVRAM3Bank2 (`add hl,de` = 0x800 между банками) и fillVRAM_DE.
;  Гейт: tools/verify/gameover_wall_gate.js.
VRAM_write2:
		push	hl
		ld	hl, (vec_vdp_ptr)
vw2_nl:
		ld	a, (vec_fill_val)
		call	vec_cache_wr
		inc	hl
		dec	bc
		ld	a, b
		or	c
		jp	nz, vw2_nl
		ld	(vec_vdp_ptr), hl
		pop	hl
		ld	a, (vec_fill_val)
		ret

;----------------------------------------------------
; Заполняет BC байт VRAM данными из (DE)
;----------------------------------------------------

fillVRAM_DE:
		ld	a, (de)
		inc	de
	jp fillVRAM

;----------------------------------------------------
;
; Передаёт данные из RAM в VRAM
; HL = адрес назначения в VRAM
; DE = источник
; BC = число данных
;
;----------------------------------------------------

;----------------------------------------------------
;
; Передаёт данные из RAM в VRAM
; [фаза1: снят DEtoVRAMset — мёртвый call setVDPWrite]
; DE = источник
; BC = число данных
;
;----------------------------------------------------

DEtoVRAM:
		push	hl
		ld	hl, (vec_vdp_ptr)
		ld	a, h
		and	0x3F
		ld	h, a
		cp	0x18	; таблица цвета: общим медленным путём (был свой vec_de_col, снят)
		jp	c, vec_de_slow0
		cp	0x20
		jp	c, vec_de_sprb
		cp	0x38
		jp	c, vec_de_ok
		jp	vec_de_slow0	; 0x3800+ (name/SAT): тоже общий путь (был отбор в vec_de_satb)
vec_de_ok:
		push	hl
		add	hl, bc	; peephole: развёрнутое HL += BC (6 инстр.) -> `add hl,bc`, -5 Б.
			; A ниже перезаписывает `ld a,h`, флаги пересчитывает `and 7`.
		ld	(vec_vdp_ptr), hl
		pop	hl
		push	de
		ld	a, h
		and	7
		ld	h, a
		call	pat_base
		add	hl, de
		pop	de
vec_de_cpy:
		ld	a, b
		or	a
		jp	nz, vdcp_8
		ld	a, c
		cp	8
		jp	c, vdcp_1
vdcp_8:
		ld	a, (de)
		ld	(hl), a
		inc	de
		inc	hl
		ld	a, (de)
		ld	(hl), a
		inc	de
		inc	hl
		ld	a, (de)
		ld	(hl), a
		inc	de
		inc	hl
		ld	a, (de)
		ld	(hl), a
		inc	de
		inc	hl
		ld	a, (de)
		ld	(hl), a
		inc	de
		inc	hl
		ld	a, (de)
		ld	(hl), a
		inc	de
		inc	hl
		ld	a, (de)
		ld	(hl), a
		inc	de
		inc	hl
		ld	a, (de)
		ld	(hl), a
		inc	de
		inc	hl
		ld	a, c
		sub	8
		ld	c, a
		ld	a, b
		sbc	a, 0
		ld	b, a
		jp	vec_de_cpy
vdcp_1:
		ld	a, c
		or	a
		jp	z, vdcp_e
		ld	a, (de)
		ld	(hl), a
		inc	de
		inc	hl
		dec	c
		jp	vdcp_1
vdcp_e:
		pop	hl
		ret
;  [СНЯТО] vec_de_col (29 Б) — bulk-приёмник MSX-таблицы цвета, остаток soft-VDP.
;  Его цикл звал vec_col_store = одинокий `ret` (задача #27), поэтому весь эффект
;  процедуры был: vec_vdp_ptr += BC, DE += BC, BC = 0, HL восстановлен, A = 0.
;  РОВНО ТО ЖЕ делает общий vec_de_slow0 на этом диапазоне: vec_cache_wr -> vcw_col ->
;  vec_col_store (тот же `ret`), выход с A=0 и восстановленным HL. То есть маршрутизация
;  «< 0x1800 -> vec_de_slow0» эквивалентна регистр-в-регистр, просто медленнее (путь холодный).
;  Сверх того недостижимость доказана ловушкой `jp $` на первом байте: все гейты зелёные.
vec_de_sprb:
		push	hl
		add	hl, bc	; peephole: развёрнутое HL += BC (6 инстр.) -> `add hl,bc`, -5 Б.
			; A ниже перезаписывает `ld a,h`, флаги пересчитывает `cp 0x1E`.
		ld	(vec_vdp_ptr), hl
		pop	hl
		push	de
		ld	a, h
		ld	de, vec_spr_buf-0x1800
		cp	0x1E
		jp	c, vec_de_sprb_w
		ld	de, vec_spr_buf-0x1D00
vec_de_sprb_w:
		add	hl, de
		pop	de
		jp	vec_de_cpy
;  [СНЯТО] vec_de_satb (28 Б) + отбор диапазона 0x3B00-0x3BFF в диспетчере (10 Б) —
;  приёмник MSX SAT (таблицы атрибутов спрайтов), остаток soft-VDP. Единственное, что он
;  делал сверх продвижения указателей, — взводил флаги vec_sat_dirty/vec_sat_dl, а их
;  НИКТО НЕ ЧИТАЕТ (проверено grep по src/: только записи здесь и на буте). Всё остальное —
;  vec_vdp_ptr += BC, DE += BC, BC = 0 — ровно то же делает общий vec_de_slow0, у которого
;  на этом диапазоне vec_cache_wr уходит в vcw_end (skip). Отличие только в A на выходе
;  (было D, стало 0) — вызывателей у SAT-диапазона нет, что доказано ловушкой `jp $`:
;  с ней все гейты зелёные, то есть игра сюда не входит ни в одном сценарии.
vec_de_slow0:
		pop	hl
vec_de_slow:
		push	hl
		ld	hl, (vec_vdp_ptr)
vds_nl:
		ld	a, (de)
		call	vec_cache_wr
		inc	hl
		inc	de
		dec	bc
		ld	a, b
		or	c
		jp	nz, vds_nl
		ld	(vec_vdp_ptr), hl
		pop	hl
		ret


;----------------------------------------------------
; Загружает шрифт и заполняет таблицу цвета
;----------------------------------------------------

loadFont:		; 8col: шрифт стримится из ROM (vec_font_rom), без декода p3

		ld	a, 0x0F0		; Белый цвет на чёрном
		ld	hl, 0x80		; Адрес таблицы цвета (тайл 16)
		ld	bc, 0x180	; Число байт для заполнения

fillVRAM3Bank:
		ld	d, 3

fillVRAM3Bank2:
		push	bc
		push	de
		call	setFillVRAM	; Заполняет таблицу цвета
		ld	de, 0x800	; Следующий банк
		add	hl, de
		pop	de
		pop	bc
		dec	d
	jp nz,fillVRAM3Bank2
		ret
;----------------------------------------------------
;
; Распаковывает данные таблицы паттернов или цветов
; в три банка экрана
;
;----------------------------------------------------

UnpackPatterns:
		ld	b, 1

setPatternDatax_:
		push	bc
		push	de
		call	unpackGFX
		ld	de, 0x800	; Следующий банк
		add	hl, de
		pop	de
		pop	bc
	dec b
	jp nz,setPatternDatax_
		ret


;  [СНЯТО, 27 Б] Блок, помеченный ещё в оригинале как «(!?) Неиспользуемый код!!»:
;  вариант setPatternDatax_ через DEtoVRAMset (метка loc_4504). Лежал сразу за `ret`
;  процедуры setPatternDatax_, входной метки у него не было — попасть внутрь можно было
;  только fall-through'ом, которого нет; на loc_4504 ссылался лишь его собственный цикл.

;----------------------------------------------------
; DE:
; +0 DW адрес VRAM для распаковки
;
;----------------------------------------------------

unpackGFXset:
		ex	de, hl
		ld	e, (hl)
		inc	hl
		ld	d, (hl)
		ex	de, hl		; HL = адрес VRAM
		inc	de
;---------------------------------------------------------------
; Интерпретирует графические данные
;
; DE = данные для интерпретации
; HL = адрес VRAM
;
; +0: число повторов данных
; +1: повторяемый байт
;
; Если bit7 числа повторов установлен:
; +0: количество байт для передачи в VRAM
; +1: передаваемые данные
;
; 0 = конец данных
;---------------------------------------------------------------


unpackGFX:
		call	setVDPWrite

unpackGFX2:
		ld	a, (de)
		and	0x7F
		ld	c, a
		ld	a, (de)
		inc	de
	jp nz,unpackGFX3
		cp	c
	jp nz,unpackGFXset	; Переход на новую позицию в VRAM
		ret

unpackGFX3:
		ld	b, 0
		cp	c
		push	af
		call	nz, DEtoVRAM	; Передаёт из DE в VRAM (BC байт)
		pop	af
		call	z, fillVRAM_DE
	jp unpackGFX2

;----------------------------------------------------
; Готовит VDP к записи
;----------------------------------------------------

setVDPWrite:
;  [2026-09-19] SETWR не трогает AF (ld (vec_vdp_ptr),hl / ret). C' := (byte_6)
;  как раньше; AF вызывателя на стеке, A' обновляем явно — без vec_exaf.
		call	SETWR
		push	af
		ld	a, (byte_6)
		ld	(z80_bc_alt), a	; C' := (byte_6)
		ld	(z80_af_alt+1), a	; A' := (byte_6)
		pop	af
		ret


;  [СНЯТО, 15 Б] Блок «(!?) Неиспользуемый код» — парная setVDPWrite подготовка VDP к
;  ЧТЕНИЮ. Лежал сразу за `ret` процедуры setVDPWrite, входной метки нет, ссылок нет.
;  Вместе с ним снят и SETRD в vec_isr.asm (4 Б) — это был его единственный вызыватель.

;  [СНЯТО] flipSprites (1 Б) — со STEP4a это была пустая заглушка `ret` (зеркало
;  генерируется на лету в vec_nsx), а вызывателей у неё не осталось НИ ОДНОГО:
;  единственный call снят вместе с хвостом загрузчика спрайтов, в src/ на имя ссылаются
;  только комментарии. Ловушкой её не проверить (тело — один байт, `jp $` затирал бы
;  соседнюю FlipPatrones), поэтому доказательство здесь чисто ссылочное.

;----------------------------------------------------
; Отзеркаливает паттерны
; HL = адрес VRAM исходных паттернов
; DE = адрес VRAM зеркальных паттернов
; C = число паттернов для отзеркаливания
;----------------------------------------------------

FlipPatrones:
		ld	b, 3		; Число банков тайлов

flipPatron2:
		push	bc
		push	hl
		push	de

flipPatron3:
		ld	b, 8

flipPatron4:
		call	InviertePatron
		inc	hl
		inc	de
	dec b
	jp nz,flipPatron4
		dec	c
	jp nz,flipPatron3
		pop	hl
		ld	de, 0x800	; Расстояние до следующего банка
		add	hl, de
		ex	de, hl
		pop	hl
		pop	bc
	dec b
	jp nz,flipPatron2
		ret

;----------------------------------------------------
; Отзеркаливает байт
; Вход: A = байт для отзеркаливания
; Выход: A = отзеркаленный байт
;----------------------------------------------------

;  [СНЯТО, 7 Б] invierteByte — обёртка «байт -> бит-реверс через vec_revtab».
;  Вызывателей не осталось ни одного (grep по src/: только упоминание в комментарии
;  vec_tables.asm). Сама таблица vec_revtab ЖИВА, её читают другие места напрямую.


;----------------------------------------------------
; Отзеркаливает паттерн в VRAM
; HL = адрес исходного паттерна
; DE = адрес зеркального паттерна
;----------------------------------------------------

InviertePatron:
		push	bc
		push	de
		push	hl
		ld	a, h
		and	7
		ld	h, a
		call	pat_base
		add	hl, de
		ld	a, (hl)
		call	vec_rev8
		pop	hl
		ld	b, a
		pop	de
		push	hl
		push	de
		ld	a, d
		and	7
		ld	h, a
		ld	l, e
		call	pat_base
		add	hl, de
		ld	a, b
		ld	(hl), a
		pop	de
		pop	hl
		pop	bc
		ret


;----------------------------------------------------
; Инициализирует железо
; Глушит PSG, очищает VRAM и ставит видеорежим
;----------------------------------------------------

;  [mummy-zx] initHardware (один вызов, из startCode) — в бут-оверлее src/v06c/vec_bootov.asm.

;----------------------------------------------------
;
; Видеорежим:
;
; Screen 2
; Спрайты 16x16 без увеличения
; Pattern name table = #3800-#3AFF
; Pattern color table = #0000-#17FF
; Pattern generator table = #2000-#37FF
; Sprite attribute table = #3B00-#3B7F
; Sprite generator table = #1800-#1FFF
; Цвет фона = #E4 (серый/синий)
;----------------------------------------------------

;  [mummy-zx] SetVideoMode/VDP_InitData сняты: 8 вызовов WRTVDP, а он на Векторе — одинокий ret
;  (таблицы SCREEN2 фиксированы). Вызовы: титул (InitTitle) и бут — убраны вместе с ним.


;----------------------------------------------------
;
; Обновляет состояние управления
;
;----------------------------------------------------

chkControls:
		ld	hl, controlPlayer ; bit 6 = героем управляет игрок
;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ: снят спилл A через il_a вокруг bit-теста — A мёртв
;  на обоих выходах: nz -> UpdateKeys начинает с `call ReadKeys` (тот пишет A: `ld e,0x8F/
;  ld a,0x0F`), z -> `ld a,(GameStatus)` пишет A сразу. Флаги для `jp nz` — от того же and.
;  -26 тактов на каждый игровой тик, -6 Б.
	ld a,(hl)
	and 1<<6
	jp nz,UpdateKeys	; Не в режиме демо

		ld	a, (GameStatus)
		cp	5
	jp nz,UpdateKeys	; Не в игровом режиме

ReplaySavedMov:
		call	ControlProtaDemo ; Читает записанные движения демо
	jp storeControls	; Обновляет значение управления

UpdateKeys:
		call	ReadKeys	; Читает состояние курсоров и джойстика

storeControls:
		ld	hl, KeyHold	; 1 = вверх, 2 = вниз, 4 = влево, 8 = вправо, #10 = кнопка A, #20 = кнопка B

StoreKeyValues:
		ld	c, (hl)		; Читает прежние значения
		ld	(hl), a		; Сохраняет новые в KeyHold
		xor	c		; Убирает клавиши, которые всё ещё нажаты
		and	(hl)		; Оставляет только что нажатые
		dec	hl
		ld	(hl), a		; Сохраняет в KeyTrigger
		ret



;---------------------------------------------------------------------------
; Читает состояние курсоров и джойстика
; 0: вверх
; 1: вниз
; 2: влево
; 3: вправо
; 4: кнопка A / Space
; 5: кнопка B / Select
;---------------------------------------------------------------------------

ReadKeys:
;  [snd-vi53] Здесь стоял `WRTPSG(15, 0x8F)` — выбор порта джойстика у MSX-AY. На Векторе в режиме ВИ53 эта
;  запись ничего не делала: оверлей клал байт в тень регистров AY (ячейка 15, её никто не читает) и уходил,
;  в чип не писалось (номер регистра >= 11). Джойстик читает RDPSG прямо из порта 0x0E. Вызов снят.
		ld	a, 0x0E
		di
		call	RDPSG		; Читает состояние джойстика
		ei
		cpl
		and	0x3F

		push	af
;  [logic-opt] SNSMAT отдаёт 0xFF для любого ряда, кроме 8 (vec_saveunder.asm), поэтому
;  ряд 7 даёт cpl/rrca/and = 0 => SELECT всегда 0; ряд 8 — это ячейка vec_kb8.
		ld	e, 0		; SELECT
		ld	a, (vec_kb8)	; ряд 8 клавиатуры
		cpl
		rrca
		rrca
		ld	b, a
		and	4
		or	e
		ld	c, a
		ld	a, b
		rrca
		rrca
		ld	b, a
		and	0x18
		or	c
		ld	c, a
		ld	a, b
		rrca
		and	3
		or	c
		pop	bc
		or	b
		ret


;----------------------------------------------------
; Интерпретирует записанную последовательность нажатий демо
;----------------------------------------------------

ControlProtaDemo:
		ld	hl, KeyHoldCntDemo
		dec	(hl)		; декрементирует время нажатия
		ld	b, (hl)

		ld	hl, (keyPressDemo) ; Указатель на записанные управления
		ld	a, (hl)		; Нажатые управления

		push	af
		ld	a, b
		or	a
	jp nz,controlDemo2	; Клавиша всё ещё нажата

		inc	hl
		ld	a, (hl)		; Время удержания новых нажатий
		cp	0x0FF		; Демо закончилась?
	jp nz,controlDemo1

		xor	a
		ld	(flagVivo), a	; Конец демо
	jp controlDemo2

controlDemo1:
		ld	(KeyHoldCntDemo), a ; Обновляет время нажатия
		inc	hl
		ld	(keyPressDemo),	hl ; Указатель на записанные управления

controlDemo2:
		pop	af
		ret
;----------------------------------------------------------------------------
;
; Функция, проверяющая нажатие клавиши, пока игра не идёт
; Если нажата — переход в меню
; Если уже были в меню — начинается партия.
;
;----------------------------------------------------------------------------

chkPushAnyKey:
		call	ReadKeys	; (!?) Осторожно
		ld	hl, KeyHold2
		call	StoreKeyValues
		or	a
		ret	z		; Ни одна клавиша не нажата

		ld	c, a		; [СНЯТО] здесь стоял вызов меню сложности
		push	bc
		ld	a, 0x20		; Тишина
		call	setMusic
		pop	bc

		ld	b, c
		xor	a
		ld	(waitCounter), a
		ld	a, 1		; Статус меню
		ld	hl, GameStatus
		cp	(hl)
	jp z,StartGame_0	; Если в меню — начинает партию

		ld	(hl), a		; Ставит статус меню
		call	vec_cheats_reset
;  ЭКРАН СЕЙЧАС БУДЕТ ОЧИЩЕН -> ФОН В СЛОТАХ SAVE-UNDER ПРОТУХ (жалоба «первый джингл
;  быстрее второго», 2026-08-12). Гашение гейта vsu_any уехало в vec_su_menu (vec_repair.asm,
;  ЗА выравниванием — здесь свободных байт нет, см. комментарий там); вызов бесплатен, это
;  тот же `call` с другим операндом, а vec_su_menu хвостовым jp уходит в clearScreen.
		call	vec_vs_rest	; штатный HW-скролл (мог быть сдвиг лого Konami)
		call	vec_su_menu	; = clearScreen + сброс гейта save-under
		call	setColor
		jp	SetUpMenu

StartGame_0:
		ld	a, b
		and	0x30
		ret	z		; Не нажат выстрел 1 или 2
		call	vec_cheats_latch	; F1+F3 открывает читы, обычный старт закрывает
		ld	hl, controlPlayer ; бит 6 = героем управляет игрок
	push af	; Ручное управление
	ld a,(hl)
	or 1<<6
	ld (hl),a
	pop af
		ld	hl, 3		; Статус начала игры
		ld	(GameStatus), hl ; Статус мигания PUSH START
		ret


;----------------------------------------------------
; Графика шрифта
;----------------------------------------------------
	.include "../res/res_ui_gfx.asm"	; GFX_Menu/PiramidLogo + DemoKeyData (RLE, исходный адрес ROM)
tickGame:
		ld	hl, flagStageClear
		ld	a, (hl)
		or	a		; Собрал все гемы?
	jp z,tickGame2	; Нет

		ld	a, (musicCh1)
		ld	b, a
		ld	a, (musicCh2)
		or	b		; Что-то звучит?
	jp nz,tickGame2	; Да

		ld	(hl), a
		ld	a, 0x8B		; игровая музыка
		call	setMusic	; Снова запускает игровую музыку после фанфар завершённого этапа

tickGame2:
		call	vec_nat_sprites	; Обновляет спрайты RAM->VRAM
tickGame3:				; [demo-sync] вход второго тика демо (без отрисовки)
		call	chkScroll	; Проверяет, выходит ли герой за экран, и отмечает необходимость скролла
;  ЗАДАЧА #35: здесь стоял `call drawBrilloGemas` — холостая перезапись MSX-таблицы цвета
;  КАЖДЫЙ игровой тик (≈4400 тактов, ≈7.4% кадра). Снят, см. комментарий на месте процедуры.
		ld	a, (flagEntraSale) ; 1 = вход в пирамиду или выход из неё. Выполняется особая логика для этого случая
		and	a		; Входит или выходит из пирамиды?
		jp	nz, escalerasEntrada ; Выполняет особую логику для этого случая

;  (здесь был `call chkPause` — MSX-пауза по F1, снята как мёртвая, см. её место ниже)
		call	AI_Momias	; Двигает мумий
		call	AI_Gemas	; Если гем взят — стирает его с экрана и из карты
		call	AI_Prota	; Логика героя
		call	AI_Cuchillos	; Логика ножей
;  [2026-08-04] itmGate ПОДНЯТ НА ОДНУ ПОЗИЦИЮ (был после chkCogeKnife): теперь его
;  результат itmGSkip виден и гейту ножа. Перестановка ТОЧНАЯ: chkCogeKnife не пишет
;  ProtaY/ProtaXdecimal/ProtaX/ProtaRoom (единственные писатели — AI_Prota,
;  scrollPantalla2 и вход/выход, см. доказательство у chkCogeGema; подбор ножа пишет
;  knifeEnProceso/IDcuchilloCoge/objetoCogido/карту — гейт их не читает), а itmGate
;  пишет только itmGSh/itmGShOk/itmGSkip — их не читает ничто в chkCogeKnife, кроме
;  нового гейта. Операции независимы => порядок наблюдаемо эквивалентен.
		call	itmGate		; Сдвинулся ли герой? (гейт подбора: гемы/кирки/ножи)
		call	chkCogeKnife	; Проверяет, поднимает ли герой нож с пола
		call	chkCogeGema	; Проверяет, берёт ли герой гем
		call	AI_Salidas	; Логика дверей пирамиды
		call	MurosTrampa	; Логика стен-ловушек, закрывающихся при проходе героя
		call	chkCogePico	; Проверяет, берёт ли герой кирку
		call	chkTocaMomia	; Проверяет, касается ли герой мумии
		call	spiningDoors	; Логика вращающихся дверей


; Проверяет самоубийство по нажатию F2

;  [logic-opt] Самоубийство по F2 снято как мёртвое: SNSMAT(6) на Векторе всегда 0xFF (отдаёт
;  vec_kb8 только ряд 8), cpl/and 0x40 дают 0 и прежний код всегда уходил в ret. Побочных
;  записей на этом пути не было. ~100 т на тик.
doNothing2:
		ret

;-----------------------------------------------------------------------------------------------------------
;
; Обновляет атрибуты спрайтов RAM -> VRAM
; Героя и кусок двери всегда рисует в одних и тех же планах
; Врагам меняет план, чтобы они не исчезали при совпадении более 5 спрайтов на одной Y
;
;-----------------------------------------------------------------------------------------------------------

chkScroll:
		ld	a, (sentidoProta) ; 1 = влево, 2 = вправо
		rra
		ld	a, (ProtaX)
	jp nc,chkScroll2
		cp	2		; Предел правой части
		ret	nc
	jp c,chkScroll3

chkScroll2:
		cp	0x0F4		; Предел левой части
		ret	c

chkScroll3:
		ld	a, 0x20
		ld	(waitCounter), a ; Число сдвигов или тайлов для перемещения
		ld	a, 1
		ld	(flagScrolling), a ; Выполняется скролл
;  СКРОЛЛ СДВИГОМ (2026-07-30): здесь стоял HideSprites — он гасит спрайты ГРУБО, заливая
;  нулями 0xC000-0xF4FF (уточнено 2026-08-03: p2 целиком + 21 страница слотов, выше 0xF500
;  не идёт), то есть ВСЮ плоскость p2 (в ней живёт цвет фона!), и при этом НЕ
;  трогает p1, где тоже есть пиксели спрайтов. Полной перерисовке комнаты это было
;  безразлично (все 704 тайла всё равно переписывались), а сдвигу — нет: он переносит
;  картинку как есть, и остатки спрайтов в p1 поехали бы вместе с комнатой (призраки),
;  а обнулённая p2 испортила бы цвета. vec_spr_flush снимает спрайты ЧИСТО — restore-under
;  всех слотов (штатный кадровый механизм стирания) + инвалидация слотов + prev=скрыт.
		call	vec_spr_flush	; Стирает спрайты из VRAM (restore-under, фон цел)
		call	hideSprAttrib	; Стирает спрайты из RAM
		ld	a, 9		; режим скролла
		ld	(GameStatus), a
		pop	hl
		ret


;  [УДАЛЕНО ЗАДАЧЕЙ #35, 2026-07-31] drawBrilloGemas + chgColorBrillo (26 Б кода) и таблицы
;  coloresBrillo / ColoresPalanca (8 Б) — «меняет цвет блесков гемов и рычага двери».
;  Процедура звалась КАЖДЫЙ игровой тик (tickGame2 и StartGame) и заливала MSX color table:
;  24 Б по VDP 0x288 (три блеска) + 3 Б по VDP 0x2E5 (нижняя часть рычага), каждый раз через
;  fillVRAM3Bank -> setFillVRAM -> vec_fill_col -> vec_col_store, то есть в `ret`.
;  САМАЯ ДОРОГАЯ холостая работа во всём образе: замер coltab_dead_audit.js на 1270 вызовах —
;  5 598 160 тактов (≈4400 тактов на игровой тик, ≈7.4% кадра) и НОЛЬ записей в тень
;  паттернов / vec_spr_buf / vec_tilemode / vec_mixbuf / плоскости экрана.
;  Мерцание блёсток на Векторе делает ПАЛИТРА, а не таблица цвета: vec_brillo_cols
;  (vec_blit.asm, «_8C_AURA», фаза (timer>>1)&3 — точь-в-точь как здесь), а рычаг двери
;  красится плоскостями в vbt8_chk_lever. То есть цветовой эффект на месте, снята только
;  MSX-половина, которая никуда не доезжала (в комментарии у vec_is_gem_col это и записано
;  как «рендер это ИГНОРИРУЕТ»).


;----------------------------------------------------
;
; MSX-ПАУЗА (F1) СНЯТА ЦЕЛИКОМ — 94 Б тела chkPause + 6 Б двух вызовов.
;
; ПОЧЕМУ ЭТО МЁРТВЫЙ КОД, А НЕ «на всякий случай». Процедура читала ряд 6 матрицы MSX
; через SNSMAT. Векторный SNSMAT (vec_saveunder.asm) для ЛЮБОГО ряда кроме 8 отдаёт
; 0x0FF без побочных эффектов, дальше `cpl` даёт 0, StoreKeyValues кладёт 0 в
; keyHoldMap/keyTriggerMap (их больше никто не читает) и возвращает A=0. Значит
; `and 1<<5` всегда даёт Z, переход на chkPause2 не берётся НИКОГДА, флаг mapPaused
; (0x70F8) ставится ТОЛЬКО в chkPause2 и потому вечно 0 — а значит `ret z` после
; `and a` тоже всегда срабатывает. То есть вся процедура от `ld a,6` и ниже —
; вычислительный ноль, а blinkPausing/erasePausing/printPause/txtPAUSING
; недостижимы в принципе (текстовых ссылок извне нет, проверено grep по src/).
;
; ПАУЗА НА ВЕКТОРЕ ЖИВА и сделана заново: клавиша P, обработчик в vec_isr.asm
; (vec_paused, глушение звука на входе). К этому коду она отношения не имеет.
;
; eraseData ОСТАВЛЕН (живые потребители). DEtoVRAMset снят — мёртвый.
;----------------------------------------------------

;----------------------------------------------------
;
; Логика героя
;
;----------------------------------------------------

AI_Prota:
		ld	hl, setAttribProta ; Обновляет атрибуты спрайтов героя
		push	hl		; Кладёт в стек функцию, обновляющую атрибуты героя
		ld	a, (protaStatus) ; Получает текущее состояние героя
		and	a
	jp z,AI_Prota2	; Состояние 0 = идёт

		cp	3
	jp nz,AI_Prota3	; Состояние 2 = падает. Управление не проверяется

AI_Prota2:
		ld	hl, protaControl ; 1 = вверх, 2 = вниз, 4 = влево, 8 = вправо, #10 = кнопка A, #20 = кнопка B
		ld	a, (KeyHold)	; 1 = вверх, 2 = вниз, 4 = влево, 8 = вправо, #10 = кнопка A, #20 = кнопка B
		ld	(hl), a		; Копирует нажатые клавиши/управление в управление героя
		and	a
	jp z,AI_Prota3	; Ни одна клавиша не нажата

		rra
		rra
		and	3
	jp z,AI_Prota3	; Не нажаты ни ВПРАВО, ни ВЛЕВО

		inc	hl
		ld	(hl), a		; Направление героя

AI_Prota3:
		ld	a, (protaStatus) ; Состояние героя
		call	jumpIndex
		dw protaAnda		; 0 = идти
		dw protaSalta		; 1 = выполняет прыжок и проверяет столкновения
		dw protaCayendo		; 2 = падает
		dw protaEscaleras	; 3 = двигает героя по лестницам и проверяет, дошёл ли до их конца
		dw protaLanza2	; 4 = анимирует героя для анимации броска. По окончании восстанавливает спрайт и переходит в состояние ходьбы
		dw protaPica2		; 5 = анимация героя, копающего и ломающего кирпичи
		dw protaGiratoria	; 6 = проходит через вращающуюся дверь

;----------------------------------------------------
; Состояние героя 0: идти
;----------------------------------------------------

protaAnda:
		ld	a, (KeyTrigger)
;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ (каждый тик ходьбы героя): спилл A снят — A мёртв
;  (protaAnda2 -> chkProtaCae -> chkPisaSuelo -> chkTocaMuro -> getMapOffset пишет A
;  первым же `ld a,(hl)`, ничего не читая; nz-путь начинает с `ld a,(objetoCogido)`).
;  Флаги для jp z — от того же and. -26 т/тик, -6 Б.
	and 1<<4
	jp z,protaAnda2	; Нет

		ld	a, (objetoCogido) ; #10 = нож, #20 = кирка
		and	0x0F0		; Есть ли у героя какой-нибудь предмет?
		jp	z, setProtaSalta ; Нет — пытается прыгнуть

		cp	0x10		; Это нож?
		jp	nz, chkProtaPica ; Нет, кирка. Пытается выкопать яму

		jp	setLanzaKnife	; Бросает нож

protaAnda2:
		call	chkProtaCae	; Есть ли пол под героем?
		jp	c, setProtaCae	; Пола нет

		xor	a
		ld	(modoSentEsc), a ; Если 0 — сохраняет в "sentidoEscalera" тип лестницы, за которую берётся герой. 0 = \, 1 = /
		call	chkCogeEscalera	; Проверяет, берётся ли за лестницу, чтобы подняться или спуститься
		ret	z		; Да, взялся

		ld	hl, protaControl ; 1 = вверх, 2 = вниз, 4 = влево, 8 = вправо, #10 = кнопка A, #20 = кнопка B
		ld	a, (hl)
		and	0xc		; Оставляет только управление ВПРАВО и ВЛЕВО
		jp	z, protaQuieto	; Не двигается в стороны

		ld	hl, protaMovCnt	; Счётчик, используемый при каждом движении героя. (!?) Его значение не используется
		inc	(hl)
		inc	(hl)		; 25 Гц: +2, кадр как на 50 Гц

		call	chkChocaAndar
	jp nc,protaAnda3	; Не сталкивается

		ld	a, (hl)		; HL указывает на тайл карты, с которым столкнулся
		and	0x0F0		; Оставляет тип тайла/семейство
		cp	0x50		; Это вращающаяся дверь?
	jp nz,protaAnda5	; Нет

		ld	a, (hl)
		and	0x0F		; Тип тайла вращающейся двери
		sub	1
		cp	2		; Столкнулся с синей частью двери?
	jp c,protaAnda5	; Нет

		ld	hl, timerEmpuja	; Таймер для отсчёта времени толкания вращающейся двери
		inc	(hl)		; Инкрементирует время толкания
		ld	a, 8		; 16 тиков@50 Гц = 8@25 Гц
		cp	(hl)
		jp	nz, protaAnda5	; Ещё не натолкал достаточно

		ld	a, 6		; Состояние: проходит через вращающуюся дверь
		ld	(protaStatus), a ; Обновляет состояние героя
		ld	a, 0x20
		ld	(accionWaitCnt), a ; Счётчик управления анимацией и длительностью действия (бросок ножа, копание, проход вращающейся двери)

		ld	a, 3		; Вращающаяся дверь
		call	setMusic
		jp	chkGiratorias	; Определяет, какую дверь толкает

protaAnda3:
		xor	a
		ld	(timerEmpuja), a ; Сбрасывает счётчик толкания

protaAnda4:
		call	isPl
		jp	z, protaAnda4s	; демо (bit6=0): шаг как на 50 Гц
		ld	a, (GameStatus)
		cp	0x0A		; концовка: шаг как на 50 Гц, иначе уходит за край
		jp	nz, protaAnda4g
protaAnda4s:
		call	mueveProta
		jp	protaAnda5
protaAnda4g:
		call	protaWalk2	; два раза 0xA8 с проверкой стены между ними

protaAnda5:
		jp	calcFrame	; Обновляет кадр анимации

;----------------------------------------------------
; Обновляет атрибуты двух спрайтов героя в RAM
; согласно его координатам
;----------------------------------------------------

setAttribProta:
		ld	hl, ProtaY	; Обновляет атрибуты спрайтов героя
		ld	c, (hl)		; Y героя
		inc	hl
		inc	hl		; X героя
		ld	b, (hl)		; BC = XY
		ld	a, (protaFrame)
		ld	hl, protaAttrib
		dec	c
		dec	c
;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ (каждый тик): A (кадр) здесь ЖИВ (нужен ADD_A_DE
;  ниже), но стойло из ячейки il_a (13+13 т) заменено мёртвым регистром E: DE пишется
;  `ld de,framesProta` до любого чтения на обоих путях. -16 т/тик, -4 Б.
	ld e,a	; Кадр чётный или нечётный?
	and 1<<0
	ld a,e
	jp z,setAttribProta2
		inc	c		; Чётные кадры сдвигает на пиксель вверх

setAttribProta2:
		ld	de, framesProta	; Спрайт по номеру кадра
		call	ADD_A_DE
		ld	a, (de)		; Номер спрайта
		ld	d, a
		call	setAttribProta3

setAttribProta3:			; Y
		ld	(hl), c
		inc	hl
		ld	(hl), b		; X
		inc	hl
		ld	a, (sentidoProta) ; 1 = влево, 2 = вправо
		rra			; В какую сторону смотрит?
		ld	a, d
	jp nc,setAttribProta4	; Вправо
		add	a, 0x60		; Смещение до спрайтов, отражённых влево

setAttribProta4:
		ld	(hl), a		; Спрайт
		ld	a, d
		add	a, 4		; Следующий спрайт 16x16
		ld	d, a
		inc	hl		; Цвет
		inc	hl		; Атрибуты следующего спрайта
		ret


;----------------------------------------------------
; Ставит кадр элемента по его счётчику движений
; Каждые 4 движения номер кадра увеличивается на 1
; Диапазон значений от 0 до 7
;----------------------------------------------------

calcFrame:
		ld	hl, protaMovCnt	; Счётчик, используемый при каждом движении героя. (!?) Его значение не используется

calcFrame2:
		ld	a, (hl)
		rra
		rra
		and	7
		inc	hl
		ld	(hl), a
		ret

protaQuieto:
		xor	a
		ld	(accionWaitCnt), a ; Счётчик управления анимацией и длительностью действия (бросок ножа, копание, проход вращающейся двери)
		inc	a		; Ноги вместе
;  [СНЯТО, 2 Б] `ld a,2` — сирота за безусловным jp, помечена «(!?) никогда не
;  выполняется» ещё в оригинале; метки на неё нет.
;  [СНЯТО, 3 Б] и сам `jp setProtaFrame`: без сироты между ними прыжок вёл РОВНО на
;  следующую инструкцию — теперь просто проваливаемся (peephole).
setProtaFrame:
		ld	(protaFrame), a
		ret


;----------------------------------------------------
; Номер спрайта для каждого кадра героя
;----------------------------------------------------
framesProta:	db    8
		db    0			; 1 = ноги вместе
		db  0x10			; 2 = прыгает
		db    8			; 3 = идёт
		db    0			; 4 = ноги вместе
		db  0x10			; 5 = ноги врозь
		db    0			; 6 = ноги вместе
		db  0x10			; 7 = ноги врозь
		db  0x18			; 8 = кадр 1 действия (копает, бросает)
		db  0x20			; 9 = кадр 2 действия


;----------------------------------------------------
; Нажата кнопка прыжка
; Герой пытается прыгнуть
;----------------------------------------------------

setProtaSalta:
		ld	hl, ProtaY
		ld	a, (hl)
		and	a
		ret	z		; Не прыгает. Герой в верхней части экрана, прижат к самому верху

		call	chkSaltar	; Проверяет, может ли прыгнуть, или есть препятствие, мешающее этому
		ret	nc		; Сталкивается с чем-то. Прыгнуть нельзя

		ex	de, hl
		ld	a, (hl)		; Указатель на карту
		and	0x0F0
		cp	0x10		; Это платформа или стена?
		ret	z		; Да

setProtaSalta_:
		ld	a, (KeyHold)	; 1 = вверх, 2 = вниз, 4 = влево, 8 = вправо, #10 = кнопка A, #20 = кнопка B
		ld	(sentidoEscalera), a ; Сохраняет состояние клавиш при прыжке
		ld	hl, protaStatus	; Указатель на данные героя
		jp	Salta

;----------------------------------------------------
; Состояние героя 1: прыжок
; Обновляет его координаты и проверяет столкновения в прыжке
; При столкновении переходит в состояние падения
;----------------------------------------------------

protaSalta:
		ld	hl, sentidoProta ; 1 = влево, 2 = вправо
		call	doSalto		; Обновляет позицию героя при прыжке
		ld	hl, protaStatus	; Указатель на данные героя
		ld	(z80_ix), hl	; IX = HL. [2026-07-29] было 11 Б клея транслятора (push hl /
				; ld (il_tmp),hl / pop hl / ld (z80_ix),hl / ld hl,(il_tmp)) —
				; сохранение HL там избыточно: он и так не менялся.
		call	chkChocaSalto	; Проверяет столкновение с чем-либо в прыжке
		ret	nz		; Ни с чем не столкнулся

protaSaltaFin:
		ld	a, 3
		ld	(protaStatus), a ; (!?) Зачем это ставит! Сразу же меняется на статус падения
	jp protaCayendo

;----------------------------------------------------
; Герой достиг пола
; Ставит состояние ходьбы/нормальное и проигрывает эффект приземления
;----------------------------------------------------

protaAterriza:
		ld	a, 2		; SFX удара о пол
		call	setMusic
		xor	a
		ld	(protaStatus), a ; Ставит состояние ходьбы
		ret


;----------------------------------------------------
; Переводит героя в состояние падения
;----------------------------------------------------

setProtaCae:
;  [snd-vi53] Здесь взводился flagSetCaeSnd=0 («инициализировать данные звука падения») — флаг читал только
;  updateSfxCaer прежнего драйвера. Падение теперь поток FALL с началом в ON, инициализация — сам запуск звука.
		ld	a, 1
		call	setMusic	; SFX падения

;----------------------------------------------------
; Состояние героя 2: падение
; Обновляет координаты героя из-за падения
; Ставит состояние падения
; Проверяет, достиг ли пола
;----------------------------------------------------

protaCayendo:
		ld	hl, protaStatus	; Указатель на состояние героя
		call	cayendo		; Ставит состояние падения и проверяет, достиг ли пола
		jp	nc, protaAterriza ; Достиг пола
		ret


;----------------------------------------------------
; Состояние героя 3: лестницы
; Двигает героя по лестницам и проверяет, дошёл ли до конца
; Дойдя до конца, переходит в состояние ходьбы
;----------------------------------------------------

protaEscaleras:
		ld	hl, protaControl ; 1 = вверх, 2 = вниз, 4 = влево, 8 = вправо, #10 = кнопка A, #20 = кнопка B
		ld	a, (hl)
		and	0x0C
		ret	z		; Не нажаты ни ВПРАВО, ни ВЛЕВО

		ld	b, 0		; игра 25 Гц: каждый тик = mask 1 на 50 Гц
		call	isPl
		jp	nz, protaEsc_b	; игрок
		inc	b		; демо: mask 1, как запись 50 Гц
protaEsc_b:
		xor	a
		ld	(quienEscalera), a ; (!?) Используется ли это? Кто на лестнице: 0 = герой, 1 = мумия
		call	andaEscalera	; Двигает героя по лестнице и проверяет, дошёл ли до конца
	jp z,protaEscaleras2	;  Дошёл до конца лестниц
		jp	calcFrame	; Обновляет кадр анимации

protaEscaleras2:
		xor	a		; Состояние: идти
;  [СНЯТО, 2 Б] `ld a,3` — сирота за безусловным jp, «(!?) никогда не выполняется».
;  [СНЯТО, 3 Б] и сам `jp protaEscaleras3`: прыжок на следующую инструкцию (peephole).
protaEscaleras3:
		ld	(protaStatus), a ; Это используется только чтобы поставить героя в состояние ходьбы по окончании лестницы
		ret

;----------------------------------------------------
; Герой бросает нож
;----------------------------------------------------

setLanzaKnife:
		xor	a
		ld	hl,ElemEnProceso
		ld	(hl),a
chkPuertaMov:		
		push	hl
		ld	a,04
		call	getExitDat	; Получает указатель на статус обрабатываемой двери
		and	0xF0		; Оставляет статус (старший ниббл)
		cp	0x30		; Открывается?
		pop	hl
		ret	z		; Запрещает бросать нож, пока дверь открывается, чтобы тайлы не портились при пролёте ножа над дверью
		inc	(hl)
		ld	a,04		; Максимальное число ножей
		cp	(hl)
	jp nz,chkPuertaMov	; Ещё остались ножи для проверки

		xor	a
		ld	(lanzamFallido), a ; 1 = нож брошен в стену и сразу отскакивает

		ld	hl, sentidoProta ; 1 = влево, 2 = вправо
		ld	a, (hl)
		inc	hl		; Указывает на Y
		rra
		ld	bc, 0x0FF00	; X-1
	jp c,setLanzaKnife2	;  Бросает его влево
		ld	b, 0x12		; X+18

setLanzaKnife2:
		push	bc
		call	chkTocaMuro	; Пытается бросить, стоя вплотную к стене?
		pop	bc
	jp z,setLanzaKnife4	; Да, так нельзя, если только нет пустоты на тайл выше

		push	bc
		ld	a,(de)		; Тайл карты, с которым столкнулся
		call	chkKnifeChoca	; Проверяет, что это за тип тайла
		pop	bc
	jp z,setLanzaKnife4	; Это стена, нож, гем или кирка


setLanzaKnife3:
		ld	a, 0x15
		ld	(accionWaitCnt), a ; Счётчик управления анимацией и длительностью действия (бросок ножа, копание, проход вращающейся двери)
		ld	a, 4
		ld	(protaStatus), a ; Меняет состояние героя на «бросает нож»
		jp	setFrameLanzar	; Ставит кадр броска ножа

; Проверяет, есть ли при броске ножа в стену
; пустота над ней, чтобы нож упал
; Например: герой в яме, но по сторонам над его головой есть свободное место

setLanzaKnife4:

		cp	0x10		; Это стена?
		ret	nz		; Нет

		dec	c		; Тайл на ряд выше героя
		ld	hl, ProtaX
		ld	a, (hl)		; X героя
		and	7
		cp	4		; В середине тайла?
		ret	nz		; Нет

		dec	hl
		dec	hl		; Указывает на Y
		call	chkTocaMuro	; Z = сталкивается
		ld	a, c		; Проверенный тайл
		or	a		; Ноль?
		ret	nz		; Не свободно

		ld	hl, lanzamFallido ; 1 = нож брошен в стену и сразу отскакивает
		inc	(hl)
	jp setLanzaKnife3

;----------------------------------------------------
; Состояние героя 4: герой бросает нож
; Сюда герой приходит с установленным кадром 1 броска
; Через несколько итераций переходит к кадру 2 анимации
; По окончании анимации/ожидания восстанавливается обычный спрайт (без предмета в руках) и состояние ходьбы
;----------------------------------------------------

protaLanzaKnife:
		ld	hl, accionWaitCnt ; Счётчик управления анимацией и длительностью действия (бросок ножа, копание, проход вращающейся двери)
;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ: спилл A снят — A мёртв (chkLanzaEnd: dec (hl)/
;  ret nz/xor a; продолжение: dec (hl)/ld a,(hl)). Флаги — от того же and.
	ld a,(hl)	; Меньше #10?
	and 1<<4
	jp z,chkLanzaEnd

		dec	(hl)
		ld	a, (hl)
		and	0x0F		; Когда lanzaWaitCnt достигает #10, ставит второй кадр анимации броска
		ret	nz

		ld	hl, IDcuchilloCoge ; Нож, который берёт герой
		ld	a, (hl)
		inc	hl
		ld	(hl), a		; Нож в обработке

		xor	a
		call	getKnifeData
		ld	(hl), 4		; Состояние: бросок

		ld	a, (sentidoProta) ; 1 = влево, 2 = вправо
		and	3
		inc	hl
		ld	(hl), a		; Задаёт ножу то же направление, что у героя

		ld	a, (lanzamFallido) ; 1 = нож брошен в стену и сразу отскакивает
		or	a		; Сразу отскакивает от стены?
	jp z,setFrameLanzar2	; Ставит кадр 2 броска: рука вниз


; Нож сразу отскакивает, чтобы упасть на стену впереди

		dec	hl
		ld	(hl), 7		; состояние: отскакивает
		inc	hl		; направление
		inc	hl		; Y

		ld	de, ProtaY
		ld	a, (de)		; Y героя
		sub	8
		ld	(hl), a		; Y ножа на 8 пикселей выше героя

		inc	hl		; X дробная часть
		inc	hl		; X ножа
		inc	de		; X дробная часть
		inc	de		; X героя

		ld	a, (de)		; X героя
		add	a, 4
		ld	(hl), a		; X ножа равен X героя + 4
		inc	hl
		inc	de
		ld	a, (de)		; Комната героя
		ld	(hl), a		; Комната ножа

		ld	a, 4
		call	ADD_A_HL
		ld	(hl), 0

setFrameLanzar2:
		ld	a, 9		; Кадр 2 броска ножа (действие, кадр 2)
		jp	setFrameProta

setFrameLanzar:
		ld	a, 8		; Кадр броска ножа (действие, кадр 1)

setFrameProta:
		ld	(protaFrame), a
		ret

;----------------------------------------------------
; Проверяет окончание броска, чтобы восстановить спрайт и состояние ходьбы
;----------------------------------------------------

chkLanzaEnd:
		ld	hl, accionWaitCnt ; Счётчик управления анимацией и длительностью действия (бросок ножа, копание, проход вращающейся двери)
		dec	(hl)
		ret	nz

		xor	a
		ld	(protaStatus), a ; Ставит состояние ходьбы
	jp quitaObjeto	; Загружает обычные спрайты (без предмета)



;----------------------------------------------------
; Состояние 5: герой копает
; Анимация героя, копающего и ломающего кирпичи
;----------------------------------------------------

protaPicando:
		ld	hl, accionWaitCnt ; Счётчик управления анимацией и длительностью действия (бросок ножа, копание, проход вращающейся двери)
		dec	(hl)
		ld	a, (hl)
		and	0x0F
	jp z,protaPicando3

		ld	a, (hl)
;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ: спилл A снят — восстановленный A тут же
;  перетирался `ld a,9` (MVI флаги не трогает, jp z читает флаги того же and).
	and 1<<4
		ld	a, 9		; Кадр 2 действия копания
	jp z,protaPicando2
		dec	a		; Кадр 1 действия копания

protaPicando2:
		jp	setProtaFrame

protaPicando3:
		ld	a, (hl)		; Счётчик действия копания
;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ: спилл A снят — A мёртв (protaPicando4 начинает с
;  `ld a,(hl)`, ветка с ямой пишет A в drawAgujero первым же `ld a,(hl)`; ld b не трогает
;  ни A, ни флаги, jp nz читает флаги того же and).
	and 1<<4
		ld	b, 4		; Кадры с киркой внизу
	jp nz,protaPicando4

		ld	b, 8		; Кадры с киркой вверху
		push	bc
		push	hl
		ld	hl, agujeroCnt	; В начале копания равен #15
		dec	(hl)
		dec	(hl)
		dec	(hl)
		call	drawAgujero	; Рисует анимацию разрушения кирпичей при копании и стирает их из карты
		pop	hl
		pop	bc

protaPicando4:
		ld	a, (hl)		; AccionWaitCnt
		and	0x0F0
		or	b		; Число кадров удержания текущей позиции
		xor	0x10
		ld	(hl), a

		ld	a, (agujeroCnt)	; В начале копания равен #15
		and	a
		ret	nz		; Яма ещё не докопана

		call	chkIncrust	; Проверяет, что по окончании ямы герой не оказался замурован (?)

		ld	a, 1
		call	setProtaFrame	; Ставит кадр с ногами вместе

		xor	a
		ld	(protaStatus), a ; Восстанавливает состояние ходьбы

;----------------------------------------------------
; Убирает имеющийся предмет.
; Обновляет спрайты в зависимости от того, что в руках
;----------------------------------------------------

quitaObjeto:
		xor	a
		ld	(itmGShOk), a	; предмет ушёл из рук -> кирку снова можно поднять,
					; тень гейта подбора недействительна (см. itmGate)

cogeObjeto:
		ld	(objetoCogido),	a ; #10 = нож, #20 = кирка
		call	vec_spr_regen	; NAT: пара героя пересобирается новым shadow (экран не гасим)
		jp	loadAnimation	; Обновляет спрайты героя


;----------------------------------------------------
; Герой использует кирку
; Проверяет, может ли герой выкопать яму киркой
; Для этого он должен стоять на твёрдом полу (каменной платформе)
; и под платформой не должно быть вращающейся двери
; Также проверяет, что над местом ямы нет ножа или гема
;----------------------------------------------------

chkProtaPica:
		ld	hl, ProtaY
		call	chkPisaSuelo
		ret	nz		; Герой не на твёрдом полу

		dec	hl
		push	hl		; Указывает на направление
		call	chkChocaAndar3
		pop	hl
	jp nc,chkProtaPica2	; Не сталкивается

		ld	a, (hl)		; Направление
		xor	3		; Инвертирует направление
		ld	b, a		; Сохраняет в B, чтобы передать функции
		push	hl
		call	chkChocaAndar4
		pop	hl
		jp	c, picaLateral	; Если зажат в яме — копает одну из стен сбоку

chkProtaPica2:
		ld	e, (hl)		; Направление
		inc	hl
		ld	a, (hl)		; Y героя
		add	a, 0x10		; Прибавляет высоту героя
		ld	d, a		; Сохраняет в D координату Y пола под ногами
		inc	hl
		inc	hl
		ld	a, (hl)		; X героя
		ld	bc, 0x10		; Смещение X: влево = 0, вправо = 16
		and	7
		cp	5		; Вычисляет относительную позицию в тайле
	jp c,chkProtaPica3

		ld	b,0x08
	
chkProtaPica3:
		ld	a, e		; Направление
		rra
		ld	a, b		; Смещение при копании влево
	jp c,chkProtaPica4
		ld	a, c		; Смещение при копании вправо

chkProtaPica4:
		add	a, (hl)		; Прибавляет смещение к X героя
		ld	e, a
		and	0x0F8
		ret	z		; Слишком прижат к левому краю

		cp	0x0F8
		ret	z		; Слишком прижат к правому краю

		ld	hl, agujeroDat	; Y, X, комната
		push	hl
		ld	(hl), d		; Y ямы
		inc	hl
		inc	hl
		ld	(hl), e		; X ямы
		inc	de
		inc	hl
		ld	a, (ProtaRoom)	; Старшая часть координаты X. Указывает комнату пирамиды
		ld	(hl), a		; Комната ямы
		pop	hl
		call	getMapOffset00	; Получает в HL указатель на карту по координатам, на которые указывает HL
		and	0x0F0		; Оставляет тип тайла
		cp	0x10		; Это платформа, кирпич или стена?
		ret	nz		; Нет

		ld	a, (hl)
		and	0x0F		; Оставляет тип кирпича
		cp	4		; Это кирпич стены или платформы?

	jp c,chkProtaPica4b
		cp	9		; Это кирпич стены-ловушки?
		ret	nz
	
chkProtaPica4b:	
		ld	a, 0x60		; Смещение на ряд ниже
		call	ADD_A_HL
		ld	a, (hl)		; Тайл карты ниже предыдущего
		and	0x0F0		; Тип тайла
		cp	0x50		; Это вращающаяся дверь?
		ret	z		; Да, здесь яму делать нельзя (иначе угробим дверь!)


; Эта проверка не даёт выкопать яму под ножом, киркой или гемом

		ld	bc, -0x0C0	; Смещение на 2 ряда выше. Ровно на тайл выше пола
		add	hl, bc
		ld	a, (hl)		; Читает тайл карты
		and	0x0F0		; Пусто?
;  ЗАДАЧА#24 (Z80-режим MiSTer). Здесь был прыжок В СЕРЕДИНУ ИНСТРУКЦИИ —
;  `jp z,chkProtaPica5+1`, то есть на байт-операнд 0x20 от `cp 0x20`. Приём из
;  оригинала (Konami, Z80): байты 20 C0 читаются как `JR NZ,-64`, а прыгаем мы
;  по Z, значит переход НЕ берётся и исполнение продолжается с `ld hl,protaStatus`.
;  На i8080 то же место читается как недокументированный NOP (0x20) + `RET NZ`
;  (0xC0), тоже не взятый по Z, и мы приходим ТУДА ЖЕ. Итог совпадал на обоих
;  процессорах, но держался на недокументированном опкоде и на том, что 0x20
;  окажется ровно нужной длины. Прыгаем прямо в общую точку — поведение то же
;  (регистры и флаги не меняются ни NOP'ом, ни невзятым RET NZ), зато на
;  исполняемых путях не остаётся ни одного байта из «опасного на Z80» списка.
;  Гейт: tools/verify/z80_mode_safety.js
	jp z,chkProtaPica5b

chkProtaPica5:
		cp	0x20		; Это лестница?
		ret	nz		; Да, у подножия лестницы яму копать можно

chkProtaPica5b:
		ld	hl, protaStatus	; Указатель на состояние героя
		ld	(hl), 5		; Состояние: копает

		inc	hl
		inc	hl
		ld	a, (hl)		; Направление героя
		rra
		inc	hl
		inc	hl
		inc	hl
		ld	a, (hl)		; X
	jp nc,chkProtaPica7	; Смотрит вправо

		and	7		; Позиция относительно тайла
		cp	5		; В правых 4 пикселях тайла?
		ld	a, (hl)		; X
	jp c,chkProtaPica6	; Нет
		add	a, 4		; Переходит к следующему тайлу
		and	0x0F8		; Выравнивает по X тайла
		add	a, 2		; Прибавляет 2

chkProtaPica6:
		ld	(hl), a		; Обновляет X героя
	jp setPicarStatus

; Герой копает яму вправо

chkProtaPica7:
		and	7		; Позиция X относительно тайла
		sub	1
		cp	3		; В правой или левой части тайла?
		ld	a, (hl)
	jp c,chkProtaPica8
		and	0x0FC		; Выравнивает X героя по X тайла

chkProtaPica8:
		ld	(hl), a		; Обновляет X героя

setPicarStatus:
		ld	a, 0x15
		ld	(agujeroCnt), a	; В начале копания равен #15
		ld	a, 5
		ld	(protaStatus), a ; Ставит состояние копания
		ret


;----------------------------------------------------
; Когда герой зажат между двумя стенами, вместо
; копания пола копает стену
;----------------------------------------------------

picaLateral:
		ld	de, agujeroDat	; Y, X, комната
		inc	hl
		ld	a, (hl)		; Y героя
		ld	(de), a		; Y ямы
		inc	hl
		inc	de
		inc	de
		inc	hl
		ld	a, (sentidoProta) ; 1 = влево, 2 = вправо
		rra
		ld	a, (hl)		; X героя
	jp c,picaLateral2	; Будет копать влево
		add	a, 0x10		; Копает вправо, поэтому прибавляет к X ширину героя (16 пикселей)

picaLateral2:
		ld	(de), a		; X ямы
		and	0x0F8
		ret	z		; Копает левую стену, ограничивающую комнату

		cp	0x0F8
		ret	z		; Пытается копать правую стену, ограничивающую комнату

		inc	hl
		inc	de
		ld	a, (hl)		; Комната героя
		ld	(de), a		; Комната ямы
		call	setPicarStatus	; Ставит героя в состояние копания

		ld	a, 2
		ld	(accionWaitCnt), a ; Счётчик управления анимацией и длительностью действия (бросок ножа, копание, проход вращающейся двери)
		ld	hl, ProtaY
		call	getMapOffset00	; Получает в HL указатель на карту по координатам, на которые указывает HL

		ld	a, (sentidoProta) ; 1 = влево, 2 = вправо
		rra
	jp c,picaLateral3	; Влево

		inc	hl
		inc	hl		; Указывает на тайл справа от героя

picaLateral3:
		ld	a, (hl)		; Тайл карты
		and	0x0F0
		cp	0x10		; Это стена/платформа?
	jp z,picaLateral4	; Да


; Если на высоте головы героя нет стены, начинает копать на тайл ниже

		ld	hl, agujeroDat	; Y, X, комната
		ld	a, (hl)
		add	a, 8
		ld	(hl), a		; Сдвигает начало ямы на тайл ниже
		ld	a, 9		; Так как копать будет только один тайл, длительность вдвое меньше
		ld	(agujeroCnt), a	; В начале копания равен #15

picaLateral4:
		ld	a, 0x45		; SFX копания
		jp	setMusic


;----------------------------------------------------
; Состояние 6: герой проходит через вращающуюся дверь
;----------------------------------------------------

protaGiratoria:
	jp protaGirMid	; [door-wall] тело в холодном хвосте, vec_jumpmid.asm (здесь нет места: .align перед vec_rev4)

setProtaAndar:
		ld	(protaStatus), a ; Ставит герою состояние 0 (идти)
		ret

;----------------------------------------------------
; Проверяет, не замурован ли герой после выкапывания ямы киркой
; (На случай, если на него опустится стена-ловушка?)
;----------------------------------------------------

chkIncrust:
		ld	hl, ProtaY
		ld	bc, 0x40C	; Смещение X+4, Y+12
		call	chkIncrustUp
		ld	b, 4
	jp nc,chkIncrust2

		ld	bc, 0x0B0C	; Смещение X+11, Y+12
		call	chkIncrustUp
		ret	c
		ld	b, 0

chkIncrust2:
		ld	hl, ProtaX
		ld	a, (hl)		; X героя
		add	a, b		; Прибавляет смещение
		and	0x0FC		; Выравнивает координату X героя по кратному 4
		ld	(hl), a		; Обновляет X героя
		ret
;----------------------------------------------------
;
; Загружает графику и спрайты игры и
; создаёт отражённые копии некоторых из них
;
;----------------------------------------------------

loadGameGfx:
		ld	hl, statusEntrada
		ld	de, lanzamFallido ; 1 = нож брошен в стену и сразу отскакивает
;  ЗАДАЧА#37: было 0x500 (1280) — до 0x722F, тоже с заходом в зону стека. Чистим ровно
;  хвост игровых переменных: statusEntrada..varsEnd-1 (ЗАДАЧА#48: было stackArea-1;
;  число прежнее, 393 — от него зависит фаза timer к моменту входа в геймплей).
		ld	bc, varsEnd-statusEntrada-1
		xor	a
		ld	(itmGShOk), a	; новый набор предметов -> тень гейта подбора
					; недействительна (см. itmGate); сама тень лежит НИЖЕ
					; statusEntrada и этой очисткой не задевается
		ld	(hl), a
	call vec_ldir_fwd	; Стирает RAM

		ld	hl, 0x2200	; Назначение = паттерн #40 таблицы
		ld	de, GFX_InGame
		call	UnpackPatterns

;  ЗАДАЧА #35 (2026-07-31): снята распаковка COLOR_InGame в VDP 0x228 (таблица цвета игровых
;  паттернов). Поток данных COLOR_InGame НЕ имеет своего терминатора и «переливался» в
;  COLOR_Flipped — на деле распаковывалось 400 Б за вызов, 282060 тактов на 5 загрузок уровня.
;  Всё в MSX color table, которая на Векторе не оседает нигде (vec_col_store = `ret`, задача #27).
;  Цвет игровых тайлов даёт офлайн-профиль vec_ct_stage_a/_b (vec_ct_stage в setupStage).
		ld	hl, 0x2340	; Источник = паттерн #68 (дверь)
		ld	de, 0x23B8	; Приёмник = паттерн #77
		ld	c, 0x0F		; Число паттернов для отражения
		call	FlipPatrones	; Отражает некоторую графику — лестницы и двери

;  ЗАДАЧА #35: снята распаковка COLOR_Flipped в VDP 0x3B8 («раскраска отражённых паттернов»,
;  82908 тактов на 5 загрузок уровня) — та же холостая MSX color table.
		ld	b, 6		; Число гемов
		ld	hl, 0x2430	; Приёмник = паттерн #96 таблицы (гемы)

UnpackGema:
		ld	de, GFX_GEMA
		push	hl
		push	bc
		call	UnpackPatterns
		pop	bc
		pop	hl
		ld	de, 8
		add	hl, de
	dec b
	jp nz,UnpackGema

;  ЗАДАЧА #35: снята распаковка COLOR_GEMAS в VDP 0x430 (цвет шести гемов, 35640 тактов на
;  5 загрузок уровня) — холостая MSX color table. Цвет гемов на Векторе задаётся плоскостями
;  в vbt8 (kv_gem_planes, vec_blit.asm) и палитрой, а искры — vec_brillo_cols.
		ld	de, GFX_SPRITES2
		call	unpackGFXset

;  ЗАДАЧА #12: снята распаковка GFX_MOMIA (`ld de,GFX_MOMIA / call unpackGFXset`) — мумия
;  лежит в образе готовой таблицей vec_spr_momia, распаковывать нечего. Заодно снят мёртвый
;  хвост `ld hl,0x1940 / ld de,0x1C50 / ld c,3 / call flipSprites`: flipSprites — одинокий
;  `ret` с шага STEP4a (зеркала даёт vec_spr_mkmir), то есть 12 Б и 44 такта впустую.

; Загружает спрайты, соответствующие состоянию персонажа
; Ничего в руках, несёт нож или несёт кирку

;  ЗАДАЧА #12 / фаза 2: три набора героя — КАРТЫ в образе (vec_spr_prota/knife/pico) +
;  общий vec_spr_pool; vsp_pat собирает кадр в vec_spr_asml. Наборы взаимоисключающие —
;  loadAnimation лишь переставляет операнд vsp_hbase+1 и зовёт vec_spr_mkmir.
loadAnimation:
		ld	a, (objetoCogido) ; #10 = нож, #20 = кирка
		rra
		rra
		rra
		and	0x1E
		ld	hl, IndexSprites
		call	getIndexHL_A	; HL = таблица паттернов набора
		ld	(vsp_hbase+1), hl ; база героя для vsp_pat
		jp	vec_spr_mkmir	; пересобрать кэш зеркал под новый набор



IndexSprites:	dw vec_spr_prota
		dw vec_spr_knife
		dw vec_spr_pico

;  [СНЯТО, 3 Б] `ld hl,ProtaY` — сирота сразу за таблицей IndexSprites (данные, не код),
;  «(!?) никогда не выполняется»; метки нет, попасть сюда нечем.

;----------------------------------------------------
; Проверяет столкновение с полом
; Out:
;   Z = столкнулся
;   C = не столкнулся
;----------------------------------------------------

chkChocaSuelo:
		push	hl
		dec	hl
		ld	a, (hl)		; Направление
		inc	hl
		ld	bc, 0x50F	; Нижняя левая часть
		rra
	jp c,chkChocaSuelo2	; Идёт влево
		ld	b, 0x0B		; Нижняя правая часть

chkChocaSuelo2:
		call	getMapOffset	; Получает в HL адрес карты, соответствующий координатам
		pop	hl
		and	0x0F0		; Оставляет семейство тайлов
		cp	0x10		; Это платформа?
		ret	z		; Да, столкнулся

		scf
		ret


;----------------------------------------------------
; Проверяет, есть ли пол под ногами героя
; Out:
;    Z = есть пол
;    C = нет пола
;----------------------------------------------------

chkProtaCae:
		ld	hl, ProtaY

chkCae:	
		call	chkPisaSuelo
		ret	z		; Стоит на полу

		inc	hl
		inc	hl
		ld	a, (hl)		; X элемента
		and	7
		cp	4		; Находится в первых 4 пикселях тайла?
		ld	a, (hl)
	jp nc,chkCae2	; В зависимости от стороны падения сдвигает элемент на 4 пикселя в ту сторону, чтобы отделить его от платформы

		add	a, 4		; Сдвигает элемент на 4 пикселя вправо

chkCae2:
		and	0x0FC		; Выравнивает X до кратного 4
		ld	(hl), a		; Обновляет X
		scf
		ret

;----------------------------------------------------
; Проверяет, стоит ли текущий элемент на полу
; И герой, и мумии имеют высоту 16,
; поэтому, прибавив 17 к высоте, смотрим, что находится прямо
; под их ногами
; Out:
;   DE = указатель на тайл карты
;    Z = столкновение
;----------------------------------------------------

chkPisaSuelo:
		ld	bc, 0x611	; Координаты X + 6, Y + 17
		call	chkTocaMuro	; Z = столкновение
		ret	z		; Стоит на платформе

		ld	bc, 0x0A11	; X + 10, Y + 17

chkTocaMuro:
		push	hl		; Z = столкновение
		call	getMapOffset	; Получает в HL адрес карты, соответствующий координатам
		ex	de, hl
		pop	hl

		dec	hl
		dec	hl
		dec	hl

		ld	b, (hl)		; Status
		inc	hl
		inc	hl
		inc	hl
		and	0x0F0		; Оставляет семейство, к которому относится тайл карты
		ld	c, a
		cp	0x10		; Платформы
		ret	z		; Касается платформы

		ld	a, b		; Status
		cp	2		; Падает?
		ld	a, c		; Восстанавливает тип тайла, которого касается
	jp z,noTocaMuro

		cp	0x50		; Вращающаяся дверь
		ret

noTocaMuro:
		ld	a, c		; (!?) Не нужно
		dec	b		; Set NZ
		ret

; getMapOffset00 / getMapOffset / tabY96 лежат в хвосте образа (game/kvalley_logic_tail.asm).


;  [СНЯТО, 2 Б] `scf / ret` — сирота за безусловным ret, «(!?) никогда не выполняется».

;----------------------------------------------------
; Проверяет, достигнут ли конец лестницы
; Out:
;   Z = достиг конца
;  NZ = не достиг конца
;----------------------------------------------------

chkFinEscalera:
		ld	a, (hl)
		and	7
		ret	nz		; Y не кратна 8

		push	bc
		ld	bc, 0x810	; Смещение центральной нижней части (8,16)
		call	getMapOffset	; Получает тайл под ногами
		and	0x0F0		; Оставляет семейство или тип
		cp	0x10		; Это платформа или начало лестницы?
		pop	bc
		ret	z		; Да

		and	a		; Нет
		ret

;----------------------------------------------------
; Проверяет, хватается ли за лестницу
; Сначала проверяется, нажаты ли ВВЕРХ или ВНИЗ
; В зависимости от относительной X внутри тайла карты проверяется подъём вправо (0-3) или влево (4-7)
; Затем смотрится тайл под ногами персонажа и сравнивается с предыдущим типом лестницы
; Out:
;    NZ = не хватается
;----------------------------------------------------

chkCogeEscalera:
		ld	hl, protaControl ; 1 = вверх, 2 = вниз, 4 = влево, 8 = вправо, #10 = кнопка A, #20 = кнопка B

chkCogeEsc2:
		ld	a, (hl)		; Управление
		and	3		; Вверх или вниз?
	jp z,noCogeEscalera	; Нет

		rra
	jp nc,chkBajaEscalera	; Вниз

		inc	hl
		inc	hl
		inc	hl
		inc	hl
		ld	a, (hl)		; X
		and	7
	jp z,noCogeEscalera	; Не находится «внутри» тайла лестницы

		sub	5		; В зависимости от относительной X внутри тайла карты проверяется подъём вправо (0-3) или влево (4-7)
		ld	b, 0x22		; Лестницы поднимаются вправо
	jp c,chkCogeEsc3
		dec	b		; Лестницы поднимаются влево

chkCogeEsc3:
		dec	hl
		dec	hl		; Указывает на Y
		push	hl
		call	getMapOffset00	; Получает в HL указатель на карту для координат, на которые указывает HL
		ld	a, 0x61		; 3 экрана + 1 (тайл внизу справа = ноги элемента)
		call	ADD_A_HL

		ld	a, (hl)		; Тайл карты у ног элемента
		ld	c, a
		pop	hl		; Указывает на Y
		cp	b		; Это лестница?
	jp z,chkSubeEsc2	; Да

; Проверяет, лежит ли нож на первой ступеньке лестницы

		push	af
		ld	a, b
		add	a, 0x10		; B = #32 или #31? (тайлы «нож на лестнице»)
		ld	b, a
		pop	af
		cp	b
	jp nz,noCogeEscalera

chkSubeEsc2:
		and	1
		xor	1
		ld	b, a		; 1 = лестницы вправо, 0 = влево

		ld	a, (modoSentEsc) ; Если 0 — сохраняет в "sentidoEscalera" тип лестницы, за которую хватается герой. 0 = \, 1 = /
		and	a
	jp nz,chkSubeEsc3	; Не сохраняет в sentidoEscalera направление лестницы

		ld	a, b
		ld	(sentidoEscalera), a ; 0 = \, 1	= /
					; Также используется, чтобы узнать, был ли прыжок вертикальным (сохраняет состояние клавиш в момент прыжка.

chkSubeEsc3:
		inc	hl
		inc	hl
		ld	a, (hl)		; X
		dec	hl
		dec	hl		; Указывает на Y
		ld	de, distPeldano
		and	7		; Оставляет относительную X персонажа внутри тайла лестницы
		call	ADD_A_DE
		ld	a, (de)		; Вертикальное смещение
		add	a, (hl)		; Прибавляет его к Y
		ld	(hl), a
		dec	hl
		dec	hl
		dec	hl
		ld	(hl), 3		; Status: поднимается или спускается по лестнице

		xor	a
		cp	0		; Set Z, NC
		ret

;----------------------------------------------------
; Таблица расстояний до первой ступеньки в зависимости
; от положения персонажа относительно тайла ступеньки
;
;----------------------------------------------------
distPeldano:	db 0
		db -1
		db -2
		db -3
		db -4
		db -3
		db -2
		db -1

noCogeEscalera:
		xor	a
		dec	a
		ret


;----------------------------------------------------
; Проверяет, есть ли лестница для спуска под ногами персонажа
; Out:
;    NC/Z = спускается по лестнице
;----------------------------------------------------

chkBajaEscalera:
		inc	hl
		inc	hl
		inc	hl
		inc	hl
		ld	a, (hl)		; X
		and	7
		cp	4
		call	nz, bajaWinX	; демо: только X&7==4 (шаг 0xA8 как на 50 Гц); игрок: 3..5. C = нельзя
	jp c,noCogeEscalera

		dec	hl
		dec	hl
		push	hl		; Указывает на Y
		call	getMapOffset00	; Получает в HL указатель на карту для координат, на которые указывает HL
		ld	a, 0x0C1		; Ряд паттернов ниже персонажа, прямо под его ногами
					; #60 на ряд * 2 (высота 16) + 1 (8 пикселей) = прямо под ногами
		call	ADD_A_HL
		ld	a, (hl)		; Тайл карты под ногами
		ld	c, a
		pop	hl
		cp	0x16		; Тайл начала лестницы, спускающейся вправо
	jp z,chkBajaEsc2

		cp	0x17		; Тайл начала лестницы, спускающейся влево
	jp nz,noCogeEscalera

chkBajaEsc2:
		ld	a, (modoSentEsc) ; Если 0 — сохраняет в "sentidoEscalera" тип лестницы, за которую хватается герой. 0 = \, 1 = /
		and	a
	jp nz,chkBajaEsc3

		ld	a, c
		and	1		;  0 = \, 1 = /
		ld	(sentidoEscalera), a ; 0 = \, 1	= /
					; Также используется, чтобы узнать, был ли прыжок вертикальным (сохраняет состояние клавиш в момент прыжка.

chkBajaEsc3:
		call	bajaSnap	; игрок: дробь X в 0, X в центр тайла; демо: не трогает. HL -> Y
		ld	a, (hl)
		add	a, 4
		ld	(hl), a		; Сдвигает персонажа на 4 пикселя вниз
		dec	hl
		dec	hl
		dec	hl
		ld	(hl), 3		; Состояние: лестница
		xor	a
		cp	0		; Set Z, NC
		ret

;----------------------------------------------------
; Проверяет столкновение со стеной или вращающейся дверью при ходьбе
; Проверка не выполняется, если не нажаты ВПРАВО или ВЛЕВО
; Если X элемента кратна 8 — проверяет столкновение с вращающейся дверью
; Если X в правых 4 пикселях тайла — проверяет стены
; Out:
;    Z = не сталкивается
;    C = сталкивается
;----------------------------------------------------

chkChocaAndar:
		ld	hl, protaControl ; 1 = вверх, 2 = вниз, 4 = влево, 8 = вправо, #10 = кнопка A, #20 = кнопка B

chkChocaAndar2:
		ld	a, (hl)
		and	0xc		; Нажаты ВПРАВО или ВЛЕВО?
		ret	z		; Нет

		inc	hl

chkChocaAndar3:
		ld	b, (hl)		; Направление

chkChocaAndar4:
		inc	hl		; Y
		ld	d, h
		ld	e, l
		call	getMapOffset00	; Получает в HL указатель на карту для координат, на которые указывает HL
		inc	de
		inc	de
		ld	a, (de)		; X
		and	7
		ld	c, 0x50		; Вращающаяся дверь (тип тайлов)
	jp z,chkChocaAndar5	; Кратно 8

		cp	4
		ld	c, 0x10		; Платформы (тип тайлов)
	jp nz,noChocaAndar

chkChocaAndar5:
	ld (il_a),a	; Направление: 1 = влево, 2 = вправо
	ld a,b
	and 1<<0
	ld a,(il_a)
	jp nz,chkChocaAndar6	; Идёт влево

		inc	hl		; X тайла карты + 1
		and	a		; Координата X элемента кратна 8
	jp z,chkChocaAndar6

		inc	hl		; Увеличивает на 1 X проверяемого тайла карты

chkChocaAndar6:
		ld	a, (hl)		; Тайл карты
		and	0x0F0		; Оставляет семейство или тип тайла
		cp	c		; Это вращающаяся дверь или стена?
	jp z,chocaAndar	; Сталкивается

		ld	a, 0x60		; Расстояние до тайла прямо снизу (Y + 1)
		call	ADD_A_HL
		ld	a, (hl)		; Получает тайл карты
		and	0x0F0		; Оставляет тип тайла
		cp	c
	jp nz,noChocaAndar	; Не сталкивается

chocaAndar:
		scf
		ret

noChocaAndar:
		and	a
		ret



;----------------------------------------------------
;
; Спрайт героя без ничего в руках
;
;----------------------------------------------------
	.include "../res/res_sprites_tiles.asm"	; GFX_SPRITES2/InGame/GEMA (RLE); герой и мумия — в gen/vec_sprdata.asm

;--------------------------------------------------------------------------------------------------------
;
; Логика ножей
;
;--------------------------------------------------------------------------------------------------------

AI_Cuchillos:
		xor	a
		ld	(knifeEnProceso), a

AI_Cuchillos2:
		ld	hl, chkLastKnife
		push	hl		; Кладёт в стек процедуру, проверяющую, обработаны ли все ножи

		xor	a		; Смещение к статусу ножа
		call	getKnifeData	; Получает индекс обрабатываемого ножа
		call	jumpIndex

		dw initCuchillo		; 0 - Инициализация ножа. Сохраняет тайл фона
		dw doNothing_		; 1 - Лежит на полу
		dw doNothing_		; 2 - Герой несёт его в руке
		dw doNothing_
		dw lanzaCuchillo	; 4 - Бросок ножа
		dw movKnife		; 5 - Нож в воздухе
		dw knifeChoca		; 6 - Нож только что столкнулся
		dw knifeRebota		; 7 - Отскакивает
		dw knifeCae		; 8 - Падает


;----------------------------------------------------
; Knife Status 0: проверяет тайл фона и сохраняет его
; Если он на ступеньке лестницы — меняет его на специальный тайл ножа, показывающий, что сзади лестница
; Переходит к следующему состоянию (1)
;----------------------------------------------------

initCuchillo:
		xor	a
		call	getKnifeData	; Получает указатель на данные ножа
		inc	(hl)		; Переводит его в статус 1
;  [2026-08-04] ХУК ГЕЙТА НОЖА: единственный переход В состояние «лежит на полу» —
;  форсируем следующую проверку chkCogeKnife (см. доказательство там). A и флаги здесь
;  мертвы: дальше идут inc hl/inc hl/call getMapOffset00 (push/lxi/`ld a,(hl)`), т.е.
;  A перезаписывается раньше чтения, а флаги впервые читает rra ПОСЛЕ своего же add a,c.
		ld	a, 1
		ld	(knfDirty), a
		inc	hl
		inc	hl		; Указывает на Y ножа
		call	getMapOffset00	; Получает тайл карты, на котором находится нож
		ex	de, hl
		ld	a, 0x0A		; Смещение backup-тайла
		call	getKnifeData
		ld	a, (de)		; Тайл, находящийся в карте RAM
		ld	b, a
		and	0x0F0
		cp	0x30		; Проверяет, нож ли это
	jp z,initCuchillo2
		ld	(hl), b		; Сохраняет тайл, который находится за ножом

initCuchillo2:
		ld	a, b
		sub	0x31		; Нож на ступеньке?
		cp	2		; Два возможных направления лестниц (нож на ступеньке вправо и на ступеньке влево)
		ld	a,b
	jp c,initCuchillo5
		
		ld	a,b		; (!?) Не нужно! A уже равно B
		sub	0x21		; Ступенька лестницы, поднимающейся влево
		cp	2		; Проверяет оба типа ступенек (вправо и влево)
	jp nc,initCuchillo4
		
		ld	a,b
initCuchillo3:
		add	a, 0x10		; Превращает тайл ножа в «нож на ступеньке»
	jp initCuchillo5

initCuchillo4:
		ld	a, 0x30		; ID тайла ножа на полу

initCuchillo5:
		ld	(de), a		; Обновляет карту RAM
		xor	a
		call	getKnifeData
		ld	a, 0x4B		; Паттерн лежащего ножа
		jp	drawTile


doNothing_:
		ret

;--------------------------------------------------------------------------------------------------------
;
; Бросает нож
; Проигрывает звук броска
; Помещает нож в координаты героя
; Сохраняет тайлы карты, поверх которых он рисуется
;
;--------------------------------------------------------------------------------------------------------

lanzaCuchillo:
		ld	a, 6
		call	setMusic	; Звук броска

		ld	a, 6
		call	getKnifeData	; Получает указатель на дробную скорость
		ex	de, hl
		ld	hl, knifeDataInicio
		ld	bc, 0x0B
	call vec_ldir_fwd	; Инициализирует значения этого ножа

		call	knifeNextStatus	; Переходит к следующему состоянию
		inc	hl
		ld	de, sentidoProta ; 1 = влево, 2 = вправо
		ex	de, hl
		ld	a, (hl)		; Направление броска
		ld	bc, 5
	call vec_ldir_fwd	; Копирует направление и координаты героя

		dec	de
		dec	de		; X ножа
		dec	hl
		dec	hl		; X героя
		ld	b, 8		; Смещение X при броске вправо
	rra	; 1 = влево, 2 = вправо
	jp nc,lanzaCuchillo2
		ld	b, 0		; Смещение при броске влево

lanzaCuchillo2:
		ld	a, (hl)
		add	a, b		; Прибавляет смещение к X
		and	0x0F8		; Выравнивает до паттернов (кратно 8)
	push af	; Прибавляет 4
	or 1<<2
	ld (il_a),a
	pop af
	ld a,(il_a)
		ld	(de), a		; Обновляет X ножа
		dec	de
		dec	de		; Y ножа
		ex	de, hl		; HL указывает на координаты ножа
		call	getMapOffset00	; Получает в HL указатель на карту для координат, на которые указывает HL
		ex	de, hl
		ld	a, 0x0A		; Смещение backup фона
		call	getKnifeData
		ex	de, hl
	ld a,(hl)
	ld (de),a
	inc hl
	inc de
	dec bc
	ld a,(hl)	; Сохраняет тайлы карты, поверх которых рисуется нож
	ld (de),a
	inc hl
	inc de
	dec bc
		ret

;----------------------------------------------------
; Получает кадр ножа по его позиции X на экране
;----------------------------------------------------

getFrameKnife:
		ld	a, 4		; Смещение X ножа
		call	getKnifeData
		rra
		rra
		and	3		; Меняет кадр каждые четыре пикселя
		ld	de, framesCuchillo
		call	ADD_A_DE
		ld	a, (de)
		ret


;----------------------------------------------------
; Паттерны для отрисовки ножа
;----------------------------------------------------
framesCuchillo:	db 0x45
					; Вращается СЗ
		db 0x46			; Вращается СВ
		db 0x48			; Вращается ЮВ
		db 0x49			; Вращается ЮЗ
		db 0x4B			; Воткнут в пол

;--------------------------------------------------------------------------------------------------------
; Двигает брошенный нож
; Проверяет столкновение с вращающейся дверью
; Копирует и восстанавливает фон, над которым пролетает
;--------------------------------------------------------------------------------------------------------

movKnife:
		ld	a, 6		; Смещение скорости ножа
		call	getKnifeData
		ld	e, (hl)
		inc	hl
		ld	d, (hl)		; DE = скорость ножа
		ld	a, 3		; Смещение дробной X
		call	getKnifeData
		call	mueveElemento	; Обновляет координаты ножа по его скорости

		ld	a, d		; X ножа
		and	3
		ret	nz		; Не кратно 4

		ld	a, d
		and	7
	jp z,movKnife3	; Кратно 8

; Кратно 4

		ld	a, d
		cp	8
		ret	c		; Меньше 8. Прижат к левому краю экрана

		cp	252
		ret	nc		; Больше или равно 252. Прижат к правому краю экрана

		call	getFrameKnife	; Получает текущий кадр анимации ножа
		dec	hl
		dec	hl
		dec	hl
		dec	hl
		call	drawTile	; Рисует первый тайл ножа

	jp nz,movKnife1	; Если не на экране — не рисует
	
		inc	a
		inc	hl
		call	vec_text_blit	; NAT: 2-й тайл ножа -> framebuffer
movKnife1:
		ld	a, 1		; Смещение направления
		call	getKnifeData
		push	hl		; Указывает на направление
		ld	a, (hl)		; Направление
		inc	hl		; Указывает на Y
		push	af
		call	getMapOffset00	; Получает указатель HL на позицию ножа в карте RAM
		pop	af
		rra
	jp c,movKnife2	; Влево
		inc	hl		; Тайл справа

; Восстанавливает вращающуюся дверь, если нож столкнулся с ней

movKnife2:
		ld	a, (hl)		; Тайл карты
		and	0x0F0		; Оставляет семейство или тип тайла
		cp	0x50		; Вращающаяся дверь
		pop	hl		; Указывает на направление
		ret	nz		; Не столкнулся с дверью

		dec	hl		; Указывает на состояние
		inc	(hl)		; Переводит нож в следующее состояние (5)
		push	hl
		ld	a, 0x0A		; Смещение тайла фона
		call	getKnifeData
		ex	de, hl
		pop	hl
		push	de
		call	getTileFromID
		call	drawTile	; Восстанавливает тайл фона 1
		pop	de
		ret	nz		; Не на текущем экране

		inc	hl		; Следующая позиция VRAM (занимает два тайла)
		inc	de		; Следующий backup-тайл ножа
		ld	a, (de)
		call	getTileFromID	; Определяет соответствующий тайл
		jp	vec_text_blit	; NAT: восстанавливает фон двери за ножом -> framebuffer

; Кратно 8

movKnife3:
		ld	a, 1		;  Смещение направления
		call	getKnifeData
		ld	(z80_ix), hl	; IX = HL. [2026-07-29] было 11 Б клея транслятора (push hl /
				; ld (il_tmp),hl / pop hl / ld (z80_ix),hl / ld hl,(il_tmp)) —
				; сохранение HL там избыточно: он и так не менялся.

		call	getFrameKnife	; Кадр, соответствующий ножу
		ld	b, a

		xor	a
		call	getKnifeData	; Указатель на данные ножа

		ld	a, b		; Кадр ножа
		call	drawTile

		ld	a, 2		; Смещение Y
		call	getKnifeData
		call	getMapOffset00	; Получает в HL указатель на карту для координат, на которые указывает HL

;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ: суммарный эффект восьми строк спиллов был ровно
;  «A := (z80_ix+0), HL и F не тронуты» — делаем это прямо (push hl/lhld/mov/pop не
;  трогают флаги, CY для rra ниже сохранён так же, как сохранял pop af). -58 т, -10 Б.
	push hl	; Направление
	ld hl,(z80_ix)
	ld a,(hl)
	pop hl
		inc	hl		; Тайл справа от ножа
	rra
		push	af
	jp nc,movKnife4	; Вправо
		dec	hl
		dec	hl		; Тайл слева

movKnife4:
		pop	af
		ld	a, (hl)		; Тайл карты фона
	jp nc,movKnife5	; Вправо

;  [2026-09-19] IX-хоровод тайлов 9/0x0A: восемь vec_ix_ofs + два vec_ix_st.
;  Слоты соседние — один проход HL=(z80_ix)+9. Смещение через BC, не DE:
;  на jp nz,movKnife8 жив E (дробная X от mueveElemento), D и так пишется backup'ом.
	push	af
	ld	hl, (z80_ix)
	ld	bc, 9
	add	hl, bc
	ld	c, (hl)		; backup-тайл 1 (+9)
	inc	hl
	ld	d, (hl)		; backup-тайл 2 (+10)
	ld	(hl), c		; +10 := старый +9
	dec	hl
	pop	af
	ld	(hl), a		; +9 := тайл карты
	jp	movKnife6

movKnife5:
	push	af
	ld	hl, (z80_ix)
	ld	bc, 9
	add	hl, bc
	ld	d, (hl)		; backup-тайл 1 (+9)
	inc	hl
	ld	c, (hl)		; backup-тайл 2 (+10)
	dec	hl
	ld	(hl), c		; +9 := старый +10
	inc	hl
	pop	af
	ld	(hl), a		; +10 := тайл карты

movKnife6:
	ld	hl, (z80_ix)
	inc	hl
	inc	hl
	inc	hl
	inc	hl		; +4, как прежний vec_ix_ofs 4 (сравнивается с ProtaRoom)
	ld	b, (hl)
		ld	a, (ProtaRoom)	; Экран героя
		cp	b
	jp nz,movKnife8	; Не на одном экране — рисовать не нужно

		ld	a, d		; Восстанавливаемый тайл фона
		call	getTileFromID
		push	af
		ld	a, 2		; Смещение Y
		call	getKnifeData
		ld	d, (hl)		; Y
		inc	hl
		inc	hl		; X
		ld	e, (hl)		; DE = YX
		call	coordVRAM_DE	; Получает указатель на VRAM, соответствующий координатам ножа

		dec	hl		; Указатель VRAM
;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ: суммарный эффект восьми строк спиллов был ровно
;  «A := (z80_ix+0), HL и F не тронуты» — делаем это прямо (push hl/lhld/mov/pop не
;  трогают флаги, CY для rra ниже сохранён так же, как сохранял pop af). -58 т, -10 Б.
	push hl	; Направление
	ld hl,(z80_ix)
	ld a,(hl)
	pop hl
		rra
	jp nc,movKnife7	; Вправо
		inc	hl
		inc	hl

movKnife7:
		pop	af
		call	vec_text_blit	; NAT: восстанавливает фон за ножом -> framebuffer

movKnife8:
	ld (il_tmp),hl
	ld hl,(z80_ix)
	push hl
	ld hl,(il_tmp)
		push	de
		call	chkKnifeMomia	; Проверяет столкновение с мумией
		pop	de
	ld (il_tmp),hl
	pop hl
	ld (z80_ix),hl
	ld hl,(il_tmp)
	jp nc,movKnife9	;  Не столкнулся с мумией

		xor	a
		call	getKnifeData
	jp movKnife11

movKnife9:
		ld	a, 2		; Y
		call	getKnifeData
		push	hl
		call	getMapOffset00	; Получает в HL указатель на карту для координат, на которые указывает HL
		dec	hl
;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ: суммарный эффект восьми строк спиллов был ровно
;  «A := (z80_ix+0), HL и F не тронуты» — делаем это прямо (push hl/lhld/mov/pop не
;  трогают флаги, CY для rra ниже сохранён так же, как сохранял pop af). -58 т, -10 Б.
	push hl	; Направление
	ld hl,(z80_ix)
	ld a,(hl)
	pop hl
		rra
	jp c,movKnife10	; Влево
		inc	hl
		inc	hl

movKnife10:
		ld	a, (hl)
		ld	b, a
		pop	hl		; Y
		call	chkKnifeChoca	; Проверяет, является ли тайл платформой, ножом, киркой или гемом
	jp nz,knifeNoChoca	; Ни с чем не сталкивается

		ld	a, b
		cp	0x40		; Гемы
	jp z,knifeNoChoca	; С гемами нож не сталкивается

		dec	hl
		dec	hl		; Указывает на статус

movKnife11:
		inc	(hl)		; Переводит нож в следующее состояние: столкновение
		inc	hl
		ld	b, (hl)		; Направление
		inc	hl
		inc	hl
		inc	hl

movKnife12:
		inc	hl
		ld	a, (ProtaRoom)	; Старшая часть координаты X. Указывает комнату пирамиды
		cp	(hl)		; Нож и герой на одном экране?
		ret	nz		; Не на текущем экране. Не виден

		ld	a, 5
		call	ADD_A_HL	; Указатель на backup-тайлы фона
	ld (il_a),a	; Направление
	ld a,b
	rra
	ld b,a
	ld a,(il_a)
	jp nc,knifeRestaura	; Вправо
		inc	hl

knifeRestaura:
		ld	a, (hl)		; Backup-тайл
		call	getTileFromID	; Получает соответствующий паттерн
		call	coordVRAM_DE	; D = Y, E = X
		jp	vec_text_blit	; NAT: восстанавливает фон за ножом (столкновение) -> framebuffer

knifeNoChoca:
		dec	hl
		ld	b, (hl)
		inc	hl
		inc	hl
		inc	hl
		xor	a
		cp	(hl)
	jp z,movKnife12
		ld	a, 0x0F8
		cp	(hl)
	jp z,movKnife12
		ret

;----------------------------------------------------
;
; Нож сталкивается
; Переходит в состояние отскока, инвертирует направление и сдвигает его на 4 пикселя назад
;----------------------------------------------------

knifeChoca:
		call	knifeNextStatus	; Переходит в состояние отскока
		inc	hl
		ld	a, (hl)
		xor	3
		ld	(hl), a		; Инвертирует направление
		inc	hl
		inc	hl
		inc	hl
		rra
		ld	a, (hl)		; X
	jp c,knifeChoca2	; Влево
		add	a, 4

knifeChoca2:
		and	0x0F8
		ld	(hl), a
		ld	a, 5
		call	ADD_A_HL
		ld	(hl), 0
		ret

;----------------------------------------------------
;
; Нож отскакивает
; Выполняет параболу, имитирующую отскок.
; Проверяет столкновение с чем-либо во время отскока.
; По окончании переходит к следующему состоянию: падение
;----------------------------------------------------

knifeRebota:
		ld	a, 3
		call	tmrAnd	; [door-wall r3] маска под 25 Гц (демо: прежняя)
		jp	nz, updateKnifeAtt ; Обновляет координаты 1 раз из 4 кадров. В остальных — атрибуты спрайта

		ld	a, 1		; Смещение направления
		call	getKnifeData
		push	hl
		ld	a, (hl)		; Направление
		inc	hl
		inc	hl
		inc	hl
		inc	(hl)		; Увеличивает X
		rra
	jp nc,knifeRebota2	; Вправо

		dec	(hl)
		dec	(hl)		; Уменьшает X (отскакивает влево)

knifeRebota2:
		pop	hl
		call	chkPasaRoom	; Проверяет переход в другую комнату

		ld	a, 9
		call	getKnifeData
		ld	a, (hl)		; Счётчик движения

		ld	hl, parabolaKnife
		call	ADD_A_HL
		ld	b, (hl)		; Смещение Y отскока для имитации параболы

		ld	a, 2		; Y
		call	getKnifeData
		ld	a, (hl)		; Y ножа
		add	a, b		; Прибавляет смещение параболы
		ld	(hl), a		; Обновляет Y ножа

		push	hl
		ld	bc, 0x408	; Смещение X+4, Y+8
		call	getMapOffset	; Читает тайл карты
		ld	a, (hl)		; Получает тайл прямо под ножом
		call	chkKnifeChoca	; Проверяет, является ли тайл платформой, ножом, киркой или гемом
		pop	hl
	jp nz,knifeRebota3	; Ни с чем не сталкивается
		call	knifeTileClass
		jp	c, knifeRebota3	; блеск — как «нет удара»
		jp	z, knifeEnd	; кирпич/стена
		jp	setReboteKnife	; прочее препятствие

knifeRebota3:
		ld	a, 7
		call	ADD_A_HL
		inc	(hl)		; Увеличивает счётчик движения

		ld	a, (hl)
		cp	8		; Парабола отскока закончилась? (8 кадров)
		jp	z, knifeNextStatus ; Да, переходит в состояние падения
		jp	updateKnifeAtt


;----------------------------------------------------
; Значения параболы отскока ножа
;----------------------------------------------------
parabolaKnife:	db -5
		db -2
		db -1
		db 0
		db 0
		db 1
		db 2
		db 5

;----------------------------------------------------
; Status ножа = падение
;----------------------------------------------------

knifeCae:
		ld	a, 3
		call	tmrAnd	; [door-wall r3] маска под 25 Гц (демо: прежняя)
		jp	nz, updateKnifeAtt ; Обновляет координаты 1 раз из 4 кадров

		ld	a, 2		; Смещение Y
		call	getKnifeData
		ld	a, (hl)		; Y ножа
		and	0x0FC		; Выравнивает до кратного 4
		ld	(hl), a

		ld	d, (hl)		; (!?) Почему не делает LD D,A
		ld	a, d
		and	3		; (!?) Если только что сделан AND #FC, откуда возьмётся NZ после AND 3?
		jp	nz, caeKnife4

		call	getMapOffset00	; Получает в HL указатель на карту для координат, на которые указывает HL
		ld	a, 0x60		; Смещение к тайлу под ножом
		call	ADD_A_HL
		ld	a, (hl)		; Тайл карты под ножом
		call	chkKnifeChoca	; Проверяет, является ли тайл платформой, ножом, киркой или гемом
		jp	nz, caeKnife4	; Ни с чем не сталкивается
		call	knifeTileClass
		jp	c, caeKnife4	; блеск
		jp	z, knifeEnd	; кирпич
		jp	setReboteKnife

knifeEnd:
		call	hideKnifeSpr
		xor	a
		call	getKnifeData
	
	jp setReboteKnife2	; Хак для экономии байта
;----------------------------------------------------
; B = тайл после chkKnifeChoca (удар был).
; CF=1 блеск (пройти), CF=0 Z=кирпич/стена, CF=0 NZ=прочее → отскок.
;----------------------------------------------------
knifeTileClass:
		ld	a, b
		cp	0x41
		scf
		ret	z
		cp	0x42
		scf
		ret	z
		and	0x0F0
		cp	0x10
		ret
;----------------------------------------------------
; Перезапускает отскок ножа
;----------------------------------------------------

setReboteKnife:
		xor	a
		call	getKnifeData
		ld	(hl), 7		; Status 7 = отскок
		ld	a, 9
		call	ADD_A_HL
setReboteKnife2:
		ld	(hl), 0		; Счётчик движения/отскока = 0
		ret

;----------------------------------------------------
; Прибавляет 4 к Y ножа и выравнивает до кратного 4
;----------------------------------------------------

caeKnife4:
		ld	a, 2		; Y
		call	getKnifeData
	
		ld	a,(hl)
		add	a,4
		and	0x0FC
		ld	(hl), a
		jp	updateKnifeAtt

;----------------------------------------------------
; Проверяет, является ли тайл платформой, гемом, ножом или гемом
; Out:
;   Z = это один из этих элементов
;   B = входной тайл
;----------------------------------------------------

chkKnifeChoca:
		ld	b, a		; Проверяет, является ли тайл платформой, ножом, киркой или гемом
		and	0x0F0
		cp	0x10		; Платформы
		ret	z

		cp	0x30		; Нож
		ret	z

		cp	0x80		; Кирка
		ret	z

		cp	0x40		; Гемы
		ret


;----------------------------------------------------
; Обновляет RAM-атрибуты спрайта ножа
;----------------------------------------------------

updateKnifeAtt:
		ld	a, 5		; Смещение экрана, на котором находится нож
		call	getKnifeData
		ld	a, (ProtaRoom)	; Старшая часть координаты X. Указывает комнату пирамиды
		cp	(hl)
	jp nz,hideKnifeSpr	; Не на текущем экране, поэтому скрывает его

		dec	hl
		dec	hl
		dec	hl		; Y
		push	hl
		call	getKnifeAttib
		ex	de, hl
		pop	hl
		ld	a, (hl)		; Y
		ld	(de), a		; Атрибут Y
		inc	hl
		inc	hl
		ld	a, (hl)		; X
		inc	de
		ld	(de), a		; Атрибут X
		inc	de
		call	tmrSpr		; [door-wall r3] (timer & 0x0C) под 25 Гц; демо прежнее
		add	a, 0x0F0		; Первый спрайт ножа
		ex	de, hl
		ld	(hl), a		; Спрайт ножа
		inc	hl
		ld	(hl), 0x0F	; Белый цвет
		ret

;----------------------------------------------------
; Проверяет, обработаны ли все ножи
;----------------------------------------------------

chkLastKnife:
		ld	hl, knifeEnProceso
		inc	(hl)
		ld	a, (hl)
		inc	hl
		cp	(hl)
		jp	nz, AI_Cuchillos2
		ret

;----------------------------------------------------
; Убирает нож из видимой области
;----------------------------------------------------

hideKnifeSpr:
		call	getKnifeAttib
		ld	(hl), 0x0E0
		ret


;----------------------------------------------------
; Переводит нож в следующее состояние
;----------------------------------------------------

knifeNextStatus:
		xor	a
		call	getKnifeData
		inc	(hl)
		ret


;----------------------------------------------------
; Получает указатель на данные текущего ножа
; In: A = смещение к переменной структуры
; Out:
;   HL = указатель на данные ножа (переменная, указанная в A)
;    A = значение переменной
;----------------------------------------------------

getKnifeData:
		push	bc
		ld	hl, knifesData	; 0 = Status (1 = на полу, 2 = взят, 4 = бросок?, 5 = брошен, 7 = отскакивает)
					; 1 = направление (1 = влево, 2 = вправо)
					; 2 = Y
					; 3 = дробная X
					; 4 = X
					; 5 = комната
					; 6 = дробная скорость
					; 7 = скорость ножа
					; 8 = скорость смены комнаты
					; 9 = счётчик движения
					; A = backup-тайл 1 (фон)
					; B = backup-тайл 2 (при броске сохраняет два тайла)
		call	ADD_A_HL
		ld	a, (knifeEnProceso)
		ld	b, a
		add	a, a
		call	getIndexX8_masB
		pop	bc
		ret


;----------------------------------------------------
; Вычисляет адрес таблицы имён, на который указывает DE
; In:
;   D =	Y
;   E =	X
; Out:
;   HL = указатель VRAM
;----------------------------------------------------

coordVRAM_DE:
		push	af		; D = Y, E = X
		ld	h, d
		ld	l, e
		ld	a, h
		rra
		rra
		rra
		rra
	ld (il_a),a
	ld a,l
	rra
	ld l,a
	ld a,(il_a)
		rra
	ld (il_a),a
	ld a,l
	rra
	ld l,a
	ld a,(il_a)
		rra
	ld (il_a),a
	ld a,l
	rra
	ld l,a
	ld a,(il_a)
		and	3
		add	a, 0x38		; Таблица имён в #3800
		ld	h, a
		pop	af
		ret


;----------------------------------------------------
; Получает указатель на атрибуты обрабатываемого ножа
;----------------------------------------------------

getKnifeAttib:
		ld	a, (knifeEnProceso)
		ld	hl, knifeAttrib
		jp	getMomiaAtrib2



;----------------------------------------------------
;
; Проверяет столкновение ножа с мумией
; Out:
;   NC, Z = Не столкнулся
;   C = Столкнулся
;----------------------------------------------------

chkKnifeMomia:
		ld	c, 0		; Первая мумия для обработки = 0

chkKnifeMomia2:
		ld	a, c		; Мумия для обработки
		call	getMomiaDat

;  [2026-09-19] ТОЧНОЕ: ix-обёртки -> (z80_ix). getMomiaDat кладёт запись в z80_ix;
;  записи momiaDat 0xFE4D-0xFEA0, смещения <= ACTOR_TIMER, L+смещение без переноса
;  страницы (как chkTocaMomia4 / momiaPiensa). МЁРТВОСТИ: входной A/HL после
;  getMomiaDat (оригинал сам перетирал их vec_ix_*), il_a/il_tmp2 (скретч), AF
;  вокруг SumaPuntos/setMusic (выход — только CY=1).
		ld	hl, (z80_ix)
		ld	a, (hl)		; ACTOR_STATUS +0
		cp	4		; Она в лимбе, появляется или взрывается?
	jp c,chkKnifeMomia3

		cp	7		; Она думает?
	jp nz,chkKnifeMomia4	; Состояние, в котором коллизию проверять не нужно

chkKnifeMomia3:
		ld	a, 2		; Смещение Y
		call	getKnifeData
		ld	d, (hl)		; Y
		inc	hl
		inc	hl
		ld	e, (hl)		; X
		inc	hl
		ld	a, (hl)		; комната ножа
		ld	hl, (z80_ix)
		ld	b, a		; B = комната ножа (C = индекс мумии)
		ld	a, l
		add	a, ACTOR_ROOM
		ld	l, a		; HL = &комната мумии (переноса нет)
		ld	a, b
		cp	(hl)
	jp nz,chkKnifeMomia4	; Не в одной комнате

		push	bc
		dec	l		; ACTOR_ROOM(6) -> ACTOR_X(5)
		ld	b, (hl)		; B = X мумии
		dec	l
		dec	l		; -> ACTOR_Y(3)
		ld	c, (hl)		; C = Y мумии
		ld	hl, areaSizeMomia
		call	chkArea
		pop	bc
	jp c,chkKnifeMomia5

chkKnifeMomia4:
		inc	c
		ld	hl, numMomias
		ld	a, c
		cp	(hl)		; Проверил все мумии?
		jp	nz, chkKnifeMomia2
		and	a
		ret

chkKnifeMomia5:
	ld (il_tmp),hl
	ld hl,(z80_ix)
	push hl
	ld hl,(il_tmp)
		ld	de, 0x100
		call	SumaPuntos
		ld	a, 8		; SFX взрыв мумии
		call	setMusic
	ld (il_tmp),hl
	pop hl
	ld (z80_ix),hl
		ld	hl, (z80_ix)
		ld	(hl), 6		; ACTOR_STATUS = вспышка
		inc	hl
		ld	(hl), 4		; ACTOR_CONTROL = влево
		inc	hl
		inc	hl		; ->ACTOR_Y +3
		ld	a, (hl)
		and	0x0F8
		ld	(hl), a		; Выравнивает Y до кратного 8
		ld	a, l
		add	a, ACTOR_TIMER-ACTOR_Y
		ld	l, a		; ->ACTOR_TIMER +17 (переноса нет)
		ld	(hl), 0x22
		scf
		ret


;----------------------------------------------------
; Область проверки попадания ножа
;----------------------------------------------------
areaSizeMomia:	db 8, 0x18
		db 8, 0x18


;----------------------------------------------------
; Проверяет, подбирает ли герой нож
; Если подобрал — восстанавливает на карте и на экране тайл, на котором лежал нож
;----------------------------------------------------

chkCogeKnife:
;  [2026-08-04] ГЕЙТ НОЖА — расширение itmGate (замер tools/verify/itmgate_ext_census.js:
;  818 т/тик, гейт срабатывает в 68.8% тиков и снимает ~450 т/тик; цена скип-пути ~49 т).
;  ПОЧЕМУ КОРРЕКТНО. Исход проверки — функция от: (а) позиции героя ProtaY/X/Room —
;  ключ itmGSkip, тот же, что у гемов/кирок (itmGate теперь зовётся ДО нас);
;  (б) objetoCogido — переход 0 -> !=0 проверку только запрещает, а сброс в 0 идёт
;  через quitaObjeto, где тень itmGShOk помечается недействительной => itmGSkip=0;
;  (в) множества ножей «лежит на полу» (status=1). Ножи в полёте (4-8) не подбираемы,
;  их движение исход не меняет. Единственный переход В состояние 1 — initCuchillo
;  (status 0 -> 1; и свежепоставленные ножи уровня, и приземлившиеся проходят через
;  него: knifeEnd сбрасывает упавший нож в 0). Там взводится knfDirty — он форсирует
;  проверку. Убирание с пола — только сам подбор (ставит objetoCogido, см. (б)) и
;  перезагрузка уровня (loadGameGfx гасит itmGShOk => itmGSkip=0).
;  ИНДУКЦИЯ: скип возможен лишь при itmGSkip!=0 (позиция та же, что в прошлый тик, и
;  тень действительна) и knfDirty=0 (посадок не было) => последняя реально
;  выполненная проверка шла при той же позиции и том же множестве ножей на полу и
;  ничего не нашла => исход «ничего» повторится. AI_Cuchillos идёт в тике РАНЬШЕ,
;  поэтому посадка текущего тика видна гейту в этом же тике, как и в оригинале.
		ld	a, (itmGSkip)	; герой двигался -> проверка обязательна
		or	a
		jp	z, ckk_run
		ld	a, (knfDirty)
		or	a
		ret	z		; гейт: герой на месте и ножи на пол не садились
ckk_run:
		xor	a
		ld	(knfDirty), a	; проверка выполняется -> отметка посадок снята
		ld	a, (objetoCogido) ; #10 = Нож, #20 = Кирка
		and	a
		ret	nz		; Уже несёт что-то

		ld	hl, knifeEnProceso
		ld	(hl), a
		inc	hl
		cp	(hl)
		ret	z		; В этой пирамиде ножей нет

;  P3: строгая редукция индекса, как в chkCogeGema. Курсор ножа живёт на вершине стека,
;  шаг структуры 17; `xor a / call getKnifeData` (201 такт: там 17*idx через getIndexX8_masB
;  плюс push/pop bc) заменено чтением курсора. getLocationDE сам затирает B (`ld b,a`).
	ld	hl, knifesData
	push	hl

chkCogeKnife2:
	pop	hl
	push	hl		; HL = данные текущего ножа
	ld	a, (hl)		; A = байт +0 (Status), как вернул бы getKnifeData
		call	getLocationDE	; Проверяет, находится ли в той же комнате, что и герой
	jp nz,chkCogeKnife3	;  Не в одной комнате

		cp	1		; Лежит на полу? (Status = 1)
	jp nz,chkCogeKnife3	; Нет, проверяет следующий нож

		call	chkAreaItem	; Проверяет, касается ли герой ножа
	jp c,chkCogeKnife4	; Да!

chkCogeKnife3:
	pop	hl		; курсор
	ld	de, 17		; шаг структуры ножа
	add	hl, de
	push	hl
		ld	hl, knifeEnProceso
		inc	(hl)
		ld	a, (hl)
		inc	hl
		cp	(hl)
	jp nz,chkCogeKnife2
	pop	hl		; снять курсор (pop rp флагов не трогает)
		ret

chkCogeKnife4:
	pop	hl		; нож подобран: выход мимо chkCogeKnife3, снимаем курсор
		ld	a, (knifeEnProceso)
		ld	(IDcuchilloCoge), a ; Нож, который подбирает герой

		ld	a, 4		; SFX подбор предмета
		call	setMusic

		ld	a, 0x10		; Нож
		call	cogeObjeto	; Загружает спрайты героя с ножом

		xor	a
		call	getKnifeData
		inc	(hl)		; Переводит нож в следующее состояние (2 = его несёт герой)

		ld	d, h
		ld	e, l
		push	hl
		ld	bc, 0x0A		; Смещение к резервной копии тайла карты
		add	hl, bc
		ld	b, (hl)		; Тайл, на котором лежал нож
		pop	hl		; Указывает на состояние

		inc	hl
		inc	hl		; Указывает на Y
		call	getMapOffset00	; Получает в HL указатель на карту для координат, на которые указывает HL
		ld	(hl), b		; Восстанавливает тайл карты
		ld	h, d
		ld	l, e		; Восстанавливает указатель на данные ножа (status)
		ld	a, b		; Тайл карты
		call	getTileFromID	; Получает паттерн, соответствующий тайлу
		jp	drawTile	; Рисует его на экране


;----------------------------------------------------
; Получает координаты элемента и проверяет, находится ли он в той же комнате, что и герой
; In: HL = Указатель на Y, X, комнату
; Out:
;    Z = Находится в комнате героя
;    D = Y
;    E = X
;----------------------------------------------------

getLocationDE:
		inc	hl

getLocationDE2:
		inc	hl

getLocationDE3:
		ld	d, (hl)		; Y
		inc	hl
		inc	hl
		ld	e, (hl)		; X
		inc	hl
		ld	b, a
		ld	c, (hl)		; Комната
		ld	a, (ProtaRoom)	; Старшая часть координаты X. Указывает комнату пирамиды
		cp	c		; В том же экране, что и герой?
		ld	a, b
		ret


;----------------------------------------------------
; Рисует нож
; In: HL = Указатель на status, направление, Y, X, комнату
;----------------------------------------------------

drawTile:
		call	getLocationDE
		ret	nz		; Не в видимой комнате

		call	coordVRAM_DE	; HL = 0x3800+клетка (адрес в name table); A = тайл
		push	af		; СОХРАНИТЬ байт тайла в A — guard читает H в A!
		ld	a, h
		and	0x3F
		cp	0x38
	jp nz,dt_vec_draw	; не bank-0 -> ниже ряда 0, рисуем
		ld	a, l
		cp	0x20
	jp nc,dt_vec_draw	; ряды 1+ (cell>=32) -> игровое поле, рисуем
;  ЗАДАЧА#56: ряд 0 БОЛЬШЕ НЕ ТАБЛО (оно уехало в кайму, ряд 30 — см. res_ui_gfx.asm),
;  но гейт ОСТАЁТСЯ И ЗНАЧИТ ТЕПЕРЬ БОЛЬШЕ. Ряд 0 (fb 255..248) — верхняя строка поля,
;  и её ФОН ОБЯЗАН БЫТЬ НУЛЁМ: ровно на нулевом фоне работает быстрая слитая запись
;  (vsz_merge/стек-блит), ради которой всё и затевалось. Карту сюда не рисует никто
;  (vec_nat_room идёт с ряда 1), единственный источник байтов здесь — вот этот
;  холодный путь drawTile с завёрнутой координатой, то есть мусор.
;  === «А СИММЕТРИЧНЫЙ ГЕЙТ РЯДА 23?» (2026-08-12) — НЕ НУЖЕН, И ВОТ ПОЧЕМУ ============
;  Нижняя строка UI уехала из ряда 23 в кайму (ряд 26), и ряд 23 стал ТАКОЙ ЖЕ пустой
;  крайней строкой поля, как ряд 0. Соблазн поставить второй гейт есть, но он бы ловил
;  ПУСТОТУ: гейт ряда 0 существует не «ради симметрии», а потому, что сюда ПРИХОДИТ
;  мусор — координата заворачивается ВВЕРХ (cell<32 при H=0x38) у объекта, ушедшего выше
;  экрана. Вниз координата так не заворачивается: ряд 23 — не край диапазона, за ним
;  честно идут ряды 24+ (кайма), и попасть в него можно только осмысленным адресом.
;  ЗАМЕР (row23_census.js, 37 сцен обеих сессий, включая пергамент карты, концовку,
;  бонус, логотип и демо): в ряд 23 после переноса не пишет НИКТО, кроме полных очисток
;  планов, — 0 ненулевых байт во ВСЕХ сценах. Ставить гейт на путь, по которому никто не
;  ходит, значит платить байтами и тактами за декларацию, которую нечем накрыть.
		pop	af		; ряд 0 (cell<32) = верхняя строка поля: мусор, пропустить
		or	1		; вернуть NZ (как вне комнаты), чтобы вызывающие тоже пропустили
		ret
dt_vec_draw:
		pop	af		; A = тайл
		di		; закрыть окно IRQ (game-tick уже под DI)
		ld	(vw_byte), a	; входной тайл блиттера
		call	vec_rc		; ФАЗА 5: B = ряд, C = столбец (общее с vec_text_blit)
		ld	a, (vec_isr_depth)
		push	af		; сохранить реальную глубину ISR
		ld	a, 1
		ld	(vec_isr_depth), a ; принудительно !=0: vbt_row сохраняет DI
		push	hl		; сохранить адрес name table на время блита (vec_blit_tile портит HL)
		call	vec_blit_tile	; B=ряд C=столбец vw_byte=тайл -> p0/p1
		pop	hl		; HL = адрес name table (полная замена MSX drawTile)
		pop	af
		ld	(vec_isr_depth), a ; восстановить реальную глубину
		call	vsu_poll	; [mus-jitter] окно DI закрыто (в ISR оно так и останется): догнать тик, если IRQ утонул
		dec	a		; [mus-jitter] глубина 1 (игровой тик) тоже EI: тик идёт с EI, а оставленное DI держало окно потери IRQ до конца тика
	jp nz,dt_keepdi	; во вложенном ISR (глубина >=2) оставить DI
		ei
dt_keepdi:
		ld	a, (vw_byte)	; A = тайл (как MSX WRTVRM сохраняет A=данные)
		ld	b, 1
		dec	b		; Z = нарисовано (контракт VERSION2), A не тронут
		ret		; HL=адрес name table, A=тайл, Z

;----------------------------------------------------
;
; ГЕЙТ ПРОВЕРОК ПОДБОРА. Раз в игровой тик отвечает на вопрос «мог ли исход
; chkCogeGema/chkCogePico измениться с прошлого тика». Если нет — обе проверки снимаются
; целиком (4023 такта/тик полного перебора всех гемов и всех кирок пирамиды).
;
; ПОЧЕМУ ЭТО НЕ МЕНЯЕТ ПОВЕДЕНИЯ. Исход обеих проверок — функция РОВНО от:
;   а) позиции героя: chkAreaItem -> chkTocaProta читает ProtaY и ProtaX, getLocationDE3
;      сравнивает комнату предмета с ProtaRoom. Больше ничего о герое не читается —
;      ни sentidoProta, ни protaStatus (в отличие от chkTocaMomia);
;   б) массивов предметов datosGemas / picosData;
;   в) для кирок — ещё objetoCogido и numPicos.
; Тень (itmGSh) хранит позицию, на которой проверки в последний раз БЫЛИ ВЫПОЛНЕНЫ и
; ничего не нашли. Совпало — значит и сейчас не найдут.
;
; ЧТО МЕНЯЕТ (б) и (в) и почему этого достаточно:
;   * гем подобран — это делает сам chkCogeGema, и делает СРАЗУ ДЛЯ ВСЕХ гемов, попавших
;     в область (цикл идёт до конца). Значит после его прохода на этой позиции гемов уже
;     нет, и на следующем тике исход «ничего» — тот же. AI_Gemas (гасит младший ниббл
;     подобранного гема) идёт В НАЧАЛЕ тика, ДО гейта, и лишь подтверждает этот исход;
;   * кирка подобрана — так же внутри chkCogePico, и сразу выставляется objetoCogido!=0,
;     после чего оригинал и так уходит по `ret nz` в первой строке;
;   * objetoCogido сброшен в 0 (герой бросил нож / отпустил предмет) — единственный путь
;     это quitaObjeto, там тень помечается недействительной. Обратный переход 0 -> !=0
;     проверку только ЗАПРЕЩАЕТ, т.е. пропуск ей эквивалентен;
;   * новый набор предметов (загрузка пирамиды, смерть, чит N/H) — тень помечается
;     недействительной в loadGameGfx, через который проходит ЛЮБАЯ загрузка уровня;
;   * появиться посреди уровня гем или кирка не могут: datosGemas/picosData пишет только
;     setupStage (сразу после loadGameGfx) и сами эти две проверки.
; Ножи (chkCogeKnife) и мумии (chkTocaMomia) НЕ гейтятся: нож падает сам, мумия ходит сама.
;
; ПОЧЕМУ ГЕЙТ СТОИТ ИМЕННО ЗДЕСЬ. Между ним и chkCogePico идут chkCogeGema, AI_Salidas и
; MurosTrampa: ни одна из них не пишет ProtaY/ProtaX/ProtaRoom (единственные писатели —
; подпрограммы AI_Prota, которая уже отработала, scrollPantalla2 и вход/выход из пирамиды,
; идущий по ветке flagEntraSale мимо всех этих вызовов) и не трогает массивы предметов.
;
; Сравниваются ЧЕТЫРЕ подряд лежащих байта ProtaY..ProtaRoom — ProtaXdecimal попадает в
; ключ «за компанию» (лежит между Y и X). Он на исход не влияет, поэтому его участие
; только СТРОЖЕ: лишний прогон возможен, пропуск нужного — нет. Цена замерена ПО ИГРОВЫМ
; ТИКАМ (а не по кадрам: медленный тик занимает два кадра, и покадровый замер сам себе
; засчитывает «герой стоит» дважды — отсюда завышенные 84.3% в cache_candidates.js):
; ключ без ProtaXdecimal не менялся на 82.7% тиков, с ним — на 77.4%. Выкинуть его можно
; только развернув сравнение в три несмежных байта: +14 Б кода ради ~300 тактов/кадр,
; т.е. лучше по абсолютной экономии, но ХУЖЕ по тактам на байт — поэтому не сделано.
;
; Out: itmGSkip != 0 — проверки подбора в этом тике можно снять.
; Портит A, B, C, DE, HL (все вызовы вокруг — с собственной инициализацией регистров).
;----------------------------------------------------

; ТЕЛО ПРОЦЕДУРЫ ЛЕЖИТ В ХВОСТЕ ОБРАЗА — в конце v06c/vec_ending.asm, ЗА `.align 256`
; (правило из шапки kvalley_8c.asm: процедуру можно переносить целиком, до её ret).
; ПРИЧИНА ЧИСТО КОМПОНОВОЧНАЯ, а не смысловая: до выравнивания оставался зазор 21 Б, и
; 32 байта itmGate, положенные здесь, толкали pre-align через границу страницы — зазор
; вырастал с 21 до 226 Б, т.е. правка стоила бы 256 Б образа вместо 32. В хвосте она стоит
; ровно свой размер, а 19 байт врезок (этот call + два гейта + quitaObjeto + loadGameGfx)
; целиком помещаются в тот самый мёртвый зазор и не стоят НИЧЕГО.

;----------------------------------------------------
;
; Проверяет, подбирает ли герой гем
;
;----------------------------------------------------

;  itmGate — ГЕЙТ ПРОВЕРОК ПОДБОРА (гемы/кирки). Смысл, доказательство корректности и
;  список событий, обнуляющих itmGShOk, — на месте вызова, в game/kvalley_game.asm рядом с
;  chkCogeGema. Здесь процедура лежит ТОЛЬКО из-за компоновки: в kvalley_game.asm её 32
;  байта толкнули бы pre-align через границу страницы (+256 Б образа). После слитой записи
;  т.е. +256 Б образа), а в хвосте за `.align 256` она стоит ровно свой размер.
;  Out: itmGSkip != 0 — chkCogeGema и chkCogePico в этом тике можно снять.
;  Портит A, B, C, DE, HL.
; itmGate лежит в хвосте образа (game/kvalley_logic_tail.asm).

chkCogeGema:
		ld	a, (itmGSkip)	; гейт: герой не сдвинулся и набор гемов тот же
		or	a
		ret	nz		; ...значит исход прошлого тика («ничего») повторится
		xor	a
		ld	(ElemEnProceso), a ; Начинаем с первого гема
;  P3: строгая редукция индекса. `xor a / call getGemaDat` каждую итерацию заново
;  считало datosGemas + 9*ElemEnProceso (159 тактов на гем), хотя от итерации к итерации
;  указатель просто растёт на 9. Держим курсор на вершине стека (свободных регистров нет:
;  B,C,D,E затирает getLocationDE, HL — chkAreaItem). Значение в HL и A на входе в
;  getLocationDE ровно то же, что давал getGemaDat; B он затирает сам первым делом
;  (`ld b,a` в getLocationDE3), так что разницы в наблюдаемом состоянии нет.
	ld	hl, datosGemas
	push	hl

chkCogeGema2:
	pop	hl
	push	hl		; HL = данные текущего гема
	ld	a, (hl)		; A = байт +0, как вернул бы getGemaDat
		call	getLocationDE	; Он на экране героя?
	jp nz,chkCogeGema3

		and	0x0F		; A = Цвет гема
	jp z,chkCogeGema3	; Цвет 0

		call	chkAreaItem	; Проверяет, касается ли герой гема
	jp nc,chkCogeGema3	; Нет

		ld	de, 0x500
		call	SumaPuntos	; Прибавляет 500 очков

		ld	a, 9		; SFX подбор гема
		call	setMusic

		ld	a, 1		; Смещение status
		call	getGemaDat
		ld	(hl), 2		; Status = Гем подобран. Надо его стереть

chkCogeGema3:
	pop	hl		; курсор
	ld	de, 9		; шаг структуры гема
	add	hl, de
	push	hl
		call	chkLastGema2
	jp nz,chkCogeGema2
	pop	hl		; снять курсор (pop rp флагов не трогает, Z от cp цел)
		ret
;----------------------------------------------------
; Смещение X к центру объекта, ширина проверяемой области (ширина героя)
; Смещение Y к центру объекта, высота области (верхняя часть героя)
; Для коллизий с объектами проверяется верхняя часть героя
; с верхним центром объекта
;----------------------------------------------------
itemHitArea:	db 5, 0x11
		db 1, 9


;----------------------------------------------------
; Проверяет, подбирает ли герой кирку
;----------------------------------------------------

chkCogePico:
		ld	a, (itmGSkip)	; гейт (см. itmGate): герой не сдвинулся, кирки не менялись
		or	a
		ret	nz
		ld	a, (objetoCogido) ; #10 = Нож, #20 = Кирка
		and	a
		ret	nz		; Уже несёт что-то


		ld	hl, numPicos
		ld	a, (hl)
		or	a
		ret	z		; Кирок нет

		xor	a
		ld	(ElemEnProceso), a ; Начинает проверку с первой кирки
;  P3: строгая редукция индекса, как в chkCogeGema. Курсор кирки живёт на вершине
;  стека, шаг 5; `xor a / call getPicoData` (107 тактов) заменено чтением курсора.
;  getLocationDE2 сам затирает B (`ld b,a`), остальные регистры не отличаются.
	ld	hl, picosData
	push	hl


chkNextPico:
	pop	hl
	push	hl		; HL = данные текущей кирки
	ld	a, (hl)		; A = байт +0, как вернул бы getPicoData
		call	getLocationDE2	; Проверяет, находится ли в той же комнате, что и герой
	jp nz,chkLastPico	; Нет, переходит к следующей кирке

		and	a		; Активна или уже подобрана?
	jp z,chkLastPico	; Не активна. Переходит к следующей

		call	chkAreaItem	; Проверяет, касается ли герой кирки
	jp nc,chkLastPico	; Нет, переходит к следующей

	pop	hl		; кирка подобрана: выход мимо chkLastPico, снимаем курсор
		ld	a, 4		; SFX подбор предмета
		call	setMusic

		xor	a
		call	getPicoData	; Указатель на данные кирки

		ld	(hl), 0		; Помечает кирку как использованную (деактивирует)
		push	hl
		inc	hl		; Указывает на Y
		call	getMapOffset00	; Получает в HL указатель на карту для координат, на которые указывает HL

		xor	a
		ld	(hl), a		; Стирает кирку с карты
		pop	hl
		dec	hl
		call	drawTile	; Стирает кирку с экрана

		ld	a, (ElemEnProceso) ; Используется, чтобы знать, какой гем или дверь обрабатывается
		ld	(idxPicoCogido), a ; Индекс кирки, подобранной героем
		ld	a, 0x20		; Кирка
		jp	cogeObjeto	; Загружает спрайты героя с киркой

chkLastPico:
	pop	hl		; курсор
	ld	de, 5		; шаг структуры кирки
	add	hl, de
	push	hl
		ld	hl, ElemEnProceso ; Используется, чтобы знать, какой гем или дверь обрабатывается
		inc	(hl)
		ld	a, (numPicos)
		cp	(hl)
	jp nz,chkNextPico
	pop	hl		; снять курсор (pop rp флагов не трогает)
		ret

;----------------------------------------------------
; Получает указатель на данные обрабатываемой кирки
;----------------------------------------------------

getPicoData:
		ld	a, (ElemEnProceso) ; Используется, чтобы знать, какой гем или дверь обрабатывается
		ld	hl, picosData	; Данные кирок
		ld	b, a
		jp	getIndexX4_masB


;----------------------------------------------------
; Проверяет, касается ли герой мумии
; Мумия должна быть жива и в активном состоянии
; Если герой или мумия на лестнице, для проверки коллизии оба должны быть на лестницах
;----------------------------------------------------

chkTocaMomia:
		ld	c, 0		; Начинает с первой мумии

chkNextMomia:
		ld	a, c
		call	getMomiaDat	; Получает указатель на данные мумии
		ld	hl, (pMomiaProceso) ; Указатель на данные обрабатываемой мумии
		ld	a, (hl)
		cp	4		; Идёт, прыгает, падает или на лестнице?
	jp c,chkTocaMomia2	; Да

		cp	7		; Думает?
	jp nz,chkLastACTOR_	; Нет, переходит к следующей мумии

chkTocaMomia2:
		ld	a, (protaStatus) ; Статус героя
		ld	b, a
		cp	3		; На лестнице?
	jp z,chkTocaMomia3	; Да

		ld	a, (hl)		; Статус мумии
		cp	3		; Мумия на лестнице?
	jp nz,chkTocaMomia4	; Нет

chkTocaMomia3:
		ld	a, b
		cp	(hl)		; Оба на лестницах?
	jp nz,chkLastACTOR_	; Нет, тогда касание не проверяется

chkTocaMomia4:
;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ: три `call vec_ix_ofs` с обвязкой il_a/il_tmp2 и
;  push/pop af (~370 тактов) заменены прямой адресацией от (z80_ix) — getMomiaDat кладёт
;  указатель записи мумии и в pMomiaProceso, и в z80_ix, а между его вызовом и этим
;  местом z80_ix никто не пишет (прямой участок сравнения статусов без call).
;  ДОКАЗАТЕЛЬСТВО ЭКВИВАЛЕНТНОСТИ:
;   * записи мумий живут в momiaDat 0xFE4D-0xFEA0 (шаг 22, до 4 записей), смещения <= 6,
;     поэтому L+смещение не переносится через границу страницы -> `add a,l / ld l,a`
;     побайтно равен vec_ix_ofs (его adc в этих данных никогда не срабатывает);
;   * nz-выход (не та комната): A и F те же (то же cp тех же значений); старые HL/D/E
;     там мертвы — chkLastACTOR_ перезаписывает HL и A до чтения, F впервые читается
;     после его собственного cp (inc c не трогает CY, но CY никто не читает), D/E не
;     читаются нигде до следующей записи (getMomiaDat их не касается);
;   * проходной путь: D=Y, E=X, HL=mummyHitArea, B/C не тронуты — как в оригинале;
;     A и F на входе в chkTocaProta мертвы (он начинает с ld a,(ProtaY), первый
;     флаговый оп — sub в chkArea); dec/inc l по дороге меняют только мёртвые флаги;
;   * il_a/il_tmp2 больше не пишутся — это скретч: каждый их потребитель сам пишет
;     до чтения, протухшие значения не читает никто.
;  ~370 -> ~110 тактов на активную мумию в комнате героя, -29 Б.
		ld	hl, (z80_ix)	; HL = запись мумии (== pMomiaProceso)
		ld	a, 255&(ACTOR_ROOM)
		add	a, l
		ld	l, a	; HL = &комната (без переноса, см. выше)
		ld	a, (ProtaRoom)	; Комната, в которой находится герой
		cp	(hl)	; ...против комнаты мумии
	jp nz,chkLastACTOR_	; Не в одной комнате
		dec	l	; ACTOR_ROOM(6) -> ACTOR_X(5)
		ld	e, (hl)	; E = X мумии
		dec	l
		dec	l	; -> ACTOR_Y(3)
		ld	d, (hl)	; D = Y мумии
		ld	hl, mummyHitArea
		call	chkTocaProta	; Проверяет, касается ли герой мумии
	jp c,momiaMataProta	; Да, касаются. Герой погибает

chkLastACTOR_:
		inc	c		; Следующая мумия
		ld	hl, numMomias	; Число мумий в пирамиде
		ld	a, c
		cp	(hl)		; Проверил все мумии?
		jp	nz, chkNextMomia ; Нет

		and	a
		ret

;  === ЕДИНСТВЕННАЯ ТОЧКА ГИБЕЛИ ГЕРОЯ + ЧИТ «GOD MODE» (клавиша G, 2026-08-11) ==========
;  ПОЧЕМУ ЗДЕСЬ И ТОЛЬКО ЗДЕСЬ. Замер по исходнику: flagVivo обнуляется ровно в четырёх
;  местах — momiaMataProta (касание мумии), trampaMataProta (стена-ловушка раздавила),
;  самоубийство по F2 (оно и так под контролем игрока) и конец демо. Игровых смертей,
;  значит, ДВЕ, и обе имели ПОБАЙТНО ОДИНАКОВОЕ тело; они сведены в одну процедуру, а чит
;  гейтит её вход. Это и есть «минимальная реализация»: одна проверка на весь чит.
;  НОЖИ В ЭТОМ ПОРТЕ ГЕРОЯ НЕ УБИВАЮТ — их бросает сам герой (AI_Cuchillos: initCuchillo/
;  lanzaCuchillo/knifeRebota/knifeCae), и ни одна их ветка flagVivo не трогает; chkTocaProta
;  зовут только мумия, рычаг и дверь. Так что «мумии, ножи и стены-ловушки» из задания
;  закрываются этими двумя точками полностью.
;  ФЛАГИ НА ВЫХОДЕ. God-выход отдаёт A=0/Z — РОВНО то же, что отдаёт путь гибели
;  (`xor a` + `ld (nn),a`, который флагов не трогает). Проверять, важны ли флаги
;  вызывателю, не пришлось: у ОБЕИХ процедур штатные «не убил» выходы и так отдают ДРУГОЕ
;  (у мумий chkLastACTOR_ выходит с A=numMomias/NZ, у ловушки — `ret nc` с флагами
;  chkAplastaMuro), то есть вызыватель на флаги опираться не может в принципе.
;  ВХОД vkp_kill — МИМО ЧИТА: им пользуется клавиша D («умереть сейчас»), которая обязана
;  работать И в God mode, иначе из режима бессмертия нет выхода.
momiaMataProta:
		ld	a, (vec_god)
		or	a
		jp	z, vkp_kill
		xor	a		; God mode: как будто касания не было
		ret
vkp_kill:
		ld	a, 0x1D		; Музыка гибели героя
		call	setMusic
		xor	a
		ld	(flagVivo), a	; Убивает героя
		ret


;----------------------------------------------------
; Смещение X к центру мумии, ширина проверяемой области (ширина героя)
; Смещение Y к центру мумии, высота области (высота героя)
; Для коллизий с мумиями проверяется вся область героя
; с центром мумии
;----------------------------------------------------
mummyHitArea:	db 5, 0x0A
		db 8, 0x10


;----------------------------------------------------
; Проверяет, касается ли герой координат
; объекта DE
;----------------------------------------------------

; chkAreaItem и chkTocaProta лежат в хвосте образа (game/kvalley_logic_tail.asm), chkArea встроена в chkTocaProta.

;----------------------------------------------------
; Проверяет, находятся ли координаты DE внутри
; определённой области
;
; DE задаёт координаты проверяемой точки
; E = X точки
; D = Y точки
; К DE применяется смещение, указывающее, какую
; именно точку элемента проверять (например, центр мумии)
;
; BC задаёт координаты проверяемой области
; B = X области
; C = Y области
; Размер области задаётся в HL+1 и HL+3

; HL:
; +0 = Смещение X1
; +1 = Ширина области
; +2 = Смещение Y1
; +3 = Высота области
;
;----------------------------------------------------

chkArea:
		ld	a, b		; X области
		sub	e		; X точки
		sub	(hl)		; Смещение X точки
		inc	hl
		add	a, (hl)		; Ширина области
	ret nc		; Не внутри

		ld	a, c		; Y области
		sub	d		; Y точки
		inc	hl
		sub	(hl)		; Смещение Y точки
		inc	hl
		add	a, (hl)		; Высота области

chkArea2:
		ret

;----------------------------------------------------
;
; Двигает скролл на 4 позиции в зависимости от направления героя
;
; Если сдвинулся на целый экран или изменился 'flagScrolling' — завершает.
;
;----------------------------------------------------

tickScroll:
		ld	hl, waitCounter
		ld	a,(hl)
		sub	4
		ld	(hl),a
		cp	0x0FC
		ret	z		; Дошёл до конца

		ld	a, (sentidoProta) ; 1 = Влево, 2 = Вправо
		rra
		ld	a, (hl)
	jp c,tickScroll2
		sub	0x20
	cpl
	inc a

tickScroll2:
		call	tickScroll3
		ld	a, (flagScrolling)
		and	a
		ret	z
		scf
		ret

;  === СКОРОСТЬ СКРОЛЛА (2026-07-30) =================================================
;  ЗАМЕР ДО: шаг скролла = 6275 инструкций, из них 51% в vec_su_fixup (vfx_loop 36.1% +
;  vfx_next 14.8%), а записей в невидимую p3 (слоты save-under) 17096 против 4832 в
;  видимую p0 — то есть втрое больше возни с сохранёнками, чем собственно рисования.
;  ПОЧЕМУ ЭТО ЗРЯ: fixup подновляет фон, сохранённый под спрайтами, чтобы стирание не
;  воскрешало устаревшую картинку. Но при скролле экран перерисовывается ЦЕЛИКОМ, спрайты
;  скрыты, и все слоты через 8 шагов всё равно недействительны. Мы 736 раз аккуратно
;  правили копии, которые тут же выбрасываются.
;  РЕШЕНИЕ: объявить слоты пустыми на время шага — у vec_su_fixup есть быстрый выход
;  `ld a,(vsu_any) / or a / ret z`, поэтому он становится бесплатным. Обнуляем ещё и
;  valid каждой слот-страницы (0xE000+idx*256), иначе после скролла Pass-R восстановил бы
;  устаревший фон. 22 записи вместо 17096.
tickScroll3:
		push	af
		xor	a
		ld	(vsu_any), a	; слотов нет -> fixup выходит на первой инструкции
		ld	hl, 0x0E000	; обнулить valid у всех 21 слот-страницы
		ld	b, 21
tsc_inval:
		ld	(hl), a
		inc	h
		dec	b
		jp	nz, tsc_inval
		pop	af
		ld	b, a		; Смещение относительно текущей комнаты
		ld	hl, ProtaRoom	; Старшая часть координаты X. Указывает комнату пирамиды
		ld	a, (sentidoProta) ; 1 = Влево, 2 = Вправо
		cp	3
	jp nz,tickScroll4
		ld	a, 1

tickScroll4:
		add	a, (hl)
		cp	3
		ld	a, 0x20
	jp z,tickScroll5
		xor	a

tickScroll5:
		add	a, b
		ld	de, MapaRAM
		call	ADD_A_DE	; Применяет смещение
;  === ШАГ СКРОЛЛА = СДВИГ + 4 СТОЛБЦА (2026-07-30) ================================
;  Раньше здесь стоял `jp drawRoom` — полная перерисовка всех 704 тайлов окна карты.
;  Теперь: 28 столбцов ПЕРЕЕЗЖАЮТ сдвигом плоскостей (vec_scroll_shift, ~17 т/байт),
;  и из карты рисуются только 4 новых столбца тем же рендерером, что и вход в комнату
;  (vec_nr_win) => 88 блитов вместо 704. Подробности схемы — в src/v06c/vec_scroll.asm.
		push	de		; окно карты (сдвиг клоббит DE; хайджек внутри, стек цел)
		call	vec_scroll_shift
		pop	de
		ld	a, (sentidoProta) ; бит0: 1 = влево -> новые столбцы 0..3
		rra
		ld	a, 0
		jp	c, tickScroll6
		ld	a, 28		; вправо -> новые столбцы 28..31
tickScroll6:
		ld	(vec_nr_c0), a
		add	a, 4
		ld	(vec_nr_cend), a
		ex	de, hl		; HL = база ряда 0 окна карты
		jp	vec_nr_win	; дорисовать новые столбцы (22 ряда x 4 стб)


;  [удалено 2026-07-30] drawRoom/drawRoom2/drawRoom3 — полная перерисовка окна карты
;  (22 ряда x 32 столбца через vec_text_blit). Единственным её вызывателем был шаг скролла
;  (tickScroll5 проваливался сюда); теперь шаг — это сдвиг плоскостей + 4 столбца через
;  vec_nr_win, и процедура осталась без читателей. Вход в комнату рисует vec_nat_room.
;----------------------------------------------------
;
; Получает паттерн/тайл, соответствующий "ID" карты
; In:  A = Map ID
; Out: A = Tile ID
;
;----------------------------------------------------

getTileFromID:
		push	hl
		ld	c, a
		rra
		rra
		rra
		and	0x1E		; Старший nibble указывает группу тайлов
		ld	hl, indexTiles
		call	getIndexHL_A
		ld	a, c
		and	0x0F		; Младший nibble указывает индекс внутри группы
		call	ADD_A_HL
		ld	a, (hl)		; Получает паттерн, соответствующий этому ID карты
		pop	hl
		ret



indexTiles:	dw tilesNULL
		dw tilesPlataforma	; #10
		dw tilesEscalera	; #20
		dw tilesCuchillo	; #30
		dw tilesGemas		; #40
		dw tilesGiratoria	; #50
		dw tilesSalida		; #60
		dw tilesSalida2		; #70
		dw tilePico		; #80
	
		dw tilesAgujero		; #D0

tilesNULL:	db    0
		db    0

tilesPlataforma:	db    0
		db    0			; Пусто
		db 0x40
		db 0x40			; Кирпич
		db 0x41			; Нижняя граница
		db 0x73			; Начало лестницы вниз-вправо (левая часть)
		db 0x74			; Начало лестницы вниз-вправо (правая часть)
		db 0x83			; Начало лестницы вниз-влево (правая часть)
		db 0x82			; Начало лестницы вниз-влево (левая часть)
		db 0x40			; Целый кирпич стены-ловушки
		db 0x42			; Одиночный кирпич стены-ловушки
		db 0x43			; Полуразбитый кирпич 1
		db 0x44			; Полуразбитый кирпич 2
		db 0x44


tilesEscalera:	db 0x75
		db 0x76			; Ступени вниз-вправо
		db 0x85
		db 0x84			; Ступени вниз-влево


tilesCuchillo:	db 0x4B
		db 0x4B
		db 0x4B			; Нож на полу


tilesGemas:	db 0x51
					; Верхний блеск
		db 0x52			; Блеск гема слева
		db 0x53			; Блеск гема справа
		db 0x86			; Тёмно-синий гем
		db 0x87			; Светло-синий гем
		db 0x88			; Пурпурный гем
		db 0x89			; Жёлтый гем
		db 0x8A			; Зелёный гем
		db 0x8B			; Серый гем


tilesGiratoria:	db 0x68
		db 0x69			; Вращающаяся дверь слева->направо
		db 0x78
		db 0x77			; Вращающаяся дверь справа->налево


tilesSalida:	db 0x6C
		db 0x7B
		db 0x6D
		db 0x7C
		db 0x6E
		db 0x7D
		db 0x63			; Жёлтая верхняя внутренняя часть выхода 1
		db 0x64			; Жёлтая верхняя внутренняя часть выхода 2
		db 0x65
		db 0x66
		db 0x67			; Лестницы
		db 0x6F			; Закрывающиеся кирпичи
		db 0x5F
		db 0x60
		db 0x7E
		db 0x70


tilesSalida2:	db 0x71
		db 0x80
		db 0x7F
		db 0x72
		db 0x61
		db 0x62
		db 0x81
		db 0x5C			; Рычаг вниз
		db 0x5D			; Рычаг вверх
		db 0x5E			; Нижняя часть рычага

tilePico:	db 0x4C

tilesAgujero:	db	0x4e	
	.include "../res/res_maps.asm"	; MapStage1-15: сжатые карты пирамид (исходные адреса ROM)


;----------------------------------------------------
; Помечает пирамиду как пройденную
; HL = Пройденные пирамиды
; DE = Маска текущей пирамиды
;----------------------------------------------------

setPiramidClear:
		ld	c, (hl)
		inc	hl
		ld	b, (hl)
		ld	a, b
		or	d
		ld	(hl), a
		dec	hl
		ld	a, c
		or	e
		ld	(hl), a
		ret


;----------------------------------------------------
; Возвращает в DE активный бит, соответствующий текущей пирамиде
;----------------------------------------------------

calcBitMask:
		ld	de, 1		; Возвращает в DE активный бит, соответствующий текущей пирамиде
		ld	a, (piramideActual)
		ld	b, a

calcBitMask2:
		dec	b
		ret	z
	ld (il_a),a
	ld a,e
	add a,a
	ld e,a
	ld a,(il_a)
	ld (il_a),a
	ld a,d
	rla
	ld d,a
	ld a,(il_a)
	jp calcBitMask2

;----------------------------------------------------
; AI гемов
;----------------------------------------------------

AI_Gemas:
;  P2: пред-скан статусов. Тело цикла делает работу ТОЛЬКО при статусе гема = 2
;  (все прочие ветки jumpIndex ведут в gemaDoNothing), а статус 2 выставляется в
;  ЕДИНСТВЕННОМ месте всего образа — chkCogeGema. Практически на каждом тике проход
;  холостой: N итераций по ~230 тактов ради ничего. Пред-скан читает те же байты
;  (datosGemas+1, шаг 9 = тот же адрес, что даёт getGemaDat+inc hl), нового состояния
;  не заводит и при отсутствии статуса 2 воспроизводит хвост холостого прохода
;  ТОЧНО: ElemEnProceso = gemasTotales, A = gemasTotales, B = gemasTotales-1,
;  HL = gemasTotales(адрес), Z=1 — всё это делает за нас chkLastGema, DE/C не тронуты.
	ld	a, (gemasTotales)
	or	a
	jp	z, aig_full	; вырожденный случай — общим путём, один в один
	push	de		; холостой проход DE не трогает — вернём как было
	ld	b, a		; счётчик гемов
	ld	hl, datosGemas+1 ; Status первого гема
	ld	de, 9		; шаг структуры гема
aig_scan:
	ld	a, (hl)
	cp	2		; есть работа?
	jp	z, aig_hit
	add	hl, de
	dec	b
	jp	nz, aig_scan
	pop	de
	ld	a, (gemasTotales)
	dec	a
	ld	b, a		; B == как после последнего getIndexX9
	ld	(ElemEnProceso), a
	jp	chkLastGema	; хвост холостого прохода: inc -> totales, cp -> Z, ret
aig_hit:
	pop	de
aig_full:
		xor	a		; Начинаем с первого
		ld	(ElemEnProceso), a ; Используется, чтобы знать, какой гем или дверь обрабатывается

nextGema:
		xor	a
		call	getGemaDat	; Получает указатель на данные обрабатываемого гема
		inc	hl
		ld	a, (hl)		; Status
		call	jumpIndex
		dw chkLastGema
		dw chkLastGema
		dw gemaCogida		; 2 = Стирает гем с экрана и с карты и увеличивает число собранных гемов
		dw chkLastGema	; 3 = Неактивен

;----------------------------------------------------
; Стирает гем и блески как с экрана, так и с карты
; Увеличивает число собранных гемов
; Сообщает ножам, что нужно обновить фон, на котором они лежат
;----------------------------------------------------

gemaCogida:
		xor	a
		call	getGemaDat	; Получает указатель на данные обрабатываемого гема
		ld	a, (hl)
		and	0x0F0
		ld	(hl), a		; Деактивирует гем на карте

		inc	hl
		inc	(hl)		; Переходит к следующему состоянию

		inc	hl
		ld	a, (hl)		; Y
		sub	8
		ld	d, a		; Координата Y блеска над гемом
		inc	hl
		inc	hl
		ld	e, (hl)		; X
		call	coordVRAM_DE	; Получает адрес VRAM этих координат в name table
		xor	a		; Пустой тайл
		call	vec_text_blit	; NAT: стирает верхний блеск гема -> фреймбуфер

		ld	bc, 0x1F		; Расстояние до левого блеска (тайл снизу слева)
		add	hl, bc
		ld	de, eraseData	; Пустые тайлы
		ld	bc, 0x103	; Ширина 3 тайла
		call	vec_blit_rect	; NAT: стирает блеск/гем/блеск -> фреймбуфер

		ld	a, 2		; Смещение переменной Y
		call	getGemaDat
		call	getMapOffset00	; Получает в HL указатель на карту для координат, на которые указывает HL
		ld	de, eraseData
		call	putBrillosMap	; Стирает блески с карты

		ld	hl, gemasCogidas
		inc	(hl)		; Увеличивает число собранных гемов

		call	knifeUpdateBack	; Заставляет ножи обновить тайл фона, на котором они лежат
					; Нож мог лежать на блеске гема, и теперь, когда блеск убран, фон надо обновить
		jp	chkLastGema

;----------------------------------------------------
; Начальные значения ножа при броске
; Дробная скорость, скорость X...
;----------------------------------------------------
knifeDataInicio:	db    0
		db    4			; 2×2: нож 25 Гц = 2 px/тик оригинала

;  [ПЕРЕНЕСЕНО, -9 Б] eraseData (9 нулей) теперь размечен поверх ПУСТЫХ ГЛИФОВ шрифта
;  (тайлы 0x1C-0x1F в vec_font_rom, см. комментарий там): дублировать нули незачем.


;----------------------------------------------------
; Паттерны для отрисовки того, как кирка пробивает дыру
; Индекс вычисляется прибавлением к этому списку значения счётчика анимации
; Этот счётчик уменьшается по 3 и начинается с #15
; Первое используемое значение — #12 (тайл = #43)
; Анимация: #43, #44, 0, #43, #44, 0, 0
;----------------------------------------------------
tilesAnimCavar:	db 0
		db 0, 0, 0
		db 0, 0, 0x44
		db 0, 0, 0x43
		db 0, 0, 0
		db 0, 0, 0x44
		db 0, 0, 0x43

;----------------------------------------------------
; Проверяет, обработаны ли все гемы
;----------------------------------------------------
	
chkLastGema:
		call	chkLastGema2	; Все гемы обработаны?
		ret	z		; Да
		jp	nextGema	; Нет, продолжает со следующим
chkLastGema2:		
		ld	hl, ElemEnProceso ; Используется, чтобы знать, какой гем или дверь обрабатывается
		inc	(hl)		; Следующий гем
		ld	a, (hl)
		dec	hl
		cp	(hl)		; Все обработаны?
		ret
	
;----------------------------------------------------
; Возвращает в HL указатель на данные гема, а в A — указанную переменную
; In:
;   A = Смещение к переменной структуры
; Out:
;  HL = Указатель на указанную переменную обрабатываемого гема
;   A = Значение переменной
;----------------------------------------------------


getGemaDat:
		ld	hl, datosGemas	; 0 = Цвет/активность. Старший nibble — цвет. Младший — активен (1) или нет (0)
					; 1 = Status
					; 2 = Y
					; 3 = дробная часть X
					; 4 = X
					; 5 = комната
					; 6-8 =	0, 0, 0
		call	ADD_A_HL
		ld	a, (ElemEnProceso) ; Используется, чтобы знать, какой гем или дверь обрабатывается

getIndexX9:
		ld	b, a

getIndexX8_masB:
		add	a, a

getIndexX4_masB:
		add	a, a
		add	a, a
		add	a, b
		add	a, l
		ld	l, a
		jp	nc, vec_aah_x4
		inc	h
vec_aah_x4:
		ld	a, (hl)
		ret
;----------------------------------------------------
;
; Отправляет в VRAM данные, на которые указывает DE.
; B = Высота
; C = Ширина
;
;----------------------------------------------------

;  [СНЯТО, 17 Б] DEtoVRAM_NXNY — прямоугольный блит B строк x C столбцов через VDP.
;  Заменён нативным vec_blit_rect (vec_blit.asm) на всех сайтах (титул, дверь бонусной
;  пирамиды); на имя ссылался только собственный цикл процедуры, внешних вызывателей нет.


;----------------------------------------------------
; Помещает на карту блески гема
; HL = Указатель на позицию гема на карте
; DE = Указатель на паттерны блесков
;----------------------------------------------------


putBrillosMap:
		ld	bc, -0x60	; Размер ряда карты (3 экрана по 32 тайла)
		add	hl, bc		; Верхний ряд
		ex	de, hl
	ld a,(hl)	; Ставит верхний блеск гема
	ld (de),a
	inc hl
	inc de
	dec bc
		ld	bc, 0x5E		; Расстояние до левого блеска
		ex	de, hl
		add	hl, bc
		ex	de, hl
		ld	c, 3
	call vec_ldir_fwd	; Копирует левый блеск, пробел, правый блеск
		ex	de, hl
		ret

;----------------------------------------------------------------
;
; Логика дверей входа и выхода пирамиды
;
; Дверь, через которую вошли в пирамиду, имеет status 1 (#10)
; Двери выхода имеют status 0, если пирамида ранее не пройдена
; Если гемы уже были собраны, двери имеют status 8 (#80)
; Проверяет, собраны ли все гемы
; Анимирует двери при входе и выходе из пирамиды
; Проверяет, коснулся ли рычага, открывающего выход по завершении фазы
; Если пирамида уже посещена, выход не скрывается
;
;----------------------------------------------------------------

; AI_Salidas: пред-скан дверей лежит в хвосте образа (game/kvalley_logic_tail.asm), общий путь — ниже.
as_full:
		xor	a
		ld	(ElemEnProceso), a ; Используется, чтобы знать, какой гем или дверь обрабатывается
		ld	(puertaCerrada), a ; Равно 1 при закрытии выхода

chkNextExit:
		ld	hl, chkLastExit	; Проверяет, проверены ли все четыре выхода
		push	hl		; Кладёт эту функцию в стек, чтобы она выполнилась при выходе

		xor	a
		call	getExitDat	; Получает указатель на обрабатываемый выход
		inc	a		; Его статус = #ff?
		ret	z		; Такого выхода нет

		inc	hl
		inc	hl
		inc	hl
		inc	hl
		ld	a, (hl)		; Статус двери
		rra
		rra
		rra
		rra
		and	0x0F		; Старший nibble — статус. Младший — счётчик анимации или подстатус
		call	jumpIndex


		dw chkAllGemas		; 0 = Проверяет, собраны ли все гемы
		dw paintEntrada		; 1 = Рисует входную дверь пирамиды
		dw chkOpenExit		; 2 = Проверяет касание рычага, открывающего дверь
		dw openCloseExit	; 3 = Открывается выход
		dw chkSalePiram		; 4 = Дверь открыта. Ждёт выхода из пирамиды
		dw openCloseExit	; 5 = Закрывается выход
		dw doNothing3		; 6 = Ничего не делает. Держит дверь в ожидании шторки
		dw finAnimEntrar	; 7 = Убирает или оставляет дверь в зависимости от того, была ли пирамида уже посещена
		dw paintCerrada		; 8 = Дверь остаётся видимой и закрытой

;----------------------------------------------------------------
;
; Проверяет, собраны ли все гемы фазы
;
; Эту проверку делает каждая существующая дверь (обычно входная и выходная)
; Так что обе двери переходят в состояние 1 при прохождении фазы.
;
; Когда собраны все:
; - фаза помечается как завершённая
; - звучит музыка "stage clear"
; - убираются вращающиеся двери
; - дверь переходит в status 1 (#10)
;----------------------------------------------------------------

chkAllGemas:
		ld	hl, gemasCogidas ; Проверяет, собраны ли все гемы
		ld	a, (hl)		; Собранные гемы
		inc	hl
		cp	(hl)		; Число гемов в этой пирамиде
		ret	nz		; Собраны не все

		ld	a, 1
		ld	(flagStageClear), a

		ld	a, 0x94
		call	setMusic	; Музыка "stage clear"

		call	quitaGiratorias	; Убирает вращающиеся двери
		ld	a, 4		; Смещение к байту статуса двери
		call	getExitDat	; Получает указатель на обрабатываемый выход
		ld	(hl), 0x10	; Status = #10

doNothing3:
		ret


;----------------------------------------------------------------
;
; Рисует дверь открытой, если входим в пирамиду
; или закрытой, если она только что появилась после сбора гемов
; Переводит дверь в status 2 (#20) — проверка касания героем рычага, открывающего дверь
;----------------------------------------------------------------

paintEntrada:
		ld	a, (GameStatus)
		cp	4		; Входит в пирамиду?
		push	af
		ld	a, 2		; Кадр открытого выхода
	jp z,paintEntrada2
		pop	af

paintCerrada:
		push	af
		xor	a		; Кадр закрытого выхода

paintEntrada2:
		call	getAnimExit	; Возвращает в DE указатель на тайлы, образующие выход
		ld	a, 4		; Смещение к состоянию двери
		call	getExitDat	; Получает указатель на обрабатываемый выход
		ld	(hl), 0x20	; Меняет состояние на #20
		call	drawPuerta	; В DE передаётся указатель на тайлы, образующие выход
		pop	af
		ret	z		; Входит в пирамиду (анимация спуска по лестнице)

;----------------------------------------------------
; Заставляет ножи сохранить фон, на котором они лежат
; Так фон не портится, пока открывается или закрывается дверь
; или когда подбирается гем
;----------------------------------------------------

knifeUpdateBack:
		ld	hl, knifeEnProceso ; Сообщает лежащим на полу ножам, что нужно сохранить тайл фона под ними
		ld	(hl), 0
		inc	hl
		ld	b, (hl)		; Число ножей фазы

status0Knife2:
		xor	a		; Смещение status ножа
		call	getKnifeData
		ld	a, (hl)		; Status
		dec	a		; Равно 1 (лежит)?
	jp nz,status0Knife3
		ld	(hl), a		; Переводит в 0

status0Knife3:
		ld	hl, knifeEnProceso
		inc	(hl)		; Следующий нож
	dec b
	jp nz,status0Knife2
		ret

;----------------------------------------------------------------
; Проверяет, коснулся ли рычага, открывающего выход
; Герой должен прыгать и касаться рычага верхней частью тела (рукой?)
; При открытии дверь переходит в состояние 3 (#30) = Дверь открывается
;----------------------------------------------------------------

chkOpenExit:
		ld	a, (protaStatus) ; Состояние героя
		cp	1		; Прыгает?
		ret	nz		;  Нет

		call	chkSameScreenS	; Проверяет, находится ли выход на экране героя
		ret	nz		; Нет

		ld	a, d		; Y
		sub	8		; Y - 8
		ld	d, a
		ld	a, e		; X
		sub	0x10		; X - 16
		ld	e, a
		push	hl
		ld	hl, palancaArea
		call	chkTocaProta	; Проверяет, касается ли герой рычага
		pop	hl
		ret	nc		; Не касается рычага, открывающего дверь

		ld	a, 1
		ld	(flagStageClear), a

		ld	a, 0x14
		ld	(timer), a
		inc	hl
		ld	(hl), 0x30	; Состояние «дверь открывается»
	jp openCloseExit2


;----------------------------------------------------------------
;
; Открывает или закрывает дверь пирамиды
;
; По окончании открытия после нажатия рычага:
; - переходит в состояние 4 = Ждёт, пока герой выйдет из пирамиды
;
; По окончании закрытия:
; - при входе в пирамиду переходит в состояние 7 (#70) = может оставить дверь закрытой, если гемы уже собраны, или убрать её, если фаза ещё не пройдена
; - при выходе переходит в состояние 6 (#60) = ждёт чёрную шторку
;----------------------------------------------------------------

openCloseExit:
		ld	a, 0x1F
		call	tmrAnd	; [door-wall r3] маска под 25 Гц (демо: прежняя)
		ret	nz		; Обрабатывает один кадр из 32. Ждёт около 0.5с.

openCloseExit2:
		call	knifeUpdateBack	; Сообщает лежащим на полу ножам, что нужно сохранить тайл фона под ними
		ld	a, 4		; Смещение к status двери
		call	getExitDat	; Получает указатель на обрабатываемый выход
		inc	(hl)		; Увеличивает подстатус двери

		ld	a, (hl)		; Счётчик анимации
		and	0x0F
		cp	4		; Анимация открытия или закрытия закончилась?
	jp nz,openCloseExit5	; Ещё нет

		ld	a, (GameStatus)
		cp	4		; Входит в пирамиду?
	jp nz,openCloseExit3	; Нет, выходит.

		ld	(hl), 0x70	; Состояние двери: закончила закрываться. Смотрит, оставить её или убрать
	jp openCloseExit4

openCloseExit3:
		ld	a, (hl)		; Status двери
		add	a, 0x10		; Переходит к следующему состоянию
		ld	(hl), a		; Если открывается для выхода после нажатия рычага — переходит в состояние 4
					; Если закрылась после выхода — переходит в состояние 6: дверь остаётся закрытой в ожидании шторки

openCloseExit4:
		ld	hl, puertaCerrada ; Равно 1 при закрытии выхода
		inc	(hl)
		jp	vec_hero_redraw	; 0x70: тайлы уже лежат, пачка на вложенном ISR не идёт

openCloseExit5:
		ld	a, (hl)		; Status
		and	0x0F0
		cp	0x50		; Дверь закрывается?
		ld	a, (hl)
	jp nz,abreSalida	; Нет, открывается

		and	0x0F		; Оставляет только счётчик анимации
		sub	4
	cpl	; При закрытии подсостояния идут от 0 до 3
	inc a

abreSalida:
		and	0x0F
		dec	a
		cp	1
	jp nz,pintaSalida

		push	af
		ld	a, 0x8D		; SFX открытия/закрытия двери
		call	setMusic	; Музыка при открытии или закрытии двери (при входе не слышна — приоритет у уже играющей)
		pop	af

pintaSalida:
		call	getAnimExit	; Возвращает в DE указатель на тайлы, образующие выход
		jp	drawPuerta


;----------------------------------------------------------------
;
; Дверь открыта и готова к выходу героя из пирамиды
; Ждёт касания лестницы для выхода
; В зависимости от двери выхода берётся направление (север, юг, восток или запад)
; Дверь/направление входа в пирамиду противоположна той, через которую вышли из предыдущей
; (Напр.: если вышли через северную дверь пирамиды, входим через южную дверь следующей)
; Ставит 4 спрайта перекрывающимися парами (16x32), чтобы нарисовать правую часть двери, за которой проходит герой
;----------------------------------------------------------------

chkSalePiram:
		call	chkSameScreenS	; Проверяет, находится ли выход на экране героя
		ret	nz		; Дверь не в одной комнате с героем
; DE = YX

		ld	hl, salidaArea
		call	chkTocaProta
		ret	nc		; Не вошёл в выход

		call	quitaMomias	; Прячет мумий

	push bc
	push de
	push hl
		ld	a, 4		; Смещение status двери
		call	getExitDat	; Получает указатель на обрабатываемый выход
		ld	(hl), 0x50	; Меняет статус на 5 (#50) = Закрытие двери

		inc	hl
		ld	bc, 2
		ld	de, piramideDest
	call vec_ldir_fwd	; Копирует пирамиду назначения и дверь, через которую входим (стрелка карты)
	pop hl
	pop de
	pop bc

		ld	a, (ElemEnProceso) ; Используется, чтобы знать, какой гем или дверь обрабатывается
		inc	a
		cp	1		; Вверх?
	jp z,setFlechaSalida

		dec	a
		add	a, a
		cp	6
	jp nz,setFlechaSalida
		ld	a, 8

setFlechaSalida:
		ld	(puertaSalida),	a ; 1 = Вверх, 2 = Вниз, 4 = Влево, 8 = Вправо

		call	setSprPuerta	; спрайты правой части двери (общее с initDoorProta3)

		ld	a, 0x20
		call	setMusic	; Тишина

		xor	a
		ld	(statusEntrada), a ; Статус входа = 0 = Выход в пирамиде
		inc	a
		ld	(flagEntraSale), a ; 1 = Вход или выход из пирамиды. Выполняется особая логика для этого случая
		inc	a
		ld	(sentidoProta),	a ; Направление вправо
		pop	hl
		pop	hl
		ret

;  ===== СПРАЙТЫ ПРАВОЙ ЧАСТИ ДВЕРИ — ОДИН НА ДВА ВЫЗОВА (2026-08-06) ================
;  Блок стоял ДВАЖДЫ побайтно одинаковым (33 Б x2): в setFlechaSalida (выход по лестнице)
;  и в initDoorProta3 (вход в пирамиду). Различались только адреса в `jp nz` собственных
;  петель, поэтому механический скан повторов показывал совпадение лишь 23 Б — код же
;  совпадает целиком, включая иммедиаты (0x10 = 16, 0x11 = 17).
;  ЦЕНА: 66 Б -> 40 Б, экономия 26 Б. Тактов +27 на вызов (call+ret), оба вызова холодные:
;  один раз на вход в пирамиду и один на выход по лестнице.
;  вход: D = Y центра двери, E = X центра двери. Клоббер A/BC/DE/HL — как было при инлайне
;  (у обоих вызывающих после блока идёт `xor a`/`ld a,imm`, регистры не переживают его и
;  в исходной версии).
setSprPuerta:
		ld	hl, sprAttrib	; Таблица атрибутов спрайтов в RAM (Y, X, Spr, Col)
		ld	a, 0x10
		add	a, e		; X + 16
		ld	e, a
		ld	a, d
		sub	0x11
		ld	d, a		; Y - 17

		ld	b, 2		; 16x32 Два последовательных спрайта по Y

setSprPuerta1:
		ld	c, 2		; 2 перекрывающихся спрайта

setSprPuerta2:
		ld	(hl), d		; Y спрайта
		inc	hl
		ld	(hl), e		; X спрайта
		inc	hl
		inc	hl
		inc	hl		; Указатель на атрибуты следующего спрайта
		dec	c
	jp nz,setSprPuerta2	; Второй перекрывающийся спрайт

		ld	a, d
		add	a, 0x10
		ld	d, a		; Y = Y	+ 16
	dec b
	jp nz,setSprPuerta1
		ret

;----------------------------------------------------
;
; При входе в новую пирамиду убирает дверь
; Если уже бывал здесь — оставляет её, чтобы можно было выйти
;
;----------------------------------------------------

finAnimEntrar:
		call	chkPiramPasada	; Проверяет, бывал ли уже герой в пирамиде, в которую входит
		push	af
		ld	a, 4		; Смещение статуса
		call	getExitDat	; Получает указатель на обрабатываемый выход
		pop	af
		ld	(hl), 0		; Состояние, скрывающее дверь и проверяющее, собраны ли все гемы
	jp z,borraSalida

		ld	(hl), 0x20	; Состояние, оставляющее дверь видимой и ждущее, пока герой коснётся рычага, чтобы открыть её
		ret

borraSalida:
		ld	de, eraseData
	jp drawPuerta

;----------------------------------------------------
; Получает указатель на структуру обрабатываемого выхода
;----------------------------------------------------

getExitDat:
		ld	hl, pyramidDoors ; Получает указатель на обрабатываемый выход
		call	ADD_A_HL
		ld	a, (ElemEnProceso) ; Используется, чтобы знать, какой гем или дверь обрабатывается
		jp	getHL_Ax7	; Возвращает HL + A*7 и A=(HL)

chkLastExit:
		ld	hl, ElemEnProceso ; Проверяет, проверены ли уже все четыре выхода
		inc	(hl)
		ld	a, 4
		cp	(hl)
		jp	nz, chkNextExit
		ret


;----------------------------------------------------
; Рисует дверь выхода/входа
; In:
;  DE = Тайлы, образующие дверь
;----------------------------------------------------

drawPuerta:
		xor	a
		call	getExitDat	; Получает указатель на обрабатываемый выход
		ld	bc, 0x0F0F8	; Смещение X-16, Y-8
		push	de
		call	getMapOffset	; Получает в HL адрес карты, соответствующий координатам
		pop	de
		ex	de, hl
		push	hl

		ld	b, 3		; Высота двери в паттернах

drawPuerta2:
		push	bc
		ld	bc, 5		; Ширина двери в паттернах
	call vec_ldir_fwd

		ld	a, 0x5B		; Смещение к нижнему ряду двери в карте RAM
		call	ADD_A_DE
		pop	bc
	dec b
	jp nz,drawPuerta2

		xor	a
		call	getExitDat	; Получает указатель на обрабатываемый выход
		dec	hl
		call	getLocationDE2	; На том же экране, что и герой? (видна?)
		pop	hl
		ret	nz		; Рисовать её не нужно

		push	hl
		call	coordVRAM_DE	; Вычисляет указатель на таблицу имён для координат в DE
		pop	de
		ld	bc, -0x22
		add	hl, bc

		ld	b, 3		; Высота в паттернах

drawPuerta3:
		ld	c, 5		; Ширина в паттернах

drawPuerta4:
		push	bc
		ld	a, (de)		; Тайл двери
		call	getTileFromID	; Получает соответствующий ему паттерн
		call	vec_text_blit	; NAT: прямой blit двери -> framebuffer (было WRTVRM->dirty)
		inc	hl
		inc	de
		pop	bc
		dec	c
		dec	c
		inc	c
	jp nz,drawPuerta4

		ld	a, 0x1B		; Расстояние в VRAM до нижнего ряда двери (#20 - 5)
		call	ADD_A_HL
	dec b
	jp nz,drawPuerta3
		ret	; не vec_hero_redraw: vfr_gate уже чинит слоты с конца (створка сверху)


;----------------------------------------------------
; Проверяет, находится ли выход в текущей комнате
; и получает его координаты.
; Out:
;  D = Y
;  E = X
;----------------------------------------------------

chkSameScreenS:
		xor	a		; Проверяет, находится ли выход на экране героя
		call	getExitDat	; Получает указатель на обрабатываемый выход
		dec	hl
		jp	getLocationDE2



;----------------------------------------------------
; Возвращает в DE указатель на паттерны, образующие
; кадр двери, указанной в A
;----------------------------------------------------

getAnimExit:
		add	a, a		; Возвращает в DE указатель на тайлы, образующие выход
		ld	hl, idxAnimExit
		call	getIndexHL_A
		ex	de, hl
		ret


;----------------------------------------------------
; Смещение X координаты рычага, проверяемая ширина героя
; Смещение Y рычага, проверяемая высота героя
;
; Проверяется только верхняя часть героя. Так кажется, что он бьёт рукой в прыжке
;----------------------------------------------------
palancaArea:	db 8, 0x10
		db 3, 5

;----------------------------------------------------
; Точка, проверяемая, чтобы узнать, вышел ли герой из пирамиды
;----------------------------------------------------
salidaArea:	db 1, 2
		db 4, 6

idxAnimExit:	dw animExitClosed	; ...
		dw animExitClosing
		dw animExitOpen

animExitClosed:	db  0x77,   0, 0x60, 0x61,	  0
		db  0x79,   0, 0x62, 0x63,	  0
		db    0,   0, 0x64, 0x65,	  0

animExitClosing:	db  0x78, 0x6B, 0x6C, 0x6D,	0x6E
		db  0x79, 0x6F, 0x70, 0x71,	0x72
		db    0, 0x73, 0x74, 0x75,	0x76

animExitOpen:	db  0x78, 0x60, 0x66, 0x67,	0x61
		db  0x79, 0x62,	0, 0x68,	0x63
		db    0, 0x64, 0x69, 0x6A,	0x65


;----------------------------------------------------
; Логика стен-ловушек
; Пока ловушка не активирована, проверяется, проходит ли герой через её позицию, чтобы её активировать
; После активации ищется потолок, от которого стена начинает закрываться.
; Стена опускается по 4 пикселя, поэтому рисуются целые кирпичи или только верхняя часть в зависимости от позиции
; Если сталкивается с предметом — останавливается, пока не сможет продолжить
; Если сталкивается со стеной — ловушка считается завершённой
;----------------------------------------------------

MurosTrampa:
		ld	hl, muroTrampProces
		ld	(hl), 0		; Начинает с первой :P
		inc	hl
		ld	a, (hl)		; Число стен-ловушек в пирамиде
		or	a
		ret	z		; Нет ни одной

chkNextTrampa:
		ld	hl, chkLastMuro
		push	hl		; Кладёт в стек процедуру, проверяющую, обработаны ли все стены-ловушки

		xor	a
		call	getMuroDat
		and	a		; Активирована ли эта стена-ловушка?
		jp	z, chkActivaTrampa ; Нет — проверяет, активирует ли её герой

		dec	a
		ret	nz		; Эта стена уже полностью закрылась

		ld	a, 0x1F
		call	tmrAnd	; [door-wall r3] маска под 25 Гц (демо: прежняя)
		ret	nz		; Стена движется каждые #20 итераций

		inc	hl
		ld	a, (hl)		; Y стены
		add	a, 4		; Движется на 4 пикселя вниз
		ld	(hl), a		; Обновляет Y стены
		and	7		; Y кратен 8? (рисовать половину кирпича или целый?)
		ld	c, 0x19		; Map ID целого кирпича
	jp nz,murosTrampa2

		inc	c		; Map ID половинного кирпича (4 пикселя высотой)

murosTrampa2:
		push	hl
		call	getMapOffset00	; Получает в HL указатель на карту для координат, на которые указывает HL
		ex	de, hl
		pop	hl
		ld	a, (hl)		; Y стены
		and	7		; Опустилась на целый тайл или на половину?
	jp nz,murosTrampa3	; На половину

		ld	a, (de)		; Тайл карты
		and	a		; Пусто?
	jp nz,trampaChoca	; Нет — проверяет, с чем столкнулась

murosTrampa3:
		call	drawTrampa
		ld	hl, protaStatus	; Данные героя
		ld	a, (hl)		; Статус героя
		or	a		; Выполняет какое-то особое действие?
		ret	nz		; Да

		ld	hl, ProtaY
		ld	bc, 0x500	; Смещение X+5, Y+0
		call	chkAplastaMuro	; Проверяет, раздавливает ли стена героя
	jp c,trampaMataProta	; Да, раздавливает

		ld	b, 0x0B		; Смещение X+11, Y+0
		call	chkAplastaMuro	; Проверяет, раздавливает ли героя
		ret	nc		; Нет

;  Тело было ПОБАЙТНО тем же, что у momiaMataProta; сведено в одну процедуру (-7 Б), там же
;  стоит гейт God mode. Хвостовой переход, оба конца — `ret`, регистры/флаги не тронуты.
trampaMataProta:
		jp	momiaMataProta

;----------------------------------------------------
; Проверяет, сталкивается ли стена с платформой или с предметом
; Если сталкивается с предметом — останавливается, пока тот не исчезнет
; Если сталкивается с платформой — ловушка считается завершённой
;----------------------------------------------------

trampaChoca:
		ld	a, (de)		; Тайл карты

		cp	1
	jp z,trampaLimite

		and	0x0F0		; Оставляет только семейство/группу
		cp	0x10		; Это платформа или стена?
	jp z,trampaLimite	; Да


		ld	a, (hl)		; Y стены
		sub	4		; Уменьшает Y на 4, чем останавливает продвижение (перестаёт опускаться)
		ld	(hl), a		; Обновляет Y
		ret

;----------------------------------------------------
; Если стена достигает нижней границы экрана — рисует тайл кирпича «нижняя граница»
; Если сталкивается с платформой или стеной — рисует обычный тайл кирпича
;----------------------------------------------------

trampaLimite:
		dec	hl		; Указывает на статус стены
		inc	(hl)		; Переходит к следующему статусу = Стена полностью закрыта
		inc	hl		; Указывает на Y
		ld	a, (de)		; Map ID, с которым столкнулась
		cp	0x14		; Нижняя граница экрана?
		ld	c, 0x13		; Обычный тайл кирпича
	jp nz,drawTrampa_

		inc	c		; Тайл нижней границы экрана

drawTrampa_:
drawTrampa:
		ld	a, c
		ld	(de), a		; Изменяет тайл карты
		push	hl		; Указывает на Y
		call	getTileFromID	; Получает паттерн, соответствующий этому тайлу карты
		dec	hl
		dec	hl		; Указывает на Y минус 2 байта — нужно, чтобы "drawTile" взял координаты
		call	drawTile	; Рисует паттерн на экране
		pop	hl
		ret


;----------------------------------------------------
; Проверяет, активирует ли герой стену-ловушку
; Когда герой проходит через позицию ловушки, она активируется
; В этот момент выполняется вертикальный поиск от этой позиции,
; пока не встретится стена или верхняя граница экрана
; Эта точка берётся как начало закрывающейся стены
;----------------------------------------------------

chkActivaTrampa:
		inc	hl
		ld	d, h
		ld	e, l
		inc	hl
		inc	hl
		ld	c, (hl)		; X ловушки
		inc	hl
		ld	b, (hl)		; Комната ловушки
		ld	hl, (ProtaX)
		and	a
	push de	; DE тут ЖИВОЙ (ниже `ld a,(de)` — Y ловушки), а общая процедура
	ld d,b	; сравнения умеет только HL-DE: одалживаем пару и возвращаем.
	ld e,c	; ld/push/pop флагов не трогают, входной перенос доедет до sbc.
	call vec_sbcd
	pop de
		ret	nz		; Герой не на той же X, что и ловушка

		ld	a, (de)		; Y ловушки
		ld	hl, ProtaY
		cp	(hl)
		ret	nz		; Не на той же Y

		ld	h, d
		ld	l, e
		call	getMapOffset00	; Получает в HL указатель на карту для координат, на которые указывает HL
		ld	b, 0

trampaTecho:
		push	hl		; Указатель на позицию ловушки в карте
		push	de		; Указатель на Y ловушки
		and	a
		ld	de, MapaRAM
	call vec_sbcd	; Выходит за карту сверху?
		pop	de
	jp c,trampaOrigen	; Да — берём эту позицию как начало стены-ловушки

		pop	hl
		ld	a, (hl)		; Тайл карты, где находится ловушка
		and	a		; Пусто?
	jp nz,trampaOrigen2	; Нет

		inc	b
		ld	a, l
		sub	0x60		; расстояние до верхнего ряда карты
		ld	l, a
	jp nc,trampaTecho2	; Нет заёма при вычитании

		dec	h		; Вычитает заём из HL

trampaTecho2:
	jp trampaTecho	; Продолжает искать, где разместить начало закрывающейся стены

trampaOrigen:
		pop	hl
		ld	(hl), 0x12	; Map ID кирпича/стены

trampaOrigen2:
		ld	a, b
		add	a, a
		add	a, a
		add	a, a		; Число тайлов до потолка * 8
		ld	b, a
		ex	de, hl

		ld	a, (hl)		; Y ловушки
		sub	b		; Вычитает расстояние в пикселях до потолка или начала ловушки
		ld	(hl), a
		dec	hl		; Указывает на статус ловушки
		inc	(hl)		; Ловушка переходит в состояние 1 = Стена опускается

		ret

;----------------------------------------------------
; Получает указатель на данные обрабатываемой стены-ловушки
;----------------------------------------------------

getMuroDat:
		ld	hl, muroTrampaDat ; Y, дробная часть X, X, комната
		call	ADD_A_HL
		ld	a, (muroTrampProces)
		ld	b, a
		jp	getIndexX4_masB

chkLastMuro:
		ld	hl, muroTrampProces
		inc	(hl)		; Следующая стена
		ld	a, (hl)		; Текущая стена
		inc	hl
		cp	(hl)		; Общее число стен
		jp	nz, chkNextTrampa
		ret



;----------------------------------------------------
; Проверяет, раздавлен ли герой стеной-ловушкой
; In:
;   BC = Смещение XY к голове героя
; Out:
;   Carry = Раздавлен
;----------------------------------------------------

chkAplastaMuro:
		push	bc
		call	chkTocaMuro	; Z = столкновение
		ld	a, (de)		; Тайл карты
		sub	0x19		; #19 = Целый кирпич стены-ловушки, #1A = Половинный кирпич стены-ловушки
		cp	2		; Это один из этих двух тайлов стены-ловушки?
		pop	bc
		ret



;----------------------------------------------------
; Рисует анимацию разрушения кирпичей при копании киркой
; и стирает разбитые из карты RAM. Проверяет, является ли то, что копается, платформой.
; Для управления анимацией используется "agujeroCnt"
; Эта переменная имеет начальное значение и уменьшается на 3 при каждом
; ударе кирки. Её значения: #12, #0F, #0C, #09, #06, #03
; а тайлы анимации: #44 (полуразбитый), #43 (разбитый), #00 (пустой), #44, #43, #00
;----------------------------------------------------

drawAgujero:
		ld	hl, agujeroCnt	; В начале копания равен #15
		ld	a, (hl)
		and	a
		ret	z		; Дыра закончена

		ld	a, (hl)
		cp	0x12		; Это первый удар кирки?
		inc	hl
	jp z,drawAgujero2	; Да — увеличивать Y дыры не нужно

		inc	(hl)
		inc	(hl)
		inc	(hl)		; Увеличивает Y дыры на 3

drawAgujero2:
		ld	b, a
		push	hl
		call	getMapOffset00	; Получает в HL указатель на карту для координат, на которые указывает HL
		ex	de, hl
		pop	hl
		ld	a, b
		cp	9
	jp nz,drawAgujero3

		ld	a, (de)		; Читает тайл карты, который будет копаться
		call	AL_C__AH_B	; Копирует старший ниббл A в B, младший — в C
		ld	a, b		; оставляет старший ниббл — семейство тайлов, т.е. тип
		cp	1		; это платформа?
	jp nz,endAgujero	; Нет — завершает дыру. Это копать нельзя

		ld	a, c
		cp	4		; Платформа или пусто? (Map ID #10-#13 = #00 (пустой тайл), #00, #40 (тайл кирпича), #40)
	jp c,drawAgujero3

		cp	9		; Map ID #19 = Tile #40
	jp nz,endAgujero

; Проверяет, надо ли стереть выкопанный кирпич из карты в RAM

drawAgujero3:
		dec	hl
		ld	a, (hl)		; agujeroCnt
		inc	hl
		cp	0x0C		; Значение анимации в момент полного разрушения верхнего кирпича
	jp z,drawAgujero4	; Убирает кирпич с карты

		cp	3		; Значение анимации в момент полного разрушения нижнего кирпича
	jp nz,drawAgujero5

drawAgujero4:
		ld	a,1
		ld	(de), a		; Стирает тайл из карты RAM

drawAgujero5:
		ld	a, (agujeroCnt)	; В начале копания равен #15
		ld	de, tilesAnimCavar ; Тайлы, используемые в анимации дыры
		call	ADD_A_DE	; Вычисляет индекс
		ld	a, (de)		; Тайл анимации (кирпич полуразбитый, разбитый или пустой)
		dec	hl
		dec	hl		; Указывает на Y дыры
		call	drawTile	; Рисует на экране тайл анимации дыры
		ld	a, 0x45		; SFX кирки
		jp	setMusic

endAgujero:
		xor	a
		ld	(agujeroCnt), a	; В начале копания равен #15
		ret


;----------------------------------------------------
; Вращающиеся двери
; Если движутся — анимирует (5 кадров)
; В зависимости от направления вращения анимация идёт в одну или другую сторону
;----------------------------------------------------

spiningDoors:
		ld	hl, doorGiraData ; 0 = Статус (бит 0 = Вращается, биты 2-1 = высота + 2)
					; 1 = Y
					; 2 = дробная часть X
					; 3 = X
					; 4 = Комната
					; 5 = Направление вращения
					; 6 = Счётчик вращения
		ld	a, (numDoorGira)
		ld	b, a
		or	a
		ret	z		; В этой пирамиде нет вращающихся дверей

spiningDoors2:
;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ: спилл A снят — A (число дверей) мёртв: счётчик
;  ведёт B, spiningDoors3 начинает с `ld a,(timer)`, петля читает A только внутри
;  этого же спилла. Флаги для jp nz — от того же and. -26 т на дверь каждый тик.
	ld a,(hl)	; Вращается ли эта дверь?
	and 1<<0
	jp nz,spiningDoors3	; Да

		ld	de, 7		; Размер структуры каждой вращающейся двери
		add	hl, de		; Указатель на следующую дверь
	dec b
	jp nz,spiningDoors2
		ret

spiningDoors3:
	jp spinGate	; [door-wall r2] гейт темпа в холодном хвосте (vec_jumpmid.asm): 8 кадров = 4 тика 25 Гц
spiningDoors3b:

		ld	(z80_ix), hl	; IX = HL. [2026-07-29] было 11 Б клея транслятора (push hl /
				; ld (il_tmp),hl / pop hl / ld (z80_ix),hl / ld hl,(il_tmp)) —
				; сохранение HL там избыточно: он и так не менялся.
;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ вращающейся двери: девять ix-обёрток -> прямая
;  адресация. Записи дверей 0xFF7F-0xFF93 (шаг 7, до 3), смещения <= 6 — перенос
;  L+смещение невозможен. HL на входе = запись двери (= z80_ix, только что записан).
;  Мёртвости: A на входе (перетирался ld a,(il_a)), старые H/L (собираются из X/Y как и
;  в оригинале), A/F на выходах (ret nz: A=ProtaRoom и F от того же cp; путь блита:
;  coordVRAM_HL); DE не трогается до `ld de,tilesGiroDoor`, дальше несёт указатель
;  тайлов для vec_blit_rect, как и раньше. ~-1100 т на активную дверь (раз в 8 кадров),
;  -70 Б.
		ld	a, l
		add	a, SPINDOOR_TIMER
		ld	l, a		; ->счётчик +6
		ld	a, (hl)		; Счётчик (до инкремента)
		inc	(hl)		; Увеличивает счётчик
		cp	5		; Полностью повернулась?
	jp z,spiningDoorEnd	; Да — отключает вращение двери

		add	a, a
		add	a, a
		add	a, a		; x8 (столько паттернов таблицы занимает каждый кадр вращения двери)
		ld	b, a
		dec	l		; ->направление +5
		ld	a, (hl)
		cp	8		; Вращается вправо или влево?
		ld	a, b
	jp z,spiningDoor4

		ld	a, 0x20		; Инвертирует анимацию для вращения влево
		sub	b

spiningDoor4:
		ld	de, tilesGiroDoor
		call	ADD_A_DE

		ld	c, 2		; Высота по умолчанию и фиксированная ширина
		ld	hl, (z80_ix)
		ld	a, (hl)		; Статус
	or a	; Оставляет только высоту
	rra
		add	a, c		; Базовая высота + дополнительная высота
		ld	b, a		; B = Высота двери
		inc	l		; ->Y +1
		ld	a, (hl)		; A = Y
		inc	l
		inc	l		; ->X +3
		ld	h, (hl)		; H = X (читается до записи H)
		ld	l, a		; L = Y

		push	hl		; HL = X:Y
		ld	hl, (z80_ix)
		ld	a, l
		add	a, SPINDOOR_ROOM
		ld	l, a		; ->комната +4
		ld	a, (ProtaRoom)	; Дверь в той же комнате, что и герой?
		cp	(hl)
		pop	hl
		ret	nz		; Нет

		call	coordVRAM_HL	; Получает адрес VRAM таблицы имён, куда указывает HL
		jp	vec_blit_rect	; NAT: прямой blit вращающейся двери -> framebuffer

spiningDoorEnd:
		ld	hl, (z80_ix)
		ld	a, (hl)		; Снимает флаг вращения
	and 255&(~(1<<0))
		ld	(hl), a
		ld	a, l
		add	a, SPINDOOR_SENT
		ld	l, a		; ->направление +5
		ld	a, (hl)
		xor	0xc		; Инвертирует направление двери (те же операнды, что 0xC xor (hl))
		ld	(hl), a		; Обновляет направление двери

;----------------------------------------------------
; Ставит вращающуюся дверь на карту
;----------------------------------------------------

putGiratMap:
;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ: мёртвый хоровод il_tmp/push/pop свёрнут в одно
;  `ld hl,(z80_ix)` (суммарный эффект тот же; чтение il_tmp перетиралось pop hl, живые
;  читатели скретча пишут его сами — см. momiaAnda3).
	ld hl,(z80_ix)	; Ставит вращающуюся дверь на карту
		inc	hl
		push	hl
		pop	de
		call	getMapOffset00	; Получает в HL указатель на карту для координат, на которые указывает HL
		dec	de
		ld	a, (de)		; Биты 2-1 задают дополнительную высоту
		rra
		and	3
		add	a, 2		; Добавляет минимальную высоту двери (2)
		ld	b, a		; Высота двери
		ld	a, 5
		call	ADD_A_DE
		ld	a, (de)		; Направление вращения
;  [2026-08-04] спилл A снят: восстановленный A тут же перетирался `ld a,0x50`.
	and 1<<2
		ld	a, 0x50		; Map ID левой двери
	jp z,putGiratMap2
		inc	a
		inc	a		; Map ID правой двери

putGiratMap2:
		ld	c, a

putGiratMap3:
		ld	(hl), c		; Левая часть вращающейся двери
		inc	hl
		inc	c
		ld	(hl), c		; Правая часть
		ld	a, 0x5F		; Смещение к нижнему ряду карты
		call	ADD_A_HL
		dec	c
	dec b	; Повторяет столько раз, какова высота двери
	jp nz,putGiratMap3
		ret


;----------------------------------------------------
; Проверяет, какую дверь толкает герой
;----------------------------------------------------

chkGiratorias:
		xor	a
		ld	(GiratEnProceso), a

chkGiratorias2:
		xor	a
		call	getGiratorData
		push	hl
		inc	hl		; Указывает на Y
		add	a, a
		add	a, a
		and	0x18
		add	a, (hl)		; Y двери
		ld	d, a

		ld	a, (sentidoProta) ; 1 = Влево, 2 = Вправо
		rra
		ld	a, 8		; 8 пикселей вправо
	jp c,chkGiratorias3	; Влево
	cpl	; 8 пикселей влево
	inc a

chkGiratorias3:
		inc	hl
		inc	hl
		add	a, (hl)		; X двери
		ld	e, a

		ld	hl, ProtaY
		ld	a, (hl)		; Y героя
		inc	hl
		inc	hl
		ld	l, (hl)		; X героя
		ld	h, a
		and	a
	call vec_sbcd	; Вычитает координаты героя и двери
		pop	hl		; Восстанавливает статус двери
	jp nz,chkLastGirat

	push af	; Устанавливает бит 0 состояния двери
	ld a,(hl)
	or 1<<0
	ld (hl),a
	pop af
		ld	a, 6
		call	ADD_A_HL
		ld	(hl), 0
		ret

chkLastGirat:
		ld	hl, GiratEnProceso
		inc	(hl)
		ld	a, (hl)
		inc	hl
		cp	(hl)
	jp nz,chkGiratorias2
		ret


;----------------------------------------------------
; Получает в HL указатель на данные обрабатываемой вращающейся двери
; Out:
;   A = Состояние
;----------------------------------------------------


getGiratorData:
		ld	hl, doorGiraData ; 0 = Статус (бит 0 = Вращается, биты 2-1 = высота + 2)
					; 1 = Y
					; 2 = дробная часть X
					; 3 = X
					; 4 = Комната
					; 5 = Направление вращения
					; 6 = Счётчик вращения
		call	ADD_A_HL
		ld	a, (GiratEnProceso)

getHL_Ax7:
		ld	b, a		; Возвращает HL + A*7 и A=(HL)
		add	a, a
		add	a, a
		add	a, a
		sub	b		; A*7 = A*8-A (нативный i8080, без il_a spill)
		add	a, l
		ld	l, a
		jp	nc, vec_aah_x7
		inc	h
vec_aah_x7:
		ld	a, (hl)
		ret

;----------------------------------------------------
;
; Убирает вращающиеся двери с карты
; Если они в той же комнате, что и герой — стирает их с экрана
;
;----------------------------------------------------

quitaGiratorias:
		xor	a
		ld	hl, numDoorGira
		cp	(hl)
		ret	z		; Вращающихся дверей нет

		ld	(GiratEnProceso), a ; Начинает с первой
		inc	hl

quitaGiratoria2:
		push	hl
		ld	a, (hl)		; Размер вращающейся двери
		rra
		and	3
		add	a, 2
		ld	b, a		; Высота в паттернах
		push	bc
		inc	hl
		push	hl
		call	getMapOffset00	; Получает в HL указатель на карту для координат, на которые указывает HL
		ld	c, 0
		call	putGiratMap3
		pop	hl
		call	getLocationDE3	; Проверяет, на том же ли экране дверь, что и герой
		pop	bc
		ld	c, 2
	jp nz,quitaGiratoria3	; Не на том же
		call	coordVRAM_DE	; D = Y, E = X
		ld	de, eraseData
		call	vec_blit_rect	; NAT: стирает вращающуюся дверь -> framebuffer

quitaGiratoria3:
		pop	hl
		ld	de, 7
		add	hl, de
	push bc
	push de
	push hl
		ld	hl, GiratEnProceso
		inc	(hl)		; Увеличивает счётчик обрабатываемой вращающейся двери
		ld	a, (hl)
		inc	hl
		cp	(hl)		; Проверены все вращающиеся двери?
	pop hl
	pop de
	pop bc
	jp nz,quitaGiratoria2
		ret


;----------------------------------------------------
; Вычисляет адрес таблицы имён, на которую указывает HL
; In:
;   H =	X
;   L =	Y
; Out:
;  HL = Адрес VRAM таблицы имён
;----------------------------------------------------

coordVRAM_HL:
		push	de
		ex	de, hl
		ld	a, d
		ld	d, e
		ld	e, a
		call	coordVRAM_DE	; D = Y, E = X
		pop	de
		ret


;----------------------------------------------------
; Паттерны для отрисовки вращающейся двери в движении
; Имеет 5 возможных позиций и максимальную высоту 32 пикселя (4 паттерна)
; Ширина — 16 пикселей (2 паттерна)
;----------------------------------------------------
tilesGiroDoor:	db 0x68,	0x69, 0x68, 0x69, 0x68, 0x69, 0x68, 0x69
		db 0x6A,	0x6B, 0x6A, 0x6B, 0x6A, 0x6B, 0x6A, 0x6B ; Синий/белый, повёрнута ->
		db 0x54,	0x55, 0x54, 0x55, 0x54, 0x55, 0x54, 0x55 ; Синяя стена
		db 0x7A,	0x79, 0x7A, 0x79, 0x7A, 0x79, 0x7A, 0x79 ; Белый/синий, повёрнута <-
		db 0x78,	0x77, 0x78, 0x77, 0x78, 0x77, 0x78, 0x77 ; Белый/синий


;----------------------------------------------------
;
; Распаковывает текущую пирамиду и её элементы:
; платформы, выходы, мумии, гемы, ножи,
; кирки, вращающиеся двери, стены-ловушки и лестницы
;
;----------------------------------------------------

setupStage:
		di
		ld	a, 0x03A
		ld	(vec_brillo_pal), a
		ld	hl, GameStatus
		ld	(vec_brillo_pal+1), hl
		ei
		call	vec_setpal_a
		xor	a
		ld	(flagMuerte), a
		ld	(UNKNOWN), a	; (!?) Используется?
		call	BorraMapaRAM
		inc	a
		ld	(flagVivo), a
		call	hideSprAttrib	; Очищает атрибуты спрайтов (скрывает их)

		ld	hl, piramideDest
		ld	a, (hl)
		dec	hl
		ld	(hl), a		; Текущая пирамида = пирамиде назначения
;  ЗАДАЧА #21: ВОТ ЗДЕСЬ сцена палитры становится «внутри пирамиды» — не раньше. Экран к этой
;  строке уже вычищен вертикальной шторкой (замер: 0 нефоновых пикселей), а лабиринт ещё не
;  нарисован ни одним пикселем, то есть смену цвета камней показывать НЕКОМУ. Ставим ПОСЛЕ
;  обновления piramideActual: покадровый писатель берёт схему камней по нему, и на строку
;  раньше он взял бы схему ПРЕДЫДУЩЕЙ пирамиды.
		ld	a, 1
		ld	(vbp_scene), a
;  ЦВЕТОВАЯ ТАБЛИЦА УРОВНЯ — ЗДЕСЬ, а не выше: профиль выбирается по piramideActual, и до
;  этой строки там ещё номер ПРЕДЫДУЩЕЙ пирамиды. При загрузке выше первый уровень получал
;  чужой банк (замер: 116-188 байт расхождения картинки).
		call	vec_ct_stage
;  ЗАДАЧА #35: здесь стоял `call ChgStoneColor` — холостая заливка MSX-таблицы цвета кирпичей
;  (см. комментарий на месте самой процедуры). Оттенок кирпичей даёт палитра (vec_setpal_a).

		ld	hl, indexPiramides ; Индекс пирамид
		ld	a, (piramideActual)
		dec	a
		add	a, a
		call	getIndexHL_A	; Получает указатель на карту текущей пирамиды
		ex	de, hl
		ld	b, 4
	push	hl
	ld	hl, MapaRAMRoot
	ld	(z80_ix), hl
	pop	hl

unpackMap:
		ld	a, (de)
		push	bc
		push	de
		ld	hl, indexHalfMap
		ld	c, a
		rra
		rra
		rra
		and	0x1E
		call	getIndexHL_A
;  ШАГ СЛОТА ТЕПЕРЬ 22 БАЙТА, А НЕ 44 (словарь рядов, см. ниже и tools/maps_compile.py):
;  полуэкран хранится не 22 рядами по 2 байта, а 22 индексами в halfRows.
;  Заодно снята эмуляция флагов от Z80-ного `sbc hl,de` (метки il_AS169/il_AS16C10):
;  прежний код считал base + slot*48 - slot*4, а флаги результата НИКТО не читал —
;  сразу за ним идёт ld (il_tmp),hl. Теперь честное base + slot*22 без вычитания.
		ld	a, c
		and	0x0F
		push	hl		; база halfMapN
		ld	h, 0
		ld	l, a
		add	hl, hl		; x2
		ld	d, h
		ld	e, l		; DE = slot*2
		add	hl, hl		; x4
		add	hl, hl		; x8
		add	hl, hl		; x16
		add	hl, de		; x18
		add	hl, de		; x20
		add	hl, de		; x22
		ld	b, h
		ld	c, l
		pop	hl
		add	hl, bc		; HL = halfMapN + slot*22
	push	hl
	ld	hl, (z80_ix)
	ex	de, hl
	pop	hl
;
; Распаковывает кусок карты
; 22 ряда x 16 столбцов (пол-экрана)
; Каждый бит указывает: кирпич или пусто
;  [2026-09-19] счётчик рядов больше не паркуется в B' через vec_exx —
;  лежит на стеке, DE/HL (dest/курсор индексов) остаются в основных.
;
		ld	b, 0x16		; Число рядов на экран (22)

unpackMap2:
		push	bc		; счётчик рядов (раньше B' через exx)
;  СЛОВАРЬ РЯДОВ. HL идёт по 22 ИНДЕКСАМ полуэкрана, а сами ряды (по 2 байта) лежат
;  один раз в halfRows: разных рядов среди 308 всего 63, повторяются сплошная стена,
;  сплошная пустота, «пол справа» и им подобные. Здесь индекс превращается в указатель
;  на ряд, а курсор индексов прячется в стек до конца ряда.
;  BC свободен (B тут же получает 2, C — рабочий байт битового цикла).
		ld	a, (hl)		; индекс ряда
		inc	hl		; курсор -> следующий ряд полуэкрана
		push	hl
		ld	l, a
		ld	h, 0
		add	hl, hl		; idx*2
		ld	bc, halfRows
		add	hl, bc		; HL -> два байта ряда
		ld	b, 2		; Два байта

unpackMap3:
		push	bc
		ld	b, 8		; Восемь бит
		ld	c, (hl)

unpackMap4:
		ld	a, c		; Вращает байт, чтобы посмотреть, бит равен 0 или 1
		rla
		ld	c, a
		ld	a, 0		; Пустой тайл
	jp nc,unpackMap5
		ld	a, 0x12		; Тайл кирпича

unpackMap5:
		ld	(de), a		; Помещает тайл в буфер карты
		inc	de
	dec b
	jp nz,unpackMap4

		inc	hl		; Следующий байт (8 тайлов)
		pop	bc
	dec b
	jp nz,unpackMap3

		pop	hl		; вернуть курсор индексов полуэкрана
		ld	a, 0x50		; Расстояние до следующего ряда. По горизонтали три экрана
		call	ADD_A_DE
		pop	bc
	dec b
	jp nz,unpackMap2

		ld	bc, 0x10		; Расстояние до второй половины экрана
	ld	hl, (z80_ix)
	add	hl, bc
	ld	(z80_ix), hl
		pop	de
		pop	bc
		ld	a, (de)
		inc	de
		and	0x0F0
		cp	0x30
	jp z,getDoors
	dec b
	jp nz,unpackMap


;----------------------------------------------------
; Проверяет выходные двери пирамиды
; Если Y (первый байт) = #FF, выход не существует
; Двери, через которую входят в пирамиду, ставит статус #10 (1)
; Если гемы этой пирамиды уже собраны — оставляет двери видимыми и закрытыми (статус #80)
; Если не собраны — оставляет дверь в статусе 0 (проверка, собраны ли все гемы)
;----------------------------------------------------

getDoors:
		ld	hl, numPuertas
		ld	(hl), 4		; Максимально возможное число дверей
		inc	hl
		ex	de, hl		; DE = буфер дверей, HL = поток карты
;  [2026-09-19] счётчик дверей и так жил в z80_bc_alt+1 (B') — входная дверь
;  сравнивается с ним ниже. Держим HL/DE в основных, без vec_exx.
		xor	a
		ld	(z80_bc_alt+1), a	; B' = 0

getNextDoor:
		ld	a, (hl)		; Y двери
		inc	a		; Это #FF? (Существует ли этот выход?)
	jp nz,getDoors3	; Да, существует

		dec	a
		ld	(de), a		; Помечает выход как недоступный
		inc	hl
		ld	a, 7		; Размер структуры каждого выхода
		call	ADD_A_DE	; DE указывает на буфер следующего выхода
	jp chkLastDoor	; Проверяет, обработаны ли уже все двери

getDoors3:
		call	transfCoords	; Переносит координаты из HL в DE (Y, X)

		ld	a, (puertaEntrada)
	or a
	rra
		cp	4
	jp nz,getDoors4
		dec	a

getDoors4:
;  [2026-08-04] СХЛОПНУТА ПАРА СВОПОВ: было `call vec_exx / cp b / call vec_exx` — то есть
;  сравнение A с ТЕНЕВЫМ B' (счётчиком дверей). Сравниваем прямо с ячейкой: z80_bc_alt
;  хранит пару как (младший=C', старший=B'), значит B' лежит по z80_bc_alt+1.
;  Флаги — единственный результат конструкции: vec_exx их не портит (push/pop/lhld/shld/
;  xthl), `pop hl` (POP H) тоже, поэтому на выходе ровно флаги от сравнения; их читает
;  `jp z,getDoors6` через `ld a,0x10` (MVI флаги не трогает). HL спасён через стек,
;  глубина стека МЕНЬШЕ прежней (2 Б против 4 Б у call vec_exx).
;  7 -> 6 байт, 536 -> 38 тактов; исполняется 4 раза за 3000 кадров (путь холодный).
	push	hl
	ld	hl, z80_bc_alt+1
		cp	(hl)		; Эта дверь — та, через которую входят в пирамиду?
	pop	hl
		ld	a, 0x10		; Статус: рисует входную дверь
	jp z,getDoors6

		push	de
		call	chkPiramPasada	; Проверяет, пройдена ли уже пирамида, чтобы оставить или убрать выходную дверь
		ld	a, 0		; Убирает дверь и оставляет состояние проверки, собраны ли все гемы
	jp z,getDoors5
		ld	a, 0x80		; Оставляет дверь закрытой и видимой

getDoors5:
		pop	de

getDoors6:
		ld	(de), a		; Статус двери
		inc	de
		ld	a, (hl)
		call	AL_C__AH_B	; Копирует старший ниббл A в B, младший — в C
		ld	a, b
		ld	(de), a		; Пирамида, куда ведёт эта дверь
		inc	de
		ld	a, c
		ld	(de), a		; Направление стрелки карты / входная дверь / направление выхода
		inc	de
		inc	hl

chkLastDoor:
		ld	a, (z80_bc_alt+1)
		inc	a
		ld	(z80_bc_alt+1), a
		cp	4		; Максимальное число выходов
	jp nz,getNextDoor	; Ещё остались двери для проверки



;----------------------------------------------------
; Обновляет мумий пирамиды
;----------------------------------------------------
		ld	a, (hl)
		ld	(numMomias), a
		inc	hl
		ld	b, a
		add	a, a
		add	a, b		; 3 байта на мумию (y, x, тип)
		ld	b, 0
		ld	c, a
		ld	de, momiasPiramid ; Данные мумий текущей пирамиды: y, x (%xxxxx--p), тип
	call vec_ldir_fwd


;----------------------------------------------------
; Обновляет гемы
;----------------------------------------------------
		ld	de, gemasTotales
		ld	a, (hl)		; Число гемов в пирамиде
	ld a,(hl)
	ld (de),a
	inc hl
	inc de
	dec bc
		inc	de
		ld	b, a		; Число гемов

readGemas:
		push	bc
		ld	a, (hl)		; Цвет
		and	0x0F0
		or	1		; Активирует гем
		ld	(de), a		; Тип / цвет гема

		inc	hl
		inc	de
		ld	a, 1
		ld	(de), a		; Статус 1

		inc	de
		call	transfCoords	; Переносит координаты из HL в DE (Y, X)
		inc	de
		inc	de
		inc	de		; 9 байт на гем
		pop	bc
	dec b
	jp nz,readGemas


		push	hl
		xor	a
		ld	(ElemEnProceso), a ; Начинаем рисовать гемы с первого

putNextGema:
		xor	a
		call	getGemaDat	; Указатель на обрабатываемый гем
		call	chkPiramPasada	; Ставить гемы этой пирамиды или они уже собраны раньше?
	jp z,putNextGema2	; Нужно ставить

		ld	a, (hl)
		and	0x0F0
		ld	(hl), a		; Деактивирует гем
		inc	hl
		ld	(hl), 3		; Статус 3 гема
	jp chkLastGema_

putNextGema2:
		inc	hl
		inc	hl
		call	getMapOffset00	; Получает в HL указатель на карту для координат, на которые указывает HL
		push	hl
		ld	de, brillosGema	; Паттерны, образующие блеск гема
		call	putBrillosMap	; Помещает блеск гема на карту

		xor	a
		call	getGemaDat
		call	AL_C__AH_B	; Копирует старший ниббл A в B, младший — в C
		ld	a, b		; Цвет гема
		add	a, 0x40		; Map ID гемов
		pop	hl
		ld	(hl), a		; Ставит гем

chkLastGema_:
		ld	hl, ElemEnProceso ; Используется, чтобы знать, какой гем или дверь обрабатывается
		inc	(hl)		; следующий гем
		ld	a, (hl)
		dec	hl
		cp	(hl)		; Общее число гемов
	jp nz,putNextGema	; Остались необработанные гемы
		pop	hl



;----------------------------------------------------
; Обновляет ножи
;----------------------------------------------------
		ld	de, numKnifes
		ld	a, (hl)		; Число ножей
		ld	(de), a		; Обновляет число ножей пирамиды
		inc	hl
		inc	de
		or	a
	jp z,getPicos	; Нет ни одного

		ld	b, a

setKnifeCoords:
		push	bc
		inc	de
		inc	de
		call	transfCoords	; Переносит координаты из HL в DE (Y, X)
		ld	a, 0x0B
		call	ADD_A_DE
		pop	bc
	dec b
	jp nz,setKnifeCoords

;----------------------------------------------------
; Обновляет кирки
;----------------------------------------------------

getPicos:
		ld	de, numPicos
		ld	a, (hl)		; Число кирок
		ld	(de), a		; Обновляет число кирок этой пирамиды
		inc	de
		inc	hl
		and	a
	jp z,getGiratorias	; Кирок нет

		ld	b, a		; Число кирок

getPicos2:
		push	bc
		ld	a, 1
		ld	(de), a		; Статус = 1
		inc	de
		call	transfCoords	; Переносит координаты из HL в DE (Y, X)
		pop	bc
	dec b
	jp nz,getPicos2

		push	hl
		ld	hl, numPicos
		ld	b, (hl)		; Число кирок на карте
		inc	hl
		inc	hl		; Указывает на Y кирки

getPicos3:
		push	bc
		push	hl
		call	getMapOffset00	; Получает в HL указатель на карту для координат, на которые указывает HL
		ld	(hl), 0x80	; Ставит кирку на карту
		pop	hl
		ld	a, 5
		call	ADD_A_HL	; Пропускает данные кирки, чтобы указать на координаты следующей
		pop	bc
	dec b
	jp nz,getPicos3
		pop	hl


;----------------------------------------------------
; Обновляет вращающиеся двери
;----------------------------------------------------

getGiratorias:
		ld	a, (hl)		; Число вращающихся дверей
		inc	hl
		ld	de, numDoorGira
		ld	(de), a		; Обновляет число вращающихся дверей пирамиды
		or	a
	jp z,getMuroTrampa	; Вращающихся дверей нет

		inc	de
		ld	b, a

getGiratorias2:
		push	bc
	ld a,(hl)	; Высота двери (затем делится на 2 и прибавляется 2)
	ld (de),a
	inc hl
	inc de
	dec bc
	ld a,(hl)	; Y
	ld (de),a
	inc hl
	inc de
	dec bc
		inc	de		; Пропускает дробную часть X

		ld	a, (hl)		; Координата X
		and	0x0F8		; биты 7-3
		ld	(de), a		; X, выровненная по паттернам

		inc	de
		ld	a, (hl)
		rra
		rra			; бит 2
		and	1
		ld	(de), a		; Комната

		inc	de
		ld	a, (hl)
		rla
		rla			; биты 0-1
		and	0x0C
		ld	(de), a		; Направление вращения
		inc	de
		inc	de
		inc	hl
		pop	bc
	dec b
	jp nz,getGiratorias2

		push	hl
	ld (il_tmp),hl	; 0 = Статус (бит 0 = Вращается, биты 2-1 = высота + 2)
	ld hl,doorGiraData
	ld (z80_ix),hl
	ld hl,(il_tmp)
					; 1 = Y
					; 2 = дробная часть X
					; 3 = X
					; 4 = Комната
					; 5 = Направление вращения
					; 6 = Счётчик вращения

getGiratorias3:
		call	putGiratMap	; Ставит вращающуюся дверь на карту
		ld	de, 7
	ld	hl, (z80_ix)
	add	hl, de
	ld	(z80_ix), hl
		ld	hl, GiratEnProceso
		inc	(hl)
		ld	a, (hl)
		inc	hl
		cp	(hl)		; Проверяет, все ли поставлены
	jp nz,getGiratorias3	; Ещё остались вращающиеся двери, которые надо поставить на карту
		pop	hl


;----------------------------------------------------
; Обновляет стены-ловушки
;----------------------------------------------------

getMuroTrampa:
		ld	de, numMuroTrampa ; Число стен-ловушек в пирамиде
		ld	a, (hl)
	ld a,(hl)	; Копирует число стен-ловушек этой пирамиды
	ld (de),a
	inc hl
	inc de
	dec bc
		or	a
	jp z,getStairs	;  Стен-ловушек нет

		ld	b, a

getMuroTrampa2:
		push	bc		; Число стен-ловушек
		inc	de
		call	transfCoords	; Переносит координаты из HL в DE (Y, X)
		pop	bc
	dec b
	jp nz,getMuroTrampa2


;----------------------------------------------------
; Обрабатывает лестницы
;----------------------------------------------------

getStairs:
		ex	de, hl
		ld	a, (de)		; Число лестниц
		ld	b, a
		inc	de
		and	a
		ret	z		; Лестниц нет

getStairs2:
		push	bc
		ld	hl, escaleraData
		ex	de, hl
		push	de
	ld a,(hl)	; Y лестницы
	ld (de),a
	inc hl
	inc de
	dec bc

		xor	a
		ld	(de), a		; Дробная часть X

		inc	de
		ld	a, (hl)		; X
		and	0x0F8
		ld	(de), a		; Выравнивает X до кратного 8

		ld	a, (hl)		; Бит 0 = Направление. Бит 1 = Комната
		and	1
		ld	b, a		; Направление

		inc	de
		ld	a, (hl)
		rra
		and	1
		ld	(de), a		; Комната

		pop	de		; Данные лестниц
		ex	de, hl
		push	de
		call	getMapOffset00	; Получает в HL указатель на карту для координат, на которые указывает HL

getStairs3:
		ld	a, (hl)		; Есть ли что-то в этом месте карты?
		and	a
	jp nz,getStairs5	; Да — лестница дошла до платформы

		ld	c, 0x20
		call	putPeldanoMap
		and	a		; Направление?
		push	bc
		ld	bc, -0x62	; Смещение к верхнему ряду карты, если лестница поднимается влево
	jp z,getStairs4
		inc	bc
		inc	bc		; Вправо

getStairs4:
		add	hl, bc
		pop	bc
	jp getStairs3

getStairs5:
		ld	c, 0x15
		call	putPeldanoMap	; Ставит особую ступеньку начала/конца лестницы
		pop	de
		inc	de
		pop	bc
	dec b
	jp nz,getStairs2
		ret

putPeldanoMap:
		ld	a, b		; Направление
		and	a
	jp z,putPeldanoMap2
		inc	c
		inc	c		; Ступеньки влево

putPeldanoMap2:
		ld	(hl), c
		inc	c
		inc	hl
		ld	(hl), c
		ret



;----------------------------------------------------
;
; Рисует экран, спрайты, ножи и размещает мумий
;
;----------------------------------------------------

setupRoom:
		ld	a, 1
		ld	(flagScrolling), a
		ld	a, (ProtaRoom)	; Комната героя (xHigh)
		add	a, a
		add	a, a
		add	a, a
		add	a, a
		add	a, a		; x32 (ширина одного экрана)
		ld	de, MapaRAM
		call	ADD_A_DE	; DE = Указатель на экран, где находится герой (по горизонтали их может быть 3)
		call	vec_nat_room	; Рисует комнату, в которой находится герой
		call	vec_nat_sprites	; Ставит спрайты
		call	AI_Cuchillos	; Ставит ножи
		xor	a
		ld	(momiaEnProceso), a

initMomias:
		call	initMomia
		ld	hl, momiaEnProceso
		inc	(hl)
		ld	a, (hl)
		dec	hl
		cp	(hl)		; Все ли мумии обработаны?
	jp nz,initMomias
		ret


;----------------------------------------------------
;
; Инициализирует обрабатываемую мумию
;
; Передаёт данные мумии в её структуру
; Ставит состояние 4 — появление
; Задаёт скорость и цвет в зависимости от типа мумии
; Тип мумии увеличивается на число прохождений игры
;----------------------------------------------------

initMomia:
		call	getMomiaProcDat	; HL = IX = слот мумии
		ld	(hl), 4		; Действие мумии: появление
		inc	hl
		inc	hl
		inc	hl
		ld	de, momiasPiramid ; Данные мумий текущей пирамиды: y, x (%xxxxx--p), тип
		ld	a, (momiaEnProceso)
		ld	c, a
		add	a, a
		add	a, c		; x3
		call	ADD_A_DE
		ex	de, hl		; HL указывает на определение мумии

		call	transfCoords	; Переносит координаты мумии

		ld	a, (hl)		; Тип мумии
		ld	c, a
		ld	a, (numFinishGame) ; Число прохождений игры
		add	a, c		; тип_карты + круги (меню HIGH снято, +0)
		cp	5		; Проверяет выход за диапазон существующих типов мумий
	jp c,initMomia2

		ld	a, 4		; Самый умный тип мумии

initMomia2:
		ld	c, a		; Тип мумии
		ex	de, hl
		ld	de, tiposMomia	; Характеристики каждого типа мумии (цвет и скорость)
		call	ADD_A_DE
		ld	a, (de)
		ld	b, a
		and	0x0F0		; Старший nibble задаёт скорость мумии
		ld	(hl), a		; Скорость

		ld	a, 0x0A
		call	ADD_A_HL
		ld	(hl), 0x10	; Таймер (время до появления)
		inc	hl
		inc	hl
		inc	hl
		ld	(hl), c		; Тип мумии
		inc	de
		call	getMomiaAtrib	; Атрибуты спрайта мумии
		inc	hl
		inc	hl
		inc	hl
		ld	a, b
		call	AL_C__AH_B	; Копирует старший nibble A в B, младший в C
		ld	(hl), c		; Цвет
		ret

;----------------------------------------------------
; Типы мумий
; Младший nibble = цвет
; Старший nibble = скорость
;----------------------------------------------------
tiposMomia:	db 0x5F
		db 0x59
		db 0x0A4
		db 0x0A8
		db 0x0BA

;----------------------------------------------------
; Получить элемент по индексу HL, A
;
; In: HL = указатель на таблицу
;      A = индекс
; Out: HL = (HL + A)
;----------------------------------------------------

getIndexHL_A:
		add	a, l
		ld	l, a
		jp	nc, vec_aah_hla
		inc	h
vec_aah_hla:
		ld	a, (hl)
		inc	hl
		ld	h, (hl)
		ld	l, a
		ret


;----------------------------------------------------
; Проверяет, пройдена ли уже текущая пирамида
; Out: NZ = пройдена
;	Z = не пройдена
;----------------------------------------------------

chkPiramPasada:
	push hl	; Каждый бит указывает, пройдена ли соответствующая пирамида
	ld hl,(PiramidesPasadas)
	ld b,h
	ld c,l
	pop hl
		push	bc
		call	calcBitMask	; Возвращает в DE активный бит, соответствующий текущей пирамиде
		pop	bc
		ld	a, b
		and	d
		ld	b, a
		ld	a, c
		and	e
		add	a, b
		ret


;----------------------------------------------------
; Переносит координаты из HL в DE (Y, X)
; In:
;   HL = Y, X (XXXXXxxP) X = координата X, P = экран
;----------------------------------------------------

transfCoords:
	ld a,(hl)	; Копирует координату Y
	ld (de),a
	inc hl
	inc de
	dec bc
		inc	de		; Пропускает дробную часть X
		ld	a, (hl)
		and	0x0F8		; Выравнивает координату X по кратным 8 (паттерны)
		ld	(de), a		; Сохраняет координату X

		inc	de		; Указывает на второй байт координаты X (комната)
		ld	a, (hl)		; Снова читает координату X
		and	1		; Оставляет бит 0 (!?) Гемы можно ставить только на экране 0 или 1
		ld	(de), a		; Интерпретирует бит 0 как экран назначения (координата + 256*bit0)
		inc	de
		inc	hl
		ret



;----------------------------------------------------
; Карты пирамид
;----------------------------------------------------
indexPiramides:	dw MapStage1
		dw MapStage2
		dw MapStage3
		dw MapStage4
		dw MapStage5
		dw MapStage6
		dw MapStage7
		dw MapStage8
		dw MapStage9
		dw MapStage10
		dw MapStage11
		dw MapStage12
		dw MapStage13
		dw MapStage14
		dw MapStage15

indexHalfMap:	dw halfMap1
		dw halfMap2
		dw halfMap3
		dw halfMap4


;----------------------------------------------------
; Паттерны, образующие блеск гемов
;----------------------------------------------------
brillosGema:	db 0x40			; Верхний
		db 0x41			; Левый
		db 0			; Место для гема
		db 0x42			; Правый


;----------------------------------------------------
; Стирает карту из RAM
;----------------------------------------------------

BorraMapaRAM:
		ld	hl, MapaRAM
		ld	de,  MapaRAM+1
		ld	bc, 0x8A0
		ld	(hl), 0x14
	jp vec_ldir_fwd	; peephole: был `call ... / ret` -> хвостовой jp

;  [УДАЛЕНО ЗАДАЧЕЙ #35, 2026-07-31] ChgStoneColor/ChgStoneColor2 (34 Б кода) и ColoresPiedra
;  (36 Б = 4 схемы по 9 Б) — «меняет цвет кирпичей каждые 4 фазы». Пять распаковок подряд в
;  VDP 0x200/0x208/0x210/0x218/0x220, то есть в MSX color table, которая на Векторе не оседает
;  нигде (vec_col_store = `ret`, задача #27): замер coltab_dead_audit.js — 40 Б цвета и 61600
;  тактов на 5 загрузок уровня, НОЛЬ записей в тень паттернов / vec_tilemode / vec_mixbuf.
;  Оттенок кирпичей по схеме ((piramideActual-1)>>2)&3 на Векторе делает не эта таблица, а
;  палитра: vec_setpal_a подбирает idx8 по той же схеме (см. vec_blit.asm, «Часть 1: цвет idx8»).

;----------------------------------------------------
;
; Логика героя на лестницах при входе/выходе из пирамиды
; Проверяет, поднимается он или спускается, и обновляет координаты героя
; При выходе проверяет, надо ли дать бонус
;
;----------------------------------------------------

escalerasEntrada:
		ld	a, (statusEntrada) ; Статус героя на лестницах входа/выхода
		call	jumpIndex

		dw entraSale		; Поднимается или спускается по лестнице
		dw quietoFinEsc		; Дошёл до конца лестницы. Ждёт немного
		dw chkBonusStage	; Проверяет, надо ли дать бонус за прохождение пирамиды
		dw haSalido		; Вышел из пирамиды. Переход к пергаменту

entraSale:
		ld	hl, protaMovCnt	; (!?) Где используется HL?
		ld	a, (timer)
		and	1
		ret	nz		; 25 Гц: каждый второй тик = and 3 на 50 Гц

		ld	hl, 0x1E0
		ld	(protaSpeed), hl ; Скорость X при входе в пирамиду
		call	mueveProta	; Обновляет позицию героя

		ld	a, (GameStatus)
		cp	4		; Входит или выходит из пирамиды?
	jp nz,salePiramide

		ld	hl, ProtaY
		inc	(hl)		; Увеличивает Y героя
		ld	a, (hl)
		and	7		; Закончил спускаться по лестнице? (спускается только на 1 тайл)
	jp nz,animProta	; Следующий кадр анимации героя

		ld	a, 1
		ld	(protaFrame), a	; Ставит кадр покоя
		call	setAttribProta	; Обновляет атрибуты спрайтов героя
	jp finEntraSale

salePiramide:
		ld	hl, ProtaY
		dec	(hl)		; Уменьшает Y героя
		inc	hl
		inc	hl
		ld	a, (hl)		; X героя
		add	a, 8
		ld	hl, puertaXspr	; X спрайта двери (правая часть)
		cp	(hl)		; Полкорпуса героя закрыто правой дверью?
	jp c,animProta	; Нет

		call	hideSprAttrib	; Скрывает все спрайты (герой, правая дверь...)
	jp finEntraSale

animProta:
		ld	hl, protaFrame
		inc	(hl)		; следующий кадр
		and	7		; диапазон 0-7
		ld	(hl), a
		jp	setAttribProta	; Обновляет атрибуты спрайтов героя

finEntraSale:
		push	hl
		ld	hl, 0x0A8	; дробь 0xA8; два полушага за тик (protaWalk2), не 0x150
		ld	(protaSpeed), hl
		pop	hl
		ld	b, 4		; Число скрываемых спрайтов
		call	hideSprAttrib2	; Скрывает спрайты двери

		ld	hl, statusEntrada ; Статус героя на лестницах
		inc	(hl)		; Переход к следующему состоянию: стоит у подножия лестницы

		ld	a, 0x20
		ld	(timer), a
		ret


;----------------------------------------------------
; Герой дошёл до конца лестницы
; при входе или выходе из пирамиды
;----------------------------------------------------

quietoFinEsc:
		call	AI_Salidas
		ld	a, (puertaCerrada) ; Становится 1 при закрытии выхода
		or	a
		ret	z		; Дверь ещё не закрылась

		ld	a, (GameStatus)
		cp	4		; Входит или выходит из пирамиды?
	jp z,estaDentro	; Входит

		ld	a, 0x20		; Тишина
		call	setMusic

		ld	hl, statusEntrada
		inc	(hl)		; Переход к следующему состоянию лестниц: проверка бонуса за прохождение фазы

		xor	a
		ld	(ElemEnProceso), a ; Используется, чтобы знать, какой гем или дверь обрабатывается
		ret


;----------------------------------------------------
; Уже внутри пирамиды, и дверь закрылась.
; Переход к следующему подсостоянию, начинающему фазу
;----------------------------------------------------

estaDentro:
		ld	a, 0x28
		ld	(waitCounter), a
		ld	hl, subStatus
		inc	(hl)		; Начинает фазу
		ret

;----------------------------------------------------
;
; Проверяет, надо ли дать бонус за прохождение пирамиды
; Если уже пройдена — бонуса нет
;
;----------------------------------------------------

chkBonusStage:
		ld	hl, waitCounter
		dec	(hl)
		ret	p

		call	chkPiramPasada
	jp nz,chkBonusStage2	; Уже была пройдена

		ld	de, 0x2000
		call	SumaPuntos	; Бонус 2000 очков
		ld	a, 0x8F		; бонус-этап пройден
		call	setMusic

chkBonusStage2:
		ld	hl, statusEntrada
		inc	(hl)		; Переход к следующему состоянию

		ld	a, 0x70
		ld	(waitCounter), a ; Время ожидания перед завершением процесса выхода

		call	calcBitMask	; Возвращает в DE активный бит, соответствующий текущей пирамиде
		ld	hl, PiramidesPasadas ; Каждый бит указывает, пройдена ли соответствующая пирамида
		jp	setPiramidClear	; Помечает текущую пирамиду как пройденную


;----------------------------------------------------
; Дополнительная жизнь
; Добавляет жизнь и проигрывает SFX для индикации
;----------------------------------------------------

VidaExtra:
		ld	hl, Vidas
		inc	(hl)		; Увеличивает число жизней

		ld	a, 0x8A		; SFX дополнительной жизни
		call	setMusic
		jp	dibujaVidas

;----------------------------------------------------
; Вышел из пирамиды
;
;----------------------------------------------------

haSalido:
		ld	hl, timer
		ld	a, (hl)
		and	3		; (!?) Зачем это, если ни на что не влияет?

		inc	hl
		dec	(hl)		; Уменьшает waitCounter
		ret	nz		; Ещё надо дождаться конца фанфар «вышел из пирамиды»

		xor	a
		ld	(flagEntraSale), a ; Продолжает обычную логику игры

		ld	a, 8		; Статус = Stage clear
		ld	(GameStatus), a
		ret


;----------------------------------------------------
; Инициализирует спрайты героя и входной двери
; Ставит героя в правый верхний угол лестницы и задаёт цвет одежды и кожи
; Меняет состояние двери на «закрывается»
; Расставляет спрайты правой створки двери, перекрывающей героя
; Всего четыре спрайта (две наложенные пары)
;----------------------------------------------------

setSprDoorProta:
		ld	de, sprAttrib	; Таблица атрибутов спрайтов в RAM (Y, X, Spr, Col)
		ld	hl, attribDoor	; Атрибуты входных дверей
		ld	bc, 0x10		; 4 спрайта * 4 байта
	call vec_ldir_fwd

;  ЛИЦА КИРПИЧЕЙ ИЗ РАСШИВКИ (задача «ворота»). В оригинале спрайт-«расшивка» — ЧЁРНЫЕ швы
;  поверх зелёной заливки. У нас заливка кладёт весь габарит в idx6 (непрозрачная база), и
;  зелёными должны стать ЛИЦА кирпичей, то есть ДОПОЛНЕНИЕ расшивки внутри заливки. Три
;  плоскости на объект набрать нельзя (hi0 пишет, hi0b пишет-или-гасит, hi0c гасит), поэтому
;  зелёный набирается ДВУМЯ объектами пары, а дополнение считается ЗДЕСЬ, один раз на
;  загрузку уровня: буфер спрайтов заливает только loadGameGfx, а он идёт в unpackStage
;  ровно перед этим вызовом (единственный вызыватель — InitStage).
;  Раскладка паттерна: 32 Б = левый столбец 16 строк, потом правый (у створки он пуст).
;  Байт 0 — ВЕРХНЯЯ строка спрайта. Заливка 0xDC занимает НИЖНИЕ 8 строк (проверено дампом
;  силуэта слота), поэтому у 0xD8 инвертируются байты 8..15, а у 0xE0 — все 16 (его заливка
;  0xE4 сплошная на все 16 строк).
		ld	hl, vec_spr_buf+0x1C8	; паттерн 0xD8, нижние 8 строк
		ld	b, 8
		call	sdp_invpat
		ld	hl, vec_spr_buf+0x200	; паттерн 0xE0 (нижняя половина)
		ld	b, 16
		call	sdp_invpat

		ld	a, 0x0E
		ld	(protaColorRopa), a ; Серый цвет для одежды и шлема героя
		ld	a, 6
		ld	(ProtaColorPiel), a ; Оранжевый цвет для кожи

		ld	a, (puertaEntrada) ; Дверь, через которую входим (направление)
	or a	; Значения: 1,2,4,8
	rra
		cp	4
	jp nz,initDoorProta2
		dec	a		; Преобразует номер бита в число

initDoorProta2:
		ld	hl, pyramidDoors ; Y (FF = отключено)
					; X дробная часть
					; X
					; Комната
					; Статус (старший nibble = статус, младший nibble = счётчик)
					; Пирамида назначения
					; Направление входа / стрелка карты
		call	getHL_Ax7	; Получает указатель на данные двери, через которую входим

		push	hl
		ld	de, ProtaY
		ld	a, (hl)		; Y центра двери
		sub	8
		ld	(de), a		; Ставит героя на 8 пикселей выше
		inc	de
		inc	hl
	ld a,(hl)	; X дробная часть
	ld (de),a
	inc hl
	inc de
	dec bc

		ld	a, (hl)		; X центра двери
		add	a, 8
		ld	(de), a		; Ставит героя на 8 пикселей правее

		inc	de
		inc	hl
	ld a,(hl)	; Одна и та же комната для двери и героя
	ld (de),a
	inc hl
	inc de
	dec bc

		ld	bc, 5
		ld	hl, protaDataDoor
	call vec_ldir_fwd	; Ставит значения по умолчанию при старте фазы

		call	setAttribProta	; Обновляет RAM-атрибуты спрайтов героя по его координатам и направлению

		ld	a, (puertaEntrada)
	or a
	rra
		cp	4
	jp nz,initDoorProta3	; Сохраняет индекс двери, через которую входим в пирамиду
		dec	a		; Преобразует номер бита в число

initDoorProta3:
		ld	(ElemEnProceso), a ; Сохраняет индекс двери, через которую входим в пирамиду
		ld	a, 4		; Статус
		call	getExitDat	; Получает указатель на состояние двери
		ld	(hl), 0x50	; Состояние «дверь закрывается»

		pop	hl		; Указатель на дверь
		ld	d, (hl)		; Координата Y центра двери
		inc	hl
		inc	hl
		ld	e, (hl)		; Координата X центра двери

;  Блок «два наложенных спрайта x две пары по Y» был здесь ПОБАЙТНО тем же, что в
;  setFlechaSalida; вынесен в setSprPuerta (см. коммент там), −26 Б на оба места.
		call	setSprPuerta	; D = Y центра двери, E = X центра двери

		xor	a
		ld	(statusEntrada), a ; Подсостояние двери, через которую входит в пирамиду
		inc	a
		ld	(sentidoProta),	a ; 1 = влево, 2 = вправо
		ret

;  sdp_invpat: HL = начало столбца паттерна, B = строк. Инвертирует байты на месте.
sdp_invpat:
		ld	a, (hl)
		cpl
		ld	(hl), a
		inc	hl
		dec	b
		jp	nz, sdp_invpat
		ret


;----------------------------------------------------
; Начальные значения следующих переменных при
; старте фазы
;
; Скорость X дробная часть,
; Скорость X целая часть,
; Скорость X комната,
; Счётчик движения,
; Кадр
;----------------------------------------------------
protaDataDoor:	db 0x0C8, 0, 0, 1, 1


;----------------------------------------------------
; Атрибуты входной двери
; x, y, спрайт, цвет
;----------------------------------------------------
;  ПОРЯДОК ВНУТРИ ПАРЫ ПЕРЕВЁРНУТ (задача «ворота», 2026-08-03): сначала ЗАЛИВКА (база,
;  сплошной прямоугольник), потом РАСШИВКА (деталь поверх неё). Сортировка вывода
;  устойчива, а lo0 у пары одинаков — значит порядок в этой таблице и есть порядок
;  рисования. Оба спрайта пары получают одни и те же Y/X (initDoorProta5/setSprPuerta2),
;  так что перестановка внутри пары геометрию не трогает.
attribDoor:	db 0x0E0,0x0B0,0x0DC,   3	; Заливка кирпичей — БАЗА (p1+p2, гасит p0)
		db 0x0E0,0x0B0,0x0D8,   1	; Рисунок кирпичей — ДЕТАЛЬ (p0, паттерн инвертирован)
		db 0x0E0,0x0B0,0x0E4,   3	; Заливка
		db 0x0E0,0x0B0,0x0E0,   1	; Рисунок кирпичей


;----------------------------------------------------
; AI мумий
; Интеллект мумий
; В зависимости от типа мумии они больше или меньше сомневаются при принятии решения
; и быстрее или медленнее ходят по лестницам.
; Пытаются приблизиться к герою и следят, чтобы не появиться внезапно сбоку экрана, когда герой у края
;----------------------------------------------------

AI_Momias:
		xor	a		; Начинает с первой мумии :)
		ld	(momiaEnProceso), a

nextMomia:
		call	getMomiaProcDat	; HL = запись мумии (она же (z80_ix) и (pMomiaProceso))
;  [logic-opt] Было: 2 x exx-эмуляция через ячейки z80_de_alt/z80_bc_alt/z80_hl_alt (HL
;  брался из alt-DE', статус гулял через z80_bc_alt+1, alt-HL' писался и не читался
;  никем). Суммарный эффект: A = статус, управление := направление >> 2, HL = запись.
;  Теперь то же напрямую; D берёт статус (D мёртв: диспетчер и обработчики пишут его
;  раньше, чем читают).
		ld	d, (hl)		; статус
		inc	hl
		ld	a, (hl)		; направление
		rrca
		rrca
		and	0x3F		; направление >> 2 (логически)
		inc	hl
		ld	(hl), a		; управление = направление >> 2
		ld	a, d		; A = статус для диспетчера

		ld	hl, updateMomiaAtr ; Обновляет RAM-атрибуты мумии
		push	hl		; Кладёт эту функцию в стек, чтобы выполнить её по окончании текущего процесса


		call	jumpIndex	; В зависимости от состояния мумии переходит к одной из следующих функций


		dw momiaAnda		; 0 = Ходит, проверяет падение или решает прыгнуть. По окончании переходит в состояние размышления
		dw momiaSaltando	; 1 = Обрабатывает прыжок
		dw momiaCayendo		; 2 = Мумия падает. Достигнув пола, переходит в состояние ходьбы
		dw momiaEscaleras	; 3 = Двигает мумию по лестнице и проверяет, дошла ли она до её конца
		dw momiaLimboW		; 4 = Ждёт некоторое время перед переходом к следующему состоянию (появление)
		dw momiaAparW		; 5 = Процесс появления мумии из облака пыли
		dw momiaSuicida		; 6 = Идёт вправо и взрывается
		dw momiaPiensa		; 7 = Смотрит по сторонам и решает, как приблизиться к герою
		dw momiaDesaparece

;----------------------------------------------------
; Мумия ходит
; Если таймер мумии = 0, переходит в состояние размышления и задаёт, сколько раз она будет сомневаться перед решением
; Когда мумия ударяется о стену, её уровень стресса растёт.
; Каждый раз, когда удаётся немного пройти без столкновений, уровень стресса падает.
; При сильном стрессе мумия в итоге взрывается.
; Так она не застревает в яме или в тупике
;----------------------------------------------------

momiaAnda:
;  timer==0 → status=THINK, timer=vecesDuda[tipo]. Один курсор по записи.
		call	getMomiaTimer	; HL -> ACTOR_TIMER (+17) мумии из z80_ix
		ld	a, (hl)
		or	a
	jp nz,momiaAnda2

		ld	de, ACTOR_STATUS-ACTOR_TIMER
		add	hl, de		; ->STATUS
		ld	(hl), 7
		ld	de, ACTOR_TIPO
		add	hl, de
		ld	a, (hl)
		ld	de, vecesDudaMomia
		call	ADD_A_DE
		ld	a, (de)
		ld	de, ACTOR_TIMER-ACTOR_TIPO
		add	hl, de		; ADD_A_DE не трогает HL
		ld	(hl), a
		ret

momiaAnda2:
		ld	a, 0x0F
		call	tmrAnd	; [door-wall r3] маска под 25 Гц (демо: прежняя)
	jp nz,momiaAnda3

		call	getMomiaTimer	; HL -> ACTOR_TIMER (+17) мумии из z80_ix
		dec	(hl)		; Каждые 16 итераций уменьшает время ходьбы

momiaAnda3:
		pop	hl		; Снимает со стека процедуру updateMomiaAtr
		call	evitaSorpresa	; Не даёт мумии появиться сбоку

		ld	hl, updateMomiaAtr ; Функция, обновляющая RAM-атрибуты
		push	hl		; Кладёт функцию в стек

		ld	hl, (z80_ix)	; NAT: ветка «мумия ходит» (нативная пометка)
		inc	hl		; ->ACTOR_CONTROL +1
		ld	a, (hl)	; 1=вверх 2=вниз 4=влево 8=вправо
;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ (каждый тик ходьбы мумии): (1) спилл A через il_a
;  вокруг bit-теста снят — A мёртв на обоих выходах (tryToJump начинает с getYMomia,
;  который пишет A; путь падения идёт в chkCae -> chkTocaMuro -> getMapOffset, где A пишет
;  первый же `ld a,(hl)`); (2) мёртвый хоровод `ld (il_tmp),hl / ld hl,(z80_ix) / push hl /
;  ld hl,(il_tmp) / pop hl / inc hl` снят целиком: HL до него УЖЕ = (z80_ix)+1 (см. две
;  строки выше), суммарный эффект — тождество; чтение il_tmp там же перетиралось pop hl,
;  а каждый живой читатель il_tmp пишет его сам в своём же базовом блоке (ISR ячейку
;  только спасает-восстанавливает). ~-125 т/тик на мумию, -17 Б.
	and 1<<4
		jp	nz, tryToJump	; Прыгает, если нет препятствий

		push	hl		; Указатель на управление мумией
		inc	hl
		inc	hl		; Указывает на координату Y
		call	chkCae		; Проверяет, есть ли пол под ногами
		pop	hl
		jp	c, momiaSinSuelo ; Сейчас упадёт или решает прыгнуть

		push	hl		; Указатель на управление (+#01)
		ld	a, 1		; Мумии не обновляют переменную героя "sentidoEscalera"
		ld	(modoSentEsc), a ; Если 0 — сохраняет в "sentidoEscalera" тип лестницы, на которую встаёт герой. 0 = \, 1 = /
		call	chkCogeEsc2	; Проверяет, начинает ли подниматься или спускаться по лестнице
		pop	hl
		jp	z, setSentEsc	; Встала на лестницу

		call	chkChocaAndar2	; Проверяет столкновение со стеной или вращающейся дверью

		push	af
		ld	a, ACTOR_STRESS	; Счётчик столкновений (стресс)
		call	getVariableMomia
		pop	af

		ld	a, (hl)		; Число столкновений
	jp nc,momiaDecStress	; Не сталкивается со стеной или вращающейся дверью. Уменьшает число решений

; Мумия ударилась о стену
; Если число почти подряд идущих столкновений равно 9 — мумия взрывается
; Так она не застревает в яме или в тупике
		and	0x0F0
		add	a, 0x1F		; Увеличивает стресс мумии
		ld	(hl), a
		cp	0x0AF
	jp nz,momiaHaChocado

momiaVanish:
		push	af
		push	de
		push	hl
		ld	hl, (z80_ix)	; NAT IX->HL S2
		ld	(hl), 8	; ACTOR_STATUS +0
		inc	hl
		ld	(hl), 4	; ACTOR_CONTROL +1
		ld	de, 0x10
		add	hl, de	; ->ACTOR_TIMER +17
		ld	(hl), 0x22
		pop	hl
		pop	de
		pop	af
		ret

momiaDecStress:
		cp	0x0F0
	jp z,momiaUpdate	; Если счётчик стресса 0, не уменьшает его

		ld	a, 0x1F
		call	tmrAnd	; [door-wall r3] маска под 25 Гц (демо: прежняя)
	jp nz,momiaUpdate	; Уменьшает только каждые #20 итераций

		dec	(hl)		; Уменьшает стресс мумии
	jp nz,momiaUpdate	; (!?) Зачем?

;----------------------------------------------------
; Обновляет позицию и кадр мумии
; 25 Гц: два шага 0xA8 с chkChocaAndar2 между ними (mumWalk2). Иначе ×2 одним
; mueveElemento даёт +2 px и минует X&7==0/4 — мумия входит в стену.
;----------------------------------------------------

momiaUpdate:
		call	isPl
		jp	z, momiaUpd_s	; демо (bit6=0): один шаг, как на 50 Гц
		call	mumWalk2
		jp	momiaCalcFrame
momiaUpd_s:
		call	mueveMomia
		jp	momiaCalcFrame

;----------------------------------------------------
; После удара о стену мумия прыгает или разворачивается
; Если она самая глупая и застряла между двумя стенами — останавливается подумать
;----------------------------------------------------

momiaHaChocado:
		dec	hl
		ld	a, (hl)		; Тип мумии
		or	a		; Самая глупая? =0
	jp nz,saltaOVuelve	; Нет

		call	getYMomia
		dec	hl
		ld	a, (hl)		; Направление
		xor	3		; Инвертирует право/лево
		ld	b, a		; Меняет направление движения (разворачивает её)
		call	chkChocaAndar4	; С другой стороны тоже упирается?
	jp nc,saltaOVuelve	; Не сталкивается


; Глупая (белая) мумия застряла между двумя стенами

;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ: две ix-обёртки -> прямая адресация (запись мумии
;  0xFE4D-0xFEA0, перенос L+0x11 невозможен). A/F/HL на выходе мертвы: ret ведёт в
;  updateMomiaAtr (снятый со стека), тот пишет HL/C/B до чтения, getMomiaAtrib пишет A,
;  первый флаговый потребитель — его собственный cp. -260 т на событие, -17 Б.
		ld	hl, (z80_ix)
		ld	a, l
		add	a, ACTOR_TIMER
		ld	l, a		; ->ACTOR_TIMER +17
		ld	(hl), 0x0FF	; «Думает» до упора
		ld	hl, (z80_ix)
		ld	(hl), 7		; ACTOR_STATUS: состояние размышления
		ret

;----------------------------------------------------
; Мумия прыгает, если может. Если нет — разворачивается
;----------------------------------------------------

saltaOVuelve:
		call	getYMomia
		cp	8
	jp c,daLaVuelta	; Слишком высоко, разворачивается

		call	chkSaltar	; Может прыгнуть? (Ничего сверху и спереди)
		jp	c, momiaSetSalta ; Прыгает

daLaVuelta:
		push	hl
		ld	hl, (z80_ix)	; NAT IX->HL S2
		inc	hl	; ->ACTOR_CONTROL +1
		ld	a, (hl)
		xor	0x0C		; Меняет направление
		ld	(hl), a
		pop	hl ;	1 = вверх, 2 = вниз, 4 = влево, 8 = вправо
		ret

;----------------------------------------------------
; Увеличивает счётчик движений и обновляет номер кадра
;----------------------------------------------------

momiaCalcFrame:
		ld	a, 0x0A		; Смещение к счётчику движений
		call	getVariableMomia
		inc	(hl)		; Увеличивает число движений
		jp	calcFrame2	; Обновляет номер кадра (0-7) по накопленному числу движений

;----------------------------------------------------
; Сохраняет направление лестницы в структуре мумии
; In:
;   C = тайл карты (лестница)
;----------------------------------------------------

setSentEsc:
		ld	hl, (z80_ix)	; NAT IX->HL S4 setSentEsc
		inc	hl		; ->ACTOR_CONTROL +1
		ld	a, (hl)
		rra			; Переносит управление ВВЕРХ в carry
		ld	a, c
		ld	b, 8		; Управление: ВПРАВО
	jp nc,setSentEsc2	; ВВЕРХ не нажат

		ld	b, 4		; Управление: ВЛЕВО
		xor	1

setSentEsc2:
		and	1
		ld	hl, (z80_ix)	; NAT S4
		ld	de, 0x0F
		add	hl, de		; ->ACTOR_SENT_ESC +15
		ld	(hl), a		; Направление лестницы 0=\ 1=/
		and	a
		ld	a, b
	jp z,setSentEsc3
		xor	0x0C		; Меняет направление движения

setSentEsc3:
		ld	hl, (z80_ix)	; NAT S4
		inc	hl		; ->ACTOR_CONTROL +1
		ld	(hl), a
		ret

;----------------------------------------------------
; Сколько раз сомневается (смотрит по сторонам) каждая мумия,
; когда решает следующий ход
;----------------------------------------------------
vecesDudaMomia:	db    3
		db    3
		db    0
		db    0
		db    3


;----------------------------------------------------
; Обновляет RAM-атрибуты мумии
; Её позицию и кадр. Скрывает её, если она в другой комнате
;----------------------------------------------------

updateMomiaAtr:
;  SAT := (y-2+[even], x, framesMomia[frame] + 0x60*left) если room==ProtaRoom, иначе Y=#E0.
;  Один проход по записи: sentido, Y, X, room, frame. SAT — после решения.
		ld	hl, (z80_ix)
		inc	hl
		inc	hl
		ld	e, (hl)		; SENTIDO
		inc	hl
		ld	c, (hl)		; Y
		inc	hl
		inc	hl
		ld	b, (hl)		; X
		inc	hl
		ld	a, (ProtaRoom)
		cp	(hl)
	jp nz,uma_hide
		push	de		; E=sentido
		ld	de, ACTOR_FRAME-ACTOR_ROOM
		add	hl, de
		ld	a, (hl)		; FRAME
		pop	de
		ld	d, a
		dec	c
		dec	c
		rra
	jp c,uma_odd
		inc	c
uma_odd:
		ld	a, d
		push	bc
		push	de
		ld	de, framesMomia
		call	ADD_A_DE
		ld	a, (de)
		pop	de
		pop	bc
		ld	d, a		; D = паттерн
		push	bc
		push	de
		call	getMomiaAtrib
		pop	de
		pop	bc
		ld	(hl), c
		inc	hl
		ld	(hl), b
		inc	hl
		ld	a, e
		rra
		ld	a, d
	jp nc,setFrameMomia
		add	a, 0x60

setFrameMomia:
		ld	(hl), a
	jp chkLastMomia

uma_hide:
		call	getMomiaAtrib

hideMomia:
		ld	(hl), 0x0E0	; Скрывает спрайт (Y = #E0)

chkLastMomia:
		ld	hl, momiaEnProceso ; Проверяет, остались ли необработанные мумии
		inc	(hl)
		ld	a, (hl)
		dec	hl
		cp	(hl)		; Все мумии обработаны?
		ret	nc		; Да, конец
		jp	nextMomia

framesMomia:	db 0x2C			; Нога сзади
		db 0x28			; Ноги вместе
		db 0x30			; Ноги врозь
		db 0x2C			; Нога сзади
		db 0x28			; Ноги вместе
		db 0x30			; Ноги врозь
		db 0x28			; Ноги вместе
		db 0x30			; Ноги врозь
		db 0x0E8			; Большое облако
		db 0x0EC			; Маленькое облако
		db 0x0D4			; Блеск

;----------------------------------------------------
; Пытается прыгнуть
; Прыгает, если не слишком высоко и нет препятствий
;----------------------------------------------------

tryToJump:
		call	getYMomia
		ld	a, (hl)
		cp	8
		ret	c
		call	chkSaltar
		ret	nc


;----------------------------------------------------
; Ставит состояние прыжка
; Сохраняет указатель на значения смещений Y прыжка
;----------------------------------------------------

momiaSetSalta:
		ld	hl, (z80_ix)	; NAT IX->HL Step0: указатель структуры мумии

Salta:	
		ld	(hl), 1		; Status = прыжок
		inc	hl
	push af	; Убирает «кнопку A» из состояния клавиш элемента
	ld a,(hl)
	and 255&(~(1<<4))
	ld (hl),a
	pop af

		ld	a, 0x0A
		call	ADD_A_HL
		ld	(hl), 2		; Кадр 2 = ноги врозь
		inc	hl
		ld	de, valoresSalto
		ld	(hl), e
		inc	hl
		ld	(hl), d		; Сохраняет указатель на значения прыжка

		inc	hl
		ld	(hl), 0		; Прыжок вверх (1 = падение)
		ret

;----------------------------------------------------
; Мумия прыгает
; Обновляет координаты мумии и проверяет столкновение
; с чем-либо, чтобы снять состояние прыжка и
; поставить ходьбу или падение.
;----------------------------------------------------

momiaSaltando:
		call	getYMomia	; Получает указатель на данные мумии
		dec	hl
		push	hl
	ld (il_tmp),hl
	ld hl,(z80_ix)
	push hl
	ld hl,(il_tmp)
		call	doSalto		; Обрабатывает прыжок

	ld (il_tmp),hl
	pop hl
	ld (z80_ix),hl
	ld hl,(il_tmp)
		pop	hl
		call	chkPasaRoom	; Проверяет переход в другую комнату
		ld	hl, (z80_ix)	; указатель на структуру мумии

		inc	hl
		xor	a
		cp	1
		call	chkChocaSalto1
	jp z,momiaCayendo	; Да, снимает состояние прыжка и ставит падение (если нет пола) или ходьбу (если есть)
		ret


;----------------------------------------------------
; Проверяет, достиг ли элемент границ экрана,
; и переходит в другую комнату
; Out:
;   Z = переходит в другую комнату
;  NZ = не переходит
;----------------------------------------------------

chkPasaRoom:
		ld	a, (hl)		; Направление
		inc	hl
		inc	hl
		inc	hl		; Указывает на X
		ld	b, 0		; Левая граница = 0
		rra			; Вправо или влево?
	jp nc,chkPasaRoom2
		dec	b		; Правая граница = 255

chkPasaRoom2:
		ld	a, b		; Граница
		cp	(hl)		; Сравнивает её с X элемента
		inc	hl
		ret	nz		; Не достиг границы комнаты

		inc	(hl)		; Переходит в комнату справа
		and	a
		ret	z

		dec	(hl)
		dec	(hl)		; Переходит в комнату слева
		ret

;----------------------------------------------------
; Когда мумия доходит до края платформы,
; она может прыгнуть или упасть
;----------------------------------------------------

momiaSinSuelo:
		ld	hl, (z80_ix)	; NAT IX->HL S2b
		ld	de, 0x14
		add	hl, de	; ->ACTOR_TIPO +20
		ld	a, (hl)
		and	a
	jp z,momiaCayendo	; Самая глупая мумия. Никогда не прыгает

		cp	3
	jp z,momiaCayendo

		ld	hl, (z80_ix)	; NAT S2b POS_RELAT
		ld	de, 0x10
		add	hl, de	; ->ACTOR_POS_RELAT +16
		ld	a, (hl)	; 0 = на той же высоте (почти), 1 = мумия выше, 2 = ниже
		cp	1		; Мумия выше героя?
	jp z,momiaCayendo	; Да, даёт себе упасть, чтобы спуститься

		call	getYMomia	; Получает Y мумии
		ld	a, (hl)		; (!?) Не нужно
		cp	8		; Слишком близко к верху экрана?
	jp c,momiaCayendo	; Не прыгает

; Будет прыгать
		call	chkSaltar	; Есть место для прыжка?
		jp	c, momiaSetSalta ; да, прыгает


;----------------------------------------------------
; Обрабатывает падение мумии и проверяет достижение пола
; Достигнув пола, ставит состояние ходьбы
;----------------------------------------------------


momiaCayendo:
		ld	hl, (z80_ix)
		call	cayendo		; Увеличивает Y и проверяет столкновение с полом
		jp	nc, setMomiaAndar ; Не падает, ставит состояние ходьбы
		ret

momiaEscaleras:
		ld	hl, (z80_ix)
		inc	hl
		ld	a, (hl)		; Управление
		and	0x0C
		ret	z		; Не идёт ни вправо, ни влево

		push	hl		; andaEscalera ждёт HL на CONTROL (+1)
		ld	de, ACTOR_TIPO-ACTOR_CONTROL
		add	hl, de		; тип мумии
		ld	a, (hl)
		ld	de, pausaEscalera
		call	ADD_A_DE
		ld	a, (de)		; Маска, накладываемая на таймер для замедления движения мумии на лестнице
		ld	b, a
		pop	hl
		ld	a, 1
		ld	(quienEscalera), a ; кто на лестнице: 0 = герой, 1 = мумия
		call	andaEscalera
	jp z,setMomiaPensar	; Дошла до конца лестницы
		jp	momiaCalcFrame	; peephole: был `call ... / ret` -> хвостовой jp

setMomiaPensar:
		call	getMomiaTimer	; HL -> ACTOR_TIMER (+17) мумии из z80_ix
		ld	(hl), 0 ; Таймер 0 + состояние ходьбы → на следующей итерации переход в состояние размышления

setMomiaAndar:
		xor	a
;  [СНЯТО, 2 Б] `ld a,3` — сирота за безусловным jp, «(!?) никогда не выполняется».
;  [СНЯТО, 3 Б] и сам `jp setMomiaStatus`: прыжок на следующую инструкцию (peephole).
setMomiaStatus:
		push	hl
		ld	hl, (z80_ix)	; NAT IX->HL S1
		ld	(hl), a	; ACTOR_STATUS +0
		pop	hl
		ret

;----------------------------------------------------
; Кадры, на которые каждый тип мумии останавливается на каждом шаге
; по лестнице
; 0 = очень быстро, 3 = медленно
;----------------------------------------------------
pausaEscalera:	db    3
		db    0
		db    1
		db    0
		db    3

;----------------------------------------------------
; Состояние мумии по умолчанию при старте партии
; Ждёт некоторое время перед появлением
; Таймер = #10, чтобы не появлялась сразу после старта
;----------------------------------------------------

momiaLimbo:
		pop	hl		; Снимает со стека функцию обновления атрибутов мумии (не видна)
;  25 Гц: timer уже +1 за логический тик (runGame). Оригинал 50 Гц + and 1 = те же
;  25 декрементов/с. Второй and 1 здесь давал 12.5/с — лимбо вдвое дольше MSX.
		call	getMomiaTimer	; HL -> ACTOR_TIMER (+17) мумии из z80_ix
		dec	(hl)
		jp	nz, chkLastMomia ; Ещё не пришло время появления
		ld	hl, (z80_ix)
		inc	(hl)	; ACTOR_STATUS +0
		ld	de, 0x11
		add	hl, de	; ->ACTOR_TIMER +17
		ld	(hl), 0x41	; 0x82/2: облако 2.6 с как на MSX (130 тиков / 50 Гц)

		ld	a, 0x87		; SFX появления мумии
		call	setMusic
		jp	chkLastMomia	; Проверяет, остались ли необработанные мумии

;----------------------------------------------------
; Процесс появления мумии
; Уменьшает время появления. По истечении переходит в состояние 0
; Если осталось меньше 8 итераций — показывает мумию с расставленными ногами, смотрящую влево
; Облако: кадр пишем каждый логический тик (иначе 0.64 с одной картинки на 25 Гц
; выглядит как залипание). Размер — bit 3, каждые 8 тиков = 0.32 с (на MSX 32/50 = 0.64 с).
;----------------------------------------------------

momiaAparece:
		call	mfd_pro		; CONTROL=8 (смотрит вправо), ACTOR_TIMER-1, A=B=ACTOR_TIMER, Z если вышел
		jp	z, setMomiaViva
		cp	3		; Скоро оживёт? (7/2 на 25 Гц)
	jp c,momiaOpenLegs	; Показывает мумию с расставленными ногами

		and	1<<3
		ld	a, 8		; Кадр большого облака
	jp z,setMomiaFrame

		inc	a		; Кадр маленького облака

setMomiaFrame:
		ld	hl, (z80_ix)	; NAT IX->HL
		ld	de, 0x0B
		add	hl, de	; ->ACTOR_FRAME (+11)
		ld	(hl), a
		ret

setMomiaViva:
		call	setMomiaAndar

momiaOpenLegs:
		ld	a, 2		; Расставленные ноги
		jp	setMomiaFrame

;  [дедуп 2026-08-18] пролог и «вспышка исчезновения» общие с momiaDesaparece
;  (стояли дважды по ~29 Б). Z от dcr ACTOR_TIMER доживает до jp z в сайте
;  (mov флаги не трогает); B = счётчик, как и раньше.
mfd_pro:
		ld	hl, (z80_ix)	; NAT IX->HL S3b
		inc	hl	; ->ACTOR_CONTROL +1
		ld	(hl), 8
		ld	de, 0x10
		add	hl, de	; ->ACTOR_TIMER +17
		dec	(hl)
		ld	a, (hl)
		ld	b, a		; (!?) Где используется B?
		ret
mfd_flash:
		and	0x1F
		ret	nz
		ld	hl, (z80_ix)
		ld	de, 0x0B
		add	hl, de	; ->ACTOR_FRAME +11
		ld	(hl), 0x0A	; Кадр вспышки исчезновения
		ret

momiaSuicida:
		call	mfd_pro
	jp z,mataMomia
		jp	mfd_flash

mataMomia:
		call	quitaMomia
		pop	hl
		jp	chkLastMomia	; Проверяет, остались ли необработанные мумии


;----------------------------------------------------
; Отправляет мумию в лимб.
; Убирает её спрайт с экрана.
; После взрыва мумия на время уходит в лимб
;----------------------------------------------------

quitaMomia:
		call	getMomiaAtrib
		ld	(hl), 0x0E0	; Y = #E0. Убирает мумию с экрана
;  [2026-09-19] ТОЧНОЕ: три vec_ix_ofs -> (z80_ix). SAT-запись в HL после
;  getMomiaAtrib больше не читается. AF на выходе мёртв (mataMomia / quitaACTOR_
;  не читают A/F). Переноса страницы нет — см. шапку chkKnifeMomia2.
		ld	hl, (z80_ix)
		ld	(hl), 4		; ACTOR_STATUS = лимб
		ld	de, ACTOR_TIMER
		add	hl, de
		ld	(hl), 0x80
		ld	hl, (z80_ix)
		ld	de, ACTOR_FRAME
		add	hl, de
		ld	(hl), 9
		ret

;----------------------------------------------------
; Получает указатель на атрибуты в RAM обрабатываемой мумии
; HL = указатель
;----------------------------------------------------

getMomiaAtrib:
		ld	a, (momiaEnProceso)
		ld	hl, enemyAttrib

getMomiaAtrib2:
		add	a, a
		add	a, a
		jp	ADD_A_HL

getYMomia:
		ld	a, 3		; Координата Y

;----------------------------------------------------
; Возвращает значение A из структуры текущей мумии
; In: A = какое значение читать
; Out: A = прочитанное значение
;----------------------------------------------------

getVariableMomia:
;  [logic-opt] call ADD_A_HL -> add/ld: записи мумий лежат в momiaDat 0xFE4D-0xFE8F (+0x15 <
;  0xFF00), все смещения <= ACTOR_STRESS(0x15), переноса через границу страницы нет
;  (так же сделано в chkTocaMomia4/momiaPiensa; раскладку проверяет lo_gate.sh). -28 т на вызов.
		ld	hl, (pMomiaProceso) ; Указатель на данные обрабатываемой мумии
		add	a, l
		ld	l, a
		ld	a, (hl)
		ret


;----------------------------------------------------
; Мумия думает, что делать
; Смотрит по сторонам столько раз, сколько задаёт TIMER
; In:
;    IX = данные мумии
;----------------------------------------------------

;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ (образец — chkTocaMomia, коммит 6701b16): пять
;  ix-обёрток -> прямая адресация от (z80_ix). z80_ix здесь всегда запись мумии
;  (getMomiaDat на входе AI_Momias, между ним и диспетчером jumpIndex z80_ix никто не
;  пишет; momiaDecide сам читает (z80_ix) так же). Записи живут в momiaDat 0xFE4D-0xFEA0,
;  смещения <= 0x11, потому L+смещение (и внутренние переходы &TIMER->&FRAME->&SENTIDO->
;  &TIMER: L в 0x4D..0xB1) не переносятся через страницу.
;  МЁРТВОСТИ: входной A (оригинал сам перетирал его `ld a,(il_a)`), входной HL (все три
;  выхода — momiaUnknown, ret и momiaPiensa2 — пишут HL до чтения: `ld hl,(z80_ix)` /
;  возврат в updateMomiaAtr), E (updateMomiaAtr пишет DE `ld de,6` до чтения, getMomiaAtrib
;  DE не трогает), A и флаги на выходах (updateMomiaAtr начинает с ld hl/ld c и getMomiaAtrib
;  пишет A; первый флаговый потребитель — собственный cp). CY на ret nz(дум): у оригинала 0
;  от and 0x1F, у нас 0 от add без переноса — совпадает. ~-600 т на думающую мумию, -47 Б.
momiaPiensa:
		ld	hl, (z80_ix)
		ld	a, l
		add	a, ACTOR_TIMER
		ld	l, a		; HL = &TIMER (переноса нет)
		ld	a, (hl)		; Сколько раз колеблется
		or	a
	jp z,momiaPiensa2	; Уже подумала

		cp	0x0E0
	jp z,momiaUnknown

		ld	e, a		; E = счётчик (E мёртв, см. шапку)
		ld	a, l
		sub	ACTOR_TIMER-ACTOR_FRAME
		ld	l, a		; ->ACTOR_FRAME +11
		ld	(hl), 2		; Кадр расставленных ног
		ld	a, e
		and	3
		ld	e, a		; Направление взгляда
		ld	a, l
		sub	ACTOR_FRAME-ACTOR_SENTIDO
		ld	l, a		; ->ACTOR_SENTIDO +2
		ld	(hl), e

		ld	a, 0x1F
		call	tmrAnd	; [door-wall r3] маска под 25 Гц (демо: прежняя)
		ret	nz		; Остаётся в этой позе 32 кадра

		ld	a, l
		add	a, ACTOR_TIMER-ACTOR_SENTIDO
		ld	l, a		; ->ACTOR_TIMER +17 (переноса нет)
		dec	(hl)		; Уменьшает счётчик взглядов по сторонам
		ret	nz		; Ещё нужно немного подумать

momiaPiensa2:
		call	momiaDecide	; Принимает решение, как приблизиться к герою
		ld	hl, (z80_ix)
		ld	(hl), 0		; ACTOR_STATUS: ходьба (A и флаги не тронуты, как в оригинале)
		ret

; (!?) Зачем это нужно?

momiaUnknown:
		ld	hl, (z80_ix)	; NAT IX->HL S2b
		inc	hl	; ->ACTOR_CONTROL +1
		ld	a, (hl)
		xor	0xc
		ld	(hl), a
		rra
		rra
		and	3
		inc	hl	; ->ACTOR_SENTIDO +2
		ld	(hl), a ;	1 = влево, 2 = вправо

		call	getYMomia
		ld	bc, 0x0FC	; X+15,Y+12
		call	getMapOffset	; Получает в HL адрес карты, соответствующий координатам
		ld	b, a		; (!?) Сохраняет тайл карты в B. Зачем?
		and	0x0F0		; Оставляет семейство (тип) тайла
		cp	0x10
		jp	nz, tryToJump	; Переход, если нет стены/платформы справа снизу

		call	getYMomia
		ld	bc, 0x10FC	; X+16,	Y-4
		call	getMapOffset	; Получает в HL адрес карты, соответствующий координатам
		ld	b, a		; (!?) Зачем сохраняет в B?
		and	0x0F0
		cp	0x10
		jp	nz, tryToJump	; переход, если нет стены/платформы справа сверху
		jp	momiaVanish

momiaDesaparece:
		call	mfd_pro	; [дедуп 2026-08-18] общий пролог, см. mfd_pro
	jp z,quitaACTOR_	; Время вышло. Мумия исчезает
		jp	mfd_flash

quitaACTOR_:
		call	quitaMomia	; Убирает спрайт с экрана и отправляет мумию в лимб (состояние 4)
		call	getMomiaTimer	; HL -> ACTOR_TIMER (+17) мумии из z80_ix
		ld	(hl), 0x0FF
		call	initMomia
		pop	hl
		jp	chkLastMomia	; Проверяет, остались ли необработанные мумии


;----------------------------------------------------
; Не даёт мумии появиться сбоку, когда герой рядом
; Если мумия находится у бокового края
; соседней комнаты, а герой у смежного края,
; направление мумии меняется, чтобы она не появилась «внезапно»,
; не оставив времени среагировать и увернуться
;----------------------------------------------------

evitaSorpresa:
;  [2026-09-19] DE' держал тот же указатель, что z80_ix (кладёт getMomiaDat).
;  После call основной HL всё равно перезаписывается, DE/BC не читаются.
	ld	hl, (z80_ix)
	ex	de, hl			; DE = указатель на структуру мумии
		ld	hl, 6		; Смещение к переменной 'room'
		add	hl, de
		ld	a, (ProtaRoom)	; Старшая часть координаты X. Указывает комнату пирамиды
		ld	b, (hl)		; B = комната мумии
		cp	(hl)		; Проверяет, в текущей ли комнате мумия
	ret	z		; да

		dec	hl
		ld	a, (hl)		; X мумии
		ld	c, 0x50
		cp	c
	jp c,evitaSorpresa2	; X мумии меньше #50

		ld	c, 0x0B0
		cp	c
	ret	c		; X мумии меньше #B0. Она не у боковых краёв

		inc	b
		inc	b

evitaSorpresa2:
		dec	b
		ld	a, (ProtaRoom)	; Старшая часть координаты X. Указывает комнату пирамиды
		cp	b		; Она у края, ближнего к комнате героя?
	ret	nz		; Нет

		xor	a
		sub	c
		ld	c, a
		cp	0x50
		ld	a, (ProtaX)
	jp z,evitaSorpresa5

		cp	c
	ret	c

evitaSorpresa3:
		inc	hl
		ld	a, (ProtaRoom)	; Старшая часть координаты X. Указывает комнату пирамиды
		cp	(hl)		; Комната мумии
		ld	a, 8		; Меняет направление на вправо
	jp c,evitaSorpresa4

		ld	a, 4		; Меняет направление на влево

evitaSorpresa4:
		ld	h, d
		ld	l, e		; Указатель на структуру мумии
		inc	hl
		ld	(hl), a		; Направление движения мумии
		ret

evitaSorpresa5:
		cp	c
	jp c,evitaSorpresa3

evitaSorpresa6:
		ret

;----------------------------------------------------
; Мумия принимает решение
; Ищет героя и движется к нему
;----------------------------------------------------

momiaDecide:
		ld	a, 5
		call	getMomiaTimer	; HL -> ACTOR_TIMER (+17) мумии из z80_ix
		ld	(hl), a

		call	buscaCercanias	; Ищет поблизости лестницы вверх или вниз (5 тайлов в каждую сторону)
		call	buscaProta	; Проверяет положение мумии относительно героя
		and	a
	jp z,momiaDecide2	; На той же высоте

		dec	a
	jp z,setOrdenBajar	; Мумия выше

		dec	a
	jp z,setOrdenSubir	; Мумия ниже

momiaDecide2:
		ld	a, (ProtaRoom)	; комната пирамиды
		ld	hl, (z80_ix)	; NAT IX->HL S4
		ld	de, 6
		add	hl, de		; ->ACTOR_ROOM +6
		cp	(hl)		; cmp m: флаги как у cp, A сохраняется
	jp nz,momiaDecide3	; они в разных комнатах

		ld	a, (ProtaX)
		ld	hl, (z80_ix)	; NAT IX->HL S4
		ld	de, 5
		add	hl, de		; ->ACTOR_X +5
		cp	(hl)		; Сравнивает X героя с X мумии

momiaDecide3:
		ld	a, 8		; Управление: идти ВПРАВО
	jp nc,momiaDecide4	; Герой справа

		ld	a, 4		; Управление: идти ВЛЕВО

momiaDecide4:
		ld	hl, (z80_ix)	; NAT IX->HL S4 momiaDecide4
		inc	hl		; ->ACTOR_CONTROL +1
		ld	(hl), a		; направление к герою

		ld	c, a
		ld	hl, ProtaY
		call	getMapOffset00	; Получает указатель на позицию героя в карте
		ex	de, hl
		call	getYMomia
		call	getMapOffset00	; Получает указатель на позицию мумии в карте


; Проверяет, есть ли препятствие между мумией и героем
; Если есть — попытается подняться или спуститься с текущего места

		ld	b, 0x20		; Ширина комнаты

momiaDecide5:
		and	a
		push	hl		; Карта мумии
	call vec_sbcd
		pop	hl
		ret	z		; Поиск дошёл до позиции героя

		ld	a, (hl)		; Тип тайла
		and	0x0F0		; Оставляет семейство
		cp	0x10		; Это платформа или стена?
	jp z,momiaDecide7	; Да

		dec	hl		; Тайл слева в карте
;  [2026-08-04] ТОЧНОЕ ПРЕОБРАЗОВАНИЕ: спилл A снят — восстановленный A (тип тайла)
;  МЁРТВ: обе ветки сходятся в momiaDecide6 -> momiaDecide5, где A участвует только в
;  `and a` (обнуление CY, значение A безразлично) и тут же перетирается `ld a,l`;
;  ветка momiaDecide7 уходит ДО этого места. Флаги для jp nz — от того же and.
	ld a,c	; Направление движения мумии
	and 1<<2
	jp nz,momiaDecide6	; Идёт влево

		inc	hl
		inc	hl		; Тайл справа

momiaDecide6:
	dec b
	jp nz,momiaDecide5
		ret

momiaDecide7:
	ld a, 0	; Z80 'ld a,i' -> I/R=0 на MSX (на i8080 нет регистров I/R; MVI сохраняет флаги) ; Случайное значение
		rra
		or	c		; Направление движения мумии
		rra
		call	c, setOrdenSubir

setOrdenBajar:
		ld	hl, ordenBajar
		ld	a, (hl)		; Движется к самой дальней (в радиусе поиска) лестнице вниз
		and	a

momiaSetControl:
		ret	z
		push	hl
		ld	hl, (z80_ix)	; NAT IX->HL S1
		inc	hl	; ->ACTOR_CONTROL +1
		ld	(hl), a
		pop	hl ;	1 = вверх, 2 = вниз, 4 = влево, 8 = вправо
		ret

setOrdenSubir:
		ld	hl, ordenSubir
		ld	a, (hl)		; Управление, чтобы идти к самой дальней (в радиусе поиска) лестнице вверх
		and	a
	jp momiaSetControl


;----------------------------------------------------
; Вычисляет положение мумии относительно героя
; Out: A и B
;   0 = почти на одной высоте
;   1 = мумия выше
;   2 = мумия ниже
;----------------------------------------------------

buscaProta:
		ld	b, 0
		ld	de, ProtaY
		call	getYMomia	; Получает Y мумии
		ld	a, (protaStatus) ; 0 = норма
					; 1 = прыжок
					; 2 = падение
					; 3 = лестница
					; 4 = бросок ножа
					; 5 = работа киркой
					; 6 = проход через вращающуюся дверь
		cp	3		; Лестница?
	jp z,buscaProta2

		ld	a, (de)		; Y героя
		sub	(hl)		; Вычитает Y мумии
		ld	c, a
		sub	10
		add	a, 18
	jp c,buscaProta3	; Почти на одной высоте

buscaProta2:
		inc	b
		ld	a, (de)		; Y героя
		sub	(hl)		; Y мумии
	jp nc,buscaProta3	; Мумия выше
		inc	b		; Мумия ниже

buscaProta3:
		ld	a, b
		ld	hl, (z80_ix)	; NAT IX->HL S1
		ld	de, 0x10
		add	hl, de	; ->ACTOR_POS_RELAT +16
		ld	(hl), a	; 0 = на той же высоте (или почти), 1 = мумия выше, 2 = ниже
		ret


;----------------------------------------------------
; Ищет поблизости от мумии,
; есть ли лестницы вверх, вниз или стена
; В зависимости от найденного сохраняет команды подняться или спуститься
;----------------------------------------------------

buscaCercanias:
		ld	b, 4
		ld	hl, ordenSubir

buscaCercanias2:
		ld	(hl), 0
		inc	hl
	dec b	; Стирает прежние команды подъёма/спуска
	jp nz,buscaCercanias2

		ld	hl, (z80_ix)	; данные мумии

		inc	hl
;  [2026-08-04] СХЛОПНУТА ПАРА СВОПОВ: было `call vec_exaf / ld a,(hl) / call vec_exaf`,
;  весь смысл — положить байт направления в ТЕНЕВОЙ A'. Раскладка z80_af_alt задана
;  самим vec_exaf (`push af / pop hl` -> L=F, H=A), значит A' лежит в z80_af_alt+1.
;  Флаги: `ld` их не трогает, поэтому и старый, и новый вариант оставляют F и F' как были.
;  ЕДИНСТВЕННОЕ отличие — старый вариант возвращал прежний A, новый оставляет в A
;  прочитанный байт. A здесь МЁРТВ: дальше идёт прямой участок без меток
;  `inc hl / inc hl / push hl / call buscaCercanias3`, а buscaCercanias3 начинается с
;  `call getYMomia`, первая же команда которого — `ld a,3`.
;  7 -> 4 байта, 337 -> 20 тактов; исполняется 12 раз за 3000 кадров (путь холодный).
		ld	a, (hl)		; Управление: направление движения
		ld	(z80_af_alt+1), a	; A' := направление

		inc	hl
		inc	hl
		push	hl		; Y
		call	buscaCercanias3	; Сначала ищет в текущем направлении
		pop	hl
;  [2026-08-04] СХЛОПНУТА ПАРА СВОПОВ вокруг `xor 0x0C`: наблюдаемый эффект конструкции
;  `call vec_exaf / xor 0x0C / call vec_exaf` — ровно A' ^= 0x0C (ячейка z80_af_alt+1,
;  раскладку задаёт vec_exaf: `push af / pop hl` -> L=F, H=A). Делаем это чтением-записью
;  ячейки напрямую. ДОКАЗАТЕЛЬСТВО МЁРТВОСТИ ЗАДЕТЫХ ОСТАТКОВ:
;   * F' у старого варианта = флаги `xor 0x0C`, у нового — прежний F'. Единственный
;     читатель — vec_exaf в начале buscaCercanias3-хвоста (ниже, «F <- F'»), а там до
;     первой команды, читающей флаги, стоит `and 1<<2` (dec hl = DCX, флагов не трогает;
;     ld флагов не читает) — F затирается раньше любого чтения;
;   * основной A: старый вариант его восстанавливал, новый оставляет A'^0x0C. A мёртв:
;     проваливаемся в buscaCercanias3 -> `call getYMomia`, его первая команда `ld a,3`;
;   * основной F: старый вариант сохранял, новый оставляет флаги `xor`. F мёртв: до
;     `add a,l` внутри ADD_A_HL (getVariableMomia) флаги никто не читает (ld/call/ld a,3).
;  8 -> 8 байт (ноль), ~327 -> 33 такта; исполняется 12 раз за 3000 кадров (путь холодный).
		ld	a, (z80_af_alt+1)	; A' — направление поиска
		xor	0x0C		; Инвертирует направление, чтобы искать в сторону, противоположную движению
		ld	(z80_af_alt+1), a	; A' ^= 0x0C, тени F' не касаемся

buscaCercanias3:
		call	getYMomia
		ld	bc, 0x0808	; X+8, Y+8 — центр клетки мумии
		call	getMapOffset	; Получает в HL адрес карты, соответствующий координатам

;  [2026-08-04] СХЛОПНУТЫ ДВЕ ПАРЫ СВОПОВ + два спилла A (горячий поиск лестниц, до
;  5 витков на мумию за решение). Весь смысл каждой пары `vec_exaf ... vec_exaf` — взять
;  байт направления из ТЕНЕВОГО A' (z80_af_alt+1, положен туда напрямую выше) для
;  bit-теста и вернуть тени как было. Читаем ячейку прямо. ДОКАЗАТЕЛЬСТВО:
;   * «основной» A, который пары берегли, МЁРТВ: его перетирает `ld a,(hl)` в
;     buscaCercanias6 (первое чтение A после хореографии);
;   * «основной» F, который пары берегли, мёртв: его ставит `and 0xF0` там же;
;   * A' не меняется ни в старом, ни в новом варианте (пары его возвращали);
;   * F' у старого варианта оставался = флагам and-теста, у нового не трогается —
;     содержимое F' между парами нигде не определено и не читается: все остальные
;     пары vec_exaf (setVDPWrite, drawRelleno) сначала кладут в тень своё и junk из
;     F' не смотрят (SETWR начинается с `ld (vec_vdp_ptr),hl`).
;  ~-700 т на решение мумии, -14 Б.
		dec	hl		; Тайл слева от мумии
	ld a,(z80_af_alt+1)	; Идёт влево?
	and 1<<2
	jp nz,buscaCercanias4	; Да, идёт влево

		inc	hl
		inc	hl		; Тайл справа от мумии

buscaCercanias4:
		ld	b, 0		; счётчик смещений X при поиске

buscaCercanias5:
		dec	hl		; сдвигает поиск на тайл влево
	ld a,(z80_af_alt+1)	; Идёт влево?
	and 1<<2
	jp nz,buscaCercanias6	; да, идёт влево

		inc	hl
		inc	hl		; сдвигает поиск на тайл вправо

buscaCercanias6:
		ld	a, (hl)		; тайл карты
		and	0x0F0		; оставляет семейство (тип) тайла
		cp	0x10		; это стена или платформа?
		ret	z		; да

		cp	0x20		; Это лестница?
	jp z,buscaCercanias7	; Нашла лестницу

		cp	0x30		; Это нож?
	jp nz,buscaCercanias8

		ld	a, (hl)
		cp	0x30		; Это нож, воткнутый в пол?
	jp z,buscaCercanias8

buscaCercanias7:
		ld	c, 1		; Команда подняться
		ld	de, distSubida
		call	guardaOrden

buscaCercanias8:
		push	hl
		ld	a, 0x60		; Ширина 3 комнат
		call	ADD_A_HL	; Указывает на нижний ряд (yTile+1)
		ld	a, (hl)		; читает тайл карты
		ld	c, a
		pop	hl
		and	0x0F0		; Оставляет тип тайла
	jp z,momiaBaja	; Пусто

		ld	a, c		; Тайл карты
		and	0x0F
		cp	5		; Лестница вниз?
		call	nc, momiaBaja	; Да, даёт команду спуститься

		inc	b
		ld	a, 5
		cp	b		; Уже просмотрено 5 позиций в одном направлении?
	jp nz,buscaCercanias5
		ret

momiaBaja:
		ld	c, 2		; Команда спуститься
		ld	de, distBajada

guardaOrden:
		ld	a, (de)
		cp	b
		ret	nc		; Существующая команда приоритетнее (идёт к более дальней лестнице?)

		ld	a, b
		ld	(de), a		; Расстояние до лестницы
		dec	de
;  [2026-08-04] СХЛОПНУТА ПАРА СВОПОВ. Было: `call vec_exaf / push af / and 0x0FC / or c /
;  ld (de),a / pop af / jp vec_exaf`. Разбор: первый своп кладёт в A теневой A', внутренний
;  `push af`/`pop af` возвращает его же, поэтому ВТОРОЙ своп отдаёт теням ровно то, что
;  забрал первый — теневая пара на выходе НЕ ИЗМЕНЕНА, основная AF тоже. Единственный
;  наблюдаемый эффект всей конструкции — запись (A' & 0x0FC) | C по адресу DE.
;  Читаем A' прямо из ячейки (раскладка задана vec_exaf: z80_af_alt = F', +1 = A'),
;  основную AF спасаем стеком. Хвостовой `jp vec_exaf` был возвратом — ставим `ret`.
;  12 -> 10 байт, 369 -> 62 такта; исполняется 28 раз за 3000 кадров (путь холодный).
		push	af
		ld	a, (z80_af_alt+1)	; A' — направление поиска
		and	0x0FC		; Сохраняет направление поиска
		or	c		; Добавляет команду подняться или спуститься
		ld	(de), a		; Сохраняет команду
		pop	af
		ret

;----------------------------------------------------
; Получает данные обрабатываемой мумии
; Out:
; IX = данные мумии
; (pMomiaData) = указатель на данные мумии
;----------------------------------------------------

; getMomiaProcDat / getMomiaDat лежат в хвосте образа (game/kvalley_logic_tail.asm).


;----------------------------------------------------
;
; Обновляет координаты элемента согласно его скорости X
; In:
;  DE = скорость. D = целая часть, E = дробная часть
; Out:
;  A,D = координата X
;  E = дробная часть X
;----------------------------------------------------


mueveProta:
		ld	hl, ProtaXdecimal ; «Дробная часть», используемая при расчёте X. Так достигаются скорости меньше 1 пикселя
	push hl	; Младший байт — «дробная» часть, старший — целая
	ld hl,(protaSpeed)
	ld d,h
	ld e,l
	pop hl

mueveElemento:
		push	hl		; NAT ME S9: P = указатель ACTOR_X_DECIMAL (+4) для записей
		inc	hl
		inc	hl		; ->P+2 (ACTOR_ROOM)
		ld	b, (hl)		; B = комната
		inc	hl
		inc	hl
		inc	hl	; ->P+5 (ACTOR_SPEEDROOM)
		ld	c, (hl)		; C = смещение комнаты
		pop	hl
		push	hl		; HL = P (сохраняет P в стеке)
		dec	hl
		dec	hl		; ->P-2 (ACTOR_SENTIDO)
		ld	a, (hl)	; A = направление движения
		rra			; CY = бит 0 направления
	jp nc,mueveElemento2	; Движется вправо
		ld	a, c
		cpl
		ld	c, a
		ld	a, d
		cpl
		ld	d, a
		ld	a, e
		cpl
		ld	e, a
		inc	de

mueveElemento2:
		pop	hl
		push	hl		; HL = P (сохраняет P для записей)
		ld	a, (hl)	; младшая часть posword = [P]
		inc	hl
		ld	h, (hl)	; старшая часть posword = [P+1]
		ld	l, a	; HL = текущая позиция
		add	hl, de		; Прибавляет смещение
		ld	a, b		; Текущая комната
		adc	a, c		; Прибавляет старшую часть смещения X — смена комнаты
		ld	b, a
		ex	de, hl		; DE = новая позиция (E=дробн., D=X), контракт для ножа
		pop	hl		; HL = P
		ld	(hl), e		; дробная часть X
		inc	hl
		ld	(hl), d		; X
		inc	hl
		ld	(hl), b		; Комната (ACTOR_ROOM = P+2)
		ret

;  Ходьба мумии: скорость из записи, затем mueveElemento. DE после mueve — позиция,
;  не скорость, поэтому каждый полушаг грузит DE заново (как mueveProta).
mueveMomia:
	ld	a, ACTOR_SPEEDXDEC
	call	getVariableMomia
	ld	e, a
	inc	l
	ld	d, (hl)
	ld	a, ACTOR_X_DECIMAL
	call	getVariableMomia
	jp	mueveElemento


;----------------------------------------------------
; Проверяет, можно ли прыгнуть: смотрит, есть ли
; потолок над элементом, если прыжок чисто вертикальный
; Если прыжок с перемещением — проверяет, нет ли стены впереди
; (а если потолок сплошной?)
; Out:
;   NC = прыжок невозможен
;----------------------------------------------------

chkSaltar:
		push	hl
		dec	hl
		dec	hl
		ld	a, (hl)		; Управление элемента
		pop	hl
		cp	0x10		; Вертикальный прыжок без бокового перемещения?
	jp z,chkChocaTecho	; Да, только проверяет, что нет потолка над головой

;---------------------------------------
; Прыжок с боковым перемещением
; Проверяет, нет ли стены впереди
;---------------------------------------
		call	chkChocaTecho
		ret	nc		; Столкнулся

		dec	hl
		ld	a, (hl)		; Направление
		inc	hl
		ld	bc, 0x304	; Смещение для верхней левой части
	rra
	jp c,chkIncrustUp	; Влево

		ld	b, 0x0C		; Смещение X правой части

chkIncrustUp:
		push	bc
		call	chkTocaMuro	; Z = столкновение
		pop	bc		; Восстанавливает смещение координат столкновения
	jp z,chkTechoMazizo	; Столкнулся

		call	chkTocaY_8	; Уменьшает смещение Y на 8 и проверяет столкновение
		ret	z

		scf
		ret

chkTechoMazizo:
		call	chkTocaY_8	; Уменьшает смещение Y на 8 и проверяет столкновение
		ret	z		; Столкновение

		call	chkTocaY_8	; Уменьшает смещение Y на 8 и проверяет столкновение
		ret	z		; Столкновение

		ld	b, 8		; Центральная часть X элемента
		call	chkTocaMuro	; Z = столкновение
		ret	z		; Столкновение

		scf			; Нет столкновения
		ret

;----------------------------------------------------
; Проверяет столкновение во время прыжка
; Out: Carry = нет столкновения
;----------------------------------------------------

chkChocaTecho:
		ld	bc, 0x4FE
		call	chkTocaMuro	; Z = столкновение
		ret	z

		ld	bc, 0x0AFE
		call	chkTocaMuro	; Z = столкновение
		ret	z

		scf			; Нет столкновения
		ret

chkTocaY_8:
		ld	a, c		; Уменьшает смещение Y на 8 и проверяет столкновение
		sub	8
		ld	c, a
		push	bc
		call	chkTocaMuro	; Z = столкновение
		pop	bc
		ret


;----------------------------------------------------
; Проверяет столкновение с чем-либо во время прыжка —
; при подъёме или при падении
; Out:
;   Z = столкнулся с чем-то при прыжке. Прыжок завершается
;----------------------------------------------------

chkChocaSalto:
		inc	hl
		ld	a, (sentidoEscalera) ; Значение управления в момент прыжка. Так узнаём, был ли прыжок вертикальным
		cp	0x10		; Кнопка A нажата? (удержание прыжка)
chkChocaSalto1:
		inc	hl
		ld	d, (hl)		; Направление
		inc	hl
	jp z,chkChocaCae	; Нажата.

;  HL на ACTOR_Y (+3). ACTOR_X = +5. Push/pop af вокруг vec_ix_ld был мёртв:
;  сразу `ld a,(il_a)` перетирал и A, и флаги.
		inc	hl
		inc	hl
		ld	a, (hl)
		dec	hl
		dec	hl
		and	7
		cp	4		; Находится в середине тайла?
	jp nz,chkChocaCae	; Нет

;------------------------------
; Проверяет столкновение сверху
;------------------------------
		ld	a, d		; Направление
		rra
		ld	bc, 0x300	; Верхнее левое смещение
	jp c,chkChocaSalto2	; Идёт влево
		ld	b, 0x0C		; Правое смещение

chkChocaSalto2:
		push	de
		call	chkTocaMuro	; Z = столкновение
		pop	de
	jp z,ajustaPasillo	; Проверяет, не зажат ли в проходе (стена сверху и снизу)

;----------------------------------------
; Проверяет столкновение центральной частью
;----------------------------------------

chkChocaSalto3:
		ld	a, d		; Направление
		ld	bc, 0x308	; Центральное левое смещение
		rra
	jp c,chkChocaSalto4	; Идёт влево
		ld	b, 0x0C		; Правое смещение

chkChocaSalto4:
		push	de
		call	chkTocaMuro	; Столкновение центральной частью?
		pop	de
	jp z,setFinSalto	; Да, прыжок завершается

;------------------------------------------
; Проверяет столкновение нижней частью
;------------------------------------------

		ld	a, d		; Направление
		rra
		ld	bc, 0x30E	; Нижнее левое смещение
	jp c,chkChocaSalto5	; Идёт влево
		ld	b, 0x0C		; Правое

chkChocaSalto5:
		call	chkTocaMuro	; Z = столкновение
	jp z,setFinSalto	; Да, прыжок завершается

chkChocaCae:
		push	hl		; HL на Y актора, бережём для chkChocaSuelo
		ld	hl, (z80_ix)
		ld	de, ACTOR_JUMPSENT
		add	hl, de
		ld	a, (hl)
		pop	hl
		and	a		; Поднимается или падает?
	jp z,setNZ	; Поднимается

		call	chkChocaSuelo	; Проверяет столкновение с полом при падении
		jp	c, chkLlegaSuelo ; Не столкнулся

setFinSalto:
		ld	a, (hl)		; Y
		and	0x0F8
		ld	(hl), a		; Выравнивает координату Y по кратности 8, отбрасывая значения меньше 8

		xor	a
		and	a		; Ставит Z, конец прыжка
		ret

; Проверяет, достиг ли уровня пола

chkLlegaSuelo:
		call	chkPisaSuelo
	jp z,setFinSalto	; Да, на полу

setNZ:	
		xor	a
		cp	1		; Ставит NZ
		ret

;----------------------------------------------------
; Вызывается, если при прыжке столкнулся с чем-то верхней частью
; Проверяет, есть ли пол под ногами, и в этом случае выравнивает Y
;----------------------------------------------------

ajustaPasillo:
		ld	a, d		; Направление
		ld	bc, 0x314	; Смещение на полтайла ниже элемента (слева)
		rra
	jp c,ajustaPasillo2
		ld	b, 0x0C		; Справа

ajustaPasillo2:
		push	de
		call	chkTocaMuro	; Z = столкновение
		pop	de
	jp z,setFinSalto	; Y

	jp chkChocaSalto3


;----------------------------------------------------
; Прыжок
; Если идёт эндинг, значения прыжка умножаются на 4
; В зависимости от нажатого направления прыгает вправо или влево
; Проходит таблицу смещений до конца. Затем
; помечает, что её нужно пройти в обратном порядке, чтобы падать так же, как поднимался
; Если снова доходит до конца (начала), падает с максимальной скоростью и продолжает так
;----------------------------------------------------

doSalto:
		call	isPl
		jp	z, doSalto_once	; демо: один шаг, как запись 50 Гц
		ld	a, (GameStatus)
		cp	0x0A		; концовка: один шаг, waitCounter=2 даёт прыжок ×4
	jp z,doSalto_once

		xor	a		; Не в концовке игры.
		ld	(waitCounter), a ; Обнуляет, чтобы не умножать значения прыжка на 4
		push	hl
		call	doSalto_once	; два исходных тика за один 25-Гц
		jp	saltoMid	; pop hl + проверка столкновения между полушагами (герой), vec_jumpmid.asm
doSalto_once:
		push	hl
		push	hl
		ld	a, 0x0A
		call	ADD_A_HL
		ld	e, (hl)
		inc	hl
		ld	d, (hl)		; DE = указатель на смещения прыжка
		inc	hl
		ld	b, (hl)		; Направление прыжка: подъём или спуск?
		pop	hl
	ld (il_tmp),hl
	pop hl
	ld (z80_ix),hl
	ld hl,(il_tmp)
		dec	hl

		ld	a, (hl)		; Нажатые клавиши
		inc	hl
		inc	hl
		inc	hl
		inc	hl
		and	0x0C		; Оставляет только вправо и влево
	jp z,doSalto3

		dec	(hl)		; Уменьшает X
		and	1<<2		; Влево = 4
	jp nz,doSalto3

		inc	(hl)		; Вправо = 8
		inc	(hl)		; Увеличивает X

doSalto3:
		ld	a, (de)		; Смещение Y прыжка
		inc	a		; Дошёл до конца таблицы?
	jp z,saltoCaeMax	; Да, падает с максимальной скоростью

		dec	a		; Восстанавливает значение смещения
		ld	c, a		; Сохраняет его в C

		ld	a, (waitCounter)
		dec	a
		dec	a
		ld	a, c
	jp nz,chkSaltoSubBaj	; Переход, если waitCounter не равен 2

		add	a, a
		add	a, a		; Умножает смещение на 4

chkSaltoSubBaj:
		dec	b
		inc	b		; Поднимается или падает?
	jp nz,saltoUpdate	; Поднимается
	cpl	; Падает, поэтому делает значение отрицательным
	inc a

saltoUpdate:
		call	saltoUpdateY	; Обновляет координату Y прыгающего элемента
		inc	de		; Следующая позиция списка смещений

		ld	a, b		; Направление прыжка
		and	a		; Поднимается или падает?
	jp z,saltoUpdate3	; Поднимается

		dec	de		; Идёт по списку в обратном порядке

saltoUpdate2:
		dec	de

saltoUpdate3:
		ld	hl, (z80_ix)	; NAT IX->HL S6 (HL мёртв: вызывающий восстановит его из стека)
		inc	hl
		inc	hl
		inc	hl
		inc	hl
		inc	hl
		inc	hl
		inc	hl
		inc	hl
		inc	hl
		inc	hl	; ->+0Ah (MOV_CNT/младший байт указателя прыжка)
		ld	(hl), e	; +0Ah
		inc	hl
		ld	(hl), d	; +0Bh старший байт указателя прыжка
		ld	a, (de)
		cp	0x0FE		; Дошёл до конца таблицы? (Высшая точка прыжка)
		ret	nz		; Нет

		inc	hl	; +0Bh->+0Ch (HL мёртв после ret nz)
		ld	(hl), 1	; Меняет направление прыжка. Начинается падение
					; Для этого проходит тот же список в обратном порядке
	jp saltoUpdate2	; Уменьшает указатель, чтобы оставить корректное значение

saltoCaeMax:
		ld	a, 4

saltoUpdateY:
		dec	hl
		dec	hl
		add	a, (hl)
		ld	(hl), a
		ret

;----------------------------------------------------
; Смещения, применяемые к Y элемента при прыжке
;----------------------------------------------------
		db 0x0FF			; Конец прыжка. Падает с максимальной скоростью
valoresSalto:	db 4
		db    2
		db    2
		db    2
		db    1
		db    1
		db    2
		db    0
		db    1
		db    1
		db    0
		db    0
		db -2			; Конец таблицы. Начинается падение

;----------------------------------------------------
; Ставит состояние падения
; Обновляет координату Y из-за падения и проверяет столкновение с полом
; Out:
;   C = падает
;  NC = стоит на полу
;----------------------------------------------------

cayendo:
		ld	(hl), 2		; Состояние падения
		inc	hl
		inc	hl
		inc	hl
		ld	a, (hl)		; Y
		and	0x0FC
		ld	(hl), a		; Выравнивает Y по кратности 4

		push	hl
		call	chkCae
		pop	hl
		ret	nc		; Стоит на чём-то

		ld	a, (hl)		; Y
		add	a, 4
		ld	b, a
		call	isPl
		ld	a, b
		jp	z, cayendo_a	; демо: +4, как запись 50 Гц
		add	a, 4		; игра: +8 = 4×2 на 25 Гц
cayendo_a:
		and	0x0FC
		ld	(hl), a		; Выравнивает Y по кратности 4

		xor	a
		sub	1		; Ставит Carry
		ret


;----------------------------------------------------
; Двигает персонажа по лестнице
; Out:
;    Z = достиг конца лестницы
;----------------------------------------------------

andaEscalera:
		ld	a, (timer)
		and	b		; Маска для замедления скорости на лестнице
		ret	nz

		inc	hl
		ld	c, (hl)		; Направление
		inc	hl
		inc	hl
		inc	hl
		ld	a, (hl)		; X
		dec	hl
		dec	hl		; Указывает на Y
		and	3
	jp nz,andaEscalera2	; X не кратна 4

		push	hl		; Указывает на Y
		call	chkFinEscalera	; Проверяет, достиг ли конца лестницы
		pop	hl
		ret	z		; Да, достиг конца

andaEscalera2:
		ld	a, c		; Направление
		inc	hl
		inc	hl
		inc	(hl)		; Увеличивает X
		rra
	jp nc,andaEscalera3	; Идёт вправо
		dec	(hl)
		dec	(hl)		; Уменьшает X. Идёт влево

andaEscalera3:
		push	hl
		ld	a, 0x0A
		call	ADD_A_HL	; Указывает на направление лестницы (+#0f)
		ld	a, (hl)
		dec	hl
		dec	hl
		dec	hl
		dec	hl
		dec	hl
		inc	(hl)		; Счётчик движения
		pop	hl		; Указывает на X

		add	a, c		; Направление лестницы + направление движения
		ld	b, 1		; Спускается
		and	1
	jp z,andaEscalera4
		ld	b, -1		; Поднимается

andaEscalera4:
		dec	hl
		dec	hl		; Указывает на Y
		ld	a, (hl)		; Y
		add	a, b		; Прибавляет вертикальное смещение
		ld	(hl), a		; Обновляет координату Y в зависимости от направления лестницы и направления движения

		xor	a
		cp	1		; Ставит NZ
		ret


;----------------------------------------------------
; Показывает концовку игры
;----------------------------------------------------

ShowEnding:
		push	bc
		call	vec_nat_sprites
		pop	bc
	dec b
	jp nz,showEnding2

		ld	hl, protaEndingDat ; Данные, подготовленные для эндинга (герой выходит из пирамиды, идёт влево и прыгает)
		ld	de, protaStatus	; Назначение: структура героя
		ld	bc, 0x0C		; Число копируемых байт
	call vec_ldir_fwd

		call	setAttribProta	; Обновляет атрибуты спрайтов героя
		ld	hl, controlsEnding ; Влево, влево+прыжок
		ld	(keyPressDemo),	hl ; Указатель на записанные команды управления
		ld	a, 0x44		; 0x88@50 Гц, шаг 1.5 px на 25 Гц — прыжок в центре
		ld	(KeyHoldCntDemo), a

controlsEnding:	db 4, 0x0E
		db 0x14,	0x0FF		; Влево, влево+прыжок (0x1B/2)

;----------------------------------------------------
; Идёт до центра экрана и прыгает
;----------------------------------------------------

showEnding2:
	dec b
	jp nz,showEnding3
		call	ReplaySavedMov	; Воспроизводит записанные движения эндинга (идти влево и прыгать)
		call	AI_Prota	; Двигает и анимирует героя
		ld	a, (flagVivo)
		and	a
		ret	nz		; Демо закончилось

		call	setProtaSalta_	; Прыгает

		ld	hl, sentidoProta ; 1 = влево, 2 = вправо
		ld	(hl), a		; (!?) A = #3F. Не похоже, что значение выставлено намеренно
		dec	a		; #3E?
		dec	hl
		ld	(hl), a		; ProntaControl
		ld	a, 2
		ld	(waitCounter), a
	jp NextSubStatus

;----------------------------------------------------
; Ждёт окончания прыжка
;----------------------------------------------------

showEnding3:
	dec b
	jp nz,showSpecialBonus
		call	AI_Prota	; Двигает и анимирует героя
		ld	a, (flagSalto)	; 0 = прыгает, 1 = на земле
		or	a
		ret	z		; Прыжок ещё не закончился
	jp NextSubStatus

;----------------------------------------------------
; Показывает текст CONGRATULATIONS, SPECIAL BONUS и добавляет 10 000 очков
;----------------------------------------------------

showSpecialBonus:
	dec b
	jp nz,waitEnding
		call	VidaExtra	; Добавляет дополнительную жизнь
		call	specialBonus	; Показывает текст CONGRATULATIONS, SPECIAL BONUS и добавляет 10 000 очков
		ld	a, 0x0D0
		ld	(waitCounter), a
	jp NextSubStatus

;----------------------------------------------------
; Ждёт некоторое время, пока текст на экране
; Переходит в состояние "Stage clear"
;----------------------------------------------------

waitEnding:
	dec b
	jp nz,setupEnding
		ld	hl, waitCounter
		dec	(hl)
		ret	nz

		ld	a, 8		; статус: Stage Clear (этап пройден)
		ld	(GameStatus), a
;  ЗАДАЧА #15: концовка кончилась — снимаем её развилку тайлов 0x40-0x47 (иначе кирпич
;  следующего лабиринта пошёл бы по ветке финала и вышел песчаником).
	jp	vec_ct_base

;----------------------------------------------------
; Готовит всё для показа финала
; - Прячет спрайты и показывает шторку
; - Загружает спрайты героя с киркой
; - Включает музыку игры
; - Стирает всю карту в RAM
;----------------------------------------------------

setupEnding:
		call	hideSprAttrib	; Прячет спрайты
		call	drawCortinilla	; Рисует шторку
		ret	p		; Ещё не закончил со шторкой

		ld	a, 0x20
		call	cogeObjeto	; Даёт герою кирку в руки

		ld	a, 0x8B		; игровая музыка
		call	setMusic

		call	BorraMapaRAM
		ld	hl, MapaRAMRoot	; Первый ряд карты не используется (занят табло). Также используется как начало стека
		ld	de,  MapaRAMRoot+1 ; Первый ряд карты не используется (занят табло). Также используется как начало стека
		ld	bc, 0x720
		ld	(hl), 0		; Пустой тайл
	call vec_ldir_fwd

		ld	hl, 0x2200	; VRAM address pattern (Vector: финальный тайлсет 0x90->0x40) generator table = паттерн #90
		ld	de, endingTiles
		call	UnpackPatterns

;  ЗАДАЧА #35: снята распаковка endingColors в VDP 0x200 — MSX color table финального экрана.
;  На Векторе не оседает нигде (vec_col_store = `ret`, задача #27); режимы тайлов финала
;  остаются от профиля, загруженного vec_ct_load, как и до правки.
;  ЗАДАЧА #15 (2026-07-31): вместо холостой распаковки — ПРОФИЛЬ ЦВЕТА КОНЦОВКИ. Ставится
;  ЗДЕСЬ, между распаковкой тайлсета и первым drawHalfPiram: раньше нельзя (тайлсета ещё
;  нет), позже — сцена уже нарисована старыми режимами. Он же переводит блиттер и палитру
;  на ветку финала; снимается обратно первой же загрузкой профиля (vec_ct_load).
		call	vec_ct_ending

		ld	hl, 0x391F	; VRAM address name table = позиция вершины большой пирамиды справа
		ld	c, 0x40
		xor	a
		call	drawHalfPiram

		ld	hl, 0x3A03	; VRAM address name table = позиция левой вершины средней левой пирамиды
		ld	c, 0x42
		call	drawHalfPiram

		ld	hl, 0x3A2B	; VRAM address name table = позиция лев. вершины малой центральной пирамиды
		call	drawHalfPiram

		ld	hl, 0x3A04	; VRAM address name table = позиция верхней вершины правой стороны средней левой пирамиды
		ld	c, 0x44
		inc	a		; Правая сторона пирамид
		call	drawHalfPiram

		ld	hl, 0x3A2C	; VRAM address name table = позиция верхней вершины правой стороны малой центральной пирамиды
		call	drawHalfPiram

		ld	de, tilesEndDoor ; Паттерны, образующие дверь большой пирамиды
		ld	bc, 0x302	; Высота = 3 тайла, ширина = 2 тайла
		ld	hl, 0x3A1E	; VRAM address name table = позиция двери
		call	vec_blit_rect	; NATBONUS: дверь большой пирамиды -> framebuffer (было DEtoVRAM_NXNY)

		ld	a, 0x46		; Паттерн песчаного пола (Vector: -0x50)
		ld	hl, 0x3A60	; VRAM address name table = пол
		ld	bc, 0x20		; Ширина экрана
		call	setFillVRAM	; Рисует пол
		call	renderMarcador

		ld	de, starsLocations
		ld	b, 6		; Число звёзд на небе

drawStars:
		ld	a, (de)		; Младший байт адреса VRAM name table (полукоордината) звезды
		ld	l, a
		ld	h, 0x39		; Старший байт адреса VRAM name table
		ld	a, 0x47		; Паттерн звезды (Vector: -0x50)
		call	vec_text_blit	; NATBONUS: звезда на небе -> framebuffer (было WRTVRM)
		inc	de		; Следующая звезда
	dec b
	jp nz,drawStars

;  НЕ СНИМАТЬ: после звёзд сцена готова — сдвигаем subStatus, иначе ShowEnding
;  снова падает в setupEnding (B=0 -> #FF по цепочке dec) и экран крутится вечно.
;  В фазе 1 jp-обёрток ошибочно убрали вместе с doNextSubStatus.
nextSubstatus2:
		ld	hl, subStatus
		inc	(hl)
		ret

;----------------------------------------------------
; Рисует половину пирамиды (прямоугольный треугольник)
; Рисует пирамиду от высоты вершины до пола, увеличивая ширину на каждой строке
; In:
;  HL = VRAM address name table
;   C = паттерн диагонали пирамиды / или \. (C+1) = паттерн заливки
;   A = сторона пирамиды для отрисовки (0 = левая, 1 = правая)
;----------------------------------------------------

drawHalfPiram:
		ld	b, 0		; Счётчик ширины текущего ряда пирамиды

chkVertice:
		push	hl		; Сохраняет адрес VRAM оси пирамиды
		push	bc		; Сохраняет ширину текущей строки пирамиды
		dec	b
		inc	b		; Ширина ноль? (Это верхняя вершина?)
	jp z,drawVertice	; Ставит вершину пирамиды

drawRelleno:
;  [2026-09-19] сторона (0/1) в A' напрямую, без vec_exaf. Концовка, не пересекается
;  с buscaCercanias (тот же z80_af_alt+1, но другой экран).
		ld	(z80_af_alt+1), a	; сторона -> A'
		ld	a, c		; Тайл грани / или \
		inc	a		; Превращает его в тайл заливки
		call	vec_text_blit	; NATBONUS: заливка пирамиды -> framebuffer (было WRTVRM)
		ld	a, (z80_af_alt+1)	; сторона <- A'
		dec	hl		; Сдвигается на один паттерн влево
		and	a		; Какую сторону пирамиды надо рисовать?
	jp z,drawRelleno2

		inc	hl
		inc	hl		; Сдвигается на один паттерн вправо

drawRelleno2:
	dec b	; Ещё остались паттерны текущего ряда пирамиды
	jp nz,drawRelleno

drawVertice:
		pop	bc		; Восстанавливает текущую ширину ряда пирамиды
		inc	b		; Увеличивает счётчик ширины пирамиды
		ld	(z80_af_alt+1), a	; сторона -> A'
		ld	a, c		; Вершина пирамиды / диагональный паттерн
		call	vec_text_blit	; NATBONUS: вершина/диагональ пирамиды -> framebuffer (было WRTVRM)
		ld	a, (z80_af_alt+1)	; сторона <- A'

		pop	hl		; Восстанавливает адрес VRAM центральной оси пирамиды
		ld	de, 0x20		; Расстояние до тайла ниже
		add	hl, de		; Ставит указатель VRAM на тайл ниже
		push	hl		; Сохраняет адрес VRAM центральной оси
;  ЗДЕСЬ ЖИЛ БАГ РЕКОМПИЛЯЦИИ (найден 2026-07-31). Оригинал Z80: `and a / ld de,#3A80 /
;  sbc hl,de` — сравнение 16 бит, которое АККУМУЛЯТОР НЕ ТРОГАЕТ. Транслятор развернул
;  `sbc hl,de` в цепочку через A (ld a,l / sbc a,e / ...), и A терялся. А в A лежит СТОРОНА
;  пирамиды (0 = левая, 1 = правая), которую читает `and a` в drawRelleno/drawVertice: со
;  второго ряда сторона становилась мусорной, левые половины рисовались как правые и
;  уползали в другой конец name-таблицы. Финальный экран выходил из трёх пирамид одной
;  кривой лестницей — увидеть это было нельзя, экран достижим только по концовке игры.
;  ЛЕЧЕНИЕ БЕЗ A: сложение с -0x3A80. dad на i8080 меняет ТОЛЬКО CY, а CY после него
;  означает hl>=0x3A80 (то есть «пирамида дорисована до пола») — условие инвертировано
;  против sbc, поэтому продолжаем по NC. Заодно -20 Б против цепочки.
		ld	de, 0x0C580	; -0x3A80: CY <- hl >= пола (A не трогаем!)
		add	hl, de
		pop	hl
	jp nc,chkVertice	; Продолжает рисовать следующий ряд пирамиды

		ret


;----------------------------------------------------
; Тайлы, используемые для отрисовки финальной сцены
; Тайлы:
;   - Правая грань кирпич, заливка кирпич (ближняя пирамида)
;   - Правая грань песчаник, заливка песчаник (дальняя пирамида)
;   - Левая грань тёмный песчаник, заливка тёмный песчаник
;   - Песок пола
;   - Звезда на небе
;----------------------------------------------------
endingTiles:	db 0x88,	0, 2, 6, 0, 0x0F, 0x2F, 0x6F, 0, 3, 0x0FE, 0x81, 0
		db 3, 0x0EF, 0x88, 0, 1, 3, 7, 0x0F, 0x1F, 0x3F, 0x7F, 9, 0x0FF
		db 0x87,	0x80, 0x0C0, 0x0E0, 0x0F0, 0x0F8, 0x0FC, 0x0FE, 9, 0x0FF
		db 0x87,	0x55, 0x0AA, 0x55,	0x0AA, 0x66, 0x99,	0x66, 8,	0, 0x81
		db 0x0C0, 0

;  [УДАЛЕНО ЗАДАЧЕЙ #35, 2026-07-31] endingColors (26 Б) — таблица цветов фоновых тайлов
;  финального экрана. Грузилась в MSX color table (VDP 0x200), которая на Векторе холостая.


;----------------------------------------------------
; Паттерны, образующие дверь пирамиды финала игры
;----------------------------------------------------
tilesEndDoor:	db 0x63,	0x64, 0,	0x65, 0x66, 0x67

;----------------------------------------------------
; Младшие байты адреса VRAM name table, где рисуются звёзды
; Старший байт фиксирован = #39
;----------------------------------------------------
starsLocations:	db 9, 0x16, 0x38,	0x67, 0x74, 0x8E, 0x0A9


;----------------------------------------------------
; Данные героя для финала
; Status, Control, направление, Y, дробная часть, X, комната, speed дробная часть, speed X, Speed room, movCnt, frame
; Идти, влево, влево, Y=#88, 0, X=#F0, 0, spd=#C0
;----------------------------------------------------
protaEndingDat:	db 0, 4, 1, 0x88, 0, 0x0F0, 0, 0x80, 1, 0, 0, 0


;----------------------------------------------------
; Настройка пергамента
;----------------------------------------------------

setupPergamino:
;  ПОРЯДОК (задача #31, 2026-07-31): СНАЧАЛА патч диспетчера палитры на ветку карты, и только
;  ПОТОМ запрос самой палитры карты. Было наоборот, и между двумя вызовами оставалось окно в
;  один кадр: прерывание успевало применить палитру карты, а покадровый писатель шёл ещё по
;  БАЗОВОЙ ветке и красил idx8 по-геймплейному. Лечили это оговоркой «fpm==2 -> красный» в
;  vec_brillo_pal, но она включалась не здесь, а в stageClear — за всю шторку до карты (см.
;  комментарий там). Теперь окна нет: в перевёрнутом порядке прерывание в зазоре исполнит
;  vbp_map, а он и есть палитра карты. Экран в этот момент уже вычищен шторкой, так что даже
;  этот кадр ничего не перекрашивает.
		di
		ld	a, 0x0C3
		ld	(vec_brillo_pal), a
		ld	hl, vbp_map
		ld	(vec_brillo_pal+1), hl
;  ЗАДАЧА #21: сцена палитры -> «вне пирамиды». Экран здесь уже съеден шторкой (нарисовано
;  только табло), а сам пергамент строится ниже — цвет карты встанет ДО первого его пикселя.
		xor	a
		ld	(vbp_scene), a
		ei
		call	vec_setpal_menu
		call	hideSprAttrib
		ld	de, gfxMap	; Паттерны пергамента с картой пирамид
		ld	hl, 0x2600	; адрес паттерна #C0 в VRAM
		call	UnpackPatterns	; Распаковывает паттерны в VRAM

;  ЗАДАЧА #30 (2026-07-31): УДАЛЕНА распаковка colorTableMap (`ld de,colorTableMap / ld hl,0x600 /
;  call UnpackPatterns`) вместе с самими данными. Это была ЧИСТО ХОЛОСТАЯ работа: MSX-таблица
;  цвета (VDP 0x0000-0x17FF) на Векторе никуда не оседает — DEtoVRAM уводит этот диапазон в
;  vec_de_col, fill-путь в vec_fill_col, и оба упираются в vec_col_store, который с задачи #27
;  представляет собой одинокий `ret` (цвет считается офлайн, msx2vec.py, и грузится готовой
;  таблицей vec_ct_load). Замер: распаковка стоила 122352 такта и не записала НИ ОДНОГО байта
;  ни в тень паттернов, ни в буфер спрайтов, ни в vec_tilemode. Режимы тайлов карты и так
;  кладутся следующей строкой — vec_map_whiteforce (таблица vec_map_modes, задача #32).
		call	vec_map_whiteforce

		call	HideSprites	; A+ fix: чистит 0xC000-0xF4FF (p2 + страницы слотов) —
					; остатки героя и мумий из геймплея, ghosting pat-shadow.
;  ПОРЯДОК ИСПРАВЛЕН (2026-07-30): раньше HideSprites стоял ПОСЛЕ распаковки спрайтов карты
;  и стирал их же — в ТОГДАШНЕЙ раскладке буфер спрайт-паттернов попадал под заливку.
;  ПОПРАВКА 2026-08-03: сегодня это уже не так — HideSprites стоит на `cp 0x0F5` и выше
;  0xF500 не идёт, а физический хвост vec_spr_buf лежит на 0xF840-0xF99F (сама метка
;  0xF6A0 — ВИРТУАЛЬНАЯ база, см. опись p3 в vec_boot.asm). Порядок «чистим ДО распаковки»
;  сохранён как безопасный, но описанный ниже механизм поломки к нему больше не относится.
;  Силуэт подсветки читал затёртую память и рисовал мусор:
;  вместо ровной обводки пирамидки — «столб вверх и усы вбок», причём форма менялась, потому
;  что вместе с буфером затираются и служебные ячейки (замер: 36529 записей выше буфера,
;  диапазон 0xF9A0-0xFEDA, под раздачу попадают vsu_sp, vec_pal_ptr и часы музыки).
;  Чистим ДО распаковки — тогда новые спрайты ложатся на уже пустое место.
		ld	de, gfxSprMapa	; Спрайты карты (силуэт пирамиды и стрелки)
		call	unpackGFXset	; Распаковывает спрайты

		xor	a
		ld	(statusEntrada), a
		ld	(timerPergam2),	a ; Используется для паузы после окончания музыки пергамента при достижении GOAL

		ld	a, 0x91		; Музыка пергамента
		call	setMusic

		ld	a, (piramideActual)
		call	setPiramidMap	; Ставит силуэт для подсветки текущей пирамиды

		ld	a, (puertaSalida) ; Направление выхода из пирамиды
		ld	de, numSprFlechas ; Номера спрайтов стрелок

setFlechaMap:
		push	de
	or a
	rra
		cp	4
	jp nz,setFlechaMap2
		dec	a		; Преобразует значения 1,2,4,8 в 0,1,2,3

setFlechaMap2:
		push	af
		add	a, a
		ld	hl, offsetFlechas
		call	ADD_A_HL
		ld	de, attrPiramidMap ; Атрибуты спрайта подсветки пирамиды на карте (силуэт)
		ld	bc, attrFlechaMap ; Атрибуты стрелки карты
		ld	a, (de)		; Y пирамиды
		add	a, (hl)		; Прибавляет смещение, соответствующее стрелке
		ld	(bc), a		; Y стрелки
		inc	hl
		inc	de
		inc	bc
		ld	a, (de)		; X пирамиды
		add	a, (hl)		; Прибавляет смещение
		ld	(bc), a		; X стрелки
		inc	bc
		pop	af		; Восстанавливает направление стрелки
		pop	de		; Указатель на номер спрайта для каждого направления
		call	ADD_A_DE
		ld	a, (de)		; Спрайт, соответствующий направлению выхода
		ld	(bc), a		; Спрайт стрелки
		ret

;----------------------------------------------------
;
; Ставит стрелку на клетку "GOAL" карты
;
;----------------------------------------------------

setFlechaGoal:
		ld	hl, attrPiramidMap ; Атрибуты спрайта подсветки пирамиды на карте (силуэт)
		push	hl
		ld	(hl), 0x97
		inc	hl
		ld	(hl), 0x7B
		ld	a, 1		; Стрелка сверху
		call	setFlechaInvert
		pop	hl
		ld	(hl), 0x0C3
		ret

;----------------------------------------------------
;
; Обновляет координаты и спрайты карты пирамид
; Спрайты: стрелка и силуэт пирамиды
;
;----------------------------------------------------

setDestinoMap:
		ld	a, (piramideDest)
		call	setPiramidMap
		ld	a, (puertaEntrada)

setFlechaInvert:
		ld	de, numSprFlechInv
	jp setFlechaMap

;----------------------------------------------------
;
; Логика карты пирамид
;
;----------------------------------------------------

tickPergamino:
		ld	a, (timer)
		and	7		; 8 цветов анимации
		ld	hl, coloresFlecha ; Цвета подсветки стрелки и пирамиды на карте
		call	ADD_A_HL
		ld	a, (hl)
		ld	(colorPiramidMap), a ; Цвет контура пирамиды на карте
		ld	(colorFlechaMap), a ; Цвет стрелки, указывающей, к какой пирамиде идём на карте
		call	vec_nat_sprites

;  (здесь был `call chkPause` — MSX-пауза по F1 на карте, снята как мёртвая)

		ld	hl, piramideActual
		ld	a, (hl)
		inc	hl
		sub	(hl)
		ld	hl, statusEntrada
		inc	(hl)
		cp	0x0E		; Последняя пирамида?
		ld	a, (hl)
	jp z,setEndingStat

		cp	0x58		; Циклы показа стрелки выхода
	jp z,setDestinoMap

		cp	0x0E0		; Циклы показа стрелки входа
		ret	nz

		inc	a
		ld	(flagEndPergamino), a ;	1 = Закончил показывать пергамент/карту
		ret

setEndingStat:
		cp	0x58		; Пора менять позицию стрелки на цель?
	jp z,setFlechaGoal	; Ставит стрелку на GOAL

		ld	a, (MusicChanData)
		or	a
		ret	nz		; Музыка ещё играет

		ld	hl, timerPergam2 ; Используется для паузы после окончания музыки пергамента при достижении GOAL
		ld	a, (hl)
		inc	(hl)
		cp	0x80
		ret	nz		; Делает паузу после окончания музыки

		ld	hl, numFinishGame ; Число прохождений игры
		inc	(hl)		; Увеличивает число прохождений игры

		xor	a
		inc	hl
		ld	(hl), a
		ld	d, h
		ld	e, l
		inc	de
		ld	bc, 0x0A
		ld	a, c		; A = Status #A
	call vec_ldir_fwd	; Стирает 10 байт переменных начиная с numFinishedGame

		call	setGameStatus	; Ставит status #A = Ending
		jp	ResetSubStatus	; (!?) Это уже сделано в предыдущем вызове

;----------------------------------------------------
; Показывает текст "CONGRATULATIONS" "SPECIAL BONUS"
; И добавляет 10.000 очков
;----------------------------------------------------

specialBonus:
		ld	de, TXT_ENDING
		call	unpackGFXset
		ld	de, 0x5000
		push	de
		call	SumaPuntos
		pop	de
		jp	SumaPuntos

;----------------------------------------------------
; Задаёт координаты силуэта текущей пирамиды
;----------------------------------------------------

setPiramidMap:
		dec	a
		add	a, a
		ld	hl, coordPiramMap
		call	ADD_A_HL
		ld	de, attrPiramidMap ; Атрибуты спрайта подсветки пирамиды на карте (силуэт)
	ld a,(hl)	; Y
	ld (de),a
	inc hl
	inc de
	dec bc
	ld a,(hl)	; X
	ld (de),a
	inc hl
	inc de
	dec bc
		ex	de, hl
		ld	(hl), 0x0E4	; Спрайт силуэта пирамиды
		ret

;----------------------------------------------------
; Графика пергамента с картой пирамид
;----------------------------------------------------
gfxMap:		db 0x0A0, 1, 3, 7, 0x0F, 0x1F, 0x3F, 0x0F, 3, 0x80, 0x0C0, 0x0E0
		db 0x0F0, 0x0F8, 0x0FC, 0x0F0, 0x0C0, 1, 3, 7, 0x0F, 0x1F, 0x3F
		db 0x0F,	3, 0x80,	0x0C0, 0x0E0, 0x0F0, 0x0F8,	0x0FC, 0x0F0, 0x0C0
		db 5, 0, 0x81, 0x0FF, 0x0F, 0x80, 0x81, 0x0FF, 7, 0, 0x81, 0x0FF
		db 7, 0, 0x81, 0x0FF, 0x0A, 1, 8, 3, 8, 0x0C0, 0x0A3, 0x0FF
		db 0x38,	0x49, 0x81, 0x9D, 0x49, 0x38, 0x0FF, 0x0FF, 0x0E1, 0x13
		db 0x12,	0x13, 0x12, 0x0E2,	0x0FF, 0x0FF, 0x0C8, 0x68, 0x28, 0x0E8
		db 0x28,	0x2F, 0x0FF, 1, 3, 7, 0x0F, 0x1F, 0x3F, 0x7F,	0x7F, 0x0F0
		db 0x0F9, 0x0FD, 7, 0x0FF,	3, 0x0DF, 0x91, 0x0CB, 0x89, 0x80, 0
		db 0x81,	0x0D1, 0x0F3, 0x0F3, 0x0FB,	0x0FF, 0x0FF, 0x0F, 0x1F, 0x3F
		db 0x3F,	0x7F, 0x7F, 5, 0x0FF, 0x8A,	0x0F7, 0x0F3, 0x0D7, 0x83
		db 0x85,	0x0F8, 0x0F8, 0x0F0, 0x0FA,	0x0FE, 5, 0x0FF, 4, 0x7F
		db 7, 0x3F, 7, 0x7F, 4, 0x3F, 0x0B,	0x0F, 0x0D, 0x1F, 4, 0x80
		db 0x0C,	0x0C0, 3, 0x0F0, 0x0C, 0x0E0, 0x0B, 0x0F0, 6,	0x0E0, 6
		db 0x80,	4, 0, 7, 0x80, 0x0C, 0x0C0, 7, 0x80, 6, 0, 4, 0x80
		db 2, 0x0C0, 0

;  ЗАДАЧА #30: colorTableMap (41 Б упакованной MSX-таблицы цвета пергамента) УДАЛЕНА —
;  единственный её потребитель (UnpackPatterns в setupPergamino) снят, см. комментарий там.

;----------------------------------------------------
; Спрайты карты пирамид
; Силуэт пирамиды, стрелки вверх, вправо, вниз, влево
;----------------------------------------------------
gfxSprMapa:	dw 0x1F20		; Адрес VRAM спрайта #E4
		db 0x88,	6, 9, 0x10, 0x20,	0x40, 0x0C0, 0x30,	0x0F, 0x0A, 0, 0x85
		db 0x80,	0x40, 0x20, 0x30, 0x0C0, 9,	0, 0x84,	0x10, 0x38, 0x7C
		db 0x0FE, 3, 0x38, 0x32, 0, 0x87, 0x10, 0x18,	0x0FC, 0x0FE, 0x0FC
		db 0x18,	0x10, 3,	0x38, 0x84, 0x0FE,	0x7C, 0x38, 0x10, 0x32, 0
		db 0x87,	0x10, 0x30, 0x7E, 0x0FE, 0x7E, 0x30, 0x10, 0x80

		dw 0x3867
		db 0x91		; Передаёт #11 паттернов
		db 0x20, 0,	0x30, 0x39, 0x32, 0x21, 0x2D, 0x29, 0x24, 0x1B, 0x33,	0, 0x2D,	0x21, 0x30, 0, 0x20	; Text: "- Pyramid's Map -"


		; Name table пергамента
		db 0x4F, 0, 0x85, 0x0CF, 0x0D0
		db 1, 1, 0x0D2, 4, 1, 0x88, 0x0D0,	0x0D3, 1, 1, 1, 0x0D2, 0x0D0
		db 0x0D5, 0x0F, 0, 0x81, 0x0D8, 0x10, 1, 0x81, 0x0DC, 0x0E, 0
		db 0x92,	0x0DB, 1, 0x0C0, 0x0C3, 0x0C7, 0x0C7, 0x0C2, 0x0C3, 0x0C7
		db 0x0C7, 0x0C2, 0x0C3, 0x0C7, 0x0C8, 1, 1, 1, 0x0DF,	0x0E, 0
		db 0x81,	0x0D9, 0x0C, 1, 0x85, 0x0C9, 1, 1, 1, 0x0E0,	0x0E, 0
		db 0x92,	0x0DA, 1, 1, 0x0C4, 0x0C7,	0x0C2, 0x0C3, 0x0C7, 0x0C7
		db 0x0C7, 0x0C2, 0x0C3, 0x0C7, 0x0C2, 0x0C1, 1, 1, 0x0E1, 0x0E
		db 0, 0x84, 0x0D7, 1, 1, 0x0C5, 0x0D, 1, 0x81, 0x0DD,	0x0E, 0
		db 3, 1, 0x89, 0x0C6, 0x0C2, 0x0C3,	0x0C7, 0x0C7, 0x0C2, 0x0C3
		db 0x0C7, 0x0C8, 5, 1, 0x81, 0x0E2,	0x0E, 0,	0x81, 0x0D6, 0x0A
		db 1, 0x81, 0x0C9, 5, 1, 0x81, 0x0E3, 0x0E, 0, 0x8D, 0x0D8, 1
		db 0x0C4, 0x0C2, 0x0C3, 0x0C7, 0x0C2, 0x0C3, 0x0C7, 0x0C7, 0x0C7
		db 0x0C2, 0x0C1, 4, 1, 0x81, 0x0E4,	0x0E, 0,	0x83, 0x0DB, 1, 0x0C5
		db 0x0E,	1, 0x81,	0x0DF, 0x0E, 0, 0x92, 0x0D9, 1, 0x0C6, 0x0C7
		db 0x0C7, 0x0C7, 0x0C2, 0x0C3, 0x0C7, 0x0C2, 0x0C3, 0x0C7, 0x0C7
		db 0x0C2, 0x0C1, 1, 1, 0x0E0, 0x0E,	0, 0x81,	0x0DA, 0x0C, 1, 0x85
		db 0x0C9, 1, 1, 1, 0x0DE,	0x0E, 0,	0x81, 0x0D7, 8, 1, 0x89, 0x0C4
		db 0x0C7, 0x0C7, 0x0C7, 0x0C2, 0x0C1, 1, 1, 0x0E5, 0x0E, 0, 7
		db 1, 0x85, 0x0CA, 0x0CC, 0x0CD, 0x0CE, 0x0CB, 5, 1, 0x81, 0x0E6
		db 0x0E,	0, 0x84,	0x0D6, 0x0D1, 0x0D4, 0x0D1,	4, 1, 0x8A, 0x0D4
		db 1, 1, 1, 0x0D1, 0x0D1,	1, 1, 0x0D1, 0x0E7, 0
		
coloresFlecha:	db 1, 6, 6, 0x0A, 0x0A, 6, 6, 6	; Цвета подсветки стрелки и пирамиды на карте


;----------------------------------------------------
;
; Экранные координаты пирамид на карте
; Y, X
;----------------------------------------------------
coordPiramMap:	db 0x3F,	0x4A
		db 0x3F,	0x6A
		db 0x3F,	0x8A
		db 0x4F,	0x0A2
		db 0x4F,	0x8A
		db 0x4F,	0x62
		db 0x5F,	0x5A
		db 0x5F,	0x7A
		db 0x6F,	0x92
		db 0x6F,	0x6A
		db 0x6F,	0x52
		db 0x7F,	0x6A
		db 0x7F,	0x82
		db 0x7F,	0x0A2
		db 0x8F,	0x0A2

offsetFlechas:	db 0x0F9, 2
		db 8, 2
		db 0x0F9, 0x0F1
		db 0x0F9, 4

;----------------------------------------------------
; Номера спрайтов стрелок
;----------------------------------------------------
numSprFlechas:	db 0x0E8
		db 0x0F0			; Вниз
		db 0x0F4			; Влево
		db 0x0EC			; Вправо

;----------------------------------------------------
; Номера спрайтов перевёрнутых стрелок
;----------------------------------------------------
numSprFlechInv:	db 0x0F0
		db 0x0E8			; Вверх
		db 0x0EC			; Вправо
		db 0x0F4			; Влево


TXT_ENDING:
		dw 0x38c9		; Адрес VRAM
		db 0x8F
		db 0x23,	0x2F, 0x2E, 0x27, 0x32, 0x21, 0x34, 0x35, 0x2C,	0x21, 0x34, 0x29, 0x2F, 0x2E, 0x33 	; "CONGRATULATIONS"
		db 0x2e, 0									; Заполняет #2e паттернов
		db 0x90			; Передаёт #10 паттернов
		db 0x33, 0x30, 0x25, 0x23, 0x29, 0x21, 0x2C, 0, 0x22, 0x2F, 0x2E, 0x35, 0x33, 0, 0, 0x11 	; "SPECIAL BONUS  1"
		
		db    4, 0x10									; "0000"
		db    0										; Конец

;----------------------------------------------------
;  ЗВУК: проигрыватель потоков событий ВИ53 вместо драйвера Konami (задача snd-vi53).
;  SetMusic_/setMusic, тик updateSound, apply/hush — v06c/vec_snd.asm; нотные данные Konami
;  (res/res_music.asm, MUS_*/SFX_*) в сборку больше не входят: из них tools/snd_gen/ снял
;  потоки (gen/snd_streams.asm). Исходные данные остались в res/res_music.asm как документ.
;----------------------------------------------------
	.include "../v06c/vec_snd.asm"
; ===========================================================================

vec_font_rom:	; TASK1: распакованный GFX_Font (RLE) в ROM, 48 тайлов 0x10-0x3f x8=384B
		db	0x000,0x01C,0x022,0x063,0x063,0x063,0x022,0x01C,0x000,0x018,0x038,0x018,0x018,0x018,0x018,0x07E
		db	0x000,0x03E,0x063,0x003,0x00E,0x03C,0x070,0x07F,0x000,0x03E,0x063,0x003,0x00E,0x003,0x063,0x03E
		db	0x000,0x00E,0x01E,0x036,0x066,0x066,0x07F,0x006,0x000,0x07F,0x060,0x07E,0x063,0x003,0x063,0x03E
		db	0x000,0x03E,0x063,0x060,0x07E,0x063,0x063,0x03E,0x000,0x07F,0x063,0x006,0x00C,0x018,0x018,0x018
		db	0x000,0x03E,0x063,0x063,0x03E,0x063,0x063,0x03E,0x000,0x03E,0x063,0x063,0x03F,0x003,0x063,0x03E
		db	0x03C,0x042,0x099,0x0A1,0x0A1,0x099,0x042,0x03C,0x018,0x03C,0x018,0x008,0x010,0x000,0x000,0x000
;  === ТАЙЛЫ ШРИФТА 0x1C-0x1F ПУСТЫЕ (32 нуля) — И ЗДЕСЬ ЖЕ ЖИВУТ ДВЕ КОНСТАНТЫ ==========
;  vec_pal_zero (16 нулей, чёрная палитра на буте) и eraseData (9 нулей, «пустые тайлы»
;  для vec_blit_rect/putBrillosMap) — это ПРОСТО НУЛИ, и лежали они отдельными блоками.
;  Теперь они РАЗМЕЧЕНЫ ПРЯМО ЗДЕСЬ, в пустых глифах шрифта: -25 Б.
;  Это НЕ `equ` на вычисленный адрес, а метки поверх настоящих данных — то есть при любой
;  правке шрифта ассемблер сдвинет их вместе с байтами, а не оставит указывать в пустоту.
;  ЕДИНСТВЕННОЕ УСЛОВИЕ: 32 байта ниже обязаны остаться нулями (это глифы 0x1C-0x1F,
;  в оригинальном шрифте пустые). Если шрифт будут дополнять — сначала перенести метки.
vec_pal_zero:	; 16 нулей = экран чёрный, что бы в плоскостях ни лежало (читается ВНИЗ от +15)
		db	0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0
eraseData:	; 9 нулей = пустой прямоугольник 3x3 тайла
		db	0,0,0, 0,0,0, 0,0,0
		db	0,0,0,0,0,0,0	; добор пустых глифов до 32 Б
		db	0x000,0x000,0x000,0x000,0x07E,0x000,0x000,0x000,0x000,0x01C,0x036,0x063,0x063,0x07F,0x063,0x063
		db	0x000,0x07E,0x063,0x063,0x07E,0x063,0x063,0x07E,0x000,0x03E,0x063,0x060,0x060,0x060,0x063,0x03E
		db	0x000,0x07C,0x066,0x063,0x063,0x063,0x066,0x07C,0x000,0x07F,0x060,0x060,0x07E,0x060,0x060,0x07F
		db	0x000,0x07F,0x060,0x060,0x07E,0x060,0x060,0x060,0x000,0x03E,0x063,0x060,0x067,0x063,0x063,0x03F
		db	0x000,0x063,0x063,0x063,0x07F,0x063,0x063,0x063,0x000,0x03C,0x018,0x018,0x018,0x018,0x018,0x03C
		db	0x000,0x01F,0x006,0x006,0x006,0x006,0x066,0x03C,0x000,0x063,0x066,0x06C,0x078,0x07C,0x06E,0x067
		db	0x000,0x060,0x060,0x060,0x060,0x060,0x060,0x07F,0x000,0x063,0x077,0x07F,0x07F,0x06B,0x063,0x063
		db	0x000,0x063,0x073,0x07B,0x07F,0x06F,0x067,0x063,0x000,0x03E,0x063,0x063,0x063,0x063,0x063,0x03E
		db	0x000,0x07E,0x063,0x063,0x063,0x07E,0x060,0x060,0x000,0x03E,0x063,0x063,0x063,0x06F,0x066,0x03D
		db	0x000,0x07E,0x063,0x063,0x062,0x07C,0x066,0x063,0x000,0x03E,0x063,0x060,0x03E,0x003,0x063,0x03E
		db	0x000,0x07E,0x018,0x018,0x018,0x018,0x018,0x018,0x000,0x063,0x063,0x063,0x063,0x063,0x063,0x03E
		db	0x000,0x063,0x063,0x063,0x063,0x036,0x01C,0x008,0x000,0x063,0x063,0x06B,0x06B,0x07F,0x077,0x022
		db	0x000,0x063,0x076,0x03C,0x01C,0x01E,0x037,0x063,0x000,0x066,0x066,0x07E,0x03C,0x018,0x018,0x018
		db	0x000,0x07F,0x007,0x00E,0x01C,0x038,0x070,0x07F,0x000,0x020,0x030,0x038,0x03C,0x038,0x030,0x020
;  [СНЯТО, 32 Б] ХВОСТ ШРИФТА: четыре последних глифа (тайлы 0x3C-0x3F) — сплошные нули,
;  таблица кончается на 0x3B. Что игра их НЕ РИСУЕТ, доказано не рассуждением, а опытом:
;  в ROM эти 32 байта забивались 0xFF (то есть сплошным чёрным квадратом вместо пустоты)
;  и в таком виде ЗЕЛЁНЫМИ прошли все гейты — coltab_frame_parity (картинка побайтно
;  на каждом игровом тике), screens_palette_check, stageclear_recolor, map_fidelity,
;  bonus_ending_gate, ending_door_fidelity и остальные. Нарисуй игра такой тайл хоть раз —
;  расхождение было бы видно немедленно.


;  ===== ОБЩЕЕ 16-БИТНОЕ ВЫЧИТАНИЕ С ФЛАГАМИ Z80 (ЗАДАЧА#53, 2026-08-07) =============
;  ЗАЧЕМ. Рекомпилятор Z80->i8080 разворачивал КАЖДЫЙ `sbc hl,de` в один и тот же блок
;  на 20 байт: вычитание по половинкам плюс восстановление флага Z ПО ВСЕМ ШЕСТНАДЦАТИ
;  битам (у i8080 `sbc a,d` оставляет Z только от старшей половины). Таких блоков в
;  игровой логике ПЯТЬ — рекорд очков, ловушка-стена (две штуки), дверь, поиск мумии, —
;  и все холодные: ни один не под лучом и ни один не в пачке вывода.
;  ЦЕНА ВЫЗОВА: 17 тактов на call + 10 на ret = 27 тактов на срабатывание.
;  ВЫИГРЫШ: 4 площадки по 17 Б + одна (ловушка, ей нужен заём пары DE) по 13 Б минус
;  19 Б самой процедуры = 62 Б pre-align. По §0 DESIGN-2026-08-06-sprout-unification
;  каждый снятый байт — это +1 к резерву, с какой стороны `.align` он ни лежал.
;  ФЛАГИ ЧЕРЕЗ call/ret ПРОХОДЯТ НАСКВОЗЬ: ни `call`, ни `ret`, ни `push`/`pop rp`
;  (кроме PSW) их не трогают, поэтому входной ПЕРЕНОС доезжает до `sbc a,e`, а выходные
;  Z и CY читает вызывающий ровно так же, как читал у инлайна.
;  ВЫХОД: CY = заём (HL < DE), Z = «все 16 бит нулевые».
vec_sbcd:
	ld	a, l
	sbc	a, e
	ld	l, a
	ld	a, h
	sbc	a, d
	ld	h, a
	ret	nz		; старшая половина ненулевая -> Z уже верный, CY = заём
	jp	c, vsbc_y
	ld	a, l	; заёма нет: Z по младшей половине, CY гасим (or a)
	or	a
	ret
vsbc_y:
	ld	a, l	; заём есть: Z по младшей половине, CY возвращаем
	or	a
	scf
vsbc_x:
	ret
