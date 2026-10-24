#!/usr/bin/env python3
# ОДНОРАЗОВЫЙ конвертер src/ из sjasm-синтаксиса в ОБЩЕЕ ПОДМНОЖЕСТВО
# sjasm+Devector (проверено байт-в-байт на обоих ассемблерах):
#   NNh / #NN        -> 0xNN            (только в кодовой части строки, до ';')
#   MAP #a / n: # s  -> n: equ 0xADDR   (адреса запечены, комменты сохранены)
#   IF/ELSE/ENDIF    -> статически разрешены при VERSION2=1 (мёртвые ветки удалены)
#   include          -> .include
#   ALIGN            -> .align
#   SIZE 28*1024     -> закомментирована (паддинг до 28К делает build.sh / гейт)
import re, os

SRC = os.path.join(os.path.dirname(__file__), "..", "src")
FILES = ["kvalley_8c.asm", "game/kvalley_game.asm", "game/kvalley_vars.asm",
         "v06c/vec_boot.asm","v06c/vec_palette.asm","v06c/vec_isr.asm","v06c/vec_blit.asm",
         "v06c/vec_sprites.asm","v06c/vec_saveunder.asm","v06c/vec_stream.asm",
         "v06c/vec_rotblit.asm","v06c/vec_mirror.asm","v06c/vec_ldir.asm",
         "res/res_ui_gfx.asm","res/res_sprites_tiles.asm","res/res_music.asm"]
VERSION2 = 1

RE_HSUF = re.compile(r"(?<![\w.])([0-9][0-9A-Fa-f]*)[hH]\b")
RE_HASH = re.compile(r"#([0-9A-Fa-f]+)\b")

def lit(code):
    code = RE_HSUF.sub(lambda m: "0x"+m.group(1), code)
    code = RE_HASH.sub(lambda m: "0x"+m.group(1), code)
    return code

def split_comment(line):
    i = line.find(";")
    return (line, "") if i < 0 else (line[:i], line[i:])

def conv_ifs(lines):
    out, stack = [], []
    for ln in lines:
        code, _ = split_comment(ln)
        s = code.strip()
        m = re.match(r"^IF\s+(.+?)\s*$", s)
        if m:
            cond = m.group(1).replace("!", " not ").replace("VERSION2", str(VERSION2))
            stack.append(bool(eval(cond)))
            continue
        if s == "ELSE" and stack:
            stack[-1] = not stack[-1]; continue
        if s == "ENDIF" and stack:
            stack.pop(); continue
        if all(stack):
            out.append(ln)
    assert not stack, "незакрытый IF"
    return out

def conv_vars(lines):
    out, cur = [], None
    for ln in lines:
        code, com = split_comment(ln)
        m = re.match(r"^\s*MAP\s+#?([0-9A-Fa-f]+)h?\s*$", code, re.I)
        if m:
            cur = int(m.group(1), 16)
            out.append("; MAP 0x%04X expanded to equ chain by converter (baked addresses)\n" % cur)
            continue
        m = re.match(r"^(\S+?):?[ \t]*#[ \t]*([^\s;][^;\n]*?)[ \t]*$", code)
        if m and cur is not None:
            name, szx = m.group(1), m.group(2)
            size = eval(RE_HSUF.sub(lambda k: "0x"+k.group(1), szx))
            out.append("%s:\tequ\t0x%04X%s%s" % (name, cur, "\t" if com else "",
                       com if com else "\n"))
            cur += size
            continue
        out.append(ln)
    if cur is not None:
        print("  konec MAP: 0x%04X" % cur)
    return out

def conv_file(path, is_vars):
    with open(path, encoding="latin-1") as f:
        lines = f.readlines()
    # sjasm-локальные метки (.name) Devector не знает; все 14 уникальны -> глобализуем.
    locs = set()
    for ln in lines:
        c, _ = split_comment(ln)
        m = re.match(r"^\.([\w]+):", c)
        if m: locs.add(m.group(1))
    if is_vars:
        lines = conv_vars(lines)
    lines = conv_ifs(lines)
    out = []
    for ln in lines:
        code, com = split_comment(ln)
        if re.match(r"^SIZE\b", code.strip()):
            out.append("; [conv] " + ln)
            continue
        code = re.sub(r"^(\s*)include\b", r"\1.include", code)
        code = re.sub(r"^(\s*)ALIGN\b", r"\1.align", code)
        # Devector: метка:мнемоника без пробела не парсится
        code = re.sub(r"^([A-Za-z_@.][\w@.]*):([A-Za-z])", r"\1:\t\2", code)
        # Devector: операнд, начинающийся со скобки, считается ссылкой на память;
        # иммедиаты вида (expr)&255 переписываем как 255&(expr)
        code = re.sub(r"([,\s])\((.+)\)&255([ \t]*)$", r"\g<1>255&(\2)\3", code)
        for nm in locs:
            code = re.sub(r"(?<![\w])\.(%s)\b" % re.escape(nm), r"\1", code)
        # двоичные NNNNb -> hex (общий знаменатель)
        code = re.sub(r"\b([01]+)b\b", lambda m: hex(int(m.group(1), 2)), code)
        code = lit(code)
        out.append(code + com)
    with open(path, "w", encoding="latin-1") as f:
        f.writelines(out)

for rel in FILES:
    print("конвертирую", rel)
    conv_file(os.path.join(SRC, rel), rel.endswith("kvalley_vars.asm"))
print("готово")
