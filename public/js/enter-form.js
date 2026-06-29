$(document).ready(function () {// Обработка формы входа
  $('.reg').click(function () {
    const $messageDiv = $('#mess'); // Ссылка на div для сообщения
    // Очистка предыдущих сообщений
    $messageDiv.text('');
    // Очищаем поля формы
    $('#loginUsername').val('');
    $('#loginPassword').val('');
  });

  $('#loginForm').on('submit', function (event) {
    event.preventDefault();// Предотвращаем стандартную отправку формы

    const username = $('#loginUsername').val().trim();
    const password = $('#loginPassword').val().trim();
    const $messageDiv = $('#mess'); // Ссылка на div для сообщения

    // Очистка предыдущих сообщений
    $messageDiv.text('');

    // Проверяем, что оба поля заполнены
    if (!username || !password) {
        $messageDiv.text('Пожалуйста, заполните все поля.').css('color', 'red');
        return;
    }

    fetch('http://localhost:3000/api/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
    })
        .then(response => {
            if (!response.ok) {
                return response.json().then(error => {
                    throw new Error(error.message || 'Неверное имя пользователя или пароль.');
                });
            }
            return response.json();
        })
        .then(response => {
          // Сохраняем userId в localStorage
          if (response.userId) {
            localStorage.setItem('userId', response.userId);
          } else {
              console.error('userId не найден в ответе сервера');
          }
            $messageDiv.css('color', 'green').text('Вход выполнен успешно!');
            setTimeout(function() {
                $('#registrationModal').hide();
            }, 1000);
            activateButtons();
        })
        .catch(error => {
            const errorMessage = error.message || 'Неизвестная ошибка';
            $messageDiv.css('color', 'red').text(errorMessage);
            $('#loginUsername').val('');
            $('#loginPassword').val('');
        });
  });

  

  function activateButtons() {
    
    $(document).ready(function() {
      // Проверяем, добавлены ли уже элементы "Закладка" и "На страницу"
      if (!$('.bookmark').length && !$('.pager').length) {
        
        // Создаем элемент "Закладка"
        const bookmarkItem = $(`
          <li>
            <label for="menuCheckbox">
              <button id="show-zakladka-input" class="bookmark">Закладка</button>
            </label>
           </li>
        `);
    
        // Создаем элемент "На страницу"
        const pageItem = $(`
          <li>
            <label for="menuCheckbox">
              <div style="display: inline-block;">
                <button id="show-page-input" class="pager">На страницу</button>
                <input type="number" id="page-input" placeholder="№ стр." min="1">
              </div>
            </label>
          </li>
        `);
    
        // Вставляем элементы по отдельности
        const targetElement = $('#menu li:nth-child(3)');
        if (targetElement.length) {
          targetElement.before(bookmarkItem); // Вставляем "Закладка"
          targetElement.before(pageItem); // Вставляем "На страницу"
        } else {
          console.error('Элемент #menu li:nth-child(3) не найден');
        }
      } else {
        console.log('Элементы уже добавлены');
      }
    });
    
    // Кнопка "Закладка"
    $('#make').on('click', function (event) {
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

    // Активируем кнопку "На страницу" и input
    $('#show-page-input').prop('disabled', false).css('cursor', 'pointer');
    $('#page-input').prop('disabled', false);
    $('#show-page-input').parent('div').parent('label').removeAttr('onclick'); // Удаляем onclick с label
    $('#show-page-input').click(function(event) {
      event.preventDefault();
      const pageNumber = $('#page-input').val();
      if (pageNumber) {
        alert(`Переход на страницу № ${pageNumber}`);
        // Здесь должен быть ваш код для перехода на указанную страницу
      } else {
        alert('Введите номер страницы.');
      }
    });

    // Активируем кнопку "Комменты"
    $('#menu ul li:has(a button:contains("Комменты")) button').prop('disabled', false).css('cursor', 'pointer');
    $('#menu ul li:has(a button:contains("Комменты")) button').parent('a').parent('label').removeAttr('onclick'); // Удаляем onclick с label
    $('#menu ul li:has(a button:contains("Комменты")) button').click(function(event) {
      event.preventDefault();
      alert('Функционал "Комменты" активирован!');
      // Здесь должен быть ваш код для работы с комментариями
    });
  }
});
