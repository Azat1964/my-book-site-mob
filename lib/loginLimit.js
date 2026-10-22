// Ограничение неудачных попыток входа с одного IP-адреса (защита от подбора паролей).
// Хранится в памяти процесса: при перезапуске сервера счётчики обнуляются, это нормально.
//
// Считаются только НЕУДАЧНЫЕ попытки. Удачный вход счётчик сбрасывает, поэтому
// обычный читатель, который просто ошибся в пароле пару раз, ничего не замечает.

function createLoginLimiter({ max = 10, windowMs = 10 * 60 * 1000 } = {}) {
  const hits = new Map(); // ключ -> { count, first }

  // Раз в минуту выбрасываем устаревшие записи, чтобы память не росла.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.first > windowMs) hits.delete(k);
  }, 60 * 1000);
  sweep.unref(); // не мешает процессу завершиться

  // Адрес посетителя. Заголовку X-Forwarded-For верим ТОЛЬКО если запрос пришёл
  // с этой же машины или из локальной сети (то есть от вашего nginx), и берём
  // из него ПОСЛЕДНИЙ адрес: его дописал наш nginx. Первый адрес в цепочке может
  // подделать сам бот, чтобы обойти лимит.
  const LOCAL = /^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:(127|10|192\.168)\.)/;
  function ip(req) {
    const remote = req.socket?.remoteAddress || 'unknown';
    if (LOCAL.test(remote)) {
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return remote;
  }

  // Сколько секунд ещё ждать (0 — можно пробовать).
  function wait(key) {
    const v = hits.get(key);
    if (!v) return 0;
    const left = v.first + windowMs - Date.now();
    if (left <= 0) { hits.delete(key); return 0; }
    return v.count >= max ? Math.ceil(left / 1000) : 0;
  }

  function fail(key) {
    const now = Date.now();
    const v = hits.get(key);
    if (!v || now - v.first > windowMs) hits.set(key, { count: 1, first: now });
    else v.count += 1;
  }

  function ok(key) { hits.delete(key); }

  return { ip, wait, fail, ok, _hits: hits };
}

module.exports = { createLoginLimiter };
