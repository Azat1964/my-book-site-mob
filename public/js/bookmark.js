$(document).ready(function () {// Обработчик для кнопки "Закладка"
  
  $('.bookmark').on('click', function (event) {
    console.log('Zakladka');
    event.preventDefault();//отмена действия по умолчанию
    $('#bookmarker').toggleClass('active'); // Переключаем класс active

    // Получаем сохраненный номер страницы из #bookmarker
    const pageNumber = $('#bookmarker').data('currentPageNumber');
    console.log("Номер страницы:", pageNumber);
    const userId = localStorage.getItem('userId'); // Получаем ID зарегистрированного пользователя
    console.log("Номер ID:", userId);

    if (!isNaN(pageNumber) && userId) { // Проверяем, что номер страницы задан
      fetch('http://localhost:3000/api/bookmark', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pageNumber, userId }), // Отправляем данные
      })
        .then(response => {
          if (!response.ok) {
            return response.json().then(err => {
              throw new Error(err.message || 'Не удалось сохранить закладку.');
            });
          }
          return response.json(); // Парсим успешный ответ
        })
        .then(result => {
          console.log('Закладка сохранена:', result.message);
          alert('Закладка успешно сохранена!');
        })
        .catch(error => {
          console.error('Ошибка сохранения закладки:', error.message);
          alert('Ошибка: ' + error.message);
        });
    } else {alert('Номер страницы не задан.');}
  });
})
