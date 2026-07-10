function scrollToSection(event, sectionId) {
  event.preventDefault();

  const headerHeight = document.querySelector('.header.scrolled').offsetHeight; // Высота заголовка
  const targetSection = document.getElementById(sectionId); // Находим нужный раздел

  if (targetSection) { // Проверяем, что целевой раздел существует
    const offsetPosition = targetSection.offsetTop - headerHeight - 10; // Сдвиг с учетом заголовка и отступа
    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth'
    });
  } else {
    console.warn(`Раздел с id="${sectionId}" не найден.`);
  }
}
// Убедитесь, что функция привязывается к событию после полной загрузки страницы
document.addEventListener("DOMContentLoaded", function() {
  const links = document.querySelectorAll("a[href^='#']");
  links.forEach(link => {
    link.addEventListener("click", (event) => {
      const sectionId = link.getAttribute("href").substring(1);
      scrollToSection(event, sectionId);
    });
  });
});
