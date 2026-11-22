#!/usr/bin/env python3
"""Делает облегчённые версии hero-картинок: public/img/covers/Tyumny_voshod/r/<имя>-<ширина>.(webp|avif).
Запуск из корня проекта:  pip3 install pillow  &&  python3 scripts/make-hero-variants.py
Запускать после добавления/замены картинки в папке Tyumny_voshod."""
import glob, os
from PIL import Image
SRC = 'public/img/covers/Tyumny_voshod'
OUT = os.path.join(SRC, 'r')
WIDTHS = (640, 1024)
os.makedirs(OUT, exist_ok=True)
for f in sorted(glob.glob(os.path.join(SRC, '*.webp'))):
    name = os.path.splitext(os.path.basename(f))[0]
    im = Image.open(f).convert('RGB')
    for w in WIDTHS:
        if im.width <= w: continue
        r = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        r.save(os.path.join(OUT, f'{name}-{w}.webp'), 'WEBP', quality=72, method=6)
        r.save(os.path.join(OUT, f'{name}-{w}.avif'), 'AVIF', quality=45, speed=6)
    print('ok', name)
