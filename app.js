(function () {
  'use strict';

  const root = document.getElementById('invitation');
  const lightbox = document.getElementById('lightbox');
  const lightboxImage = document.getElementById('lightbox-image');
  const lightboxCount = document.getElementById('lightbox-count');
  const toast = document.getElementById('toast');
  let galleryImages = [];
  let lightboxIndex = 0;
  let currentData = null;
  let toastTimer = null;

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const attr = (value) => esc(value).replaceAll('`', '&#096;');
  const nl = (value) => esc(value).replaceAll('\n', '<br>');

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('on'), 1800);
  }

  async function copyText(text, message = '복사되었습니다 ✓') {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    showToast(message);
  }

  function parseDate(dateText) {
    const date = new Date(`${dateText || '2026-01-01'}T00:00:00`);
    return Number.isNaN(date.getTime()) ? new Date('2026-01-01T00:00:00') : date;
  }

  function dateLabels(event) {
    const date = parseDate(event.date);
    const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    const [hour = '00', minute = '00'] = String(event.time || '00:00').split(':');
    const hourNumber = Number(hour);
    const period = hourNumber < 12 ? '오전' : '오후';
    const displayHour = hourNumber % 12 || 12;
    return {
      date,
      full: `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${dayNames[date.getDay()]}`,
      time: `${period} ${displayHour}시${minute !== '00' ? ` ${Number(minute)}분` : ''}`,
      short: `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}.${date.getFullYear()}`
    };
  }

  function youtubeId(url) {
    const text = String(url || '').trim();
    if (!text) return '';
    const match = text.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/i);
    return match ? match[1] : (/^[\w-]{6,}$/.test(text) ? text : '');
  }

  function calendarMarkup(event) {
    const wedding = parseDate(event.date);
    const year = wedding.getFullYear();
    const month = wedding.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const heads = ['일', '월', '화', '수', '목', '금', '토'];
    let cells = heads.map((head, index) => `<div class="calendar-cell calendar-head ${index === 0 ? 'calendar-sun' : ''}">${head}</div>`).join('');
    for (let i = 0; i < firstDay; i += 1) cells += '<div class="calendar-cell"></div>';
    for (let day = 1; day <= lastDate; day += 1) {
      const dayOfWeek = (firstDay + day - 1) % 7;
      const classes = ['calendar-cell'];
      if (dayOfWeek === 0) classes.push('calendar-sun');
      if (day === wedding.getDate()) classes.push('calendar-wedding');
      cells += `<div class="${classes.join(' ')}">${day}</div>`;
    }
    return cells;
  }

  function mapUrl(map) {
    const lat = Number(map.lat) || 37.5665;
    const lng = Number(map.lng) || 126.978;
    const spread = 0.008;
    const bbox = [lng - spread, lat - spread, lng + spread, lat + spread].join('%2C');
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
  }

  function familyCard(label, parents, message, image) {
    return `
      <article class="family-card ${image ? 'has-photo' : ''}">
        ${image ? `<img src="${attr(image)}" alt="${esc(label)} 가족 사진">` : ''}
        <div class="family-card-copy">
          <p class="family-label">${esc(label)}</p>
          <p class="family-parents">${esc(parents)}</p>
          <p class="family-message">${esc(message)}</p>
        </div>
      </article>`;
  }

  function galleryMarkup(gallery) {
    if (gallery.length) {
      return gallery.map((src, index) => `
        <button class="gallery-item" type="button" data-gallery-index="${index}" aria-label="사진 ${index + 1} 크게 보기">
          <img src="${attr(src)}" alt="웨딩 갤러리 ${index + 1}" loading="lazy">
        </button>`).join('');
    }
    return Array.from({ length: 9 }, (_, index) => `<div class="gallery-item gallery-empty"><span>GALLERY<br>${String(index + 1).padStart(2, '0')}</span></div>`).join('');
  }

  function accountsMarkup(accounts) {
    const groups = [
      ['groom', '🤵🏻 신랑 측 마음 전하실 곳'],
      ['bride', '👰🏻 신부 측 마음 전하실 곳']
    ];
    return groups.map(([side, title]) => {
      const rows = accounts.filter((account) => account.side === side);
      if (!rows.length) return '';
      return `<div class="account-group"><h3>${title}</h3>${rows.map((account, index) => `
        <div class="account-row">
          <div class="account-row-copy">
            <p>${esc(account.bank)} ${esc(account.number)}</p>
            <small>${esc(account.role)} · ${esc(account.holder)}</small>
          </div>
          <button class="copy-button" type="button" data-copy-account="${side}-${index}">복사하기</button>
        </div>`).join('')}</div>`;
    }).join('');
  }

  function render(data) {
    currentData = data;
    const theme = data.theme || {};
    document.documentElement.style.setProperty('--accent', theme.accent || '#f4879f');
    document.documentElement.style.setProperty('--soft', theme.soft || '#ffe0e3');
    document.documentElement.style.setProperty('--paper', theme.paper || '#fbf8f3');
    document.documentElement.style.setProperty('--ink', theme.ink || '#181818');

    const couple = data.couple || {};
    const event = data.event || {};
    const messages = data.messages || {};
    const family = data.family || {};
    const images = data.images || {};
    const video = data.video || {};
    const map = data.map || {};
    const labels = dateLabels(event);
    const videoCode = youtubeId(video.youtubeUrl);
    const videoThumb = images.videoThumbnail || (videoCode ? `https://img.youtube.com/vi/${videoCode}/maxresdefault.jpg` : '');
    galleryImages = Array.isArray(data.gallery) ? data.gallery.filter(Boolean) : [];

    document.title = (data.meta && data.meta.title) || `${couple.groom} · ${couple.bride} 결혼합니다`;
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) metaDescription.content = (data.meta && data.meta.description) || '';
    const metaPairs = {
      'og:title': (data.meta && data.meta.title) || document.title,
      'og:description': (data.meta && data.meta.description) || '',
      'og:url': (data.meta && data.meta.shareUrl) || location.href,
      'og:image': images.shareThumbnail || images.cover || ''
    };
    Object.entries(metaPairs).forEach(([property, value]) => {
      const element = document.querySelector(`meta[property="${property}"]`);
      if (element && value) element.content = value;
    });

    root.innerHTML = `
      <section class="section hero">
        <div class="hero-photo">
          ${images.cover ? `<img src="${attr(images.cover)}" alt="${esc(couple.groom)}과 ${esc(couple.bride)}의 메인 사진">` : ''}
          <div class="hero-copy">
            <p class="hero-kicker">WE ARE GETTING MARRIED</p>
            <h1 class="hero-names">${esc(couple.groom)} <span aria-hidden="true">·</span> ${esc(couple.bride)}</h1>
            <p class="hero-date">${esc(labels.short)} &nbsp; ${esc(event.time)}</p>
          </div>
        </div>
        ${data.musicUrl ? '<button class="music-button" type="button" aria-label="배경 음악 재생">♫</button><audio id="bgm" loop></audio>' : ''}
      </section>

      <section class="section save-date">
        <p class="save-date-mark">${esc(messages.opening || 'Save the date')}</p>
        <p class="event-date">${esc(labels.full)}<br>${esc(labels.time)}</p>
        <p class="event-place"><strong>${esc(event.venue)}</strong><br>${esc(event.address)}</p>
        <div class="envelope" aria-hidden="true"><span class="envelope-heart">♥</span></div>
      </section>

      <section class="section invitation-message">
        <p class="script-line">With love, we invite you</p>
        <p class="body-copy">${nl(messages.invitation)}</p>
        <div class="couple-list">
          <div><p class="couple-role">${esc(couple.groomEn)}</p><p class="couple-name">${esc(couple.groom)}</p></div>
          <div><p class="couple-role">${esc(couple.brideEn)}</p><p class="couple-name">${esc(couple.bride)}</p></div>
        </div>
      </section>

      ${images.secondary ? `<section class="section wide-photo"><img src="${attr(images.secondary)}" alt="두 사람의 웨딩 사진" loading="lazy"></section>` : ''}

      <section class="section family">
        ${familyCard('GROOM FAMILY', `${family.groomFather} · ${family.groomMother}`, messages.groomFamily, images.groomFamily)}
        ${familyCard('BRIDE FAMILY', `${family.brideFather} · ${family.brideMother}`, messages.brideFamily, images.brideFamily)}
      </section>

      <section class="section video-section">
        <div class="video-heading"><p class="eyebrow">OUR FILM</p><h2 class="section-title">The moments we love</h2></div>
        <div class="video-box" data-video-id="${attr(videoCode)}">
          ${videoCode
            ? `<img src="${attr(videoThumb)}" alt="웨딩 영상 썸네일" loading="lazy"><button class="video-play" type="button" aria-label="영상 재생">▶</button>`
            : '<div class="video-empty"><span>▷</span><p>편집 화면에서 유튜브 영상을 추가해 주세요</p></div>'}
        </div>
      </section>

      <section class="section letter">
        <p class="eyebrow">LOVE LETTER</p>
        <h2 class="section-title">${esc(messages.letterTitle)}</h2>
        <p class="body-copy">${nl(messages.letter)}</p>
      </section>

      <section class="section gallery-section">
        <div class="gallery-heading"><p class="eyebrow">GALLERY</p><h2 class="section-title">Our favorite scenes</h2></div>
        <div class="gallery-grid">${galleryMarkup(galleryImages)}</div>
      </section>

      <section class="section calendar-section">
        <p class="eyebrow">WEDDING DAY</p>
        <h2 class="section-title">우리의 특별한 날</h2>
        <p class="calendar-month">${labels.date.getFullYear()} · ${String(labels.date.getMonth() + 1).padStart(2, '0')}</p>
        <div class="calendar-grid">${calendarMarkup(event)}</div>
        <p class="calendar-caption">${esc(labels.full)} · ${esc(labels.time)}</p>
      </section>

      <section class="section map-section">
        <div class="map-heading"><p class="eyebrow">LOCATION</p><h2 class="section-title">오시는 길</h2></div>
        <iframe class="map-frame" src="${attr(mapUrl(map))}" title="예식장 지도" loading="lazy"></iframe>
        <div class="location-card">
          <div class="location-top">
            <div class="location-copy"><h3>${esc(event.venue)}</h3><p>${esc(event.address)}</p></div>
            <button class="pill-button" type="button" data-copy-address>주소 복사</button>
          </div>
          <div class="map-links">
            <a class="outline-link" href="https://map.naver.com/p/search/${encodeURIComponent(event.address || event.venue || '')}" target="_blank" rel="noopener">네이버 지도</a>
            <a class="outline-link" href="https://map.kakao.com/link/search/${encodeURIComponent(event.address || event.venue || '')}" target="_blank" rel="noopener">카카오맵</a>
          </div>
        </div>
        <div class="transport">
          <div class="transport-row"><strong>🚇 지하철</strong><p>${esc(map.subway)}</p></div>
          <div class="transport-row"><strong>🚌 버스</strong><p>${esc(map.bus)}</p></div>
          <div class="transport-row"><strong>🚙 주차</strong><p>${esc(map.parking)}</p></div>
        </div>
      </section>

      <section class="section accounts-section">
        <div class="accounts-heading"><p class="eyebrow">WITH HEART</p><h2 class="section-title">마음 전하실 곳</h2></div>
        ${accountsMarkup(Array.isArray(data.accounts) ? data.accounts : [])}
      </section>

      <section class="section share-section">
        <button class="share-button" type="button" data-copy-url>청첩장 주소 복사하기</button>
        <button class="share-button" type="button" data-share>청첩장 공유하기</button>
        <p class="footer-copy">${esc(data.footer || '')}</p>
      </section>`;

    bindContentEvents();
  }

  function bindContentEvents() {
    root.querySelectorAll('[data-gallery-index]').forEach((button) => {
      button.addEventListener('click', () => openLightbox(Number(button.dataset.galleryIndex)));
    });

    const videoPlay = root.querySelector('.video-play');
    if (videoPlay) {
      videoPlay.addEventListener('click', () => {
        const box = videoPlay.closest('.video-box');
        const code = box.dataset.videoId;
        box.innerHTML = `<iframe src="https://www.youtube.com/embed/${attr(code)}?autoplay=1&rel=0&modestbranding=1" title="웨딩 영상" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
      });
    }

    root.querySelector('[data-copy-address]')?.addEventListener('click', () => copyText(currentData.event.address, '주소가 복사되었습니다 ✓'));
    root.querySelector('[data-copy-url]')?.addEventListener('click', () => copyText(currentData.meta.shareUrl || location.href, '청첩장 주소가 복사되었습니다 ✓'));
    root.querySelector('[data-share]')?.addEventListener('click', async () => {
      const shareData = { title: currentData.meta.title, text: currentData.meta.description, url: currentData.meta.shareUrl || location.href };
      if (navigator.share) {
        try { await navigator.share(shareData); } catch (_) { /* sharing cancelled */ }
      } else copyText(shareData.url, '청첩장 주소가 복사되었습니다 ✓');
    });

    const accounts = Array.isArray(currentData.accounts) ? currentData.accounts : [];
    root.querySelectorAll('[data-copy-account]').forEach((button) => {
      button.addEventListener('click', () => {
        const [side, sideIndex] = button.dataset.copyAccount.split('-');
        const account = accounts.filter((item) => item.side === side)[Number(sideIndex)];
        if (account) copyText(`${account.bank} ${account.number} ${account.holder}`, '계좌번호가 복사되었습니다 ✓');
      });
    });

    const musicButton = root.querySelector('.music-button');
    if (musicButton) {
      const audio = root.querySelector('#bgm');
      audio.src = currentData.musicUrl;
      musicButton.addEventListener('click', async () => {
        if (audio.paused) {
          try { await audio.play(); musicButton.classList.add('playing'); musicButton.setAttribute('aria-label', '배경 음악 정지'); }
          catch (_) { showToast('음악을 재생할 수 없습니다'); }
        } else {
          audio.pause(); musicButton.classList.remove('playing'); musicButton.setAttribute('aria-label', '배경 음악 재생');
        }
      });
    }
  }

  function openLightbox(index) {
    if (!galleryImages.length) return;
    lightboxIndex = index;
    updateLightbox();
    lightbox.classList.add('on');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function updateLightbox() {
    lightboxImage.src = galleryImages[lightboxIndex];
    lightboxCount.textContent = `${lightboxIndex + 1} / ${galleryImages.length}`;
  }

  function shiftLightbox(direction) {
    if (!galleryImages.length) return;
    lightboxIndex = (lightboxIndex + direction + galleryImages.length) % galleryImages.length;
    updateLightbox();
  }

  function closeLightbox() {
    lightbox.classList.remove('on');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  lightbox.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
  lightbox.querySelector('.lightbox-prev').addEventListener('click', () => shiftLightbox(-1));
  lightbox.querySelector('.lightbox-next').addEventListener('click', () => shiftLightbox(1));
  lightbox.addEventListener('click', (event) => { if (event.target === lightbox) closeLightbox(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeLightbox();
    if (lightbox.classList.contains('on') && event.key === 'ArrowLeft') shiftLightbox(-1);
    if (lightbox.classList.contains('on') && event.key === 'ArrowRight') shiftLightbox(1);
  });

  let touchStartX = 0;
  lightbox.addEventListener('touchstart', (event) => { touchStartX = event.touches[0].clientX; }, { passive: true });
  lightbox.addEventListener('touchend', (event) => {
    const delta = event.changedTouches[0].clientX - touchStartX;
    if (Math.abs(delta) > 45) shiftLightbox(delta < 0 ? 1 : -1);
  }, { passive: true });

  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'WEDDING_PREVIEW' && event.data.content) render(event.data.content);
  });

  fetch(`content.json?v=${Date.now()}`)
    .then((response) => {
      if (!response.ok) throw new Error('content.json을 불러오지 못했습니다.');
      return response.json();
    })
    .then(render)
    .catch((error) => {
      root.innerHTML = `<div class="loading-card"><span class="loading-heart">!</span><p>${esc(error.message)}</p></div>`;
    });
})();
