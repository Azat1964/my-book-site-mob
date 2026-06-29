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

  return withImgTokens
    .replace(/\n{2,}/g, '\n') // схлопываем пустые строки между абзацами — иначе получался лишний пробел
    .replace(/\n/g, '<br><span style="margin-left: 16px;"></span>')
    .replace(/(^\S+)/, '<span style="margin-left: 16px;"></span>$1')
    .replace(/\*\*\*/g, '<div style="text-align: center;">***</div>'); // Центрирование символов ***
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
    loadAndRenderChapter(); // содержимое глав уже в кэше — переотправки на сервер не будет
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
            const withImgTags = sideText.replace(/§IMG§(.+?)§/g, (_, encoded) =>
                `<img class="chapter-illustration" src="${decodeURIComponent(encoded)}" alt="">`
            );
            p.innerHTML = withImgTags.replace(/\n/g, '<br>');
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
