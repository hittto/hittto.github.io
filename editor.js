(function () {
  'use strict';

  const previewFrame = document.getElementById('preview-frame');
  const saveState = document.getElementById('save-state');
  const galleryEditor = document.getElementById('gallery-editor');
  const contactEditor = document.getElementById('contact-editor');
  const guideEditor = document.getElementById('guide-editor');
  const publishDialog = document.getElementById('publish-dialog');
  const publishStatus = document.getElementById('publish-status');
  let originalContent = null;
  let content = null;
  let saveTimer = null;
  let previewTimer = null;
  let databasePromise = null;

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  function mergeDefaults(defaults, value) {
    if (Array.isArray(defaults)) return Array.isArray(value) ? value : clone(defaults);
    if (defaults && typeof defaults === 'object') {
      const source = value && typeof value === 'object' ? value : {};
      const result = {};
      for (const key of new Set([...Object.keys(defaults), ...Object.keys(source)])) {
        result[key] = key in defaults ? mergeDefaults(defaults[key], source[key]) : source[key];
      }
      return result;
    }
    return value === undefined ? defaults : value;
  }

  function getPath(object, path) {
    return path.split('.').reduce((value, key) => value?.[key], object);
  }

  function setPath(object, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const parent = keys.reduce((value, key) => {
      if (!value[key] || typeof value[key] !== 'object') value[key] = {};
      return value[key];
    }, object);
    parent[last] = value;
  }

  function migrateLegacy(value, defaults) {
    if (!value || !value.couple) return clone(defaults);
    if (value.couple.groom && typeof value.couple.groom === 'object') return mergeDefaults(defaults, value);
    const next = clone(defaults);
    next.theme.accent = value.theme?.accent || next.theme.accent;
    next.couple.groom.name = value.couple?.groom || next.couple.groom.name;
    next.couple.groom.en = value.couple?.groomEn || next.couple.groom.en;
    next.couple.bride.name = value.couple?.bride || next.couple.bride.name;
    next.couple.bride.en = value.couple?.brideEn || next.couple.bride.en;
    next.couple.groom.father = value.family?.groomFather || '';
    next.couple.groom.mother = value.family?.groomMother || '';
    next.couple.bride.father = value.family?.brideFather || '';
    next.couple.bride.mother = value.family?.brideMother || '';
    next.wedding.date = value.event?.date || next.wedding.date;
    next.wedding.time = value.event?.time || next.wedding.time;
    next.wedding.venue = value.event?.venue || next.wedding.venue;
    next.wedding.address = value.event?.address || next.wedding.address;
    next.cover.image = value.images?.cover || '';
    next.intro.image = value.images?.secondary || '';
    next.greeting.message = value.messages?.invitation || next.greeting.message;
    next.video.url = value.video?.youtubeUrl || '';
    next.gallery.images = Array.isArray(value.gallery) ? value.gallery : next.gallery.images;
    next.map.guides = [
      { title: '🚃 지하철', desc: value.map?.subway || '' },
      { title: '🚌 버스', desc: value.map?.bus || '' },
      { title: '🚗 주차', desc: value.map?.parking || '' }
    ];
    next.accounts.groom.items = (value.accounts || []).filter((item) => item.side === 'groom').map((item) => ({ bank: item.bank, number: item.number, holder: item.holder, label: item.role }));
    next.accounts.bride.items = (value.accounts || []).filter((item) => item.side === 'bride').map((item) => ({ bank: item.bank, number: item.number, holder: item.holder, label: item.role }));
    next.bgm.src = value.musicUrl || '';
    next.share.title = value.meta?.title || next.share.title;
    next.share.desc = value.meta?.description || next.share.desc;
    next.share.url = value.meta?.shareUrl || next.share.url;
    next.share.ogImageUrl = value.images?.shareThumbnail || '';
    next.footer.text = value.footer || next.footer.text;
    return next;
  }

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('hittto-wedding-editor', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return databasePromise;
  }

  async function loadDraft() {
    try {
      const db = await openDatabase();
      return await new Promise((resolve, reject) => {
        const request = db.transaction('drafts', 'readonly').objectStore('drafts').get('current');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (_) { return null; }
  }

  async function storeDraft(value) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction('drafts', 'readwrite').objectStore('drafts').put(value, 'current');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async function clearDraft() {
    try {
      const db = await openDatabase();
      await new Promise((resolve, reject) => {
        const request = db.transaction('drafts', 'readwrite').objectStore('drafts').delete('current');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (_) { /* no stored draft */ }
  }

  function sendPreview() {
    if (content && previewFrame.contentWindow) previewFrame.contentWindow.postMessage({ type: 'WEDDING_PREVIEW', content }, '*');
  }

  function scheduleSave() {
    saveState.textContent = '저장 중…';
    clearTimeout(saveTimer);
    clearTimeout(previewTimer);
    previewTimer = setTimeout(sendPreview, 90);
    saveTimer = setTimeout(async () => {
      try {
        await storeDraft(content);
        saveState.textContent = '자동 저장됨 ✓';
      } catch (_) { saveState.textContent = '저장 공간이 부족합니다'; }
    }, 350);
  }

  function populateFields() {
    document.querySelectorAll('[data-path]').forEach((input) => {
      const value = getPath(content, input.dataset.path);
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = value ?? '';
    });
  }

  function refreshMediaCards() {
    document.querySelectorAll('[data-image-card]').forEach((card) => {
      const value = getPath(content, card.dataset.imageCard);
      const preview = card.querySelector('.media-preview');
      preview.style.backgroundImage = value ? `url("${String(value).replaceAll('"', '%22')}")` : 'none';
      preview.style.backgroundColor = value ? '#eee' : '#f4f1ef';
    });
    const music = content.bgm?.src || '';
    document.getElementById('music-state').textContent = music ? (music.startsWith('data:') ? '새 음악 파일이 등록되었습니다' : music) : '등록된 음악 없음';
  }

  function renderGalleryEditor() {
    const images = content.gallery?.images || [];
    galleryEditor.innerHTML = images.length ? images.map((src, index) => `
      <div class="gallery-edit-item">
        ${src ? `<img src="${escapeHtml(src)}" alt="갤러리 사진 ${index + 1}">` : `<div class="gallery-placeholder">사진 ${index + 1}</div>`}
        <div class="gallery-edit-actions">
          <button type="button" data-gallery-move="${index}" data-direction="-1" aria-label="앞으로 이동">←</button>
          <button type="button" data-gallery-remove="${index}" aria-label="삭제">삭제</button>
          <button type="button" data-gallery-move="${index}" data-direction="1" aria-label="뒤로 이동">→</button>
        </div>
      </div>`).join('') : '<p class="help-text">아직 갤러리 사진이 없습니다.</p>';
    galleryEditor.querySelectorAll('[data-gallery-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        content.gallery.images.splice(Number(button.dataset.galleryRemove), 1);
        renderGalleryEditor(); scheduleSave();
      });
    });
    galleryEditor.querySelectorAll('[data-gallery-move]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.galleryMove);
        const next = index + Number(button.dataset.direction);
        if (next < 0 || next >= content.gallery.images.length) return;
        [content.gallery.images[index], content.gallery.images[next]] = [content.gallery.images[next], content.gallery.images[index]];
        renderGalleryEditor(); scheduleSave();
      });
    });
  }

  function renderContacts() {
    if (!Array.isArray(content.contacts)) content.contacts = [];
    contactEditor.innerHTML = content.contacts.length ? content.contacts.map((item, index) => `
      <div class="dynamic-card">
        <div class="dynamic-head"><strong>연락처 ${index + 1}</strong><button type="button" data-contact-remove="${index}">삭제</button></div>
        <div class="dynamic-fields">
          <label>버튼 문구<input value="${escapeHtml(item.label)}" data-contact-index="${index}" data-contact-key="label"></label>
          <label>전화번호<input value="${escapeHtml(item.phone)}" data-contact-index="${index}" data-contact-key="phone"></label>
        </div>
      </div>`).join('') : '<p class="help-text">등록된 연락처가 없습니다.</p>';
    contactEditor.querySelectorAll('[data-contact-index]').forEach((input) => input.addEventListener('input', () => {
      content.contacts[Number(input.dataset.contactIndex)][input.dataset.contactKey] = input.value; scheduleSave();
    }));
    contactEditor.querySelectorAll('[data-contact-remove]').forEach((button) => button.addEventListener('click', () => {
      content.contacts.splice(Number(button.dataset.contactRemove), 1); renderContacts(); scheduleSave();
    }));
  }

  function renderGuides() {
    if (!Array.isArray(content.map.guides)) content.map.guides = [];
    guideEditor.innerHTML = content.map.guides.length ? content.map.guides.map((item, index) => `
      <div class="dynamic-card">
        <div class="dynamic-head"><strong>교통 안내 ${index + 1}</strong><button type="button" data-guide-remove="${index}">삭제</button></div>
        <div class="dynamic-fields">
          <label>제목<input value="${escapeHtml(item.title)}" data-guide-index="${index}" data-guide-key="title"></label>
          <label class="full">설명<textarea rows="3" data-guide-index="${index}" data-guide-key="desc">${escapeHtml(item.desc)}</textarea></label>
        </div>
      </div>`).join('') : '<p class="help-text">등록된 교통 안내가 없습니다.</p>';
    guideEditor.querySelectorAll('[data-guide-index]').forEach((input) => input.addEventListener('input', () => {
      content.map.guides[Number(input.dataset.guideIndex)][input.dataset.guideKey] = input.value; scheduleSave();
    }));
    guideEditor.querySelectorAll('[data-guide-remove]').forEach((button) => button.addEventListener('click', () => {
      content.map.guides.splice(Number(button.dataset.guideRemove), 1); renderGuides(); scheduleSave();
    }));
  }

  function renderAccountGroup(side) {
    const container = document.getElementById(`account-${side}-editor`);
    const items = content.accounts[side].items || [];
    container.innerHTML = items.length ? items.map((item, index) => `
      <div class="account-card">
        <div class="account-head"><strong>${side === 'groom' ? '신랑' : '신부'} 측 계좌 ${index + 1}</strong><button type="button" data-account-remove="${index}" data-side="${side}">삭제</button></div>
        <div class="account-fields">
          <label>은행<input value="${escapeHtml(item.bank)}" data-account-index="${index}" data-side="${side}" data-account-key="bank"></label>
          <label>계좌번호<input value="${escapeHtml(item.number)}" data-account-index="${index}" data-side="${side}" data-account-key="number"></label>
          <label>예금주<input value="${escapeHtml(item.holder)}" data-account-index="${index}" data-side="${side}" data-account-key="holder"></label>
          <label>관계 표시<input value="${escapeHtml(item.label)}" data-account-index="${index}" data-side="${side}" data-account-key="label"></label>
        </div>
      </div>`).join('') : '<p class="help-text">등록된 계좌가 없습니다.</p>';
    container.querySelectorAll('[data-account-index]').forEach((input) => input.addEventListener('input', () => {
      content.accounts[input.dataset.side].items[Number(input.dataset.accountIndex)][input.dataset.accountKey] = input.value; scheduleSave();
    }));
    container.querySelectorAll('[data-account-remove]').forEach((button) => button.addEventListener('click', () => {
      content.accounts[button.dataset.side].items.splice(Number(button.dataset.accountRemove), 1); renderAccountGroup(button.dataset.side); scheduleSave();
    }));
  }

  function refreshAll() {
    populateFields();
    refreshMediaCards();
    renderGalleryEditor();
    renderContacts();
    renderGuides();
    renderAccountGroup('groom');
    renderAccountGroup('bride');
    sendPreview();
  }

  function compressImage(file, maxSize = 1600, quality = 0.84) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) return reject(new Error('이미지 파일만 선택할 수 있습니다.'));
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      image.onload = () => {
        let width = image.naturalWidth;
        let height = image.naturalHeight;
        const ratio = Math.min(1, maxSize / Math.max(width, height));
        width = Math.round(width * ratio); height = Math.round(height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('사진을 읽을 수 없습니다.')); };
      image.src = objectUrl;
    });
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
      reader.readAsDataURL(file);
    });
  }

  function bindInputs() {
    document.querySelectorAll('[data-path]').forEach((input) => {
      input.addEventListener('input', () => {
        const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
        setPath(content, input.dataset.path, value); scheduleSave();
      });
    });
    document.querySelectorAll('[data-image-input]').forEach((input) => input.addEventListener('change', async () => {
      if (!input.files[0]) return;
      saveState.textContent = '사진 처리 중…';
      try {
        setPath(content, input.dataset.imageInput, await compressImage(input.files[0]));
        refreshMediaCards(); scheduleSave();
      } catch (error) { alert(error.message); }
      input.value = '';
    }));
    document.querySelectorAll('[data-image-clear]').forEach((button) => button.addEventListener('click', () => {
      setPath(content, button.dataset.imageClear, ''); refreshMediaCards(); scheduleSave();
    }));
    document.getElementById('gallery-input').addEventListener('change', async (event) => {
      const files = [...event.target.files]; if (!files.length) return;
      content.gallery.images = (content.gallery.images || []).filter(Boolean);
      for (let i = 0; i < files.length; i += 1) {
        saveState.textContent = `사진 처리 중 ${i + 1}/${files.length}`;
        try { content.gallery.images.push(await compressImage(files[i], 1500, 0.82)); }
        catch (error) { alert(`${files[i].name}: ${error.message}`); }
      }
      event.target.value = ''; renderGalleryEditor(); scheduleSave();
    });
    document.getElementById('music-input').addEventListener('change', async (event) => {
      const file = event.target.files[0]; if (!file) return;
      if (!file.type.startsWith('audio/')) { alert('음악 파일만 선택해 주세요.'); return; }
      if (file.size > 10 * 1024 * 1024 && !confirm('음악 파일이 10MB보다 큽니다. 페이지가 느려질 수 있는데 계속할까요?')) return;
      saveState.textContent = '음악 처리 중…';
      try { content.bgm.src = await fileToDataUrl(file); refreshMediaCards(); scheduleSave(); }
      catch (error) { alert(error.message); }
      event.target.value = '';
    });
    document.querySelector('[data-clear-music]').addEventListener('click', () => { content.bgm.src = ''; refreshMediaCards(); scheduleSave(); });
    document.querySelector('[data-add-contact]').addEventListener('click', () => { content.contacts.push({ label: '연락하기', phone: '' }); renderContacts(); scheduleSave(); });
    document.querySelector('[data-add-guide]').addEventListener('click', () => { content.map.guides.push({ title: '교통 안내', desc: '' }); renderGuides(); scheduleSave(); });
    document.querySelectorAll('[data-add-account]').forEach((button) => button.addEventListener('click', () => {
      const side = button.dataset.addAccount;
      content.accounts[side].items.push({ bank: '은행', number: '', holder: '', label: side === 'groom' ? '신랑' : '신부' });
      renderAccountGroup(side); scheduleSave();
    }));
    document.querySelector('[data-export]').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json;charset=utf-8' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
      link.download = `wedding-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });
    document.getElementById('import-input').addEventListener('change', async (event) => {
      if (!event.target.files[0]) return;
      try {
        const imported = JSON.parse(await event.target.files[0].text());
        if (!imported.couple || !imported.wedding) throw new Error('청첩장 백업 파일 형식이 아닙니다.');
        content = migrateLegacy(imported, originalContent); refreshAll(); scheduleSave();
      } catch (error) { alert(`불러오지 못했습니다. ${error.message}`); }
      event.target.value = '';
    });
    document.querySelector('[data-reset]').addEventListener('click', async () => {
      if (!confirm('모든 편집 내용을 지우고 처음 상태로 돌아갈까요?')) return;
      await clearDraft(); content = clone(originalContent); refreshAll(); scheduleSave();
    });
    document.querySelector('[data-open-publish]').addEventListener('click', () => {
      publishStatus.textContent = ''; publishStatus.className = 'publish-status'; publishDialog.showModal();
    });
    document.querySelector('[data-publish]').addEventListener('click', publishToGitHub);
  }

  function bytesToBase64(bytes) {
    let binary = ''; const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
  }
  const textToBase64 = (text) => bytesToBase64(new TextEncoder().encode(text));
  function dataUrlParts(dataUrl) {
    const match = String(dataUrl).match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) throw new Error('업로드 파일 데이터를 읽을 수 없습니다.');
    const mime = match[1];
    const extension = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('mpeg') ? 'mp3' : mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'jpg';
    return { base64: match[2], extension };
  }

  async function publishToGitHub() {
    const owner = document.getElementById('publish-owner').value.trim();
    const repo = document.getElementById('publish-repo').value.trim();
    const branch = document.getElementById('publish-branch').value.trim();
    const tokenInput = document.getElementById('publish-token');
    const token = tokenInput.value.trim();
    const button = document.querySelector('[data-publish]');
    if (!owner || !repo || !branch || !token) {
      publishStatus.textContent = 'GitHub 정보와 일회용 토큰을 모두 입력해 주세요.';
      publishStatus.className = 'publish-status error'; return;
    }
    button.disabled = true; publishStatus.className = 'publish-status';
    const apiRoot = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const request = async (path, options = {}) => {
      const response = await fetch(`${apiRoot}${path}`, {
        ...options,
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', ...(options.headers || {}) }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || `GitHub 요청 오류 (${response.status})`);
      return payload;
    };
    try {
      publishStatus.textContent = '현재 게시 상태를 확인하고 있어요…';
      const ref = await request(`/git/ref/heads/${encodeURIComponent(branch)}`);
      const headSha = ref.object.sha;
      const headCommit = await request(`/git/commits/${headSha}`);
      const cleanContent = clone(content);
      const uploadFiles = [];
      const stamp = Date.now();
      const extract = (path, filename) => {
        const value = getPath(cleanContent, path);
        if (typeof value !== 'string' || !value.startsWith('data:')) return;
        const parts = dataUrlParts(value);
        const target = `assets/uploads/${filename}-${stamp}.${parts.extension}`;
        uploadFiles.push({ path: target, content: parts.base64 }); setPath(cleanContent, path, target);
      };
      extract('cover.image', 'cover');
      extract('intro.image', 'intro');
      extract('share.ogImageUrl', 'share');
      extract('bgm.src', 'bgm');
      cleanContent.gallery.images = (cleanContent.gallery.images || []).map((value, index) => {
        if (typeof value !== 'string' || !value.startsWith('data:')) return value;
        const parts = dataUrlParts(value);
        const target = `assets/uploads/gallery-${String(index + 1).padStart(2, '0')}-${stamp}.${parts.extension}`;
        uploadFiles.push({ path: target, content: parts.base64 }); return target;
      });
      const treeEntries = [];
      for (let i = 0; i < uploadFiles.length; i += 1) {
        publishStatus.textContent = `사진·음악 업로드 중 ${i + 1}/${uploadFiles.length}`;
        const blob = await request('/git/blobs', { method: 'POST', body: JSON.stringify({ content: uploadFiles[i].content, encoding: 'base64' }) });
        treeEntries.push({ path: uploadFiles[i].path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      publishStatus.textContent = '수정한 내용을 정리하고 있어요…';
      const contentBlob = await request('/git/blobs', { method: 'POST', body: JSON.stringify({ content: textToBase64(`${JSON.stringify(cleanContent, null, 2)}\n`), encoding: 'base64' }) });
      treeEntries.push({ path: 'content.json', mode: '100644', type: 'blob', sha: contentBlob.sha });

      const indexResponse = await fetch(`index.html?v=${Date.now()}`);
      if (!indexResponse.ok) throw new Error('공유 정보를 넣을 index.html을 읽을 수 없습니다');
      let indexHtml = await indexResponse.text();
      const title = escapeHtml(cleanContent.share?.title || '결혼합니다');
      const description = escapeHtml(cleanContent.share?.desc || '소중한 분들을 초대합니다.').replaceAll('\n', ' ');
      const shareUrl = escapeHtml(cleanContent.share?.url || 'https://hittto.github.io/');
      let shareImage = cleanContent.share?.ogImageUrl || cleanContent.cover?.image || '';
      try { shareImage = new URL(shareImage, cleanContent.share?.url || location.href).href; } catch (_) { /* keep original */ }
      shareImage = escapeHtml(shareImage);
      const replaceMeta = (property, value) => {
        const pattern = new RegExp(`<meta\\s+property=["']${property}["']\\s+content=["'][^"']*["']\\s*>`, 'i');
        const tag = `<meta property="${property}" content="${value}">`;
        indexHtml = pattern.test(indexHtml) ? indexHtml.replace(pattern, tag) : indexHtml.replace('</head>', `  ${tag}\n</head>`);
      };
      indexHtml = indexHtml.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
      indexHtml = indexHtml.replace(/<meta\s+name=["']description["']\s+content=["'][^"']*["']\s*>/i, `<meta name="description" content="${description}">`);
      replaceMeta('og:title', title); replaceMeta('og:description', description); replaceMeta('og:url', shareUrl); replaceMeta('og:image', shareImage);
      const indexBlob = await request('/git/blobs', { method: 'POST', body: JSON.stringify({ content: textToBase64(indexHtml), encoding: 'base64' }) });
      treeEntries.push({ path: 'index.html', mode: '100644', type: 'blob', sha: indexBlob.sha });

      const tree = await request('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: headCommit.tree.sha, tree: treeEntries }) });
      const commit = await request('/git/commits', { method: 'POST', body: JSON.stringify({ message: `청첩장 내용 수정 (${new Date().toLocaleString('ko-KR')})`, tree: tree.sha, parents: [headSha] }) });
      await request(`/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
      content = cleanContent; await storeDraft(content); refreshAll(); tokenInput.value = '';
      publishStatus.innerHTML = '게시가 완료되었습니다 ✓<br>GitHub Pages 반영까지 보통 1~3분 정도 걸립니다.';
      publishStatus.className = 'publish-status success'; saveState.textContent = '게시 완료 ✓';
    } catch (error) {
      const hint = /401|Bad credentials/i.test(error.message) ? ' 토큰이 정확한지 확인해 주세요.' : /403|Resource not accessible/i.test(error.message) ? ' 토큰의 Contents 쓰기 권한을 확인해 주세요.' : '';
      publishStatus.textContent = `게시하지 못했습니다. ${error.message}.${hint}`; publishStatus.className = 'publish-status error';
    } finally { button.disabled = false; }
  }

  async function initialize() {
    try {
      const [publishedResponse, defaultResponse] = await Promise.all([
        fetch(`content.json?v=${Date.now()}`),
        fetch(`default-content.json?v=${Date.now()}`)
      ]);
      if (!publishedResponse.ok) throw new Error('현재 게시 내용을 읽을 수 없습니다.');
      if (!defaultResponse.ok) throw new Error('개인정보 없는 초기값을 읽을 수 없습니다.');
      const publishedContent = await publishedResponse.json();
      originalContent = await defaultResponse.json();
      const draft = await loadDraft();
      content = draft ? migrateLegacy(draft, originalContent) : mergeDefaults(originalContent, publishedContent);
      bindInputs(); refreshAll(); saveState.textContent = '자동 저장 준비됨';
      previewFrame.addEventListener('load', sendPreview);
    } catch (error) {
      saveState.textContent = error.message; alert(`편집 작업창을 시작하지 못했습니다. ${error.message}`);
    }
  }
  initialize();
})();
