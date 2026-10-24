;  Хвост vmx_check: микс уже законен (ни одного vmx_bad). vmx_ovl часто не
;  ставит sl=2 на ∩ с мумией — тогда пачка рисует героя до мумий, мумия сейвит
;  одежду и после прыжка restore оставляет черту. Не только лестница (vop_i1):
;  перепрыгивание на полу — тот же сейв. Створки сюда не попадают (vmx_bad).
vcm_tick:
	ld	a, (vmx_p)
	ld	(vpr_mix), a
	ld	e, 6
	ld	a, 14
	call	vhr_ovl
	ret	z
	inc	a
	ld	(vpr_sl), a
	ret
;  vmx_one: pending=3 (кожа в одежде) имеет valid=0 — старый dec a валил пару,
;  mix оставался 0xFE, LAST не ставился. Шапка тогда пустая, в союз только запись.
vcm_pone:
	add	a, vso_ord&255
	ld	l, a
	ld	h, 255&(vso_ord>>8)
	ld	a, (hl)
	add	a, 0x0E0
	ld	h, a
	ld	l, 0x96
	ld	a, (hl)
	and	1
	jp	z, vmx_bad
	ld	l, 0
	ld	a, (hl)
	dec	a
	jp	nz, vcm_pded
	ld	l, 1
	call	vmx_un
	jp	vcm_prec
vcm_pded:
	ld	l, 0x96
	ld	a, (hl)
	cp	3
	jp	nz, vmx_bad
vcm_prec:
	ld	l, 0x97
	call	vmx_un
	ld	a, (vpr_sl)
	or	a
	ret	nz
	call	vfm_geo
	ret	z
	ld	a, 1
	ld	(vpr_sl), a
	ret
