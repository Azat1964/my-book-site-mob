/*JS way for setting height: 100vh to slides' height*/
/*const $slides = $(".owl-carousel .owl-slide");
$slides.css("height", $(window).height());
$(window).resize(() => {
  $slides.css("height", $(window).height());
});*/

$(".owl-carousel").on("initialized.owl.carousel", () => {
  setTimeout(() => {
    $(".owl-item.active .owl-slide-animated").addClass("is-transitioned");
    $("section").show();
  }, 200);
});

const $owlCarousel = $(".owl-carousel").owlCarousel({
  items: 1,
  loop: true,
  nav: false,
  navText: [
  '<svg width="50" height="50" viewBox="0 0 24 24"><path d="M16.67 0l2.83 2.829-9.339 9.175 9.339 9.167-2.83 2.829-12.17-11.996z"/></svg>',
  '<svg width="50" height="50" viewBox="0 0 24 24"><path d="M5 3l3.057-3 11.943 12-11.943 12-3.057-3 9-9z"/></svg>' /* icons from https://iconmonstr.com */] });



$owlCarousel.on("changed.owl.carousel", e => {
  $(".owl-slide-animated").removeClass("is-transitioned");

  const $currentOwlItem = $(".owl-item").eq(e.item.index);
  $currentOwlItem.find(".owl-slide-animated").addClass("is-transitioned");

  const $target = $currentOwlItem.find(".owl-slide-text");
  doDotsCalculations($target);
});

$owlCarousel.on("resize.owl.carousel", () => {
  setTimeout(() => {
    setOwlDotsPosition();
  }, 50);
});

/*if there isn't content underneath the carousel*/
//$owlCarousel.trigger("refresh.owl.carousel");

setOwlDotsPosition();

function setOwlDotsPosition() {
  const $target = $(".owl-item.active .owl-slide-text");
  doDotsCalculations($target);
}

function doDotsCalculations(el) {
  const height = el.height();
  const { top, left } = el.position();

  // Получаем родительский элемент
  const parentHeight = el.parent().height();
  const parentWidth = el.parent().width();

  // Проверяем, что родительские размеры корректны
  if (parentHeight === 0 || parentWidth === 0) {
    console.warn('Невозможно вычислить позиции, так как родительский элемент имеет нулевую высоту или ширину');
    return;
  }

  // Вычисляем `res` как процент от высоты родителя
  let resPercentage = ((height + top) / parentHeight) * 100;
  let leftPercentage = ((left + 300) / parentWidth) * 100;

  // Ограничиваем значения, чтобы не выходили за допустимые пределы
  if (resPercentage > 100) resPercentage = 82; // Зафиксируем на 62%, если больше 100%
  if (resPercentage < 0) resPercentage = 0; // Минимум 0%, если меньше

  // Аналогично для left
  if (leftPercentage > 100) leftPercentage = 80;
  if (leftPercentage < 0) leftPercentage = 0;

  // Устанавливаем значения в CSS
  /*$(".owl-carousel .owl-dots").css({
    top: `${resPercentage}%`, // Используем процентное значение для top
    left: `${leftPercentage}%` // Используем процентное значение для left
  });*/
}
