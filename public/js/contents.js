document.addEventListener('DOMContentLoaded', async () => {
  const app = document.getElementById('app');
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('book');

  // ---- Статус входа — видно, залогинены ли вы, и можно выйти прямо здесь ----
  const authStatus = document.getElementById('authStatus');
  const logoutBtn = document.getElementById('logoutBtn');
  const loginLink = document.getElementById('loginLink');

  try {
    const meRes = await fetch('/api/me');
    const me = await meRes.json();
    if (me.loggedIn) {
      authStatus.textContent = `Вы вошли как ${me.nickname}`;
      logoutBtn.style.display = 'inline-block';
    } else {
      loginLink.style.display = 'inline-block';
      loginLink.href = `./registration.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
  } catch (err) {
    console.error('Не удалось проверить вход:', err);
  }

  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch (err) {
      console.error('Ошибка выхода:', err);
    }
    window.location.reload(); // перезагружаем — закладка и статус входа пересчитаются с нуля
  });

  if (!slug) {
    app.innerHTML = '<p id="error">Не указана книга. Используйте: contents.html?book=slug</p>';
    return;
  }

  try {
    const res = await fetch(`/api/books/${slug}`);
    if (!res.ok) {
      app.innerHTML = '<p id="error">Книга не найдена.</p>';
      return;
    }
    const book = await res.json();

    let bookmark = null;
    try {
      const bmRes = await fetch(`/api/bookmark/${slug}`);
      const bmData = await bmRes.json();
      bookmark = bmData.bookmark;
    } catch (err) {
      console.error('Не удалось проверить закладку:', err);
    }

    render(book, slug, bookmark);
  } catch (err) {
    app.innerHTML = `<p id="error">Ошибка загрузки: ${err.message}</p>`;
  }
});

function render(book, slug, bookmark) {
  const app = document.getElementById('app');

  let chaptersHtml;
  if (book.chapters.length === 0) {
    chaptersHtml = '<p class="empty-msg">Главы пока не опубликованы.</p>';
  } else {
    const items = book.chapters
      .sort((a, b) => a.chapter_number - b.chapter_number)
      .map(ch => `
        <li class="chapter-item">
          <a class="chapter-link" href="./book.html?book=${slug}&chapter=${ch.chapter_number}">
            <span class="chapter-num">Глава ${ch.chapter_number}</span>
            <span class="chapter-title">${escapeHtml(ch.title) || ''}</span>
          </a>
        </li>
      `).join('');
    chaptersHtml = `<ul class="chapter-list">${items}</ul>`;
  }

  const bookmarkTabHtml = bookmark
    ? `<a class="bookmark-tab" href="./book.html?book=${slug}&chapter=${bookmark.chapter_number}&word=${bookmark.word_offset}">
         🔖 Закладка — глава ${bookmark.chapter_number}
       </a>`
    : '';

  app.innerHTML = `
    ${bookmarkTabHtml}
    <div class="book-header">
      <h1 class="book-title">${escapeHtml(book.title)}</h1>
      <p class="book-author">${escapeHtml(book.author)}</p>
    </div>
    ${chaptersHtml}
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
