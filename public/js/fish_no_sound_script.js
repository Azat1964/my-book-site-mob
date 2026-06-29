// http://stackoverflow.com/a/23371115/604040
$(document).ready(function() {
  // Делегирование событий (через $(document).on, а не $('.page').click) — это критично,
  // потому что страницы теперь создаются ПОСЛЕ загрузки текста с сервера (асинхронно),
  // то есть в момент готовности документа их может ещё не существовать.
  // Делегирование работает для любых страниц, появившихся позже — и при первой загрузке,
  // и после пересчёта при изменении размера окна.
  $(document).on('click', '.page', function() {
    $('#bookmarker').removeClass('active'); // Скрываем закладку
    $(this).removeClass('no-anim').toggleClass('flipped');
    reorder();
    notifyCurrentSpreadChanged();
  });

  $(document).on('click', '.page > div', function(e) {
    e.stopPropagation();
  });

  function reorder(){
    $(".book").each(function(){
      var pages=$(this).find(".page");
      var pages_flipped=$(this).find(".flipped");
      pages.each(function(i){
          $(this).css("z-index",pages.length-i);
      })
      pages_flipped.each(function(i){
          $(this).css("z-index",i+1);
      })
    });
  }

  // Какая страница (1-based) сейчас "наверху" — определяется количеством
  // уже перевёрнутых страниц. Используется кнопкой "Сохранить закладку" в book.html.
  function getCurrentPageIndex() {
    return $('.page.flipped').length + 1;
  }

  function notifyCurrentSpreadChanged() {
    const pageIndex = getCurrentPageIndex();
    const pageEl = document.querySelector(`.page[data-page="${pageIndex}"]`);
    const startWord = pageEl ? parseInt(pageEl.dataset.startWord || '0', 10) : 0;
    document.dispatchEvent(new CustomEvent('currentSpreadChanged', { detail: { pageIndex, startWord } }));
  }

  // Мгновенный переход на страницу targetIndex (1-based) БЕЗ анимации —
  // используется при открытии главы по ссылке с сохранённой закладкой (?word=...).
  // Помечает все страницы ДО targetIndex как "перевёрнутые", чтобы targetIndex
  // оказалась наверху.
  window.jumpToPageIndex = function(targetIndex) {
    $('.page').each(function() {
      const pageNum = parseInt($(this).data('page'), 10);
      if (pageNum < targetIndex) {
        $(this).addClass('flipped');
      } else {
        $(this).removeClass('flipped');
      }
    });
    reorder();
    notifyCurrentSpreadChanged();
  };

  window.getCurrentSpreadInfo = function() {
    const pageIndex = getCurrentPageIndex();
    const pageEl = document.querySelector(`.page[data-page="${pageIndex}"]`);
    const startWord = pageEl ? parseInt(pageEl.dataset.startWord || '0', 10) : 0;
    return { pageIndex, startWord };
  };

  // Пересчитываем порядок страниц КАЖДЫЙ РАЗ, когда они созданы или пересозданы —
  // событие 'pagesRendered' отправляется из fish_no_sound.js
  document.addEventListener('pagesRendered', reorder);

  reorder(); // на случай, если страницы уже были в DOM на момент готовности документа
});
