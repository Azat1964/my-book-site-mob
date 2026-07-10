// Получаем элемент меню
const dropdownMenu = document.querySelector('.dropdown-menu');

// Функция для закрытия меню
function closeDropdownMenu(event) {
  // Проверяем, был ли клик вне меню
  if (!dropdownMenu.contains(event.target)) {
    dropdownMenu.style.display = 'none'; // Скрываем меню
  }
}

// Добавляем обработчик события клика на весь документ
document.addEventListener('click', closeDropdownMenu);

// Добавляем обработчик события скролла
window.addEventListener('scroll', function() {
  dropdownMenu.style.display = 'none'; // Скрываем меню при скролле
});

// Если нужно, чтобы меню открывалось при клике на кнопку "гамбургер"
const hamburger = document.querySelector('.hamburger');
hamburger.addEventListener('click', function(event) {
  event.stopPropagation(); // Остановка распространения события, чтобы клик не закрывал меню
  dropdownMenu.style.display = 'block'; // Открываем меню
});
