let ADMIN_TOKEN = localStorage.getItem('adminToken') || '';
let currentPlatform = 'vk';
let currentPost = '';
let siteStats = null;
let vkStats = null;

// ---- ЛОГИН ----
async function doLogin() {
  const val = document.getElementById('tokenInput').value.trim();
  if (!val) return;
  const r = await fetch('/api/admin/analytics/summary', { headers: { 'x-admin-token': val } });
  if (r.ok) { ADMIN_TOKEN = val; localStorage.setItem('adminToken', val); showAgent(); }
  else { const el = document.getElementById('loginErr'); el.textContent = 'Неверный токен'; el.style.display = 'block'; }
}
document.getElementById('tokenInput').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
if (ADMIN_TOKEN) fetch('/api/admin/analytics/summary', { headers: { 'x-admin-token': ADMIN_TOKEN } }).then(r => { if (r.ok) showAgent(); });

function showAgent() {
  document.getElementById('loginWrap').style.display = 'none';
  document.getElementById('agentWrap').style.display = 'block';
  loadAdvice();
}

function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-posts').style.display = name === 'posts' ? 'block' : 'none';
  document.getElementById('tab-audience').style.display = name === 'audience' ? 'block' : 'none';
  document.getElementById('tab-ads').style.display = name === 'ads' ? 'block' : 'none';
}

function selectPlatform(el) {
  document.querySelectorAll('.platform-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  currentPlatform = el.dataset.platform;
}

// Хелпер для запроса к YandexGPT через прокси
async function askAI(prompt, maxTokens) {
  const res = await fetch('/api/agent/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body: JSON.stringify({ model: 'yandexgpt', max_tokens: maxTokens || 1000, messages: [{ role: 'user', content: prompt }] })
  });
  const data = await res.json();
  return data.text || (data.content && data.content[0] && data.content[0].text) || 'Нет ответа';
}

function nl2br(t) { return t.split('\n').join('<br>'); }
function bold(t) { return t.replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--gold);">$1</strong>'); }

// ---- СОВЕТ ДНЯ ----
async function loadAdvice() {
  const box = document.getElementById('adviceBox');
  try {
    const text = await askAI('Ты агент продвижения для сайта booklo.ru писателя Азата Туктарова. Книга "Тёмный Восход" — городское фэнтези, Булгаков+Гай Ричи. Telegram @otets_tuk, группа ВКонтакте "Отец Тук". Дай один конкретный практичный совет по продвижению на сегодня — что сделать, где разместить, что написать. Выполнимо за 30 минут. Не более 80 слов.', 500);
    box.innerHTML = '<strong>💡 Совет дня:</strong> ' + text;
  } catch(e) {
    box.innerHTML = '<strong>💡 Совет дня:</strong> Опубликуйте цитату из "Тёмного Восхода" в группе ВКонтакте с хэштегами #городскоефэнтези #русскаялитература';
  }
}

// ---- ГЕНЕРАЦИЯ ПОСТА ----
async function generatePost() {
  const btn = document.getElementById('genBtn');
  const output = document.getElementById('postOutput');
  const actions = document.getElementById('postActions');
  const topic = document.getElementById('postTopic').value;
  const pnames = { vk: 'ВКонтакте', tg: 'Telegram', inst: 'Instagram' };
  const tnames = { new_chapter: 'анонс новой главы', quote: 'цитата из книги', author: 'пост об авторе', teaser: 'тизер с интригой', review: 'пост от лица читателя', behind: 'закулисье автора' };
  btn.disabled = true; btn.innerHTML = '<span class="spinner">⏳</span> Генерирую...';
  output.style.display = 'block'; output.textContent = 'Пишу пост...'; actions.style.display = 'none';
  try {
    const limits = { vk: 'До 1000 знаков, хэштеги в конце.', tg: 'До 500 знаков, разговорный тон.', inst: 'До 300 знаков, emoji, хэштеги.' };
    currentPost = await askAI('Напиши пост для ' + pnames[currentPlatform] + ', тема: ' + tnames[topic] + '.\nАвтор: Азат Туктаров "Отец Тук". Книга "Тёмный Восход" — вампир Клычков устал от вечности, кот Мотолыжников, ангел Василий, бобёр Ниофан. Стиль: Булгаков+Гай Ричи.\nСайт: https://booklo.ru, Telegram: @otets_tuk\n' + limits[currentPlatform] + '\nТолько текст поста.', 1000);
    output.textContent = currentPost; actions.style.display = 'flex';
  } catch(e) { output.textContent = 'Ошибка: ' + e.message; }
  btn.disabled = false; btn.innerHTML = '✨ Сгенерировать пост';
}

function copyPost() { navigator.clipboard.writeText(currentPost); showStatus('pubStatus', '✅ Скопировано!', 'ok'); }

async function publishVK() {
  if (!currentPost) return;
  const btn = document.getElementById('pubVkBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner">⏳</span>';
  try {
    const r = await fetch('/api/agent/publish-vk', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN }, body: JSON.stringify({ text: currentPost }) });
    const data = await r.json();
    if (data.ok) showStatus('pubStatus', '✅ Опубликовано в ВКонтакте! Пост #' + data.post_id, 'ok');
    else showStatus('pubStatus', '❌ Ошибка ВК: ' + data.error, 'err');
  } catch(e) { showStatus('pubStatus', '❌ ' + e.message, 'err'); }
  btn.disabled = false; btn.innerHTML = '🔵 В ВКонтакте';
}

// ---- ПОИСК ПЛОЩАДОК ----
async function searchPlatforms() {
  const btn = document.getElementById('searchBtn');
  const results = document.getElementById('searchResults');
  const type = document.getElementById('searchType').value;
  btn.disabled = true; btn.innerHTML = '<span class="spinner">⏳</span> Ищу...';
  results.innerHTML = '<div class="status loading">🔍 Агент ищет площадки...</div>';
  try {
    const typeDesc = { all: 'ВКонтакте группы, Telegram-каналы и литературные сайты', vk: 'группы ВКонтакте о литературе и фэнтези', tg: 'Telegram-каналы о книгах и фэнтези', sites: 'Author.Today, Проза.ру, LiveLib' };
    const text = await askAI('Найди 5 реальных площадок для продвижения книги "Тёмный Восход" (городское фэнтези, мистика, юмор). Тип: ' + typeDesc[type] + '. Для каждой: name, url, why, what. Только JSON массив: [{"name":"...","url":"...","why":"...","what":"..."}]', 1500);
    const platforms = JSON.parse(text.replace(/```json|```/g, '').trim());
    results.innerHTML = platforms.map(p => '<div class="site-card"><h4>' + p.name + '</h4><p>' + p.why + '</p><p style="color:var(--gold);font-size:11px;">📝 ' + p.what + '</p><div class="site-actions"><a href="' + p.url + '" target="_blank" class="btn btn-outline btn-sm" style="text-decoration:none;">🔗 Открыть</a></div></div>').join('');
  } catch(e) { results.innerHTML = '<div class="status err">Ошибка: ' + e.message + '</div>'; }
  btn.disabled = false; btn.innerHTML = '🔍 Найти площадки';
}

// ---- ДАННЫЕ САЙТА ----
async function loadSiteData() {
  const btn = document.getElementById('siteDataBtn');
  const result = document.getElementById('siteDataResult');
  btn.disabled = true; btn.innerHTML = '<span class="spinner">⏳</span> Загружаю...';
  try {
    const [summary, devices, chapters] = await Promise.all([
      fetch('/api/admin/analytics/summary', { headers: { 'x-admin-token': ADMIN_TOKEN } }).then(r => r.json()),
      fetch('/api/admin/analytics/devices', { headers: { 'x-admin-token': ADMIN_TOKEN } }).then(r => r.json()),
      fetch('/api/admin/analytics/top-chapters', { headers: { 'x-admin-token': ADMIN_TOKEN } }).then(r => r.json())
    ]);
    siteStats = { summary, devices, chapters };
    const devLabels = { mobile: '📱 Мобильные', desktop: '🖥 Десктоп', tablet: '📋 Планшет' };
    result.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;"><div style="background:var(--surface2);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:22px;color:var(--gold);font-weight:bold;">' + (summary.totalViews||0) + '</div><div style="font-size:11px;color:var(--text-dim);">просмотров</div></div><div style="background:var(--surface2);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:22px;color:var(--gold);font-weight:bold;">' + (summary.totalUsers||0) + '</div><div style="font-size:11px;color:var(--text-dim);">читателей</div></div></div>' +
      '<div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Устройства:</div>' +
      (Array.isArray(devices) ? devices.map(d => '<div style="font-size:13px;margin-bottom:4px;">' + (devLabels[d.device_type]||d.device_type) + ': <span style="color:var(--gold);">' + d.views + '</span></div>').join('') : '') +
      '<div style="font-size:12px;color:var(--text-dim);margin:10px 0 6px;">Топ глав:</div>' +
      (Array.isArray(chapters) ? chapters.slice(0,3).map(ch => '<div style="font-size:13px;margin-bottom:4px;">Гл.' + ch.chapter_number + ': <span style="color:var(--gold);">' + ch.views + '</span></div>').join('') : '');
  } catch(e) { result.innerHTML = '<div class="status err">Ошибка: ' + e.message + '</div>'; }
  btn.disabled = false; btn.innerHTML = '📊 Обновить данные';
}

async function loadVKData() {
  const btn = document.getElementById('vkDataBtn');
  const result = document.getElementById('vkDataResult');
  btn.disabled = true; btn.innerHTML = '<span class="spinner">⏳</span> Загружаю...';
  try {
    const r = await fetch('/api/agent/vk-stats', { headers: { 'x-admin-token': ADMIN_TOKEN } });
    const data = await r.json();
    vkStats = data;
    result.innerHTML = '<div style="background:var(--surface2);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:22px;color:#4c75a3;font-weight:bold;">' + (data.members||0) + '</div><div style="font-size:11px;color:var(--text-dim);">подписчиков</div></div>';
  } catch(e) { result.innerHTML = '<div class="status err">Ошибка: ' + e.message + '</div>'; }
  btn.disabled = false; btn.innerHTML = '🔵 Обновить из ВК';
}

async function analyzeAudience() {
  const btn = document.getElementById('analyzeBtn');
  const result = document.getElementById('audienceResult');
  btn.disabled = true; btn.innerHTML = '<span class="spinner">⏳</span> Анализирую...';
  result.innerHTML = '<div class="status loading">🧠 Строю портрет аудитории...</div>';
  const siteInfo = siteStats ? 'Данные сайта: просмотров ' + (siteStats.summary.totalViews||0) + ', читателей ' + (siteStats.summary.totalUsers||0) : 'Данные сайта не загружены.';
  const vkInfo = vkStats ? 'ВКонтакте: подписчиков ' + (vkStats.members||0) : 'Данные ВК не загружены.';
  try {
    const text = await askAI('Ты аналитик ЦА. Составь портрет целевой аудитории для книги "Тёмный Восход" (городское фэнтези, мистика, юмор, Булгаков+Гай Ричи).\n' + siteInfo + '\n' + vkInfo + '\nРазделы: 1) Сегменты аудитории (2-3 портрета) 2) Боли и потребности 3) Каналы потребления контента 4) Рекомендации по продвижению 5) Контент-план на неделю. Используй эмодзи.', 1500);
    result.innerHTML = bold(nl2br(text));
  } catch(e) { result.innerHTML = '<div class="status err">Ошибка: ' + e.message + '</div>'; }
  btn.disabled = false; btn.innerHTML = '🧠 Проанализировать снова';
}

// ---- РЕКЛАМА ----
async function analyzeAds() {
  const btn = document.getElementById('analyzeAdsBtn');
  const result = document.getElementById('adsResult');
  const goal = document.getElementById('adGoal').value;
  const budget = document.getElementById('adBudget').value;
  const audience = document.getElementById('adAudience').value;
  const region = document.getElementById('adRegion').value;
  const gN = { reach: 'охват', leads: 'лиды', sales: 'продажи' };
  const aN = { fantasy: 'любители фэнтези', literature: 'читатели русской литературы', humor: 'любители юмора', all: 'широкая 25-55' };
  const rN = { russia: 'вся Россия', moscow: 'Москва и МО', spb: 'СПб', cis: 'Россия и СНГ' };
  btn.disabled = true; btn.innerHTML = '<span class="spinner">⏳</span> Анализирую...';
  result.innerHTML = '<div class="status loading">📢 Подбираю каналы...</div>';
  try {
    const text = await askAI('Ты эксперт по digital-рекламе книг в России. План рекламной кампании для "Тёмный Восход" (городское фэнтези). Цель: ' + gN[goal] + ', бюджет: ' + budget + ' руб/мес, аудитория: ' + aN[audience] + ', регион: ' + rN[region] + ', сайт booklo.ru. Для каждого канала (ВКонтакте Реклама, Яндекс Директ, Telegram Ads, посевы): формат, бюджет, ожидаемый результат, текст объявления, таргетинг. Распредели бюджет. Конкретно с цифрами.', 2000);
    result.innerHTML = '<div class="card"><div class="card-title"><span>📊</span> План рекламной кампании</div><div style="font-size:14px;line-height:1.8;">' + nl2br(text) + '</div></div>';
  } catch(e) { result.innerHTML = '<div class="status err">Ошибка: ' + e.message + '</div>'; }
  btn.disabled = false; btn.innerHTML = '📢 Подобрать каналы и форматы';
}

// ---- ПОИСК СООБЩЕСТВ ВК ----
async function searchVKGroups() {
  const btn = document.getElementById('searchVKBtn');
  const result = document.getElementById('vkGroupsResult');
  const query = document.getElementById('vkGroupQuery').value;
  const keywords = query.split(',').map(k => k.trim()).filter(Boolean);
  btn.disabled = true; btn.innerHTML = '<span class="spinner">⏳</span> Ищу сообщества...';
  result.innerHTML = '<div class="status loading">🔵 Ищу сообщества ВКонтакте...</div>';
  try {
    const r = await fetch('/api/agent/vk-groups', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN }, body: JSON.stringify({ keywords }) });
    const groups = await r.json();
    if (!groups.length) { result.innerHTML = '<div class="status err">Сообщества не найдены</div>'; btn.disabled = false; btn.innerHTML = '🔵 Найти сообщества ВКонтакте'; return; }
    result.innerHTML = '<div style="margin-bottom:12px;font-size:13px;color:var(--text-dim);">Найдено ' + groups.length + ' сообществ</div>' +
      groups.map(g => {
        const m = g.members > 1000000 ? (g.members/1000000).toFixed(1)+'M' : g.members > 1000 ? Math.round(g.members/1000)+'K' : g.members;
        return '<div class="site-card" style="display:flex;align-items:center;gap:14px;"><div style="flex:1;min-width:0;"><h4>' + g.name + '</h4><div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">👥 ' + g.members.toLocaleString('ru') + ' · 🔑 ' + g.keyword + '</div><div class="site-actions"><a href="' + g.url + '" target="_blank" class="btn btn-vk btn-sm" style="text-decoration:none;">🔵 Открыть</a></div></div><div style="text-align:center;flex-shrink:0;"><div style="font-size:18px;font-weight:bold;color:var(--gold);">' + m + '</div><div style="font-size:10px;color:var(--text-dim);">подписч.</div></div></div>';
      }).join('');
  } catch(e) { result.innerHTML = '<div class="status err">Ошибка: ' + e.message + '</div>'; }
  btn.disabled = false; btn.innerHTML = '🔵 Найти сообщества ВКонтакте';
}

// ---- VK ADS ОБЪЯВЛЕНИЯ ----
let lastVKAds = '';
async function generateVKAds() {
  const btn = document.getElementById('genAdsBtn');
  const result = document.getElementById('vkAdsResult');
  const format = document.getElementById('adFormat').value;
  const count = document.getElementById('adCount').value;
  const goal = document.getElementById('adGoal').value;
  const audience = document.getElementById('adAudience').value;
  const fN = { universal: 'универсальная запись', promo: 'рекламный пост с кнопкой', short: 'короткое объявление' };
  const gN = { reach: 'охват', leads: 'подписки', sales: 'переходы на сайт' };
  const aN = { fantasy: 'любители фэнтези', literature: 'читатели русской литературы', humor: 'любители юмора', all: 'широкая 25-55' };
  btn.disabled = true; btn.innerHTML = '<span class="spinner">⏳</span> Создаю...';
  result.innerHTML = '<div class="status loading">📣 Готовлю креативы...</div>';
  try {
    const text = await askAI('Создай ' + count + ' вариантов рекламного объявления для VK Ads (формат: ' + fN[format] + '). Книга "Тёмный Восход" Азата Туктарова — городское фэнтези, вампир Клычков, кот Мотолыжников. Стиль Булгаков+Гай Ричи. Сайт booklo.ru. Цель: ' + gN[goal] + ', аудитория: ' + aN[audience] + '. Для каждого: ЗАГОЛОВОК (до 40 знаков), ТЕКСТ (до 220 знаков), КНОПКА, ТАРГЕТИНГ (пол, возраст, интересы). Раздели чертой.', 2000);
    lastVKAds = text;
    result.innerHTML = '<div class="post-output" style="margin-top:0;">' + nl2br(text) + '</div><div style="margin-top:12px;"><button class="btn btn-outline btn-sm" onclick="copyVKAds()">📋 Скопировать</button></div>';
  } catch(e) { result.innerHTML = '<div class="status err">Ошибка: ' + e.message + '</div>'; }
  btn.disabled = false; btn.innerHTML = '📣 Создать объявления для VK Ads';
}
function copyVKAds() { navigator.clipboard.writeText(lastVKAds); alert('Скопировано!'); }

function showStatus(id, msg, type) {
  const el = document.getElementById(id);
  el.className = 'status ' + type; el.textContent = msg; el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}
