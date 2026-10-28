// Адрес посетителя. Заголовку X-Forwarded-For верим ТОЛЬКО если запрос пришёл
// с этой же машины или из локальной сети (то есть от вашего nginx), и берём
// из него ПОСЛЕДНИЙ адрес: его дописал наш nginx. Первый адрес в цепочке может
// подделать сам бот, чтобы обойти лимиты.
const LOCAL = /^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:(127|10|192\.168)\.)/;

function trustedIp(req) {
  const remote = req.socket?.remoteAddress || 'unknown';
  if (LOCAL.test(remote)) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
  }
  return remote;
}

module.exports = { trustedIp };
