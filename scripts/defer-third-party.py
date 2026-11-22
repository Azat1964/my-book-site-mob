#!/usr/bin/env python3
"""Переводит страницы public/*.html на свои шрифты и отложенные счётчики (как на главной).
Запуск из корня проекта: python3 scripts/defer-third-party.py  (повторный запуск безопасен)."""
import re, sys, pathlib

PAGES = ['about','annotations','blog','blog-post','book','book_mob','chistoriya','contents','privacy','registration']

LOADER = '''  <!-- Счётчики (GA4, Яндекс.Метрика, Top.Mail.Ru)%(chat_note)s грузятся ОТЛОЖЕННО: после load + паузы
       либо при первом действии посетителя. Очереди ym / gtag / _tmr создаются сразу —
       цели и события, отправленные до загрузки счётчиков, не теряются. -->
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-29GR2L5LFK');

    window.ym = window.ym || function(){(window.ym.a = window.ym.a || []).push(arguments)};
    window.ym.l = 1 * new Date();
    ym(110915454, 'init', {ssr:true, webvisor:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});

    var _tmr = window._tmr || (window._tmr = []);
    _tmr.push({id: "3780557", type: "pageView", start: (new Date()).getTime()});

    (function () {
      var started = false;
      var evs = ['scroll','pointerdown','keydown','touchstart','mousemove'];
      function add(src, id) {
        var s = document.createElement('script');
        s.async = true; s.src = src;
        if (id) s.id = id;
        document.head.appendChild(s);
      }
      function start() {
        if (started) return;
        started = true;
        evs.forEach(function (ev) { window.removeEventListener(ev, start, true); });
        add('https://www.googletagmanager.com/gtag/js?id=G-29GR2L5LFK');
        add('https://mc.yandex.ru/metrika/tag.js?id=110915454');
        add('https://top-fwz1.mail.ru/js/code.js', 'tmr-code');%(chat_add)s
      }
      evs.forEach(function (ev) { window.addEventListener(ev, start, {capture: true, passive: true, once: true}); });
      window.addEventListener('load', function () { setTimeout(start, 2500); });
    })();
  </script>
'''

FONTS = '''<link rel="preload" href="/fonts/gabriela-cyrillic-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<style>
  /* Шрифты свои (public/fonts), не с Google */
  @font-face { font-family:'Gabriela'; font-style:normal; font-weight:400; font-display:swap;
    src:url(/fonts/gabriela-cyrillic-400-normal.woff2) format('woff2');
    unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116; }
  @font-face { font-family:'Gabriela'; font-style:normal; font-weight:400; font-display:swap;
    src:url(/fonts/gabriela-latin-400-normal.woff2) format('woff2');
    unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
  @font-face { font-family:'Archivo Black'; font-style:normal; font-weight:400; font-display:swap;
    src:url(/fonts/archivo-black-latin-400-normal.woff2) format('woff2');
    unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
</style>
'''

for name in PAGES:
    p = pathlib.Path('public') / f'{name}.html'
    s = p.read_text(encoding='utf8')
    if 'fonts.googleapis.com' not in s and 'googletagmanager.com/gtag/js' not in s:
        print('skip (уже сделано)', name); continue
    n0 = len(s)

    # --- счётчики ---
    s = re.sub(r'[ \t]*<!-- Google tag \(gtag\.js\) -->\s*<script async src="https://www\.googletagmanager\.com/gtag/js\?id=G-29GR2L5LFK"></script>\s*<script>[\s\S]*?</script>\n?', '', s, count=1)
    s = re.sub(r'<script type="text/javascript">\s*\(function\(m,e,t,r,i,k,a\)[\s\S]*?</script>\n?', '', s, count=1)
    s = re.sub(r'<script type="text/javascript">\s*var _tmr[\s\S]*?</script>\n?', '', s, count=1)

    # --- чат-виджет: если был на странице — теперь его грузит общий загрузчик ---
    had_chat = bool(re.search(r'<script src="/js/chat-widget\.js" defer></script>\n?', s))
    s = re.sub(r'<script src="/js/chat-widget\.js" defer></script>\n?', '', s)
    loader = LOADER % {
        'chat_note': ' и чат' if had_chat else '',
        'chat_add': "\n        add('/js/chat-widget.js');" if had_chat else '',
    }
    s = re.sub(r'<head>\n?', lambda m: '<head>\n' + loader, s, count=1)

    # --- шрифты и preconnect к сторонним ---
    s = re.sub(r'[ \t]*<link rel="preconnect" href="https://(?:fonts\.googleapis\.com|fonts\.gstatic\.com|www\.googletagmanager\.com|mc\.yandex\.ru|top-fwz1\.mail\.ru)"[^>]*>\n?', '', s)
    s = re.sub(r'[ \t]*<noscript><link href=[\'"]https://fonts\.googleapis\.com[^>]*></noscript>\n?', '', s)
    s, k = re.subn(r'[ \t]*<link rel="preload" href=[\'"]https://fonts\.googleapis\.com[^>]*>\n?', lambda m: FONTS, s, count=1)
    if k == 0 and 'fonts.googleapis.com' in s:
        sys.exit(f'{name}: остались Google Fonts')
    p.write_text(s, encoding='utf8')
    print('ok', name, n0, '->', len(s), '| чат:', had_chat)
