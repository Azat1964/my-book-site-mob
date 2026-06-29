document.addEventListener('DOMContentLoaded', () => {
  const showModalButton = document.querySelector('.reg');
  const modal = document.getElementById('registrationModal');
  const closeModalButton = document.getElementById('closeModal');
  const form = document.getElementById('registrationForm');
  const messageDiv = document.getElementById('message');

  // Открытие модального окна
  showModalButton.addEventListener('click', () => {
    modal.style.display = 'flex'; // Показываем модальное окно
  });

  // Закрытие модального окна
  closeModalButton.addEventListener('click', () => {
    modal.style.display = 'none'; // Скрываем модальное окно
  });

  // Закрытие модального окна при клике вне его содержимого
  window.addEventListener('click', (event) => {
    if (event.target === modal) {
      modal.style.display = 'none';
    }
  });

  // Обработка отправки формы
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); // Останавливаем стандартное поведение отправки формы

    // Получаем значения полей
    const username = document.getElementById('username').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();

    try {
      // Отправляем данные на сервер
      const response = await fetch('http://localhost:3000/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, email, password}), // Преобразуем данные в JSON
      });

      // Обрабатываем ответ сервера
      const result = await response.json();
      console.log('JSON-ответ:', result); // Здесь вы увидите JSON
      // Обработайте JSON-ответ (например, сохраните userId и email)

      if (response.ok) {
        const userId = result.userId;// Сохраняем userId
        console.log('userId:', userId); // Выводим userId в консоль
        // Здесь вы можете сохранить userId в localStorage, sessionStorage,
        // в переменной или передать в другой компонент вашего приложения.
        // Например:
        localStorage.setItem('userId', userId);
        
        messageDiv.textContent = result.message;
        messageDiv.style.color = 'green';
        form.reset(); // Очищаем форму
      } else {
        messageDiv.textContent = result.message; // Выводим сообщение об ошибке
        messageDiv.style.color = 'red';
      }
    } catch (error) {
      console.error('Ошибка:', error);
      messageDiv.textContent = 'Ошибка подключения к серверу';
      messageDiv.style.color = 'red';
    }
  });
});
