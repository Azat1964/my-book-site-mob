// Токен хранится в sessionStorage — живёт пока открыта вкладка браузера,
// не остаётся навсегда как при localStorage (немного безопаснее для общего компьютера)
let ADMIN_TOKEN = sessionStorage.getItem('adminToken') || '';

const loginScreen = document.getElementById('login-screen');
const adminPanel = document.getElementById('admin-panel');
const tokenInput = document.getElementById('admin-token-input');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');

const bookForm = document.getElementById('book-form');
const bookStatusMsg = document.getElementById('book-status-msg');
const bookLoadBtn = document.getElementById('book-load-btn');
const bookSlugSelect = document.getElementById('book-slug-select');
const bookLoadMsg = document.getElementById('book-load-msg');

const chapterForm = document.getElementById('chapter-form');
const chapterBookSelect = document.getElementById('chapter-book-slug');
const chapterStatusMsg = document.getElementById('chapter-status-msg');
const chapterLoadBtn = document.getElementById('chapter-load-btn');
const chapterLoadMsg = document.getElementById('chapter-load-msg');

const importForm = document.getElementById('import-form');
const importBookSelect = document.getElementById('import-book-slug');
const importModeSelect = document.getElementById('import-mode');
const importTocRow = document.getElementById('import-toc-row');
const importStatusMsg = document.getElementById('import-status-msg');
const importResult = document.getElementById('import-result');

// Если токен уже сохранён в этой вкладке — сразу показываем панель
if (ADMIN_TOKEN) {
  showAdminPanel();
}

loginBtn.addEventListener('click', () => {
  const value = tokenInput.value.trim();
  if (!value) {
    loginError.textContent = 'Введите токен';
    return;
  }
  ADMIN_TOKEN = value;
  sessionStorage.setItem('adminToken', value);
  loginError.textContent = '';
  showAdminPanel();
});

function showAdminPanel() {
  loginScreen.style.display = 'none';
  adminPanel.style.display = 'flex';
  loadBooksIntoSelect();
  // Загружаем аналитику сразу после входа
}

// Подгружаем список книг в выпадающий список для формы главы и формы массовой загрузки
async function loadBooksIntoSelect() {
  try {
    const res = await fetch('/api/books');
    const books = await res.json();

    // Заполняем выпадашку формы книги
    if (bookSlugSelect) {
      bookSlugSelect.innerHTML = '<option value="">— выбрать существующую книгу —</option>';
      books.forEach(book => {
        const opt = document.createElement('option');
        opt.value = book.slug;
        opt.textContent = `${book.title} (${book.slug})`;
        bookSlugSelect.appendChild(opt);
      });
    }

    [chapterBookSelect, importBookSelect].forEach(select => {
      select.innerHTML = '<option value="">— выберите книгу —</option>';
      books.forEach(book => {
        const opt = document.createElement('option');
        opt.value = book.slug;
        opt.textContent = `${book.title} (${book.slug})`;
        select.appendChild(opt);
      });
    });
  } catch (err) {
    console.error('Не удалось загрузить список книг:', err);
  }
}

// Выбор из списка → заполняет поле slug и автоматически загружает книгу
if (bookSlugSelect) {
  bookSlugSelect.addEventListener('change', async () => {
    const slug = bookSlugSelect.value;
    if (!slug) return;
    document.getElementById('book-slug').value = slug;
    // Автоматически запускаем загрузку как если бы нажали кнопку
    bookLoadBtn.click();
  });
}

// ---- Загрузка существующей книги в форму (чтобы не перепечатывать всё
// заново, если нужно просто поменять лимит бесплатных глав или обложку) ----
bookLoadBtn.addEventListener('click', async () => {
  const slug = document.getElementById('book-slug').value.trim();
  if (!slug) {
    bookLoadMsg.textContent = 'Сначала впишите slug книги';
    bookLoadMsg.className = 'status-text err';
    return;
  }

  bookLoadMsg.textContent = 'Загружаю книгу…';
  bookLoadMsg.className = 'status-text';

  try {
    const res = await fetch(`/api/books/${slug}`);
    const data = await res.json();

    if (res.ok) {
      document.getElementById('book-title').value = data.title || '';
      document.getElementById('book-author').value = data.author || '';
      document.getElementById('book-description').value = data.description || '';
      document.getElementById('book-genre').value = data.genre || '';
      document.getElementById('book-cover').value = data.cover_image || '';
      document.getElementById('book-status').value = data.status || 'ongoing';
      document.getElementById('book-free-limit').value =
        (data.free_chapters_limit === null || data.free_chapters_limit === undefined)
          ? ''
          : data.free_chapters_limit;
      // Запоминаем оригинальный slug отдельно — он не сбросится при reset()
      // и именно по нему будет ON CONFLICT при сохранении
      document.getElementById('book-slug-original').value = data.slug;
      bookLoadMsg.textContent = `Книга «${data.title}» загружена — можно править поля и нажать «Сохранить книгу».`;
      bookLoadMsg.className = 'status-text ok';
    } else if (res.status === 404) {
      bookLoadMsg.textContent = 'Книги с таким slug пока нет — можно заполнить форму и создать новую.';
      bookLoadMsg.className = 'status-text err';
    } else {
      bookLoadMsg.textContent = data.message || 'Не удалось загрузить книгу';
      bookLoadMsg.className = 'status-text err';
    }
  } catch (err) {
    bookLoadMsg.textContent = 'Ошибка сети: ' + err.message;
    bookLoadMsg.className = 'status-text err';
  }
});

// ---- Добавление книги ----
bookForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  bookStatusMsg.textContent = 'Сохраняю...';
  bookStatusMsg.className = 'status-text';

  const freeLimitRaw = document.getElementById('book-free-limit').value.trim();
  // Используем оригинальный slug (сохранённый при загрузке кнопкой),
  // если он есть — это гарантирует что ON CONFLICT сработает на правильную запись.
  // Иначе берём то, что в поле (создание новой книги).
  const originalSlug = document.getElementById('book-slug-original').value.trim();
  const slugFromField = document.getElementById('book-slug').value.trim().toLowerCase();
  const payload = {
    slug: originalSlug || slugFromField,
    title: document.getElementById('book-title').value.trim(),
    author: document.getElementById('book-author').value.trim(),
    description: document.getElementById('book-description').value.trim(),
    genre: document.getElementById('book-genre').value.trim(),
    cover_image: document.getElementById('book-cover').value.trim(),
    status: document.getElementById('book-status').value,
    free_chapters_limit: freeLimitRaw === '' ? null : freeLimitRaw,
  };

  try {
    const res = await fetch('/api/books', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': ADMIN_TOKEN,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (res.ok) {
      bookStatusMsg.textContent = `Книга «${data.title}» сохранена.`;
      bookStatusMsg.className = 'status-text ok';
      bookForm.reset();
      document.getElementById('book-slug-original').value = '';
      if (bookSlugSelect) bookSlugSelect.value = '';
      bookLoadMsg.textContent = '';
      loadBooksIntoSelect();
    } else if (res.status === 403) {
      bookStatusMsg.textContent = 'Неверный токен администратора. Войдите снова.';
      bookStatusMsg.className = 'status-text err';
      logout();
    } else {
      bookStatusMsg.textContent = data.message || 'Ошибка сохранения';
      bookStatusMsg.className = 'status-text err';
    }
  } catch (err) {
    bookStatusMsg.textContent = 'Ошибка сети: ' + err.message;
    bookStatusMsg.className = 'status-text err';
  }
});

// ---- Загрузка существующей главы в форму (чтобы не перепечатывать текст,
// если нужно просто добавить/поменять картинку, эпиграф или заголовок) ----
chapterLoadBtn.addEventListener('click', async () => {
  const slug = chapterBookSelect.value;
  const num = document.getElementById('chapter-number').value;

  if (!slug) {
    chapterLoadMsg.textContent = 'Сначала выберите книгу';
    chapterLoadMsg.className = 'status-text err';
    return;
  }
  if (!num) {
    chapterLoadMsg.textContent = 'Укажите номер главы';
    chapterLoadMsg.className = 'status-text err';
    return;
  }

  chapterLoadMsg.textContent = 'Загружаю главу…';
  chapterLoadMsg.className = 'status-text';

  try {
    const res = await fetch(`/api/books/${slug}/chapters/${num}`);
    const data = await res.json();

    if (res.ok) {
      document.getElementById('chapter-title').value = data.title || '';
      document.getElementById('chapter-epigraph').value = data.epigraph || '';
      document.getElementById('chapter-illustration').value = data.illustration || '';
      document.getElementById('chapter-content').value = data.content || '';
      chapterLoadMsg.textContent = `Глава ${data.chapter_number} загружена — можно править поля и нажать «Опубликовать главу».`;
      chapterLoadMsg.className = 'status-text ok';
    } else if (res.status === 404) {
      chapterLoadMsg.textContent = 'Такой главы пока нет — можно просто заполнить форму и опубликовать новую.';
      chapterLoadMsg.className = 'status-text err';
    } else {
      chapterLoadMsg.textContent = data.message || 'Не удалось загрузить главу';
      chapterLoadMsg.className = 'status-text err';
    }
  } catch (err) {
    chapterLoadMsg.textContent = 'Ошибка сети: ' + err.message;
    chapterLoadMsg.className = 'status-text err';
  }
});

// ---- Добавление / обновление главы ----
chapterForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  chapterStatusMsg.textContent = 'Публикую...';
  chapterStatusMsg.className = 'status-text';

  const slug = chapterBookSelect.value;
  if (!slug) {
    chapterStatusMsg.textContent = 'Выберите книгу';
    chapterStatusMsg.className = 'status-text err';
    return;
  }

  const payload = {
    chapter_number: parseInt(document.getElementById('chapter-number').value, 10),
    title: document.getElementById('chapter-title').value.trim(),
    epigraph: document.getElementById('chapter-epigraph').value.trim(),
    illustration: document.getElementById('chapter-illustration').value.trim(),
    content: document.getElementById('chapter-content').value,
  };

  try {
    const res = await fetch(`/api/books/${slug}/chapters`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': ADMIN_TOKEN,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (res.ok) {
      chapterStatusMsg.textContent = `Глава ${data.chapter_number} опубликована.`;
      chapterStatusMsg.className = 'status-text ok';

      // Подготавливаем (но не отправляем) пост-анонс в Telegram — просто
      // заполняем форму ниже, чтобы можно было поправить текст и опубликовать
      // в один клик, не печатая всё заново.
      const bookOption = chapterBookSelect.options[chapterBookSelect.selectedIndex];
      const bookTitle = bookOption ? bookOption.textContent.replace(/\s*\([^)]*\)\s*$/, '') : '';
      const chapterTitle = payload.title || `Глава ${data.chapter_number}`;
      document.getElementById('tg-text').value =
        `📖 «${bookTitle}»\n\nГлава ${data.chapter_number}: ${chapterTitle}\n\nЧитайте уже сейчас!`;
      document.getElementById('tg-button-text').value = 'Читать главу';
      document.getElementById('tg-button-url').value =
        `${window.location.origin}/contents.html?book=${slug}`;

      chapterForm.reset();
      chapterLoadMsg.textContent = '';
    } else if (res.status === 403) {
      chapterStatusMsg.textContent = 'Неверный токен администратора. Войдите снова.';
      chapterStatusMsg.className = 'status-text err';
      logout();
    } else {
      chapterStatusMsg.textContent = data.message || 'Ошибка публикации';
      chapterStatusMsg.className = 'status-text err';
    }
  } catch (err) {
    chapterStatusMsg.textContent = 'Ошибка сети: ' + err.message;
    chapterStatusMsg.className = 'status-text err';
  }
});

function logout() {
  sessionStorage.removeItem('adminToken');
  ADMIN_TOKEN = '';
  adminPanel.style.display = 'none';
  loginScreen.style.display = 'flex';
}

// ---- Массовая загрузка книги целиком ----

// Поле содержания нужно только в режиме "по списку заголовков"
function updateTocRowVisibility() {
  importTocRow.style.display = importModeSelect.value === 'toc' ? 'block' : 'none';
}
importModeSelect.addEventListener('change', updateTocRowVisibility);
updateTocRowVisibility();

importForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  await submitImport(false);
});

document.getElementById('import-preview-btn').addEventListener('click', async () => {
  await submitImport(true);
});

async function submitImport(preview) {
  const slug = importBookSelect.value;
  if (!slug) {
    importStatusMsg.textContent = 'Выберите книгу';
    importStatusMsg.className = 'status-text err';
    return;
  }

  const bookFileInput = document.getElementById('import-book-file');
  const tocFileInput = document.getElementById('import-toc-file');
  const mode = importModeSelect.value;

  if (!bookFileInput.files[0]) {
    importStatusMsg.textContent = 'Выберите файл романа (.docx)';
    importStatusMsg.className = 'status-text err';
    return;
  }

  if (mode === 'toc' && !tocFileInput.files[0]) {
    importStatusMsg.textContent = 'Для режима "по списку заголовков" нужен файл содержания (.txt)';
    importStatusMsg.className = 'status-text err';
    return;
  }

  importStatusMsg.textContent = preview
    ? 'Проверяю разбивку… в базу пока ничего не записывается.'
    : 'Загружаю и разбиваю на главы… это может занять немного времени.';
  importStatusMsg.className = 'status-text';
  importResult.innerHTML = '';

  const formData = new FormData();
  formData.append('mode', mode);
  formData.append('preview', preview ? 'true' : 'false');
  formData.append('bookFile', bookFileInput.files[0]);
  if (mode === 'toc') {
    formData.append('tocFile', tocFileInput.files[0]);
  }

  try {
    const res = await fetch(`/api/books/${slug}/import`, {
      method: 'POST',
      headers: { 'x-admin-token': ADMIN_TOKEN },
      body: formData,
    });
    const data = await res.json();

    if (res.ok) {
      importStatusMsg.textContent = data.message;
      importStatusMsg.className = 'status-text ok';

      if (data.preview) {
        // Режим предпросмотра — показываем список глав с длиной и началом текста
        const items = data.chapters.map(ch => `
          <li>
            <span class="ch-num">Глава ${ch.number}</span>${ch.title ? ' — ' + escapeHtml(ch.title) : ''}
            <span class="ch-len">${ch.length} симв.</span>
            <span class="ch-snippet">${escapeHtml(ch.snippet)}…</span>
          </li>
        `).join('');
        importResult.innerHTML = `
          <p class="status-text">Если разбивка выглядит правильно — нажмите «Загрузить и разбить на главы» (та же форма, без изменений).</p>
          <ul class="preview-list">${items}</ul>
        `;
      } else {
        // Реальная загрузка — просто список номеров сохранённых глав
        importResult.innerHTML = `Главы: ${data.chapters.join(', ')}`;
        importForm.reset();
        updateTocRowVisibility();
      }
    } else if (res.status === 403) {
      importStatusMsg.textContent = 'Неверный токен администратора. Войдите снова.';
      importStatusMsg.className = 'status-text err';
      logout();
    } else {
      importStatusMsg.textContent = data.message || 'Ошибка загрузки';
      importStatusMsg.className = 'status-text err';
    }
  } catch (err) {
    importStatusMsg.textContent = 'Ошибка сети: ' + err.message;
    importStatusMsg.className = 'status-text err';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- ИИ-подбор цитаты и тизера для Telegram по уже сохранённой главе ----
const aiSuggestBtn = document.getElementById('ai-suggest-post-btn');
const aiSuggestMsg = document.getElementById('ai-suggest-post-msg');

aiSuggestBtn.addEventListener('click', async () => {
  const slug = chapterBookSelect.value;
  const num = document.getElementById('chapter-number').value;

  if (!slug) {
    aiSuggestMsg.textContent = 'Сначала выберите книгу';
    aiSuggestMsg.className = 'status-text err';
    return;
  }
  if (!num) {
    aiSuggestMsg.textContent = 'Укажите номер главы';
    aiSuggestMsg.className = 'status-text err';
    return;
  }

  aiSuggestMsg.textContent = 'ИИ читает главу и подбирает цитату… (10–20 секунд)';
  aiSuggestMsg.className = 'status-text';
  aiSuggestBtn.disabled = true;

  try {
    const res = await fetch('/api/admin/suggest-telegram-post', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': ADMIN_TOKEN,
      },
      body: JSON.stringify({ bookSlug: slug, chapterNumber: parseInt(num, 10) }),
    });
    const data = await res.json();

    if (res.ok) {
      document.getElementById('tg-text').value = data.postText || '';
      document.getElementById('tg-button-text').value = 'Читать главу';
      document.getElementById('tg-button-url').value =
        `${window.location.origin}/contents.html?book=${slug}`;
      aiSuggestMsg.textContent = `Готово — цитата: «${data.quote}». Текст поста ниже, можно поправить перед публикацией.`;
      aiSuggestMsg.className = 'status-text ok';
    } else if (res.status === 403) {
      aiSuggestMsg.textContent = 'Неверный токен администратора. Войдите снова.';
      aiSuggestMsg.className = 'status-text err';
      logout();
    } else {
      aiSuggestMsg.textContent = data.message || 'Не удалось подобрать пост';
      aiSuggestMsg.className = 'status-text err';
    }
  } catch (err) {
    aiSuggestMsg.textContent = 'Ошибка сети: ' + err.message;
    aiSuggestMsg.className = 'status-text err';
  } finally {
    aiSuggestBtn.disabled = false;
  }
});

// ---- Публикация поста в Telegram-канал ----
const telegramForm = document.getElementById('telegram-form');
const telegramStatusMsg = document.getElementById('telegram-status-msg');

telegramForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  telegramStatusMsg.textContent = 'Публикую...';
  telegramStatusMsg.className = 'status-text';

  const payload = {
    text: document.getElementById('tg-text').value.trim(),
    imageUrl: document.getElementById('tg-image').value.trim(),
    buttonText: document.getElementById('tg-button-text').value.trim(),
    buttonUrl: document.getElementById('tg-button-url').value.trim(),
  };

  try {
    const res = await fetch('/api/telegram/post', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': ADMIN_TOKEN,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (res.ok) {
      telegramStatusMsg.textContent = 'Опубликовано в канале ✅';
      telegramStatusMsg.className = 'status-text ok';
      telegramForm.reset();
    } else if (res.status === 403) {
      telegramStatusMsg.textContent = 'Неверный токен администратора. Войдите снова.';
      telegramStatusMsg.className = 'status-text err';
      logout();
    } else {
      telegramStatusMsg.textContent = data.message || 'Ошибка публикации';
      telegramStatusMsg.className = 'status-text err';
    }
  } catch (err) {
    telegramStatusMsg.textContent = 'Ошибка сети: ' + err.message;
    telegramStatusMsg.className = 'status-text err';
  }
});

