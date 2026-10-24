
;-------------------------------------------------------------------------------
;
; King's Valley (RC727)
;
; Copyright 1985 Konami
;
; Desensamblado	e interpretado por Manuel Pazos	(jose.manuel.pazos@gmail.com)
; Santander,  17-07-2009
;
;-------------------------------------------------------------------------------


VERSION2	equ	1	; Segunda version de la ROM con correccion de fallos

;-------------------------------------------------------------------------------
; Modificando la constante VERSION2 se pueden generar las dos versiones del juego que existen
; La version 2 [A1] corrige algunos fallos de la version previa como:
;
; - Impide que se pueda lanzar un cuchillo cuando la puerta se esta abriendo.
;   De esta forma se evita que se corrompa el grafico de la puerta al pasar el cuchillo sobre ella
;
; - Impide que se pueda lanzar un cuchillo cuando se esta pegado a un objeto (gema, pico, etc...)
;   En la version original atravesaba el objeto al lanzar el cuchillo
;
; - Se puede picar sobre un muro trampa
;
; - Corregida la posicion del muro trampa de la piramide 10 de la pantalla de la izquierda, abajo a la izquierda (aparece al coger el cuchillo)
