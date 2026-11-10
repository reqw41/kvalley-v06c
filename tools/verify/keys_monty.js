// [mummy-zx] Управление по схеме Monty: джойстик «П» (порт 06) наравне с 0E, ВК — пауза,
// в паузе АР2 — титул, УС — музыка вкл/выкл. node tools/verify/keys_monty.js [rom] [sym]
const H=require('./beam_harness.js');
const rom=process.argv[2]||'build/kvalley_8c.rom', sym=process.argv[3]||rom.replace(/\.rom$/,'.sym');
const E=H.make(rom,sym);const {run,key,rd,L,io}=E;
let ok=true;const chk=(c,m)=>{console.log((c?'OK  ':'FAIL')+' '+m);if(!c)ok=false;};
chk(H.toGame(E)===5,'партия идёт (GS=5)');
run(60);
const X=()=>rd(L.sprAttrib+17);   // слот 4 = герой
// джойстик «П»: вправо (бит0) на порту 06
let x0=X(); io.PB2=0xFD; run(20); io.PB2=0xFF; run(5); let x1=X();
chk(x1<x0,`порт 06 «влево» двигает героя: X ${x0} -> ${x1}`);
x0=X(); io.PB2=0xFE; run(20); io.PB2=0xFF; run(5); x1=X();
chk(x1>x0,`порт 06 «вправо»: X ${x0} -> ${x1}`);
// УС: режим звука 0 -> 1 -> 0
const m0=rd(L.vec_snd_mode); key(17,1); run(8); key(17,0); run(8); const m1=rd(L.vec_snd_mode);
key(17,1); run(8); key(17,0); run(8); const m2=rd(L.vec_snd_mode);
chk(m0===0&&m1===1&&m2===0,`УС: режим звука ${m0} -> ${m1} -> ${m2}`);
// ВК: пауза
key(13,1); run(8); key(13,0); run(8);
chk(rd(L.vec_paused)===1,'ВК: пауза включена');
x0=X(); const t0=rd(L.timer); key(39,1); run(30); key(39,0); 
chk(X()===x0&&rd(L.timer)===t0,'в паузе логика стоит');
key(13,1); run(8); key(13,0); run(8);
chk(rd(L.vec_paused)===0,'ВК: пауза снята');
run(20); chk(rd(L.GameStatus)===5,'после паузы — игра');
// пауза + АР2 -> титул
key(13,1); run(8); key(13,0); run(8);
key(27,1); run(8); key(27,0);
let gs=[];for(let i=0;i<60;i++){run(5);gs.push(rd(L.GameStatus));}
chk(rd(L.vec_paused)===0,'АР2: пауза снята');
chk(gs.includes(0)||gs.includes(1),'АР2: GameStatus прошёл титул: '+[...new Set(gs)].join(','));
chk((rd(L.controlPlayer)&0x40)===0,'АР2: герой не под игроком');
E.png&&E.png('outputs/mummy-zx/keys_title_after_ar2.png');
// с титула — снова в игру пробелом
for(let i=0;i<250&&rd(L.GameStatus)!==5;i++){key(32,1);run(3);key(32,0);run(5);}
for(let i=0;i<400&&rd(L.GameStatus)!==5;i++)run(4);
chk(rd(L.GameStatus)===5,'с титула снова партия');
run(100); E.png&&E.png('outputs/mummy-zx/keys_game_again.png');
// огонь на порту 06 = прыжок (Y меняется)
const y0=rd(L.sprAttrib+16); let ys=[]; io.PB2=0xBF; run(6); io.PB2=0xFF; for(let i=0;i<20;i++){run(2);ys.push(rd(L.sprAttrib+16));}
chk(ys.some(y=>y!==y0),'огонь порта 06 — прыжок: Y '+y0+' -> '+Math.min(...ys));
console.log(ok?'KEYS_MONTY PASS':'KEYS_MONTY FAIL');process.exit(ok?0:1);
