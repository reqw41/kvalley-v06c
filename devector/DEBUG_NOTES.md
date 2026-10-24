# King's Valley — отладка в Devector (VS Code)

ROM: `kvalley.rom` (= текущий задеплоенный билд kvv_r3_ef.rom, i8080, org 0x100).
Devector НЕ импортирует sjasm-символы → брейкпоинты ставим ПО АДРЕСУ (ниже).
Чтобы отладить свежий билд: перекопируй `kvv_r3_ef.rom` -> `kvalley.rom` и Run заново.

## Запуск
1. Command Palette → **Devector: Run Project** (или F5).
2. Если экран пустой/мусор (CPU стартует с PC=0): в отладчике задай **PC = 0x100** (наш вход .COM-стиля).
3. Панель памяти (hexdump 16×16) следит за PC; Step / Step Frame / Step 256.

## Ключевые адреса (из kvalley.sym)
### Автомат состояний (GameStatus @6B00: 0=Konami 1=меню 2=demo 4=StartGame 5=игра 8=stageClear 9=scroll)
- `tickMain` = 0x10F
- `runGame` = 0x197
- `gameLogic` = 0x2EC
- `KonamiLogo` = 0x1CE
- `WaitMainMenu` = 0x210
- `SetDemo` = 0x218
- `StartGame` = 0x244
- `tickGame` = 0xFC4
- `updateSprites` = 0x103C

### Рендер/палитра/заставка (для охоты за порчей титула)
- `vec_nsx` = 0x5E23
- `vec_spr_load` = 0x56A9
- `vec_spr_mkmir` = 0x6284
- `vec_spr_buf` = 0x6598
- `vec_spr_buf_mir` = 0x63F8
- `vec_setpal` = 0x5320
- `vec_setpal_menu` = 0x532A
- `vec_pal_menu` = 0x5361
- `setupPergamino` = 0x46D4
- `dibujaLogo` = 0xCF5
- `clearScreen` = 0x680

### Состояние (RAM)
- `GameStatus` = 0x6B00
- `timer` = 0x6B03
- `Vidas` = 0x6B50
- `momiasPiramid` = 0x6C4E
- `ProtaY` = 0x6C37
- `ProtaX` = 0x6C39
- `MapaRAM` = 0x7373
