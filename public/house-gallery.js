const photos = [
  { slug: 'exterior', height: 1656, alt: 'Вход в дом среди сосен', title: 'Дом среди сосен', subtitle: 'Отдельное пространство для вашей компании', size: 'feature' },
  { slug: 'music-screen', height: 1652, alt: 'Музыкальная система, большой экран и камин', title: 'Когда хочется погромче', subtitle: 'Музыка, большой экран и пространство для вечера', size: 'feature' },
  { slug: 'karaoke', height: 1659, alt: 'Два микрофона для караоке', title: 'Караоке? Конечно.', size: 'detail' },
  { slug: 'fireplace-screen', height: 1657, alt: 'Камин и большой экран в гостиной', title: 'А потом — потише', subtitle: 'Камин и большой экран для спокойного вечера', size: 'detail' },
  { slug: 'kitchen', height: 1645, alt: 'Общий план кухни с рабочей поверхностью и техникой', title: 'Всё необходимое — на месте', size: 'detail' },
  { slug: 'lounge', height: 1700, alt: 'Зона отдыха с диваном', title: 'Место найдётся всем', size: 'detail' },
  { slug: 'stairs', height: 1653, alt: 'Лестница и интерьер второго этажа', title: 'Лестница и интерьер', size: 'transition' },
  { slug: 'bedroom-one', height: 1649, alt: 'Спальня с широкой кроватью и мягким изголовьем', title: 'Спальня 1', size: 'bedroom' },
  { slug: 'bedroom-two', height: 1648, alt: 'Спальня с кроватью в клетчатом покрывале', title: 'Спальня 2', size: 'bedroom' },
  { slug: 'bedroom-three', height: 1663, alt: 'Спальня под мансардным потолком', title: 'Спальня 3', size: 'bedroom' },
  { slug: 'bathroom', height: 1663, alt: 'Раковина, зеркало и отделка санузла', title: 'Всё продумано для отдыха', size: 'spa' },
  { slug: 'sauna', height: 1650, alt: 'Деревянная домашняя сауна с полками и печью', title: 'Своя сауна — прямо в доме', size: 'spa' },
  { slug: 'gazebo', height: 1663, alt: 'Беседка и мангальная зона во дворе', title: 'Вечер можно продолжить на улице', size: 'outdoor' }
];

const mobileWidth = 768;
const desktopWidth = 1280;
const imageUrl = (photo, width) => `/gallery/${photo.slug}-${width}.webp`;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function photoCard(photo, index, sizes) {
  const figure = element('figure', `house-gallery-card house-gallery-card--${photo.size}`);
  const button = element('button', 'house-gallery-photo');
  button.type = 'button';
  button.dataset.galleryIndex = String(index);
  button.setAttribute('aria-label', `Открыть фотографию: ${photo.title}`);

  const image = element('img');
  image.src = imageUrl(photo, mobileWidth);
  image.srcset = `${imageUrl(photo, mobileWidth)} ${mobileWidth}w, ${imageUrl(photo, desktopWidth)} ${desktopWidth}w`;
  image.sizes = sizes;
  image.width = desktopWidth;
  image.height = photo.height;
  image.alt = photo.alt;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.fetchPriority = 'low';
  button.append(image);

  const caption = element('figcaption', 'house-gallery-caption');
  caption.append(element('h3', '', photo.title));
  if (photo.subtitle) caption.append(element('p', '', photo.subtitle));
  figure.append(button, caption);
  return figure;
}

function section(className, heading, subtitle) {
  const wrapper = element('div', className);
  if (heading) wrapper.append(element('h3', 'house-gallery-subheading', heading));
  if (subtitle) wrapper.append(element('p', 'house-gallery-note', subtitle));
  return wrapper;
}

function buildGallery() {
  const gallery = element('section', 'house-photo-gallery');
  gallery.id = 'house-photo-gallery';
  gallery.setAttribute('aria-labelledby', 'house-photo-gallery-title');

  const header = element('header', 'house-photo-gallery-header');
  header.append(element('p', 'eyebrow', 'ИНТЕРЬЕР И ТЕРРИТОРИЯ'));
  header.append(element('h2', '', 'Фотогалерея дома'));
  gallery.append(header);

  const featureGrid = section('house-gallery-grid house-gallery-feature-grid');
  featureGrid.append(photoCard(photos[0], 0, '(max-width: 680px) 94vw, 43vw'));
  featureGrid.append(photoCard(photos[1], 1, '(max-width: 680px) 94vw, 53vw'));
  gallery.append(featureGrid);

  const detailGrid = section('house-gallery-grid house-gallery-detail-grid');
  [2, 3, 4, 5].forEach(index => detailGrid.append(photoCard(photos[index], index, '(max-width: 560px) 45vw, (max-width: 900px) 45vw, 23vw')));
  gallery.append(detailGrid);

  const transition = section('house-gallery-grid house-gallery-transition-grid');
  transition.append(photoCard(photos[6], 6, '(max-width: 680px) 94vw, 32vw'));
  const bedroomIntro = element('div', 'house-gallery-bedroom-intro');
  bedroomIntro.append(element('h3', 'house-gallery-subheading', 'Пять отдельных спален'));
  bedroomIntro.append(element('p', 'house-gallery-note', 'После длинного вечера'));
  transition.append(bedroomIntro);
  gallery.append(transition);

  const bedroomGrid = section('house-gallery-grid house-gallery-bedroom-grid');
  [7, 8, 9].forEach(index => bedroomGrid.append(photoCard(photos[index], index, '(max-width: 560px) 45vw, (max-width: 900px) 30vw, 30vw')));
  gallery.append(bedroomGrid);

  const spaGrid = section('house-gallery-grid house-gallery-spa-grid');
  spaGrid.append(photoCard(photos[10], 10, '(max-width: 680px) 94vw, 43vw'));
  spaGrid.append(photoCard(photos[11], 11, '(max-width: 680px) 94vw, 53vw'));
  gallery.append(spaGrid);

  const outdoorGrid = section('house-gallery-grid house-gallery-outdoor-grid');
  outdoorGrid.append(photoCard(photos[12], 12, '(max-width: 680px) 94vw, 66vw'));
  gallery.append(outdoorGrid);
  return gallery;
}

function buildLocationMap() {
  const address = 'Екатеринбург, СНТ УКЗ-2';
  const coordinates = '56.790236,60.768620';
  const mapCoordinates = '60.768620,56.790236';
  const section = element('section', 'house-location-map');
  section.id = 'house-location-map';
  section.setAttribute('aria-labelledby', 'house-location-map-title');

  const header = element('header', 'house-location-map-header');
  const title = element('h2', '', 'Как добраться');
  title.id = 'house-location-map-title';
  header.append(title);

  const route = element('a', 'house-location-route', 'Построить маршрут');
  route.href = `https://yandex.ru/maps/?rtext=~${coordinates}&rtt=auto`;
  route.target = '_blank';
  route.rel = 'noopener noreferrer';
  header.append(route);

  const map = element('iframe', 'house-location-map-frame');
  map.src = `https://yandex.ru/map-widget/v1/?ll=${encodeURIComponent(mapCoordinates)}&z=16&pt=${encodeURIComponent(mapCoordinates)},pm2rdm`;
  map.title = `Карта: ${address}`;
  map.loading = 'lazy';
  map.referrerPolicy = 'no-referrer-when-downgrade';
  map.allowFullscreen = true;
  section.append(header, map);
  return section;
}

let lightbox;
let lightboxImage;
let lightboxTitle;
let lightboxCounter;
let activeIndex = 0;
let returnFocus = null;
let savedScrollY = 0;
let savedBodyStyle = null;
let savedHtmlOverflow = '';
let touchStart = null;
let stylesheetReady = false;

function renderLightboxPhoto() {
  const photo = photos[activeIndex];
  lightboxImage.src = imageUrl(photo, desktopWidth);
  lightboxImage.alt = photo.alt;
  lightboxImage.width = desktopWidth;
  lightboxImage.height = photo.height;
  lightboxTitle.textContent = photo.title;
  lightboxCounter.textContent = `${activeIndex + 1} / ${photos.length}`;
}

function closeLightbox() {
  if (!lightbox) return;
  document.removeEventListener('keydown', onLightboxKeydown);
  lightbox.remove();
  lightbox = null;
  document.documentElement.style.overflow = savedHtmlOverflow;
  if (savedBodyStyle === null) document.body.removeAttribute('style');
  else document.body.setAttribute('style', savedBodyStyle);
  const savedScrollBehavior = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';
  window.scrollTo(0, savedScrollY);
  document.documentElement.style.scrollBehavior = savedScrollBehavior;
  returnFocus?.focus({ preventScroll: true });
}

function moveLightbox(direction) {
  activeIndex = (activeIndex + direction + photos.length) % photos.length;
  renderLightboxPhoto();
}

function onLightboxKeydown(event) {
  if (event.key === 'Escape') closeLightbox();
  if (event.key === 'ArrowRight') moveLightbox(1);
  if (event.key === 'ArrowLeft') moveLightbox(-1);
}

function openLightbox(index, trigger) {
  if (lightbox) return;
  activeIndex = index;
  returnFocus = trigger;
  savedScrollY = window.scrollY;
  savedBodyStyle = document.body.getAttribute('style');
  savedHtmlOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.top = `-${savedScrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
  document.body.style.overflow = 'hidden';

  lightbox = element('div', 'house-gallery-lightbox');
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('aria-label', 'Фотогалерея дома');
  lightbox.tabIndex = -1;

  const toolbar = element('div', 'house-gallery-lightbox-toolbar');
  lightboxCounter = element('span', 'house-gallery-lightbox-counter');
  lightboxCounter.setAttribute('aria-live', 'polite');
  const close = element('button', 'house-gallery-lightbox-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Закрыть фотографию');
  toolbar.append(lightboxCounter, close);

  const stage = element('div', 'house-gallery-lightbox-stage');
  const previous = element('button', 'house-gallery-lightbox-nav house-gallery-lightbox-previous', '‹');
  previous.type = 'button';
  previous.setAttribute('aria-label', 'Предыдущая фотография');
  const next = element('button', 'house-gallery-lightbox-nav house-gallery-lightbox-next', '›');
  next.type = 'button';
  next.setAttribute('aria-label', 'Следующая фотография');
  lightboxImage = element('img', 'house-gallery-lightbox-image');
  stage.append(previous, lightboxImage, next);

  const footer = element('div', 'house-gallery-lightbox-footer');
  lightboxTitle = element('p', 'house-gallery-lightbox-title');
  footer.append(lightboxTitle);
  lightbox.append(toolbar, stage, footer);
  document.body.append(lightbox);
  renderLightboxPhoto();

  close.addEventListener('click', closeLightbox);
  previous.addEventListener('click', () => moveLightbox(-1));
  next.addEventListener('click', () => moveLightbox(1));
  lightbox.addEventListener('click', event => {
    if (event.target === lightbox) closeLightbox();
  });
  stage.addEventListener('touchstart', event => {
    const touch = event.changedTouches[0];
    touchStart = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  stage.addEventListener('touchend', event => {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStart.x;
    const deltaY = touch.clientY - touchStart.y;
    if (Math.abs(deltaX) > 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) moveLightbox(deltaX < 0 ? 1 : -1);
    touchStart = null;
  }, { passive: true });
  document.addEventListener('keydown', onLightboxKeydown);
  close.focus({ preventScroll: true });
}

function mountGallery() {
  if (!stylesheetReady) return;
  const layout = document.querySelector('.house-layout');
  if (!layout) return;

  let gallery = document.getElementById('house-photo-gallery');
  if (!gallery) gallery = buildGallery();
  if (layout.nextElementSibling !== gallery) layout.after(gallery);

  let map = document.getElementById('house-location-map');
  if (!map) map = buildLocationMap();
  if (gallery.nextElementSibling !== map) gallery.after(map);
}

document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-gallery-index]');
  if (trigger) openLightbox(Number(trigger.dataset.galleryIndex), trigger);
});

const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = '/house-gallery.css';
stylesheet.addEventListener('load', () => {
  stylesheetReady = true;
  mountGallery();
}, { once: true });
stylesheet.addEventListener('error', () => {
  stylesheetReady = true;
  mountGallery();
}, { once: true });
document.head.append(stylesheet);

const observer = new MutationObserver(() => mountGallery());
observer.observe(document.documentElement, { childList: true, subtree: true });
if (document.readyState === 'complete') mountGallery();
else window.addEventListener('load', mountGallery, { once: true });