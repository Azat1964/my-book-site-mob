// Ограничение неудачных попыток входа с одного IP-адреса (защита от подбора паролей).
// Хранится в памяти процесса: при перезапуске сервера счётчики обнуляются, это нормально.
//
// Считаются только НЕУДАЧНЫЕ попытки. Удачный вход счётчик сбрасывает, поэтому
// обычный читатель, который просто ошибся в пароле пару раз, ничего не замечает.

const { trustedIp } = require('./clientIp');

function createLoginLimiter({ max = 10, windowMs = 10 * 60 * 1000 } = {}) {
  const hits = new Map(); // ключ -> { count, first }

  // Раз в минуту выбрасываем устаревшие записи, чтобы память не росла.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.first > windowMs) hits.delete(k);
  }, 60 * 1000);
  sweep.unref(); // не мешает процессу завершиться

  const ip = trustedIp; // адрес посетителя: см. lib/clientIp.js

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
