// Общая логика разбивки текста романа на главы.
// Используется и в import-book.js (командная строка), и в server.js (загрузка через admin.html).

// Словесные обозначения номеров глав (женский род — "глава ПЕРВАЯ")
const RU_ORDINALS = [
  'нулевая', 'первая', 'вторая', 'третья', 'четвёртая', 'четвертая', 'пятая',
  'шестая', 'седьмая', 'восьмая', 'девятая', 'десятая', 'одиннадцатая',
  'двенадцатая', 'тринадцатая', 'четырнадцатая', 'пятнадцатая', 'шестнадцатая',
  'семнадцатая', 'восемнадцатая', 'девятнадцатая', 'двадцатая', 'двадцать первая',
  'двадцать вторая', 'двадцать третья', 'двадцать четвёртая', 'двадцать пятая',
  'двадцать шестая', 'двадцать седьмая', 'двадцать восьмая', 'двадцать девятая', 'тридцатая'
];

function romanToInt(roman) {
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let result = 0;
  for (let i = 0; i < roman.length; i++) {
    const cur = map[roman[i]];
    const next = map[roman[i + 1]];
    if (next && cur < next) { result -= cur; } else { result += cur; }
  }
  return result;
}

function wordsToChapterNumber(word) {
  const idx = RU_ORDINALS.indexOf(word.toLowerCase());
  return idx >= 0 ? idx : null;
}

// Пытается найти номер главы в строке-заголовке. Возвращает {number, title} или null.
function parseChapterHeading(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 100) return null;

  let m = trimmed.match(/^(?:глава|часть|chapter)\s+(\d+)\.?\s*(.*)$/i);
  if (m) return { number: parseInt(m[1], 10), title: m[2].trim() || null };

  m = trimmed.match(/^(?:глава|часть)\s+([а-яё ]+?)\.?\s*$/i);
  if (m) {
    const num = wordsToChapterNumber(m[1].trim());
    if (num !== null) return { number: num, title: null };
  }

  m = trimmed.match(/^(?:глава|часть|chapter)\s+([IVXLCDM]+)\.?\s*(.*)$/i);
  if (m) return { number: romanToInt(m[1].toUpperCase()), title: m[2].trim() || null };

  return null;
}

// Авто-разбивка: ищет заголовки вида "Глава N", "Глава первая" и т.п. прямо в тексте.
// Возвращает [{number, title, content}] или [] если ничего не найдено.
function splitByAutoHeadings(fullText) {
  const lines = fullText.split('\n');
  const chapters = [];
  let current = null;

  for (const line of lines) {
    const heading = parseChapterHeading(line);
    if (heading) {
      if (current) chapters.push(current);
      current = { number: heading.number, title: heading.title, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) chapters.push(current);

  return chapters.map(ch => ({
    number: ch.number,
    title: ch.title,
    content: ch.lines.join('\n').trim()
  })).filter(ch => ch.content);
}

function parseTocLine(line, index) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const m = trimmed.match(/^(?:глава\s+)?(\d+)[\.\)]?\s*(.*)$/i);
  if (m && m[2]) {
    return { number: parseInt(m[1], 10), heading: trimmed, title: m[2].trim() };
  }
  return { number: index + 1, heading: trimmed, title: trimmed };
}

// Разбивка по явному списку заголовков (самый надёжный способ).
// tocText — список заголовков глав, по одному на строку, точно как в тексте романа.
// Бросает Error с понятным сообщением, если какой-то заголовок не найден.
function splitByToc(fullText, tocText) {
  const tocLines = tocText.split('\n');
  const toc = tocLines.map(parseTocLine).filter(Boolean);

  if (toc.length === 0) {
    throw new Error('Файл содержания пуст.');
  }

  const chapters = [];
  let searchFrom = 0;

  for (let i = 0; i < toc.length; i++) {
    const { number, heading, title } = toc[i];
    const idx = fullText.indexOf(heading, searchFrom);

    if (idx === -1) {
      throw new Error(`Заголовок не найден в тексте романа: "${heading}". Проверьте точное совпадение текста (опечатки, лишние пробелы).`);
    }

    const contentStart = idx + heading.length;
    chapters.push({ number, title, contentStart });
    searchFrom = contentStart;
  }

  for (let i = 0; i < chapters.length; i++) {
    const start = chapters[i].contentStart;
    const end = i + 1 < chapters.length
      ? fullText.indexOf(toc[i + 1].heading, start)
      : fullText.length;
    chapters[i].content = fullText.slice(start, end).trim();
  }

  return chapters.map(({ number, title, content }) => ({ number, title, content }))
    .filter(ch => ch.content);
}

module.exports = {
  parseChapterHeading,
  splitByAutoHeadings,
  parseTocLine,
  splitByToc,
};
