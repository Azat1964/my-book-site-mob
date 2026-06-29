// Инициализация карусели
const $owlCarousel = $(".owl-carousel").owlCarousel({
  items: 1,
  loop: true,
  nav: false, // Стрелки скрыты по умолчанию
  dots: true, // Точки отображены по умолчанию
  navText: [
    '<svg width="50" height="50" viewBox="0 0 24 24"><path d="M16.67 0l2.83 2.829-9.339 9.175 9.339 9.167-2.83 2.829-12.17-11.996z"/></svg>',
    '<svg width="50" height="50" viewBox="0 0 24 24"><path d="M5 3l3.057-3 11.943 12-11.943 12-3.057-3 9-9z"/></svg>'
  ]
});

// Анимация для активного слайда при инициализации
$(".owl-carousel").on("initialized.owl.carousel", () => {
  setTimeout(() => {
    $(".owl-item.active .owl-slide-animated").addClass("is-transitioned");
    $("section").show();
  }, 200);
});

// Анимация при смене слайда
$owlCarousel.on("changed.owl.carousel", e => {
  $(".owl-slide-animated").removeClass("is-transitioned");

  const $currentOwlItem = $(".owl-item").eq(e.item.index);
  $currentOwlItem.find(".owl-slide-animated").addClass("is-transitioned");

  const $target = $currentOwlItem.find(".owl-slide-text");
  doDotsCalculations($target);
});

// Функция для обновления состояния точек и стрелок в зависимости от размера экрана
function updateCarousel() {
  const windowWidth = $(window).width();

  if (windowWidth >= 320 && windowWidth <= 991) {
    // Если ширина экрана от 768px до 991px — скрыть точки, показать стрелки
    $owlCarousel.trigger('destroy.owl.carousel'); // Уничтожаем текущий инстанс
    $owlCarousel.owlCarousel({
      items: 1,
      loop: true,
      nav: true, // Показываем стрелки
      dots: false, // Скрываем точки
      navText: [
        '<svg width="50" height="50" viewBox="0 0 24 24"><path d="M16.67 0l2.83 2.829-9.339 9.175 9.339 9.167-2.83 2.829-12.17-11.996z"/></svg>',
        '<svg width="50" height="50" viewBox="0 0 24 24"><path d="M5 3l3.057-3 11.943 12-11.943 12-3.057-3 9-9z"/></svg>'
      ]
    });
  } else {
    // Для других размеров экрана
    $owlCarousel.trigger('destroy.owl.carousel'); // Уничтожаем текущий инстанс
    $owlCarousel.owlCarousel({
      items: 1,
      loop: true,
      nav: false, // Скрываем стрелки
      dots: true // Показываем точки
    });
  }
}

// Вызов при загрузке страницы и изменении размера окна
$(document).ready(updateCarousel);
$(window).resize(updateCarousel);

// Функция для вычисления положения точек
$owlCarousel.on("resize.owl.carousel", () => {
  setTimeout(() => {
    setOwlDotsPosition();
  }, 50);
});

// Вычисление и позиционирование точек
function setOwlDotsPosition() {
  const $target = $(".owl-item.active .owl-slide-text");
  doDotsCalculations($target);
}

function doDotsCalculations(el) {
  $(".owl-carousel .owl-dots").css({
    top: `62%`,   // Фиксированная высота
    left: `0%`   // Центрирование по горизонтали
    //top: `${resPercentage}%`,
    //left: `${leftPercentage}%`
  });


}
