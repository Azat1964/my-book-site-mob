// Помощник для подготовки toc.txt (см. import-book.js, режим --toc).
//
// Читает .docx файл романа, находит все строки вида "Глава 1. Название",
// "Глава 12. Другое название" и т.п., и сохраняет их как черновик toc.txt.
//
// ⚠️ Это ЧЕРНОВИК — обязательно откройте получившийся файл и проверьте,
// что все главы найдены и ничего лишнего не попало (иногда в тексте
// встречаются случайные совпадения, например в диалогах персонажей).
//
// ИСПОЛЬЗОВАНИЕ:
//   node extract-toc.js <путь-к-роману.docx> [путь-для-сохранения.txt]
//
// ПРИМЕР:
//   node extract-toc.js ./romans/temny-voskhod.docx ./romans/toc.txt

const fs = require('fs');
const mammoth = require('mammoth');

async function main() {
  const docxPath = process.argv[2];
  const outPath = process.argv[3] || './toc-draft.txt';

  if (!docxPath) {
    console.log('Использование: node extract-toc.js <путь-к-роману.docx> [путь-для-сохранения.txt]');
    process.exit(1);
  }
  if (!fs.existsSync(docxPath)) {
    console.error(`Файл не найден: ${docxPath}`);
    process.exit(1);
  }

  const result = await mammoth.extractRawText({ path: docxPath });
  const lines = result.value.split('\n');

  // Ищем строки вида "Глава 1. Название", "ГЛАВА 12 Название", "Глава 3:Название"
  const headingRegex = /^\s*глава\s+\d+[\.\:\)]?\s*.*\S.*$/i;

  const found = lines
    .map(l => l.trim())
    .filter(l => l.length > 0 && l.length < 120 && headingRegex.test(l));

  if (found.length === 0) {
    console.error('\n❌ Не найдено ни одной строки вида "Глава N. Название".');
    console.error('Откройте файл и проверьте, как именно у вас написаны заголовки —');
    console.error('возможно, формат отличается (например, без точки после номера).\n');
    process.exit(1);
  }

  fs.writeFileSync(outPath, found.join('\n') + '\n', 'utf-8');

  console.log(`\n✅ Найдено заголовков: ${found.length}`);
  console.log(`Черновик сохранён в: ${outPath}\n`);
  found.forEach((h, i) => console.log(`  ${i + 1}. ${h}`));
  console.log(`\n⚠️  Откройте ${outPath} и проверьте список перед использованием в import-book.js!`);
  console.log(`Если всё верно:`);
  console.log(`  node import-book.js <slug> --file ${docxPath} --toc ${outPath} --preview\n`);
}

main();
