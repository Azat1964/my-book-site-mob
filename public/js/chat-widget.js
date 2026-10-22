/*!
 * Болталка booklo.ru: плавающий чат. Подключение на странице, перед </body>:
 *   <script src="/js/chat-widget.js" defer></script>
 * Работает с маршрутами /api/chat и /api/chat/config того же сайта.
 */
(function () {
  "use strict";
  if (window.__bookloChat) return;
  window.__bookloChat = true;

  var script = document.currentScript;
  var API = ((script && script.getAttribute("data-api")) || "").replace(/\/$/, "");
  var KEY = "booklo_chat_v1";
  var history = [];
  try { history = JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch (e) {}

  var css = [
    ".bk{--bg:#14111a;--surface:#1a1625;--surface2:#262136;--gold:#c9a227;--text:#e8e0f0;--dim:#9a8fae;--line:rgba(201,162,39,.28);font-family:Georgia,'Times New Roman',serif;position:fixed;right:20px;bottom:20px;z-index:2147483000;font-size:16px;line-height:1.5;color:var(--text)}",
    ".bk *{box-sizing:border-box}",
    ".bk-fab{display:flex;align-items:center;gap:9px;border:0;border-radius:999px;background:var(--gold);color:#14111a;padding:13px 20px 13px 16px;font:inherit;font-weight:700;cursor:pointer;box-shadow:0 8px 26px rgba(0,0,0,.5);transition:transform .15s}",
    ".bk-fab:hover{transform:translateY(-2px)}",
    ".bk-fab svg{width:22px;height:22px;flex:none}",
    ".bk-panel{position:absolute;right:0;bottom:62px;width:380px;max-width:calc(100vw - 24px);height:560px;max-height:calc(100vh - 110px);background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.6);display:none;flex-direction:column;overflow:hidden}",
    ".bk-open .bk-panel{display:flex}",
    ".bk-open .bk-fab{display:none}",
    ".bk-head{background:var(--bg);border-bottom:1px solid var(--line);padding:13px 12px 13px 18px;display:flex;align-items:center;gap:6px}",
    ".bk-head div{flex:1;min-width:0}",
    ".bk-head b{display:block;font-size:17px;color:var(--gold)}",
    ".bk-head small{display:block;color:var(--dim);font-size:12px;line-height:1.3;font-family:system-ui,sans-serif}",
    ".bk-ib{background:none;border:0;color:var(--dim);cursor:pointer;width:34px;height:34px;border-radius:8px;font-size:20px;line-height:1}",
    ".bk-ib:hover{background:rgba(255,255,255,.08);color:var(--text)}",
    ".bk-log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:9px;scrollbar-color:#3a3350 transparent}",
    ".bk-m{max-width:88%;padding:10px 14px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere}",
    ".bk-bot{background:var(--surface2);align-self:flex-start;border-bottom-left-radius:4px}",
    ".bk-me{background:var(--gold);color:#14111a;align-self:flex-end;border-bottom-right-radius:4px}",
    ".bk-m a{color:inherit;text-decoration:underline;text-underline-offset:2px}",
    ".bk-bot a{color:var(--gold)}",
    ".bk-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px;font-family:system-ui,sans-serif}",
    ".bk-chip{border:1px solid var(--gold);color:var(--gold);background:transparent;border-radius:999px;padding:7px 12px;font:inherit;font-size:13.5px;cursor:pointer}",
    ".bk-chip:hover{background:var(--gold);color:#14111a}",
    ".bk-form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line);background:var(--bg)}",
    ".bk-in{flex:1;min-width:0;border:1px solid #3a3350;border-radius:10px;padding:10px 12px;font:inherit;color:var(--text);background:var(--surface);outline:none}",
    ".bk-in::placeholder{color:var(--dim)}",
    ".bk-in:focus{border-color:var(--gold)}",
    ".bk-send{border:0;background:var(--gold);color:#14111a;border-radius:10px;padding:0 16px;cursor:pointer;font:inherit;font-weight:700}",
    ".bk-send:disabled{opacity:.5;cursor:default}",
    ".bk-dots span{display:inline-block;width:6px;height:6px;margin:0 2px;border-radius:50%;background:var(--dim);animation:bkd 1s infinite}",
    ".bk-dots span:nth-child(2){animation-delay:.15s}.bk-dots span:nth-child(3){animation-delay:.3s}",
    "@keyframes bkd{0%,80%,100%{opacity:.3}40%{opacity:1}}",
    ".bk :focus-visible{outline:3px solid #f0b34a;outline-offset:2px}",
    "@media(max-width:480px){.bk{right:12px;bottom:12px}.bk-fab span{display:none}.bk-fab{padding:14px}.bk-panel{height:calc(100vh - 90px)}}",
    "@media(prefers-reduced-motion:reduce){.bk-fab{transition:none}.bk-dots span{animation:none}}"
  ].join("");
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Текст ответа выводим только через textContent; адреса http(s) превращаем в ссылки.
  function fill(node, text) {
    var re = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?»"'])/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) node.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = el("a", null, m[1]);
      a.href = m[1]; a.target = "_blank"; a.rel = "noopener noreferrer";
      node.appendChild(a);
      last = m.index + m[1].length;
    }
    if (last < text.length) node.appendChild(document.createTextNode(text.slice(last)));
  }

  var root = el("div", "bk");
  var fab = el("button", "bk-fab");
  fab.type = "button";
  fab.setAttribute("aria-label", "Открыть чат с Болталкой");
  fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  fab.appendChild(el("span", null, "Поболтать"));

  var panel = el("div", "bk-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Чат с Болталкой");
  var head = el("div", "bk-head");
  var titleBox = el("div");
  var title = el("b", null, "Болталка");
  var sub = el("small", null, "ИИ-собеседник сайта");
  titleBox.appendChild(title); titleBox.appendChild(sub);
  var resetBtn = el("button", "bk-ib", "↺");
  resetBtn.type = "button"; resetBtn.title = "Начать заново"; resetBtn.setAttribute("aria-label", "Начать разговор заново");
  var closeBtn = el("button", "bk-ib", "×");
  closeBtn.type = "button"; closeBtn.setAttribute("aria-label", "Закрыть чат");
  head.appendChild(titleBox); head.appendChild(resetBtn); head.appendChild(closeBtn);

  var log = el("div", "bk-log");
  log.setAttribute("aria-live", "polite");
  var form = el("form", "bk-form");
  var input = el("input", "bk-in");
  input.placeholder = "Напишите что-нибудь…";
  input.maxLength = 1000;
  input.setAttribute("aria-label", "Ваше сообщение");
  var send = el("button", "bk-send", "Отправить");
  send.type = "submit";
  form.appendChild(input); form.appendChild(send);
  panel.appendChild(head); panel.appendChild(log); panel.appendChild(form);
  root.appendChild(panel); root.appendChild(fab);
  document.body.appendChild(root);

  var cfg = { greeting: "Привет! Давайте поговорим об авторе, книгах и стихах.", starters: [] };
  var busy = false;

  function scroll() { log.scrollTop = log.scrollHeight; }
  function add(role, text) {
    var m = el("div", "bk-m " + (role === "user" ? "bk-me" : "bk-bot"));
    fill(m, text);
    log.appendChild(m); scroll();
    return m;
  }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(history.slice(-20))); } catch (e) {} }

  function ask(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    var chips = log.querySelector(".bk-chips");
    if (chips) chips.remove();
    add("user", text);
    history.push({ role: "user", content: text });
    busy = true; send.disabled = true;
    var typing = el("div", "bk-m bk-bot bk-dots");
    typing.innerHTML = "<span></span><span></span><span></span>";
    log.appendChild(typing); scroll();

    fetch(API + "/api/chat", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.slice(-14) })
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || "Ошибка"); }, function () { throw new Error("Ошибка связи"); });
        return r.json();
      })
      .then(function (j) {
        typing.remove();
        add("bot", j.reply);
        history.push({ role: "assistant", content: j.reply });
        save();
      })
      .catch(function (e) {
        typing.remove();
        history.pop();
        add("bot", typeof e.message === "string" && e.message ? e.message : "Не получилось ответить. Попробуйте ещё раз.");
      })
      .then(function () { busy = false; send.disabled = false; input.focus(); });
  }

  function showStarters() {
    if (!cfg.starters || !cfg.starters.length) return;
    var box = el("div", "bk-chips");
    cfg.starters.forEach(function (s) {
      var b = el("button", "bk-chip", s);
      b.type = "button";
      b.onclick = function () { ask(s); };
      box.appendChild(b);
    });
    log.appendChild(box); scroll();
  }

  function start() {
    log.textContent = "";
    if (history.length) {
      history.forEach(function (m) { add(m.role === "user" ? "user" : "bot", m.content); });
      return;
    }
    add("bot", cfg.greeting);
    showStarters();
  }

  resetBtn.onclick = function () { history = []; save(); start(); input.focus(); };

  var opened = false;
  function toggle(open) {
    var on = open != null ? open : !root.classList.contains("bk-open");
    root.classList.toggle("bk-open", on);
    if (on && !opened) {
      opened = true;
      fetch(API + "/api/chat/config").then(function (r) { return r.json(); }).then(function (c) {
        cfg = c;
        if (c.bot_name) title.textContent = c.bot_name;
        if (c.disclaimer) sub.textContent = c.disclaimer;
      }).catch(function () {}).then(start);
    }
    if (on) setTimeout(function () { input.focus(); }, 50);
    else fab.focus();
  }
  fab.onclick = function () { toggle(true); };
  closeBtn.onclick = function () { toggle(false); };
  root.addEventListener("keydown", function (e) { if (e.key === "Escape") toggle(false); });
  form.onsubmit = function (e) { e.preventDefault(); var v = input.value; input.value = ""; ask(v); };
})();
