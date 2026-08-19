//const FONT_SIZE_DEFAULT = '16px';
//const FONT_SIZE_DEFAULT_PROC = '95%';
//const FONT_FAMILY_DEFAULT = 'Gabriela';
const OUTPUTCONTEINER = document.getElementById('outputContainer');
const regex = /[бвгджзйклмнпрстфхцчшщ]+[аеёиоуыэюя][бвгджзйклмнпрстфхцчшщ](?=[бвгджзйклмнпрстфхцчшщьъ ])[ьъй]?|[бвгджзйклмнпрстфхцчшщ]+[аеёиоуыэюя][й]?|[аеёиоуыэюя][бвгджзйклмнпрстфхцчшщ](?=[бвгджзйклмнпрстфхцчшщьъ ])[ъь]?|[аеёиоуыэюя](?=[а-я]{2})|(?<= +)[^\s]+(?= +|$)/gmi;

// Храним обработанный текст и текущий размер окна для сравнения при resize
let currentInputText = null;
let lastWindowHeight = window.innerHeight;
let lastWindowWidth = window.innerWidth;

// Параметры текущей открытой главы (заполняются при первой загрузке)
let currentSlug = null;
let currentChapterNum = null;

// Простой кэш в памяти — чтобы при пересчёте после resize не дёргать сервер заново
// (текст глав не меняется от размера окна, меняется только то, сколько страниц он займёт)
const chapterContentCache = {};
let bookInfoCache = null;

async function fetchChapterContent(slug, chapterNumber) {
  const key = `${slug}:${chapterNumber}`;
  if (chapterContentCache[key] !== undefined) return chapterContentCache[key];
  const res = await fetch(`/api/books/${slug}/chapters/${chapterNumber}`);
  if (res.status === 403) {
    // Глава за пределами бесплатного лимита ЭТОЙ книги — читателю нужна регистрация.
    // Не кэшируем (вдруг он зарегистрируется и придёт сюда снова в этой же вкладке).
    let info = {};
    try { info = await res.json(); } catch (e) { /* тело могло не распарситься — не критично */ }
    const err = new Error('requiresAuth');
    err.requiresAuth = true;
    err.freeChaptersLimit = info.freeChaptersLimit;
    throw err;
  }
  if (!res.ok) return null;
  const data = await res.json();
  chapterContentCache[key] = data.content;
  return data.content;
}

async function fetchBookInfo(slug) {
  if (bookInfoCache && bookInfoCache.slug === slug) return bookInfoCache.data;
  const res = await fetch(`/api/books/${slug}`);
  if (!res.ok) return null;
  const data = await res.json();
  bookInfoCache = { slug, data };
  return data;
}

// Приводит сырой текст главы к HTML-разметке, которую понимает buildPages()
function formatChapterText(rawText) {
  // Маркер [img:путь] — иллюстрация внутри текста главы (автор ставит её
  // отдельной строкой в нужном месте текста). Превращаем в токен БЕЗ пробелов
  // внутри (через encodeURIComponent) — иначе разбивка на слова (split по \s+
  // ниже, в processWords) разорвала бы путь к картинке на несколько "слов".
  // Сам токен превращается обратно в <img> позже, в addTextToSide — в момент
  // реального измерения высоты страницы, чтобы подгонка текста учитывала
  // настоящий размер картинки.
  const withImgTokens = rawText.replace(/\[img:(.+?)\]/g, (_, path) => `§IMG§${encodeURIComponent(path.trim())}§`);

  // Уменьшенная версия картинки — [img-small:...], та же логика атомного
  // токена, что и у §IMG§ выше, отображается вдвое мельче (см. класс
  // .chapter-illustration-small в css/fish_no_sound.css).
  const withImgSmallTokens = withImgTokens.replace(/\[img-small:(.+?)\]/g, (_, path) => `§IMGSMALL§${encodeURIComponent(path.trim())}§`);

  // Маркер [audio:путь] — аудиоплеер внутри текста главы, та же логика
  // атомного токена, что и у §IMG§ выше: пагинация режет текст на "слова"
  // по пробелу, а путь к аудиофайлу не должен быть разорван на середине.
  const withAudioTokens = withImgSmallTokens.replace(/\[audio:(.+?)\]/g, (_, path) => `§AUDIO§${encodeURIComponent(path.trim())}§`);

  // Главы приходят из разных источников (ручной ввод в admin.html, импорт
  // .docx через mammoth), и переносы строк в них бывают разного вида:
  // \n (Unix/Mac), \r\n (Windows) или даже одиночный \r. Без нормализации
  // регулярка \n{2,} не находит "пустую строку" в \r\n\r\n — между \n там
  // стоит \r, и для регулярки это не два подряд идущих \n. Из-за этого
  // отступы схлопывались в одних главах (введённых как \n) и оставались
  // в других (импортированных с \r\n) — приводим всё к единому виду сразу.
  const normalized = withAudioTokens.replace(/\r\n?/g, '\n');

  // Заголовок отдельного стихотворения внутри сплошного текста книги —
  // [title]Название[/title]. Нужен, когда вся книга (например, сборник
  // стихов) хранится как ОДНА глава: без этого маркера стихи слились бы
  // в один блок без подписей.
  // ВАЖНО: упаковываем в атомный токен §PTITLE§...§ (как и §PLINE§ для строк
  // стиха, §IMG§ для картинок), а НЕ вставляем готовый HTML-тег напрямую.
  // Причина: пагинация (см. processWords ниже) режет текст на "слова" по
  // пробелу, а сырой `<div class="poem-title">Название</div>` содержит
  // пробел между "<div" и "class=..." — без защиты пагинация может разорвать
  // тег ровно на этом пробеле, раскидав его половинки по разным страницам
  // (наблюдалось на практике: "<div" оставался в конце одной страницы,
  // "class=\"poem-title\">Название" — в начале следующей, видимое как код).
  // Распаковывается обратно в реальный HTML в addTextToSide(), уже после
  // того как разбивка по страницам полностью завершена.
  const withTitles = normalized.replace(
    /\[title\]([\s\S]*?)\[\/title\]/gi,
    (_, t) => `§PTITLE§${encodeURIComponent(t.trim())}§`
  );

  // Мелкая курсивная пометка автора ([note]...[/note]) — дата/время
  // написания, самооценка и т.п. Та же логика атомного токена, что и у
  // §PTITLE§ выше — может быть в несколько строк, пагинация не должна
  // резать её посередине.
  const withNotes = withTitles.replace(
    /\[note\]([\s\S]*?)\[\/note\]/gi,
    (_, t) => `§PNOTE§${encodeURIComponent(t.trim())}§`
  );

  // Стихи форматируются иначе, чем проза: без красной строки на каждой
  // строке, с сохранением всех пробелов автора (ручные отступы — "лесенка")
  // и с сохранением пустых строк между строфами как визуального промежутка.
  // Автор помечает такой фрагмент маркерами [poem] ... [/poem] в admin.html;
  // всё остальное (проза до и после) форматируется как обычно.
  const poemRe = /\[poem\]([\s\S]*?)\[\/poem\]/gi;

  if (poemRe.test(withNotes)) {
    poemRe.lastIndex = 0; // сбрасываем после test(), иначе следующий exec начнёт не с начала
    let result = '';
    let lastIndex = 0;
    let match;
    while ((match = poemRe.exec(withNotes)) !== null) {
      result += formatProseSegment(withNotes.slice(lastIndex, match.index));
      result += formatPoemSegment(match[1]);
      lastIndex = poemRe.lastIndex;
    }
    result += formatProseSegment(withNotes.slice(lastIndex));
    return result;
  }

  return formatProseSegment(withNotes);
}

// Обычная прозаическая разметка — то, что formatChapterText делала раньше
// целиком: красная строка на каждый абзац, схлопывание пустых строк.
function formatProseSegment(text) {
  if (!text) return '';
  return text
    .replace(/\n{2,}/g, '\n') // схлопываем пустые строки между абзацами — иначе получался лишний пробел
    .replace(/\n/g, '<br><span style="margin-left: 16px;"></span>')
    // Отступ красной строки — только если сегмент реально начинается с текста,
    // а не с уже готового HTML-тега (например, вставленного [title]...[/title]
    // заголовка стихотворения). Иначе регулярка врезалась бы прямо в середину
    // атрибутов тега (там тоже есть пробелы) и ломала разметку.
    .replace(/^(?!<)(\S+)/, '<span style="margin-left: 16px;"></span>$1')
    .replace(/\*\*\*/g, '<div style="text-align: center;">***</div>'); // Центрирование символов ***
}

// Стихотворная разметка. Пагинация (см. processWords ниже) режет текст на
// "слова" по /\s+/, что без защиты уничтожило бы все переносы строк и
// авторские отступы внутри стихотворения.
// Стихотворение упаковывается ПОСТРОЧНО, а не целиком одним куском.
// Причина: если весь стих упаковать в один неразделимый токен, длинное
// стихотворение, не помещающееся на одну страницу разворота, будет
// обрезано — механизм пагинации не сможет перенести остаток на следующую
// страницу (было замечено на реальном тексте длиннее одной страницы).
// Каждая строка кодируется в свой атомный токен §PLINE§...§ (пагинация не
// может разбить пробелы ВНУТРИ токена — только между соседними токенами),
// поэтому перенос между страницами теперь возможен, но только по границе
// целой строки — никогда посередине строки, что для стихов и правильно.
// Пустая строка (стык строф) кодируется в такой же токен и превращается
// при распаковке в короткую пустую строку — так сохраняется межстрофный
// промежуток, как в исходном тексте.
function formatPoemSegment(text) {
  return text
    .trim() // убирает пустые строки сразу после [poem] и перед [/poem] —
            // они обычны при вводе, но не должны становиться лишним промежутком
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      // Если внутри [poem]...[/poem] стоит [img:...] (иллюстрация к стиху),
      // к этому моменту она уже превращена в готовый атомный токен §IMG§...§
      // (это происходит раньше, в самом начале formatChapterText — до того,
      // как текст вообще разбирается на прозу/стихи). На десктопе такая
      // картинка показывается ТАК ЖЕ, как обычная иллюстрация в прозе —
      // обтекание текстом сбоку (в отличие от мобильной версии, где по
      // требованию картинка идёт отдельным блоком над текстом стиха —
      // см. book_mob.html, там своя, отдельная логика). Поэтому здесь просто
      // оставляем строку как есть — она уже сама по себе атомна и безопасна,
      // и её найдёт и развернёт обычная распаковка §IMG§ в addTextToSide.
      // ВАЖНО: нельзя заново заворачивать в §PLINE§ — получится "упаковка
      // внутри упаковки", и распаковка картинок не найдёт токен.
      if (/^§IMG§.*§$/.test(trimmed)) return trimmed;
      if (/^§IMGSMALL§.*§$/.test(trimmed)) return trimmed;
      if (/^§AUDIO§.*§$/.test(trimmed)) return trimmed;
      if (/^§PNOTE§.*§$/.test(trimmed)) return trimmed;
      return `§PLINE§${encodeURIComponent(line)}§`;
    })
    .join(' ');
}

// Достаёт пути всех картинок-маркеров [img:путь] из сырого текста главы —
// нужно, чтобы предзагрузить их ДО разбивки на страницы (см. preloadImages).
function extractImageSrcs(rawText) {
  return [...rawText.matchAll(/\[img:(.+?)\]/g)].map(m => m[1].trim());
}

// Предзагружает картинки — критично сделать ДО buildPages(): пока картинка не
// загружена, браузер не знает её реальную высоту, и измерение "влезает ли
// текст на страницу" даст неверный (заниженный) результат, который разойдётся
// с тем, что получится чуть позже, когда картинка всё-таки загрузится.
function preloadImages(srcList) {
  return Promise.all(srcList.map(src => new Promise(resolve => {
    const img = new Image();
    img.onload = resolve;
    img.onerror = resolve; // не блокируем разбивку, если картинка не нашлась
    img.src = src;
  })));
}

// ──────────────────────────────────────────────────────────────────
// Кастомная кнопка play/pause для аудио внутри текста главы (см. §AUDIO§
// в addTextToSide/buildPages ниже). Обычная HTML-кнопка вместо нативных
// controls — у неё нет бага с потерянными кликами внутри 3D-перспективы
// разворота книги (см. подробный комментарий в css/fish_no_sound.css).
// ──────────────────────────────────────────────────────────────────
function formatAudioTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

document.addEventListener('click', (e) => {
  // Ловим клик по ВСЕЙ капсуле плеера (.chapter-audio-inline), а не только
  // по маленькой кнопке ▶ внутри неё — так остаётся запас на случай, если
  // 3D-контекст страницы всё же немного сдвигает координаты клика.
  const wrapper = e.target.closest('.chapter-audio-inline');
  if (!wrapper) return;
  const btn = wrapper.querySelector('.audio-toggle-btn');
  if (!btn) return;
  e.stopPropagation(); // не даём клику дойти до .page и перевернуть страницу
  const audio = document.getElementById(btn.dataset.audioTarget);
  if (!audio) return;
  if (audio.paused) {
    // Останавливаем другие играющие плееры на странице — чтобы одновременно
    // не звучало сразу несколько озвучек.
    document.querySelectorAll('audio').forEach(a => { if (a !== audio) a.pause(); });
    audio.play();
  } else {
    audio.pause();
  }
});

// 'play'/'pause'/'timeupdate'/'loadedmetadata' у <audio> НЕ всплывают
// (не bubbling) — единственный способ поймать их делегированно на document
// это подписка на фазе capture (третий аргумент true).
['play', 'pause'].forEach(evt => {
  document.addEventListener(evt, (e) => {
    if (!e.target.matches || !e.target.matches('audio')) return;
    const btn = document.querySelector(`.audio-toggle-btn[data-audio-target="${e.target.id}"]`);
    if (btn) btn.textContent = evt === 'play' ? '⏸' : '▶';
  }, true);
});

document.addEventListener('timeupdate', (e) => {
  if (!e.target.matches || !e.target.matches('audio')) return;
  const timeEl = document.querySelector(`[data-audio-time="${e.target.id}"]`);
  if (timeEl) timeEl.textContent = `${formatAudioTime(e.target.currentTime)} / ${formatAudioTime(e.target.duration)}`;
}, true);

document.addEventListener('loadedmetadata', (e) => {
  if (!e.target.matches || !e.target.matches('audio')) return;
  const timeEl = document.querySelector(`[data-audio-time="${e.target.id}"]`);
  if (timeEl) timeEl.textContent = `0:00 / ${formatAudioTime(e.target.duration)}`;
}, true);

// ──────────────────────────────────────────────────────────────────
// Полная загрузка и отрисовка текущей главы (с учётом сквозной нумерации страниц)
// ──────────────────────────────────────────────────────────────────
async function loadAndRenderChapter() {
  // КРИТИЧНО: ждём полной загрузки шрифта Gabriela перед любыми измерениями текста.
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  // Прячем книгу на время расчётов — без этого было бы видно мерцание от временного
  // построения предыдущих глав, которые нужны только для подсчёта числа страниц.
  OUTPUTCONTEINER.style.visibility = 'hidden';
  OUTPUTCONTEINER.querySelectorAll('.page').forEach(p => p.remove());

  let noFormattedText;
  let pageOffsetSides = 0;
  let currentChapterEdit = 0;
  let viewportBucketForCache = '';

  if (currentSlug && currentChapterNum) {
    try {
      noFormattedText = await fetchChapterContent(currentSlug, currentChapterNum);
    } catch (err) {
      if (err && err.requiresAuth) {
        OUTPUTCONTEINER.style.visibility = '';
        if (typeof window.showChapterRegisterWall === 'function') {
          window.showChapterRegisterWall(currentChapterNum, err.freeChaptersLimit);
        } else {
          alert('Эта глава доступна только зарегистрированным читателям.');
        }
        return;
      }
      throw err;
    }
    if (noFormattedText === null) {
      alert('Глава не найдена на сервере.');
      OUTPUTCONTEINER.style.visibility = '';
      return;
    }

    // Считаем сквозную нумерацию: сколько "сторон" заняли все ПРЕДЫДУЩИЕ главы этой книги.
    // ВАЖНО: считаем прямо в РЕАЛЬНОМ контейнере #outputContainer (а не в отдельном
    // скрытом клоне) — это гарантирует абсолютно одинаковые условия измерения текста.
    // Результат кэшируется в sessionStorage — при повторных переходах не нужно заново
    // скачивать и пересчитывать все главы.
    try {
      const book = await fetchBookInfo(currentSlug);
      if (book) {
        const chapters = (book.chapters || []).slice().sort((a, b) => a.chapter_number - b.chapter_number);
        const currentNum = parseInt(currentChapterNum, 10);
        const previousChapters = chapters.filter(c => c.chapter_number < currentNum);

        const viewportBucket = `${Math.round(window.innerWidth / 50)}x${Math.round(window.innerHeight / 50)}`;
        viewportBucketForCache = viewportBucket;
        const currentChapterInfo = chapters.find(c => c.chapter_number === currentNum);
        currentChapterEdit = currentChapterInfo?.published_at ? new Date(currentChapterInfo.published_at).getTime() : 0;
        const latestEdit = previousChapters.reduce((max, c) => {
          const t = c.published_at ? new Date(c.published_at).getTime() : 0;
          return t > max ? t : max;
        }, 0);
        const cacheKey = `pageOffset:v3:${currentSlug}:${currentNum}:${viewportBucket}:${latestEdit}`;

        const cached = sessionStorage.getItem(cacheKey);
        if (cached !== null) {
          pageOffsetSides = parseInt(cached, 10);
        } else {
          // Для каждой предыдущей главы — сначала смотрим, не посчитано ли её
          // количество страниц УЖЕ РАНЬШЕ (при переходе на другую главу). Если да —
          // берём готовое число без пересчёта. Если нет — считаем и сразу кэшируем
          // именно для ЭТОЙ главы, чтобы при следующих переходах (на любую другую
          // главу позже неё) это значение уже не нужно было пересчитывать.
          const contents = await Promise.all(
            previousChapters.map(ch => fetchChapterContent(currentSlug, ch.chapter_number).catch(() => null))
          );

          for (let i = 0; i < previousChapters.length; i++) {
            const ch = previousChapters[i];
            const content = contents[i];
            if (!content) continue;

            const chEdit = ch.published_at ? new Date(ch.published_at).getTime() : 0;
            const sidesKey = `chapterSides:v1:${currentSlug}:${ch.chapter_number}:${viewportBucket}:${chEdit}`;
            const cachedSides = sessionStorage.getItem(sidesKey);

            let sides;
            if (cachedSides !== null) {
              sides = parseInt(cachedSides, 10);
            } else {
              await preloadImages(extractImageSrcs(content));
              const formatted = formatChapterText(content);
              // Строим временно прямо в реальном контейнере, считаем стороны, сразу убираем —
              // те же самые DOM-условия, что и при настоящем показе главы.
              sides = buildPages(OUTPUTCONTEINER, formatted, 0);
              OUTPUTCONTEINER.querySelectorAll('.page').forEach(p => p.remove());
              sessionStorage.setItem(sidesKey, String(sides));
            }
            pageOffsetSides += sides;
          }
          sessionStorage.setItem(cacheKey, String(pageOffsetSides));
        }
      }
    } catch (err) {
      console.error('Не удалось посчитать сквозную нумерацию страниц (нумерация начнётся с 1):', err);
      pageOffsetSides = 0;
    }
  } else {
    // Старый режим: текст из send_text.html через localStorage
    noFormattedText = localStorage.getItem('textInput');
  }

  if (!noFormattedText) {
    alert('Текст не найден. Пожалуйста, вернитесь на предыдущую страницу и введите текст.');
    OUTPUTCONTEINER.style.visibility = '';
    return;
  }

  await preloadImages(extractImageSrcs(noFormattedText));
  const inputText = formatChapterText(noFormattedText);
  currentInputText = inputText; // сохраняем для пересчёта при resize

  const currentChapterSides = buildPages(OUTPUTCONTEINER, inputText, pageOffsetSides);

  // Кэшируем количество страниц ТЕКУЩЕЙ главы — пригодится при переходе на
  // следующие главы (не нужно будет пересчитывать её снова)
  if (currentSlug && currentChapterNum && viewportBucketForCache) {
    const ownSidesKey = `chapterSides:v1:${currentSlug}:${currentChapterNum}:${viewportBucketForCache}:${currentChapterEdit}`;
    sessionStorage.setItem(ownSidesKey, String(currentChapterSides));
  }

  // Если подключён img_insert1.js с трекингом вставленных картинок — восстанавливаем их
  if (typeof restoreInsertedImages === 'function') {
    restoreInsertedImages();
  }

  OUTPUTCONTEINER.style.visibility = ''; // показываем готовый результат

  document.dispatchEvent(new Event('pagesRendered')); // сообщаем fish_no_sound_script.js, что страницы готовы

  // Восстановление закладки: если в адресе есть ?word=N — переходим на страницу,
  // где находится эта позиция (без анимации, мгновенно)
  const wordParam = new URLSearchParams(window.location.search).get('word');
  if (wordParam && typeof window.jumpToPageIndex === 'function') {
    const targetWordOffset = parseInt(wordParam, 10);
    const pageIdx = findPageIndexForWordOffset(targetWordOffset);
    window.jumpToPageIndex(pageIdx);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  currentSlug = params.get('book');
  currentChapterNum = params.get('chapter');
  loadAndRenderChapter();
});

// ---- АВТОМАТИЧЕСКИЙ ПЕРЕСЧЁТ СТРАНИЦ ПРИ ИЗМЕНЕНИИ РАЗМЕРА ОКНА ----
// Пересчитываем полностью (включая сквозную нумерацию) — она тоже зависит от размера окна,
// так как от него зависит, сколько страниц заняла каждая глава.

function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

const handleResize = debounce(() => {
  const newHeight = window.innerHeight;
  const newWidth = window.innerWidth;

  if (newHeight !== lastWindowHeight || newWidth !== lastWindowWidth) {
    lastWindowHeight = newHeight;
    lastWindowWidth = newWidth;

    // Запоминаем, на каком слове (не просто номере страницы — при пересчёте
    // разбивка на страницы меняется, номера "плывут") читатель находился ДО
    // пересчёта, чтобы вернуться туда же после. window.getCurrentSpreadInfo
    // уже существует и используется для этого при переходе по ссылке-закладке
    // (?word=...) — здесь используем ту же логику для resize.
    const wordBeforeResize = typeof window.getCurrentSpreadInfo === 'function'
      ? window.getCurrentSpreadInfo().startWord
      : 0;

    loadAndRenderChapter().then(() => { // содержимое глав уже в кэше — переотправки на сервер не будет
      if (wordBeforeResize && typeof window.jumpToPageIndex === 'function') {
        const pageIdx = findPageIndexForWordOffset(wordBeforeResize);
        window.jumpToPageIndex(pageIdx);
      }
    });
  }
}, 250);

window.addEventListener('resize', handleResize);

// ---- остальной код ----

function createSideDiv(index, text) {
  const sideDiv = document.createElement('div');
  sideDiv.className = `side-${index % 2 === 0 ? 2 : 1}`;  // Для чётных создаём `side-2`, для нечётных `side-1`
  sideDiv.id = `p${index}`;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'content';

  const p = document.createElement('p');
  p.innerHTML = text.replace(/\n/g, '<br>') + '<br>';
  contentDiv.appendChild(p);
  sideDiv.appendChild(contentDiv);

  return sideDiv;
}

// Строит страницы в указанном контейнере (container), нумеруя стороны начиная с
// pageOffsetSides+1 (для сквозной нумерации между главами). Возвращает итоговое
// количество "сторон", занятых этим текстом — используется для расчёта смещения
// следующей главы.
function buildPages(container, inputText, pageOffsetSides) {
    let pageIndex = 0;
    let remainingText = inputText;
    let lastPageDiv = null;
    let globalWordOffset = 0; // сквозная позиция по словам от начала главы — для закладок

    function createPage() {
        pageIndex++;
        const pageDiv = document.createElement('div');
        pageDiv.id = `page-${pageOffsetSides}-${pageIndex}`;
        pageDiv.className = 'page no-anim';
        pageDiv.dataset.page = pageIndex;
        pageDiv.dataset.pageFlipped = pageIndex > 1 ? pageIndex - 1 : 1;
        pageDiv.dataset.startWord = globalWordOffset; // с какого слова начинается эта страница — для закладок
        pageDiv.style.textAlign = 'justify';
        lastPageDiv = pageDiv;

        // Создаем две стороны страницы
        const side1Div = createSideDiv(pageIndex * 2 - 1, '');
        const side2Div = createSideDiv(pageIndex * 2, '');

        // Номер страницы на side-1 — с учётом сквозного смещения
        const numDiv1 = document.createElement('div');
        numDiv1.className = 'number';
        numDiv1.textContent = pageOffsetSides + (pageIndex * 2 - 1);
        numDiv1.style.right = '10px';
        side1Div.appendChild(numDiv1);
        pageDiv.appendChild(side1Div);

        // Номер страницы на side-2 — с учётом сквозного смещения
        const numDiv2 = document.createElement('div');
        numDiv2.className = 'number';
        numDiv2.textContent = pageOffsetSides + (pageIndex * 2);
        numDiv2.style.left = '-10px';
        side2Div.appendChild(numDiv2);
        pageDiv.appendChild(side2Div);

        container.appendChild(pageDiv);

        // Раньше здесь было "offsetHeight - 120" — фиксированный отступ, рассчитанный
        // на высокую десктопную колонку (где 120px — это мелочь, ~15% высоты).
        // На мобильном страница вдвое короче (side занимает 50% высоты .page),
        // и те же фиксированные 120px съедали уже почти половину доступного места —
        // отсюда огромные пустые пробелы и мало текста на странице. Делаем отступ
        // пропорциональным (10% высоты) — одинаково разумно смотрится и на десктопе,
        // и на мобильном, какой бы ни была реальная высота контейнера.
        const sideDivHeight1 = side1Div.offsetHeight * 0.9;
        const sideDivHeight2 = side2Div.offsetHeight * 0.9;

        function addTextToSide(sideDiv, sideText, maxHeight) {
            const p = sideDiv.querySelector('.content p');
            // Иллюстрация внутри стихотворения ([img:...] внутри [poem]...[/poem])
            // на десктопе рендерится ТЕМ ЖЕ классом .chapter-illustration, что и
            // обычная картинка в прозе — с обтеканием текстом сбоку. (На
            // мобильной версии — другое поведение: там картинка отдельным
            // блоком над текстом стиха, см. book_mob.html, там своя логика.)
            const withImgTags = sideText.replace(/§IMG§(.+?)§/g, (_, encoded) =>
                `<img class="chapter-illustration" src="${decodeURIComponent(encoded)}" alt="">`
            );
            // §IMGSMALL§ — уменьшенная версия картинки, та же логика
            // распаковки, что и у §IMG§ выше.
            const withImgSmallTags = withImgTags.replace(/§IMGSMALL§(.+?)§/g, (_, encoded) =>
                `<img class="chapter-illustration-small" src="${decodeURIComponent(encoded)}" alt="">`
            );
            // §AUDIO§ — аудиоплеер, обтекание текстом как у картинки, но со
            // своей кнопкой play/pause (см. подробный комментарий про 3D-баг
            // нативных controls в css/fish_no_sound.css). Каждому плееру —
            // свой уникальный id, чтобы обработчик клика (см. ниже, глобальный
            // делегированный слушатель) точно знал, каким <audio> управлять.
            const withAudioTags = withImgSmallTags.replace(/§AUDIO§(.+?)§/g, (_, encoded) => {
                const audioId = 'audio-' + Math.random().toString(36).slice(2, 10);
                const src = decodeURIComponent(encoded);
                return `<span class="chapter-audio-inline">` +
                    `<button type="button" class="audio-toggle-btn" data-audio-target="${audioId}">▶</button>` +
                    `<span class="audio-time" data-audio-time="${audioId}">0:00 / 0:00</span>` +
                    `<audio id="${audioId}" preload="metadata" src="${src}"></audio>` +
                    `</span>`;
            });
            // §PLINE§ — одна строка стихотворения, упакованная в formatPoemSegment().
            // Каждая строка декодируется независимо и оборачивается в блочный
            // span (.poem-line) — он сам переносится на новую строку, поэтому
            // отдельный <br> не нужен. Ведущие пробелы (авторская "лесенка")
            // превращаем в &nbsp; явно: родительский .content использует
            // white-space:pre-line, который иначе схлопнул бы повторные пробелы.
            const withPoemLines = withAudioTags.replace(/§PLINE§(.*?)§/g, (_, encoded) => {
                const raw = decodeURIComponent(encoded);
                const leadSpaces = raw.match(/^ */)[0].length;
                const rest = raw
                    .slice(leadSpaces)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                const indent = '&nbsp;'.repeat(leadSpaces);
                // Полностью пустая строка (промежуток между строфами) — нужен
                // хотя бы один &nbsp;, иначе пустой блочный элемент схлопнется
                // до нулевой высоты и промежуток визуально исчезнет.
                const content = (indent + rest) || '&nbsp;';
                return `<span class="poem-line">${content}</span>`;
            });
            // §PTITLE§ — заголовок стихотворения, упакованный при формировании
            // текста (formatChapterText). Распаковываем в реальный HTML-тег
            // ЗДЕСЬ, уже после того как пагинация закончила резать текст по
            // страницам — так тег никогда не окажется разорван пополам между
            // соседними страницами (см. подробный комментарий в formatChapterText).
            const withPoemTitles = withPoemLines.replace(/§PTITLE§(.*?)§/g, (_, encoded) => {
                const escaped = decodeURIComponent(encoded)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                return `<div class="poem-title">${escaped}</div>`;
            });
            // §PNOTE§ — мелкая курсивная пометка автора, та же логика
            // распаковки, что и у §PTITLE§ выше.
            const withPoemNotes = withPoemTitles.replace(/§PNOTE§(.*?)§/g, (_, encoded) => {
                const escaped = decodeURIComponent(encoded)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                return `<div class="poem-note">${escaped}</div>`;
            });
            p.innerHTML = withPoemNotes.replace(/\n/g, '<br>');
            return p.clientHeight <= maxHeight;
        }

        function formatText(text) {
            return text.replace(/^16px;\">/, '<span style="margin-left: 16px;"></span>').replace(/^center;\">/, '<div style="text-align: center;">');
        }

        // Находит МАКСИМАЛЬНОЕ количество слов (начиная с startIdx), которое помещается
        // в sideDiv — через БИНАРНЫЙ ПОИСК, а не перебор по одному слову.
        // Слова монотонны по высоте (чем больше слов — тем больше высота), поэтому
        // бинарный поиск даёт тот же результат, что и линейный перебор, но за ~log(n)
        // проверок вместо n — то есть ~7 проверок на ~150 слов вместо 150 проверок.
        // Каждая проверка вызывает реальный reflow браузера (clientHeight), так что
        // это самое весомое ускорение самого процесса разбивки на страницы.
        function fitMaxWords(sideDiv, words, maxHeight) {
            let lo = 0, hi = words.length;
            let bestFit = 0;
            let bestText = '';

            while (lo <= hi) {
                const mid = Math.floor((lo + hi) / 2);
                const text = formatText(words.slice(0, mid).join(' '));
                if (addTextToSide(sideDiv, text, maxHeight)) {
                    bestFit = mid;
                    bestText = text;
                    lo = mid + 1;
                } else {
                    hi = mid - 1;
                }
            }

            // На всякий случай гарантируем прогресс — если совсем ничего не влезает
            // (крайне маленький контейнер), берём хотя бы одно слово, чтобы не зависнуть.
            if (bestFit === 0 && words.length > 0) {
                bestFit = 1;
                bestText = formatText(words[0]);
            }

            addTextToSide(sideDiv, bestText, maxHeight); // фиксируем итоговое состояние
            return bestFit;
        }

        function processWords() {
            const words = remainingText.split(/\s+/).filter(word => word.length > 0);

            const count1 = fitMaxWords(side1Div, words, sideDivHeight1);

            if (count1 >= words.length) {
                // Всё помещается на side-1 целиком — глава закончена на этой странице
                remainingText = '';
                globalWordOffset += words.length;
                return;
            }

            const remainingAfterSide1 = words.slice(count1);
            const count2 = fitMaxWords(side2Div, remainingAfterSide1, sideDivHeight2);

            if (count1 + count2 >= words.length) {
                remainingText = ''; // всё уместилось, глава закончена
                globalWordOffset += words.length;
            } else {
                remainingText = remainingAfterSide1.slice(count2).join(' ');
                globalWordOffset += count1 + count2;
                createPage();
            }
        }

        processWords();
    }

    while (remainingText.length > 0) {
      createPage();
    }

    // Считаем, сколько "сторон" заняла глава целиком — нужно для нумерации следующей главы
    let totalSides = pageIndex * 2;
    if (lastPageDiv) {
      const side2P = lastPageDiv.querySelector('.side-2 .content p');
      const side2Text = side2P ? side2P.textContent.trim() : '';
      if (!side2Text) {
        totalSides = pageIndex * 2 - 1; // последняя сторона не использовалась
      }
    }

    return totalSides;
}

// Находит индекс страницы (1-based), которая содержит данную позицию по словам —
// используется при восстановлении закладки. Возвращает 1, если не нашли (начало главы).
function findPageIndexForWordOffset(targetWordOffset) {
  const pages = OUTPUTCONTEINER.querySelectorAll('.page');
  let resultIndex = 1;
  pages.forEach((page, i) => {
    const startWord = parseInt(page.dataset.startWord || '0', 10);
    if (startWord <= targetWordOffset) {
      resultIndex = i + 1; // последняя страница, чей startWord не превышает цель
    }
  });
  return resultIndex;
}
