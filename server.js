require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session'); // Импортируем express-session
const pgSession = require('connect-pg-simple')(session); // Если вы хотите хранить сессии в PostgreSQL
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const multer = require('multer');
const mammoth = require('mammoth');
const { splitByAutoHeadings, splitByToc } = require('./lib/chapterSplitter');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Превращает HTML, полученный от mammoth.convertToHtml(), в чистый текст —
// так, чтобы результат совпадал с тем, что видно в самом .docx: каждый
// ручной перенос строки (Shift+Enter → mammoth отдаёт его как <br>) остаётся
// отдельной строкой, а разрыв абзаца (¶) — пустой строкой между ними.
// В отличие от mammoth.extractRawText(), которая ручные переносы просто
// выбрасывает (без даже пробела на их месте), здесь ничего не теряется.
function docxHtmlToPlainText(html) {
  return html
    // Подчёркнутый текст (<u>) — по договорённости это название стихотворения
    // в исходном .docx. Превращаем в маркер [title]...[/title] СРАЗУ, до того
    // как остальные теги будут стёрты (иначе сигнал "это заголовок" потеряется
    // безвозвратно). Если внутри подчёркивания есть ещё теги (например, само
    // название дополнительно жирное) — они переживут этот шаг и будут убраны
    // позже обычной чисткой тегов, а сам текст останется между [title]/[/title].
    .replace(/<u>([\s\S]*?)<\/u>/gi, (_, inner) => `[title]${inner.trim()}[/title]`)
    .replace(/<br\s*\/?>/gi, '\n')                    // ручной перенос строки → \n
    .replace(/<\/(p|h[1-6]|li)>\s*<(p|h[1-6]|li)[^>]*>/gi, '\n\n') // граница между абзацами → пустая строка
    .replace(/<\/?(p|h[1-6]|li|ul|ol)[^>]*>/gi, '')    // остатки тегов абзацев/списков — убираем
    .replace(/<[^>]+>/g, '')                           // любые прочие теги (strong, em и т.п.) — убираем, текст внутри остаётся
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')                        // пробелы перед переносом — убираем как мусор
    .replace(/\n{3,}/g, '\n\n')                        // три и более пустых строки подряд (пустые ¶ в Word) → одна пустая строка
    .trim();
}

// Подключение к базе данных PostgreSQL
// Значения берутся из .env — см. .env.example
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'your_db_name',
  password: process.env.DB_PASSWORD || 'your_db_password',
  port: process.env.DB_PORT || 5432,
});

const app = express();
app.use(express.json()); // Обработчик JSON-запросов
app.use(express.urlencoded({ extended: true })); // Обработчик URL-encoded запросов
// ---------------------------------------------------------------------------
// SEO: серверная подстановка метатегов для страниц чтения и оглавления.
// Ставится ДО express.static, иначе статика отдаст файл раньше.
// Если книга/глава не найдены или БД недоступна — молча отдаём файл как есть.
// ---------------------------------------------------------------------------
const SITE_URL = 'https://booklo.ru';
const OG_IMAGE = SITE_URL + '/img/og-cover.jpg';

// Экранирование для подстановки внутрь HTML-атрибута
function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Обрезка описания до разумной длины по границе слова
function clampDesc(s, max = 160) {
  const t = String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > 60 ? cut.slice(0, sp) : cut) + '…';
}

// Экранирование для подстановки простого текста (не HTML-разметки) внутрь
// HTML — используется для заголовка поста в шаблоне blog-post.html, где
// заголовок должен остаться именно текстом, а не интерпретироваться как теги
function escapeHtmlBasic(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Экранирование для XML (RSS-лента) — свои правила, шире чем HTML:
// XML требует экранировать ещё и кавычки внутри атрибутов
function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Заменяет title и указанные meta в готовом HTML
function injectMeta(html, meta) {
  html = html.replace(/<title>[\s\S]*?<\/title>/i, '<title>' + escAttr(meta.title) + '</title>');

  const set = (attr, key, value) => {
    const re = new RegExp('(<meta\\s+' + attr + '="' + key + '"\\s+content=")[^"]*(")', 'i');
    if (re.test(html)) {
      html = html.replace(re, '$1' + escAttr(value) + '$2');
    } else {
      html = html.replace(/(<meta charset="UTF-8">)/i,
        '$1\n    <meta ' + attr + '="' + key + '" content="' + escAttr(value) + '">');
    }
  };

  set('name', 'description', meta.description);
  set('property', 'og:title', meta.title);
  set('property', 'og:description', meta.description);
  set('property', 'og:url', meta.url);
  set('property', 'og:image', OG_IMAGE);
  set('property', 'og:type', 'book');

  // Канонический адрес — чтобы варианты с разными параметрами не плодили дубли
  if (/<link\s+rel="canonical"/i.test(html)) {
    html = html.replace(/(<link\s+rel="canonical"\s+href=")[^"]*(")/i, '$1' + escAttr(meta.url) + '$2');
  } else {
    html = html.replace(/(<meta charset="UTF-8">)/i,
      '$1\n    <link rel="canonical" href="' + escAttr(meta.url) + '">');
  }

  // book.html/book_mob.html по умолчанию помечены noindex (это просто файл-
  // шаблон, без ?book=&chapter= в нём нет содержимого — Google иначе находит
  // пустой дубль без подсказки, какой вариант канонический). При валидных
  // параметрах сюда доходит реальный контент — снимаем пометку.
  html = html.replace(/\s*<meta name="robots" content="noindex">\n?/i, '\n');

  return html;
}

app.get(['/book.html', '/book_mob.html', '/contents.html'], async (req, res, next) => {
  const file = path.join(__dirname, 'public', path.basename(req.path));
  const slug = req.query.book;
  const isContents = req.path === '/contents.html';

  // Без ?book= подставлять нечего — пусть отдаёт статика
  if (!slug) return next();

  try {
    let html = fs.readFileSync(file, 'utf8');

    if (isContents) {
      const r = await pool.query(
        'SELECT title, description, author, genre, status, cover_image FROM books WHERE slug = $1',
        [slug]
      );
      if (r.rows.length === 0) return next();
      const b = r.rows[0];
      html = injectMeta(html, {
        title: `${b.title} — оглавление | Азат Туктаров`,
        description: clampDesc(b.description) ||
          `Оглавление романа «${b.title}» Азата Туктарова. Читать онлайн бесплатно.`,
        url: `${SITE_URL}/contents.html?book=${encodeURIComponent(slug)}`
      });

      // Structured data (Schema.org Book) — помогает поиску показать книгу
      // с автором и жанром прямо в сниппете, а не просто ссылкой на страницу.
      const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Book',
        name: b.title,
        author: { '@type': 'Person', name: b.author },
        description: clampDesc(b.description) || undefined,
        genre: b.genre || undefined,
        bookFormat: 'https://schema.org/EBook',
        url: `${SITE_URL}/contents.html?book=${encodeURIComponent(slug)}`,
        image: b.cover_image ? `${SITE_URL}${b.cover_image}` : OG_IMAGE,
        isAccessibleForFree: b.status === 'finished' ? undefined : true,
      };
      html = html.replace('<!--__JSONLD__-->',
        `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`);

      return res.type('html').send(html);
    }

    // Страница чтения: нужен номер главы
    const num = parseInt(req.query.chapter, 10);
    if (!Number.isInteger(num) || num < 1) return next();

    const r = await pool.query(
      `SELECT c.chapter_number, c.title, c.epigraph, b.title AS book_title
         FROM chapters c JOIN books b ON b.id = c.book_id
        WHERE b.slug = $1 AND c.chapter_number = $2`,
      [slug, num]
    );
    if (r.rows.length === 0) return next();
    const c = r.rows[0];

    const chapterTitle = c.title ? `${c.title}` : `Глава ${c.chapter_number}`;
    const cleanTitle = chapterTitle.replace(/[.,;:\s]+$/, ''); // убираем хвостовую пунктуацию
    html = injectMeta(html, {
      title: `${cleanTitle} — ${c.book_title} | Азат Туктаров`,
      description: clampDesc(c.epigraph) ||
        `«${c.book_title}» Азата Туктарова, глава ${c.chapter_number}: ${cleanTitle}. Читать онлайн бесплатно.`,
      url: `${SITE_URL}${req.path}?book=${encodeURIComponent(slug)}&chapter=${c.chapter_number}`
    });
    return res.type('html').send(html);
  } catch (err) {
    // Любая ошибка — не ломаем страницу, отдаём статику
    return next();
  }
});

// ---------------------------------------------------------------------------
// Блог: список постов (публичный, для blog.html), чистая ссылка на отдельный
// пост (/blog/slug — без параметров, так требует Яндекс.Дзен для RSS) и сама
// RSS-лента. Админские операции (создание/удаление постов) — ниже, в общем
// разделе admin API.
// ---------------------------------------------------------------------------

// Список опубликованных постов — используется публичной страницей blog.html
app.get('/api/posts', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT slug, title, excerpt, cover_image, published_at
         FROM posts ORDER BY published_at DESC`
    );
    res.json(r.rows);
  } catch (err) {
    console.error('Ошибка получения списка постов:', err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// ---------------------------------------------------------------------------
// Комментарии к постам блога. Оставлять может только зарегистрированный
// читатель (та же система входа, что и для книг — /api/register, /api/login).
// ---------------------------------------------------------------------------

// Список комментариев к посту — публичный, без авторизации
app.get('/api/posts/:slug/comments', async (req, res) => {
  const slug = (req.params.slug || '').trim().toLowerCase();
  try {
    const r = await pool.query(
      `SELECT pc.id, pc.content, pc.created_at, u.nickname
         FROM post_comments pc
         JOIN posts p ON p.id = pc.post_id
         JOIN users u ON u.id = pc.user_id
        WHERE p.slug = $1
        ORDER BY pc.created_at ASC`,
      [slug]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('Ошибка получения комментариев:', err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Добавление комментария — только для вошедших пользователей
app.post('/api/posts/:slug/comments', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ message: 'Чтобы оставить комментарий, войдите или зарегистрируйтесь' });
  }
  const slug = (req.params.slug || '').trim().toLowerCase();
  const content = (req.body.content || '').trim();

  if (!content) {
    return res.status(400).json({ message: 'Комментарий не может быть пустым' });
  }
  if (content.length > 2000) {
    return res.status(400).json({ message: 'Слишком длинный комментарий (максимум 2000 символов)' });
  }

  try {
    const postResult = await pool.query('SELECT id FROM posts WHERE slug = $1', [slug]);
    if (postResult.rows.length === 0) {
      return res.status(404).json({ message: 'Пост не найден' });
    }
    const postId = postResult.rows[0].id;

    const result = await pool.query(
      `INSERT INTO post_comments (post_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, content, created_at`,
      [postId, req.session.userId, content]
    );

    res.status(201).json({ ...result.rows[0], nickname: req.session.username });
  } catch (err) {
    console.error('Ошибка добавления комментария:', err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Чистая ссылка на отдельный пост: /blog/moy-post — без параметров в URL,
// это отдельное требование Дзена к формату ссылок в RSS-ленте. Отдаём
// готовую HTML-страницу с текстом поста, подставленным на сервере (SSR) —
// так и краулер Дзена, и поисковики видят полный текст сразу, без JS.
app.get('/blog/:slug', async (req, res) => {
  const slug = (req.params.slug || '').trim().toLowerCase();
  try {
    const r = await pool.query('SELECT * FROM posts WHERE slug = $1', [slug]);
    if (r.rows.length === 0) {
      return res.status(404).send('Пост не найден');
    }
    const post = r.rows[0];
    const template = fs.readFileSync(path.join(__dirname, 'public', 'blog-post.html'), 'utf8');

    const dateStr = new Date(post.published_at).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric',
    });

    let html = template
      .replace(/__POST_TITLE__/g, escapeHtmlBasic(post.title))
      .replace(/__POST_DATE__/g, dateStr)
      .replace(/__POST_SLUG__/g, escapeHtmlBasic(slug))
      .replace('__POST_BODY__', post.content); // content — доверенный HTML, вводит только администратор через admin.html

    html = injectMeta(html, {
      title: `${post.title} — Блог | Азат Туктаров`,
      description: clampDesc(post.excerpt) || clampDesc(post.content.replace(/<[^>]+>/g, ' ')),
      url: `${SITE_URL}/blog/${slug}`,
    });

    // Structured data (Schema.org BlogPosting) — даёт поиску автора и дату
    // публикации прямо в сниппете.
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      datePublished: new Date(post.published_at).toISOString(),
      author: { '@type': 'Person', name: 'Азат Туктаров' },
      image: post.cover_image ? `${SITE_URL}${post.cover_image}` : OG_IMAGE,
      url: `${SITE_URL}/blog/${slug}`,
      mainEntityOfPage: `${SITE_URL}/blog/${slug}`,
    };
    html = html.replace('<!--__JSONLD__-->',
      `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`);

    res.type('html').send(html);
  } catch (err) {
    console.error('Ошибка получения поста:', err);
    res.status(500).send('Ошибка сервера');
  }
});

// RSS-лента для Яндекс.Дзен и подобных агрегаторов. Требования Дзена:
// - минимум 10 материалов при первой разметке, минимум 3 новых в месяц дальше
// - разрешённый набор HTML-тегов в контенте (p, img, figure и т.п.)
// - ЧПУ-ссылки без параметров (см. /blog/:slug выше)
// - обложка через <enclosure>
app.get('/rss.xml', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT slug, title, excerpt, content, cover_image, published_at
         FROM posts ORDER BY published_at DESC LIMIT 50`
    );

    const items = r.rows.map(post => {
      const link = `${SITE_URL}/blog/${post.slug}`;
      const pubDate = new Date(post.published_at).toUTCString();
      const description = escapeXml(clampDesc(post.excerpt) || clampDesc(post.content.replace(/<[^>]+>/g, ' ')));
      const enclosure = post.cover_image
        ? `<enclosure url="${escapeXml(SITE_URL + post.cover_image)}" type="image/${post.cover_image.toLowerCase().endsWith('.png') ? 'png' : 'jpeg'}" />`
        : '';
      return `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${description}</description>
      <content:encoded><![CDATA[${post.content}]]></content:encoded>
      ${enclosure}
    </item>`;
    }).join('');

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Отец Тук — блог</title>
    <link>${SITE_URL}/blog.html</link>
    <description>Заметки о работе над книгами, черновики и истории из-за кулис.</description>
    <language>ru</language>${items}
  </channel>
</rss>`;

    res.type('application/rss+xml; charset=utf-8').send(rss);
  } catch (err) {
    console.error('Ошибка формирования RSS:', err);
    res.status(500).send('Ошибка сервера');
  }
});

// ---------------------------------------------------------------------------
// Динамический sitemap.xml — собирается из базы при каждом запросе, поэтому
// новые посты блога и главы книг попадают в него сами, без ручного
// редактирования файла. Статические страницы (главная, об авторе и т.п.)
// перечислены прямо здесь — их список меняется редко.
// Должен стоять ДО express.static, иначе будет отдан старый public/sitemap.xml.
// ---------------------------------------------------------------------------
app.get('/sitemap.xml', async (req, res) => {
  try {
    const urls = [];
    const add = (loc, changefreq, priority, lastmod) => {
      urls.push(`  <url>\n    <loc>${escapeXml(loc)}</loc>\n` +
        (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : '') +
        `    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`);
    };
    const today = new Date().toISOString().slice(0, 10);

    add(`${SITE_URL}/`, 'weekly', '1.0', today);
    add(`${SITE_URL}/about.html`, 'monthly', '0.8', today);
    add(`${SITE_URL}/blog.html`, 'weekly', '0.9', today);
    add(`${SITE_URL}/annotations.html`, 'weekly', '0.8', today);
    add(`${SITE_URL}/privacy.html`, 'yearly', '0.3', today);

    const books = await pool.query('SELECT slug, created_at FROM books ORDER BY id');
    for (const b of books.rows) {
      const bDate = new Date(b.created_at).toISOString().slice(0, 10);
      add(`${SITE_URL}/contents.html?book=${encodeURIComponent(b.slug)}`, 'weekly', '0.9', bDate);

      const chapters = await pool.query(
        'SELECT chapter_number, published_at FROM chapters WHERE book_id = (SELECT id FROM books WHERE slug = $1) ORDER BY chapter_number',
        [b.slug]
      );
      for (const c of chapters.rows) {
        const cDate = new Date(c.published_at).toISOString().slice(0, 10);
        add(`${SITE_URL}/book.html?book=${encodeURIComponent(b.slug)}&chapter=${c.chapter_number}`, 'monthly', '0.7', cDate);
      }
    }

    const posts = await pool.query('SELECT slug, published_at FROM posts ORDER BY published_at DESC');
    for (const p of posts.rows) {
      const pDate = new Date(p.published_at).toISOString().slice(0, 10);
      add(`${SITE_URL}/blog/${p.slug}`, 'monthly', '0.7', pDate);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;
    res.type('application/xml; charset=utf-8').send(xml);
  } catch (err) {
    console.error('Ошибка формирования sitemap:', err);
    res.status(500).send('Ошибка сервера');
  }
});

// ---------------------------------------------------------------------------
// blog.html — список постов подставляется прямо в HTML на сервере (не только
// через JS-fetch на клиенте, как раньше). Без этого краулеры, заставшие
// страницу до того, как отработал JS (или при медленном ответе БД), видели
// пустую заглушку «Загрузка...» — Google Search Console помечал такую
// страницу как soft-404 («ложная ошибка 404»). Клиентский JS в blog.html
// после загрузки всё равно обновляет список сам — это не мешает, а просто
// подстраховывает при добавлении новых постов без перезагрузки.
// ---------------------------------------------------------------------------
app.get('/blog.html', async (req, res, next) => {
  try {
    const file = path.join(__dirname, 'public', 'blog.html');
    let html = fs.readFileSync(file, 'utf8');

    const r = await pool.query(
      `SELECT slug, title, excerpt, published_at FROM posts ORDER BY published_at DESC`
    );

    const listHtml = r.rows.length === 0
      ? '<p class="empty-blog">Постов пока нет — загляните позже.</p>'
      : r.rows.map(p => {
          const dateStr = new Date(p.published_at).toLocaleDateString('ru-RU', {
            day: 'numeric', month: 'long', year: 'numeric',
          });
          return `
            <a class="post-card" href="./blog/${encodeURIComponent(p.slug)}">
              <p class="post-card-date">${dateStr}</p>
              <h2 class="post-card-title">${escAttr(p.title)}</h2>
              ${p.excerpt ? `<p class="post-card-excerpt">${escAttr(p.excerpt)}</p>` : ''}
            </a>
          `;
        }).join('');

    html = html.replace(
      '<div class="post-list" id="postList">\n      <p class="empty-blog">Загрузка...</p>\n    </div>',
      `<div class="post-list" id="postList">${listHtml}</div>`
    );

    res.type('html').send(html);
  } catch (err) {
    console.error('Ошибка серверного рендера blog.html:', err);
    return next(); // при ошибке — отдаём как обычный статический файл
  }
});

app.use(express.static(path.join(__dirname, 'public'))); // Статические файлы

// Явный маршрут для иллюстраций глав — на случай если основной static
// по какой-то причине не подхватывает эту папку
app.use('/img/illustrations', express.static(path.join(__dirname, 'public', 'img', 'illustrations')));
app.use(session({// Конфигурация сессий
  store: new pgSession({ // Используем connect-pg-simple для хранения сессий в PostgreSQL
    pool: pool,            // Ваш пул подключений к PostgreSQL
    tableName: 'session',  // Название таблицы для хранения сессий (по умолчанию 'session')
    createTableIfMissing: true // Если таблицы session нет в БД — создаст её сама при старте сервера
  }),
  secret: process.env.SESSION_SECRET || 'your-secret-key', // **ОЧЕНЬ ВАЖНО:** задайте в .env, не оставляйте дефолтное значение в продакшене!
  resave: false,            // Не сохранять сессию, если она не была изменена
  saveUninitialized: false, // Не сохранять новую сессию, если она не была инициализирована
  cookie: {
    // Без maxAge/expires cookie становится "session cookie" — браузер сам удаляет её
    // при полном закрытии (это и нужно: выход из аккаунта при закрытии браузера).
    httpOnly: true,           // Cookie доступна только на сервере (защита от XSS)
    secure: process.env.NODE_ENV === 'production' // Cookie только для HTTPS в production
    // sameSite: 'strict'     // Рекомендуется для дополнительной защиты от CSRF (опционально)
  }
}));

// Обработка POST-запроса на регистрацию
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;

  console.log('Данные регистрации:', { username, email }); // Логируем без пароля

  // Проверка, что все поля заполнены
  if (!username || !email || !password) {
    return res.status(400).json({ message: 'Все поля обязательны для заполнения' });
  }

  try {
    // Проверка, существует ли пользователь с таким email или username
    const userQuery = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR nickname = $2',
      [email, username]
    );

    if (userQuery.rows.length > 0) {
      return res.status(400).json({ message: 'Пользователь с таким email или именем пользователя уже существует' });
    }

    // Хэширование пароля
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Сохранение пользователя в базу данных
    const result = await pool.query(
      'INSERT INTO users (nickname, email, password) VALUES ($1, $2, $3) RETURNING id, email',
      [username, email, hashedPassword] // Если pageNumber отсутствует, сохраняем null
    );

    // Возврат успешного ответа с id и email
    const { id, email: registeredEmail } = result.rows[0];
    res.status(201).json({ message: 'Пользователь зарегистрирован', userId: result.rows[0].id });
  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ message: 'Внутренняя ошибка сервера' });
  }
});

// Обработка POST-запроса на вход
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  console.log('Данные для входа:', { username }); // Логируем без пароля
  //console.log('Привет:');
  // Проверка, что все поля заполнены
  if (!username || !password) {
    return res.status(400).json({ message: 'Все поля обязательны для заполнения' });
  }

  try {
    // Поиск пользователя в базе данных по имени пользователя
    const userQuery = await pool.query('SELECT * FROM users WHERE nickname = $1', [username]);

    if (userQuery.rows.length === 0) {
      return res.status(401).json({ message: 'Неверное имя пользователя' });
    }

    const user = userQuery.rows[0];

    // Проверка пароля
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Неверный  пароль' });
    }

    // **✅  Сохраняем ID пользователя в сессию после успешного входа:**
    req.session.userId = user.id; // Сохраняем ID пользователя в сессии
    console.log('Сессия пользователя ID:', user.id, 'установлена.'); // Добавьте эту строку
    req.session.username = user.nickname; // Опционально: можно сохранить и имя пользователя для удобства

    // Отправляем успешный ответ
    res.status(200).json({ message: 'Вход выполнен успешно', userId: user.id });

  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ message: 'Внутренняя ошибка сервера' });
  }
});


// Проверка, вошёл ли пользователь — используется на book.html/contents.html,
// чтобы понять, показывать ли кнопку «Сохранить закладку» или ссылку «Войти»
app.get('/api/me', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ loggedIn: false });
  }
  try {
    const result = await pool.query('SELECT nickname FROM users WHERE id = $1', [req.session.userId]);
    if (result.rows.length === 0) {
      return res.json({ loggedIn: false });
    }
    res.json({ loggedIn: true, nickname: result.rows[0].nickname });
  } catch (error) {
    console.error('Ошибка проверки сессии:', error);
    res.json({ loggedIn: false });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Вы вышли из системы' });
  });
});

// Сохранение закладки конкретного читателя: книга + глава + позиция ПО СЛОВАМ
// в тексте главы (не номер страницы — он зависит от размера экрана читателя).
app.post('/api/bookmark', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ message: 'Войдите, чтобы сохранять закладки' });
  }

  const { bookSlug, chapterNumber, wordOffset } = req.body;
  if (!bookSlug || !chapterNumber) {
    return res.status(400).json({ message: 'Не указана книга или глава' });
  }

  try {
    const bookResult = await pool.query('SELECT id FROM books WHERE slug = $1', [bookSlug]);
    if (bookResult.rows.length === 0) {
      return res.status(404).json({ message: 'Книга не найдена' });
    }
    const bookId = bookResult.rows[0].id;

    const chapterResult = await pool.query(
      'SELECT id FROM chapters WHERE book_id = $1 AND chapter_number = $2',
      [bookId, chapterNumber]
    );
    if (chapterResult.rows.length === 0) {
      return res.status(404).json({ message: 'Глава не найдена' });
    }
    const chapterId = chapterResult.rows[0].id;

    await pool.query(
      `INSERT INTO reading_progress (user_id, book_id, last_chapter_id, word_offset, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, book_id)
       DO UPDATE SET last_chapter_id = EXCLUDED.last_chapter_id, word_offset = EXCLUDED.word_offset, updated_at = NOW()`,
      [req.session.userId, bookId, chapterId, wordOffset || 0]
    );

    res.json({ message: 'Закладка сохранена' });
  } catch (error) {
    console.error('Ошибка сохранения закладки:', error);
    res.status(500).json({ message: 'Ошибка сервера. Не удалось сохранить закладку.' });
  }
});

// Получение сохранённой закладки текущего читателя для конкретной книги
app.get('/api/bookmark/:slug', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ bookmark: null });
  }

  try {
    const result = await pool.query(
      `SELECT c.chapter_number, rp.word_offset, rp.updated_at
       FROM reading_progress rp
       JOIN books b ON b.id = rp.book_id
       JOIN chapters c ON c.id = rp.last_chapter_id
       WHERE b.slug = $1 AND rp.user_id = $2`,
      [req.params.slug, req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.json({ bookmark: null });
    }

    res.json({ bookmark: result.rows[0] });
  } catch (error) {
    console.error('Ошибка получения закладки:', error);
    res.json({ bookmark: null });
  }
});

// ============================================================
// КНИГИ И ГЛАВЫ
// ============================================================

// Защита админских маршрутов простым токеном (см. .env: ADMIN_TOKEN)
// Подходит для одного автора-администратора, не для многопользовательской ролевой системы
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!process.env.ADMIN_TOKEN) {
    console.warn('ВНИМАНИЕ: ADMIN_TOKEN не задан в .env — админские маршруты не защищены!');
    return next();
  }
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ message: 'Доступ запрещён. Неверный токен администратора.' });
  }
  next();
}

// Загрузка аудиофайла озвучки главы (только администратор, через admin.html).
// Файл сохраняется прямо на сервере в public/audio/ — в отличие от картинок,
// не требует ручного заливания через Git. Возвращает путь, из которого в
// admin.html собирается маркер [audio:путь] для вставки в текст главы.
app.post('/api/admin/upload-audio', requireAdmin, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: 'Файл не загружен' });
  }
  const allowedExt = ['.mp3', '.wav', '.ogg', '.m4a'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedExt.includes(ext)) {
    return res.status(400).json({ message: `Неподдерживаемый формат файла. Разрешены: ${allowedExt.join(', ')}` });
  }

  try {
    const audioDir = path.join(__dirname, 'public', 'audio');
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    // Безопасное имя файла: только латиница/цифры/дефис из оригинального имени,
    // плюс метка времени — чтобы новая загрузка не затёрла случайно старый файл
    // с таким же именем.
    const baseName = path.basename(file.originalname, ext)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'audio';
    const fileName = `${baseName}-${Date.now()}${ext}`;
    const filePath = path.join(audioDir, fileName);

    fs.writeFileSync(filePath, file.buffer);

    res.json({ path: `/audio/${fileName}` });
  } catch (err) {
    console.error('Ошибка загрузки аудио:', err);
    res.status(500).json({ message: 'Не удалось сохранить файл на сервере' });
  }
});

// Публикация поста в Telegram-канал через Bot API (только администратор).
// Бота нужно один раз создать через @BotFather и добавить АДМИНОМ в канал
// с правом "публиковать сообщения" — дальше всё работает из админки сайта.
app.post('/api/telegram/post', requireAdmin, async (req, res) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const channel = process.env.TELEGRAM_CHANNEL;

  if (!botToken || !channel) {
    return res.status(500).json({
      message: 'Telegram-бот не настроен — добавьте TELEGRAM_BOT_TOKEN и TELEGRAM_CHANNEL в .env',
    });
  }

  const { text, imageUrl, buttonText, buttonUrl } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ message: 'Текст поста обязателен' });
  }

  const replyMarkup = (buttonText && buttonUrl)
    ? { inline_keyboard: [[{ text: buttonText, url: buttonUrl }]] }
    : undefined;

  try {
    let tgUrl, payload;
    if (imageUrl && imageUrl.trim()) {
      // Telegram сам скачивает картинку по URL — значит, адрес должен быть
      // публично доступен из интернета (не localhost), иначе Telegram не
      // сможет её получить.
      tgUrl = `https://api.telegram.org/bot${botToken}/sendPhoto`;
      payload = {
        chat_id: channel,
        photo: imageUrl.trim(),
        caption: text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      };
    } else {
      tgUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
      payload = {
        chat_id: channel,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      };
    }

    const tgRes = await fetch(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const tgData = await tgRes.json();

    if (!tgData.ok) {
      console.error('Telegram API отклонил публикацию:', tgData);
      return res.status(502).json({
        message: 'Telegram отклонил публикацию: ' + (tgData.description || 'неизвестная ошибка'),
      });
    }

    res.json({ success: true, messageId: tgData.result.message_id });
  } catch (error) {
    console.error('Ошибка публикации в Telegram:', error);
    res.status(500).json({ message: 'Ошибка сервера при публикации в Telegram' });
  }
});

// ИИ-агент: читает текст главы, сам выбирает цепляющую цитату и пишет
// короткий тизер-пост для Telegram на её основе. Не публикует сам —
// просто предлагает текст, админ смотрит и публикует (или правит) вручную.
app.post('/api/admin/suggest-telegram-post', requireAdmin, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      message: 'ANTHROPIC_API_KEY не задан в .env — ИИ-подбор постов не настроен',
    });
  }

  const { bookSlug, chapterNumber } = req.body;
  if (!bookSlug || !chapterNumber) {
    return res.status(400).json({ message: 'Нужны bookSlug и chapterNumber' });
  }

  try {
    const result = await pool.query(
      `SELECT c.title AS chapter_title, c.content, b.title AS book_title
       FROM chapters c
       JOIN books b ON b.id = c.book_id
       WHERE b.slug = $1 AND c.chapter_number = $2`,
      [bookSlug, chapterNumber]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Глава не найдена. Сначала сохраните её.' });
    }
    const { chapter_title, content, book_title } = result.rows[0];

    const prompt = `Ты помогаешь автору продвигать книгу в Telegram-канале.

Книга: "${book_title}"
Глава ${chapterNumber}${chapter_title ? ': ' + chapter_title : ''}

Текст главы:
"""
${content.slice(0, 6000)}
"""

Задача: выбери ОДНУ короткую цитату из текста выше — точно как в оригинале,
без искажений, 1-2 предложения, не длиннее 200 символов — самую цепляющую,
забавную или интригующую, без спойлеров концовки главы. Затем напиши короткий
тизер-пост для Telegram (3-5 строк), который:
- начинается с этой цитаты в <i>курсиве</i>
- дальше пара живых слов от лица анонса, с лёгким юмором (без спойлеров)
- заканчивается коротким приглашением читать главу

Используй только HTML-теги <b> и <i> (Telegram поддерживает только их),
никакого markdown.

Ответь СТРОГО в формате JSON, без пояснений до или после:
{"quote": "...", "post_text": "..."}`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const aiData = await aiRes.json();

    if (!aiRes.ok) {
      console.error('Ошибка Anthropic API:', aiData);
      return res.status(502).json({
        message: 'Ошибка обращения к ИИ: ' + (aiData.error?.message || 'неизвестная ошибка'),
      });
    }

    const textBlock = (aiData.content || []).find(b => b.type === 'text');
    if (!textBlock) {
      return res.status(502).json({ message: 'ИИ не вернул текстовый ответ' });
    }

    let parsed;
    try {
      const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Не удалось разобрать ответ ИИ:', textBlock.text);
      return res.status(502).json({ message: 'ИИ вернул ответ в неожиданном формате' });
    }

    res.json({ quote: parsed.quote, postText: parsed.post_text });
  } catch (error) {
    console.error('Ошибка подбора поста для Telegram:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Список всех книг — для каталога на главной странице
app.get('/api/books', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, slug, title, author, description, cover_image, genre, status
       FROM books ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Ошибка получения списка книг:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Список .webp-файлов из папки обложек книги — для случайного фона на главной
app.get('/api/covers/:folder', (req, res) => {
  const folder = req.params.folder;
  // Разрешаем только буквы, цифры, дефис и подчёркивание — блокирует path traversal
  if (!/^[A-Za-z0-9_-]+$/.test(folder)) {
    return res.status(400).json({ error: 'Недопустимое имя папки' });
  }
  const dirPath = path.join(__dirname, 'public', 'img', 'covers', folder);

  fs.readdir(dirPath, (err, files) => {
    if (err) {
      return res.status(404).json({ error: 'Папка не найдена' });
    }
    const webpFiles = files.filter(f => f.toLowerCase().endsWith('.webp'));
    res.json(webpFiles);
  });
});

// Информация о книге + список глав (без полного текста — только номера и заголовки)
app.get('/api/books/:slug', async (req, res) => {
  try {
    const bookResult = await pool.query('SELECT * FROM books WHERE slug = $1', [req.params.slug]);
    if (bookResult.rows.length === 0) {
      return res.status(404).json({ message: 'Книга не найдена' });
    }
    const book = bookResult.rows[0];

    const chaptersResult = await pool.query(
      `SELECT id, chapter_number, title, epigraph, illustration, published_at
       FROM chapters WHERE book_id = $1 ORDER BY chapter_number ASC`,
      [book.id]
    );

    res.json({ ...book, chapters: chaptersResult.rows });
  } catch (error) {
    console.error('Ошибка получения книги:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Текст конкретной главы — именно его читает book.html через fetch()
// Сколько глав читать бесплатно — настраивается ПО КАЖДОЙ КНИГЕ отдельно
// (поле free_chapters_limit, выставляется в admin.html). NULL — вся книга бесплатна.
app.get('/api/books/:slug/chapters/:num', async (req, res) => {
  const { slug, num } = req.params;
  try {
    const result = await pool.query(
      `SELECT c.id, c.chapter_number, c.title, c.content, c.epigraph, c.illustration,
              b.id AS book_id, b.title AS book_title, b.slug AS book_slug, b.free_chapters_limit
       FROM chapters c
       JOIN books b ON b.id = c.book_id
       WHERE b.slug = $1 AND c.chapter_number = $2`,
      [slug, num]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Глава не найдена' });
    }

    const chapter = result.rows[0];
    const freeLimit = chapter.free_chapters_limit;
    const bookId = chapter.book_id;
    const chapterId = chapter.id;
    delete chapter.free_chapters_limit;
    delete chapter.book_id;

    if (freeLimit !== null && parseInt(num, 10) > freeLimit && (!req.session || !req.session.userId)) {
      return res.status(403).json({
        message: 'Дальше — по регистрации',
        requiresAuth: true,
        freeChaptersLimit: freeLimit,
      });
    }

    res.json(chapter);

    // Логируем просмотр асинхронно (после отправки ответа — не блокируем читателя)
    setImmediate(async () => {
      try {
        const crypto = require('crypto');
        const rawIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
        const ipHash = crypto.createHash('sha256').update(rawIp).digest('hex');
        const ua = (req.headers['user-agent'] || '').toLowerCase();
        const device = /mobile|android|iphone|ipad/i.test(ua) ? 'mobile'
          : /tablet/i.test(ua) ? 'tablet' : 'desktop';
        const utmSource = req.query.utm_source || null;
        const userId = req.session?.userId || null;

        await pool.query(
          `INSERT INTO page_views (book_id, chapter_id, user_id, ip_hash, device_type, utm_source)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [bookId, chapterId, userId, ipHash, device, utmSource]
        );
      } catch (logErr) {
        console.error('Ошибка логирования просмотра:', logErr);
      }
    });
  } catch (error) {
    console.error('Ошибка получения главы:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// =====================================================================
// АНАЛИТИКА — только для администратора
// =====================================================================

// Сводная статистика: итоговые цифры для карточек в шапке раздела
app.get('/api/admin/analytics/summary', requireAdmin, async (req, res) => {
  try {
    const [views, users, tgClicks, bookmarks] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM page_views'),
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query(`SELECT COUNT(*) FROM page_views WHERE utm_source = 'telegram'`),
      pool.query('SELECT COUNT(*) FROM reading_progress'),
    ]);
    res.json({
      totalViews: parseInt(views.rows[0].count),
      totalUsers: parseInt(users.rows[0].count),
      telegramClicks: parseInt(tgClicks.rows[0].count),
      totalBookmarks: parseInt(bookmarks.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Просмотры по дням за последние N дней (для линейного графика)
app.get('/api/admin/analytics/views-by-day', requireAdmin, async (req, res) => {
  const days = Math.min(parseInt(req.query.days || 30), 90);
  try {
    const result = await pool.query(
      `SELECT DATE(viewed_at) AS day, COUNT(*) AS views,
              COUNT(DISTINCT ip_hash) AS unique_readers
       FROM page_views
       WHERE viewed_at >= NOW() - INTERVAL '${days} days'
       GROUP BY DATE(viewed_at)
       ORDER BY day`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Топ глав по просмотрам
app.get('/api/admin/analytics/top-chapters', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.title AS book, c.chapter_number, c.title AS chapter,
              COUNT(*) AS views, COUNT(DISTINCT pv.ip_hash) AS unique_readers
       FROM page_views pv
       JOIN chapters c ON c.id = pv.chapter_id
       JOIN books b ON b.id = pv.book_id
       GROUP BY b.title, c.chapter_number, c.title
       ORDER BY views DESC
       LIMIT 20`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Самые популярные книги
app.get('/api/admin/analytics/top-books', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.title, COUNT(*) AS views, COUNT(DISTINCT pv.ip_hash) AS unique_readers
       FROM page_views pv
       JOIN books b ON b.id = pv.book_id
       GROUP BY b.title
       ORDER BY views DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// До какой главы дочитывают — распределение последней сохранённой закладки
app.get('/api/admin/analytics/dropoff', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.title AS book, c.chapter_number,
              COUNT(*) AS readers_stopped_here
       FROM reading_progress rp
       JOIN chapters c ON c.id = rp.chapter_id
       JOIN books b ON b.id = rp.book_id
       GROUP BY b.title, c.chapter_number
       ORDER BY b.title, c.chapter_number`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Регистрации по дням
app.get('/api/admin/analytics/registrations', requireAdmin, async (req, res) => {
  const days = Math.min(parseInt(req.query.days || 30), 90);
  try {
    const result = await pool.query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS registrations
       FROM users
       WHERE created_at >= NOW() - INTERVAL '${days} days'
       GROUP BY DATE(created_at)
       ORDER BY day`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Устройства (mobile/desktop)
app.get('/api/admin/analytics/devices', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT device_type, COUNT(*) AS views
       FROM page_views GROUP BY device_type ORDER BY views DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Добавление новой книги ИЛИ обновление существующей — определяется по slug
// (только администратор, через admin.html)
app.post('/api/books', requireAdmin, async (req, res) => {
  const rawSlug = req.body.slug;
  const { title, author, description, cover_image, genre, status, free_chapters_limit } = req.body;

  // Текстура страницы читалки. Разрешаем только известные значения,
  // остальное (в т.ч. пустое) → 'classic' — прежний коричнево-жёлтый вид.
  const allowedTextures = ['classic', 'cream', 'white', 'parchment', 'oldpaper', 'dark'];
  const pageTexture = allowedTextures.includes(req.body.page_texture) ? req.body.page_texture : 'classic';

  // Нормализуем slug: обрезаем пробелы и приводим к нижнему регистру,
  // чтобы 'Temny-Voskhod ' и 'temny-voskhod' не создавали дублей
  const slug = (rawSlug || '').trim().toLowerCase();

  if (!slug || !title || !author) {
    return res.status(400).json({ message: 'Поля slug, title и author обязательны' });
  }

  // Пустая строка/undefined → NULL (вся книга бесплатна); число (включая 0) — лимит глав
  let freeLimitValue = null;
  if (free_chapters_limit !== undefined && free_chapters_limit !== null && free_chapters_limit !== '') {
    const parsed = parseInt(free_chapters_limit, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      freeLimitValue = parsed;
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO books (slug, title, author, description, cover_image, genre, status, free_chapters_limit, page_texture)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'ongoing'), $8, $9)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         author = EXCLUDED.author,
         description = EXCLUDED.description,
         cover_image = EXCLUDED.cover_image,
         genre = EXCLUDED.genre,
         status = EXCLUDED.status,
         free_chapters_limit = EXCLUDED.free_chapters_limit,
         page_texture = EXCLUDED.page_texture
       RETURNING *`,
      [slug, title, author, description || null, cover_image || null, genre || null, status, freeLimitValue, pageTexture]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Ошибка добавления/обновления книги:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Полное безвозвратное удаление книги (только администратор, через admin.html).
// Главы, статистика просмотров и прогресс чтения удаляются автоматически —
// в схеме БД на них стоит ON DELETE CASCADE от books(id), отдельно чистить
// эти таблицы не нужно. Файлы обложки/иллюстраций на диске НЕ удаляются
// (только запись в базе) — их можно почистить вручную при необходимости.
app.delete('/api/admin/books/:slug', requireAdmin, async (req, res) => {
  const slug = (req.params.slug || '').trim().toLowerCase();
  if (!slug) {
    return res.status(400).json({ message: 'Не указан slug книги' });
  }
  try {
    const result = await pool.query('DELETE FROM books WHERE slug = $1 RETURNING title', [slug]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Книга не найдена' });
    }
    res.json({ message: `Книга «${result.rows[0].title}» удалена безвозвратно` });
  } catch (error) {
    console.error('Ошибка удаления книги:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Получить один пост по slug — для формы редактирования в admin.html
app.get('/api/admin/posts/:slug', requireAdmin, async (req, res) => {
  const slug = (req.params.slug || '').trim().toLowerCase();
  try {
    const r = await pool.query('SELECT * FROM posts WHERE slug = $1', [slug]);
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Пост не найден' });
    }
    res.json(r.rows[0]);
  } catch (error) {
    console.error('Ошибка получения поста:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Добавление нового поста ИЛИ обновление существующего — определяется по slug
// (только администратор, через admin.html). Та же логика upsert, что у книг.
app.post('/api/admin/posts', requireAdmin, async (req, res) => {
  const rawSlug = req.body.slug;
  const { title, content, excerpt, cover_image } = req.body;

  if (!rawSlug || !title || !content) {
    return res.status(400).json({ message: 'Заполните slug, заголовок и текст поста' });
  }
  const slug = rawSlug.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ message: 'Slug может содержать только латинские буквы, цифры и дефис' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO posts (slug, title, content, excerpt, cover_image)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         content = EXCLUDED.content,
         excerpt = EXCLUDED.excerpt,
         cover_image = EXCLUDED.cover_image
       RETURNING *`,
      [slug, title, content, excerpt || null, cover_image || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Ошибка добавления/обновления поста:', error);
    // ВРЕМЕННО: показываем реальную причину прямо в админке, чтобы не искать
    // её в консоли сервера. Уберите поле detail, когда причина будет найдена.
    res.status(500).json({ message: 'Ошибка сервера', detail: error.message, code: error.code });
  }
});

// Полное безвозвратное удаление поста (только администратор)
app.delete('/api/admin/posts/:slug', requireAdmin, async (req, res) => {
  const slug = (req.params.slug || '').trim().toLowerCase();
  if (!slug) {
    return res.status(400).json({ message: 'Не указан slug поста' });
  }
  try {
    const result = await pool.query('DELETE FROM posts WHERE slug = $1 RETURNING title', [slug]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Пост не найден' });
    }
    res.json({ message: `Пост «${result.rows[0].title}» удалён безвозвратно` });
  } catch (error) {
    console.error('Ошибка удаления поста:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Добавление/обновление главы (только администратор, через admin.html)
// Если глава с таким номером уже есть — текст обновляется (удобно для правок).
app.post('/api/books/:slug/chapters', requireAdmin, async (req, res) => {
  const { slug } = req.params;
  const { chapter_number, title, content, epigraph, illustration } = req.body;

  if (!chapter_number || !content) {
    return res.status(400).json({ message: 'Поля chapter_number и content обязательны' });
  }

  try {
    const bookResult = await pool.query('SELECT id FROM books WHERE slug = $1', [slug]);
    if (bookResult.rows.length === 0) {
      return res.status(404).json({ message: 'Книга не найдена' });
    }
    const bookId = bookResult.rows[0].id;

    const result = await pool.query(
      `INSERT INTO chapters (book_id, chapter_number, title, content, epigraph, illustration)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (book_id, chapter_number)
       DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, epigraph = EXCLUDED.epigraph, illustration = EXCLUDED.illustration, published_at = NOW()
       RETURNING *`,
      [bookId, chapter_number, title || null, content, epigraph || null, illustration || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Ошибка добавления главы:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Массовая загрузка ВСЕЙ книги через admin.html — .docx файл романа (+ опционально файл содержания)
// Извлечение текста из файла со стихотворением (.docx или .txt), чтобы автор
// мог загрузить готовый файл вместо ручного набора/копирования текста стиха.
// Возвращает только сырой текст — вставка в главу и обёртка [poem]...[/poem]
// делаются на клиенте (admin.js), в текстовое поле главы.
app.post('/api/admin/extract-text', requireAdmin, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: 'Файл не загружен' });
  }
  try {
    let text;
    if (file.originalname.toLowerCase().endsWith('.docx')) {
      // ВАЖНО: mammoth.extractRawText() полностью игнорирует ручные переносы
      // строк (Shift+Enter в Word) — не вставляет на их месте даже пробел,
      // просто склеивает соседние строки. Для стихов, где почти каждая
      // строка — это ручной перенос внутри одного абзаца, это ломает весь
      // текст ("моста" + "И" превращается в "мостаИ"). Поэтому используем
      // convertToHtml(), которая сохраняет ручные переносы как <br>, и сами
      // аккуратно разбираем получившийся HTML обратно в чистый текст —
      // это даёт результат, который выглядит ровно как в исходном .docx.
      // ВАЖНО: mammoth по умолчанию сохраняет жирный/курсив (strong/em),
      // но НЕ подчёркивание — его приходится явно запрашивать через styleMap.
      // Нужно, чтобы автоматически распознавать названия стихов: в исходном
      // .docx они помечены подчёркиванием, и мы используем это как сигнал
      // "это заголовок" — см. docxHtmlToPlainText ниже.
      const result = await mammoth.convertToHtml(
        { buffer: file.buffer },
        { styleMap: ['u => u'] }
      );
      text = docxHtmlToPlainText(result.value);
    } else {
      // .txt и всё остальное — читаем как обычный текст (UTF-8)
      text = file.buffer.toString('utf8');
    }
    res.json({ text });
  } catch (err) {
    console.error('Ошибка извлечения текста из файла:', err);
    res.status(500).json({ message: 'Не удалось прочитать файл' });
  }
});

app.post('/api/books/:slug/import', requireAdmin, upload.fields([
  { name: 'bookFile', maxCount: 1 },
  { name: 'tocFile', maxCount: 1 },
]), async (req, res) => {
  const { slug } = req.params;
  const mode = req.body.mode === 'toc' ? 'toc' : 'auto';
  const preview = req.body.preview === 'true';

  const bookFile = req.files?.bookFile?.[0];
  if (!bookFile) {
    return res.status(400).json({ message: 'Файл романа (.docx) не загружен' });
  }

  try {
    const bookResult = await pool.query('SELECT id, title FROM books WHERE slug = $1', [slug]);
    if (bookResult.rows.length === 0) {
      return res.status(404).json({ message: 'Книга не найдена. Сначала создайте её выше.' });
    }
    const bookId = bookResult.rows[0].id;

    const mammothResult = await mammoth.extractRawText({ buffer: bookFile.buffer });
    const fullText = mammothResult.value;

    let chapters;
    if (mode === 'toc') {
      const tocFile = req.files?.tocFile?.[0];
      if (!tocFile) {
        return res.status(400).json({ message: 'Для режима "по списку заголовков" нужен файл содержания (.txt)' });
      }
      const tocText = tocFile.buffer.toString('utf-8');
      try {
        chapters = splitByToc(fullText, tocText);
      } catch (err) {
        return res.status(400).json({ message: err.message });
      }
    } else {
      chapters = splitByAutoHeadings(fullText);
    }

    if (chapters.length === 0) {
      return res.status(400).json({
        message: 'Не удалось найти ни одной главы. Похоже, заголовки помечены не стандартным образом — попробуйте режим "по списку заголовков".'
      });
    }

    // РЕЖИМ ПРЕДПРОСМОТРА: показываем разбивку, но НИЧЕГО не пишем в базу
    if (preview) {
      return res.json({
        preview: true,
        message: `Найдено глав: ${chapters.length} (в базу пока ничего не записано)`,
        chapters: chapters.map(ch => ({
          number: ch.number,
          title: ch.title,
          length: ch.content.length,
          snippet: ch.content.slice(0, 80).replace(/\n/g, ' '),
        })).sort((a, b) => a.number - b.number),
      });
    }

    const savedNumbers = [];
    for (const ch of chapters) {
      await pool.query(
        `INSERT INTO chapters (book_id, chapter_number, title, content)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (book_id, chapter_number)
         DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, published_at = NOW()`,
        [bookId, ch.number, ch.title, ch.content]
      );
      savedNumbers.push(ch.number);
    }

    res.status(201).json({
      preview: false,
      message: `Загружено глав: ${savedNumbers.length}`,
      chapters: savedNumbers.sort((a, b) => a - b),
    });
  } catch (error) {
    console.error('Ошибка массовой загрузки книги:', error);
    res.status(500).json({ message: 'Ошибка сервера при обработке файла' });
  }
});

// Запуск сервера на порту 3000
const port = 3000;
app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});

// Прокси для YandexGPT API (агент продвижения)
app.post('/api/agent/claude', requireAdmin, async (req, res) => {
  try {
    const body = req.body;
    // Конвертируем формат Anthropic → YandexGPT
    const messages = body.messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      text: typeof m.content === 'string' ? m.content : m.content[0]?.text || ''
    }));
    const yandexBody = {
      modelUri: `gpt://${process.env.YANDEX_FOLDER_ID}/yandexgpt/latest`,
      completionOptions: {
        stream: false,
        temperature: 0.7,
        maxTokens: body.max_tokens || 1000
      },
      messages
    };
    const response = await fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${process.env.YANDEX_API_KEY}`
      },
      body: JSON.stringify(yandexBody)
    });
    const data = await response.json();
    const text = data.result?.alternatives?.[0]?.message?.text || '';
    // Возвращаем в формате совместимом с Anthropic
    res.json({ content: [{ type: 'text', text }], text });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Статистика ВКонтакте для агента ЦА
app.get('/api/agent/vk-stats', requireAdmin, async (req, res) => {
  try {
    const token = process.env.VK_TOKEN;
    const groupId = process.env.VK_GROUP_ID;
    const r = await fetch(`https://api.vk.com/method/groups.getById?group_id=${groupId}&fields=members_count&access_token=${token}&v=5.131`);
    const data = await r.json();
    const group = data.response?.groups?.[0];
    res.json({ members: group?.members_count || 0, views: 0 });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Публикация поста в ВКонтакте
app.post('/api/agent/publish-vk', requireAdmin, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Нет текста' });
  try {
    const url = `https://api.vk.com/method/wall.post?owner_id=-${process.env.VK_GROUP_ID}&message=${encodeURIComponent(text)}&access_token=${process.env.VK_TOKEN}&v=5.131`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error.error_msg });
    res.json({ ok: true, post_id: data.response?.post_id });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Поиск тематических сообществ ВКонтакте
app.post('/api/agent/vk-groups', requireAdmin, async (req, res) => {
  const userToken = process.env.VK_USER_TOKEN;
  const keywords = (req.body.keywords && req.body.keywords.length)
    ? req.body.keywords
    : ['фэнтези', 'мистика', 'фантастика', 'книги', 'городское фэнтези',
       'юмористическое фэнтези', 'современная проза', 'русская литература',
       'книжный блог', 'самиздат'];
  try {
    const results = [];
    const searches = keywords.map(async (keyword) => {
      try {
        const url = `https://api.vk.com/method/groups.search?q=${encodeURIComponent(keyword)}&type=group&count=30&sort=6&fields=members_count&access_token=${userToken}&v=5.131`;
        const r = await fetch(url);
        const data = await r.json();
        const found = [];
        const stopWords = ['вышив', 'шить', 'шитьё', 'шитье', 'медицин', 'учебник', 'кино', 'фильм',
          'рекорд', 'детей', 'детск', 'детям', 'детя', 'ребен', 'малыш', 'дошкол', 'кухн', 'рецепт', 'английск', 'психолог', 'психотерап',
          'кулинар', 'учител', 'школ', 'вязан', 'рукодел', 'диет', 'фитнес', 'похуд', 'язык', 'девушк'];
        if (data.response?.items) {
          for (const g of data.response.items) {
            const nameLower = g.name.toLowerCase();
            const hasStopWord = stopWords.some(w => nameLower.includes(w));
            if (g.is_closed === 0 && g.members_count > 1000 && !hasStopWord) {
              found.push({ name: g.name, url: `https://vk.com/${g.screen_name}`, members: g.members_count, keyword });
            }
          }
        }
        return found;
      } catch(e) { return []; }
    });
    const all = await Promise.all(searches);
    for (const arr of all) results.push(...arr);
    const seen = new Set();
    const unique = results.filter(g => { if (seen.has(g.url)) return false; seen.add(g.url); return true; });
    unique.sort((a, b) => b.members - a.members);
    res.json(unique.slice(0, 50));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
