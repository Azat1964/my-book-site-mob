document.addEventListener("DOMContentLoaded", function() {
  var parent = document.querySelector(".container_text");
  var bookInner = document.querySelector(".book-inner");

  // Реализуем логику при наведении на .book-inner
  bookInner.addEventListener('mouseover', function() {
      setTimeout(function() {
          parent.classList.add('show'); // Плавное появление
          resetAnimation();
          animateContainers();;
        }, 1000); // Таймер на 2 секунды
  });

  bookInner.addEventListener('mouseleave', function() {
      setTimeout(function() {
          parent.classList.remove('show'); // Плавное исчезновение
      }, 1000); // Ждем 1 секунду перед скрытием
  });

  // Сбрасываем анимацию
  function resetAnimation() {
    // Останавливаем все анимации GSAP
    gsap.globalTimeline.clear();

    // Сбрасываем классы и стили для всех элементов <span> и <cite>
    const containers = [containerOne, containerTwo, containerThree, containerFour];
    containers.forEach(container => {
      const words = container.querySelectorAll('span');
      const cite = container.querySelector('cite');

      words.forEach(word => {
        word.classList.remove('animate');
        gsap.set(word, {
          filter: `blur(${word.dataset.blur || 0}px)`,
          opacity: 0
        });
      });

      if (cite) {
        cite.classList.remove('animate');
        gsap.set(cite, { opacity: 0, y: 50 });
      }
    });
  }

  const containerOne = document.querySelector('.container_one');
  const containerTwo = document.querySelector('.container_two');
  const containerThree = document.querySelector('.container_three');
  const containerFour = document.querySelector('.container_four');

  // Функция для анимации текста внутри контейнеров
  function animateText(container) {
    const words = container.querySelectorAll('span');
    const cite = container.querySelector('cite');
    const tl = gsap.timeline(); // Таймлайн для последовательной анимации

    let maxDelay = 0;
    let maxDuration = 0;
    const baseDelay = 3;

    // Анимация для каждого <span> внутри контейнера
    words.forEach((word, i) => {
      const duration = parseFloat(word.dataset.duration) || 0;
      const delay = parseFloat(word.dataset.delay) || 0;
      const blur = parseFloat(word.dataset.blur) || 0;

      maxDelay = Math.max(delay, maxDelay);
      maxDuration = Math.max(duration, maxDuration);

      // Устанавливаем начальные стили
      gsap.set(word, {
        filter: `blur(${blur}px)`,
        opacity: 0 // Начальная прозрачность
      });

      // Добавляем анимацию текста в таймлайн
      tl.to(word, {
        className: "+=animate",
        duration: duration,
        delay: delay,
        ease: "power1.in",
        opacity: 1,
        filter: 'blur(0)',
        onStart: () => requestAnimationFrame(() => {})
      }, delay);
    });

    // Анимация для <cite> после текста
    if (cite) {
      const citeDuration = 1;
      const citeDelay = maxDelay + maxDuration + baseDelay;

      gsap.set(cite, { opacity: 0, y: 50 });

      // Добавляем анимацию для <cite>
      tl.to(cite, {
        className: "+=animate",
        duration: citeDuration,
        ease: "power1.inOut",
        opacity: 1,
        y: 0
      }, citeDelay);
    }

    return tl; // Возвращаем таймлайн для использования в последовательной анимации
  }

  // Основная анимация для container_one и container_two
  function animateContainers() {
    const mainTimeline = gsap.timeline();

    // Анимация для container_one
    mainTimeline.add(animateText(containerOne));

    // После завершения анимации container_one, запускаем анимацию container_two
    mainTimeline.add(animateText(containerTwo), '+=0'); // Запуск с задержкой в 1 секунду после завершения предыдущей анимации

    // После завершения анимации container_one, запускаем анимацию container_two
    mainTimeline.add(animateText(containerThree), '+=0'); // Запуск с задержкой в 1 секунду после завершения предыдущей анимации

    // После завершения анимации container_one, запускаем анимацию container_two
    mainTimeline.add(animateText(containerFour), '+=0'); // Запуск с задержкой в 1 секунду после завершения предыдущей анимации
    // Запускаем таймлайн
    mainTimeline.play();
  }

});
