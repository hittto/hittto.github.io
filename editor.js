(function () {
  'use strict';

  const previewFrame = document.getElementById('preview-frame');
  const saveState = document.getElementById('save-state');
  const galleryEditor = document.getElementById('gallery-editor');
  const accountEditor = document.getElementById('account-editor');
  const publishDialog = document.getElementById('publish-dialog');
  const publishStatus = document.getElementById('publish-status');
  let originalContent = null;
  let content = null;
  let saveTimer = null;
  let databasePromise = null;

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

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
    } catch (_) {
      return null;
    }
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
    if (content && previewFrame.contentWindow) {
      previewFrame.contentWindow.postMessage({ type: 'WEDDING_PREVIEW', content }, '*');
    }
  }

  function scheduleSave() {
    saveState.textContent = '저장 중…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await storeDraft(content);
        saveState.textContent = '자동 저장됨 ✓';
      } catch (_) {
        saveState.textContent = '저장 공간이 부족합니다';
      }
    }, 350);
    sendPreview();
  }

  function populateFields() {
    document.querySelectorAll('[data-path]').forEach((input) => {
      const value = getPath(content, input.dataset.path);
      input.value = value ?? '';
    });
  }

  function refreshMediaCards() {
    document.querySelectorAll('[data-image-card]').forEach((card) => {
      const value = getPath(content, card.dataset.imageCard);
      const preview = card.querySelector('.media-preview');
      preview.style.backgroundImage = value ? `url("${String(value).replaceAll('"', '%22')}")` : 'none';
      preview.style.backgroundColor = value ? '#eee' : '#f4f1ef';
    });
  }

  function renderGalleryEditor() {
    const gallery = Array.isArray(content.gallery) ? content.gallery : [];
    galleryEditor.innerHTML = gallery.length ? gallery.map((src, index) => `
      <div class="gallery-edit-item">
        <img src="${escapeHtml(src)}" alt="갤러리 사진 ${index + 1}">
        <div class="gallery-edit-actions">
          <button type="button" data-gallery-move="${index}" data-direction="-1" aria-label="앞으로 이동">←</button>
          <button type="button" data-gallery-remove="${index}" aria-label="삭제">삭제</button>
          <button type="button" data-gallery-move="${index}" data-direction="1" aria-label="뒤로 이동">→</button>
        </div>
      </div>`).join('') : '<p class="help-text">아직 갤러리 사진이 없습니다.</p>';

    galleryEditor.querySelectorAll('[data-gallery-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        content.gallery.splice(Number(button.dataset.galleryRemove), 1);
        renderGalleryEditor();
        scheduleSave();
      });
    });
    galleryEditor.querySelectorAll('[data-gallery-move]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.galleryMove);
        const next = index + Number(button.dataset.direction);
        if (next < 0 || next >= content.gallery.length) return;
        [content.gallery[index], content.gallery[next]] = [content.gallery[next], content.gallery[index]];
        renderGalleryEditor();
        scheduleSave();
      });
    });
  }

  function renderAccountEditor() {
    if (!Array.isArray(content.accounts)) content.accounts = [];
    accountEditor.innerHTML = content.accounts.length ? content.accounts.map((account, index) => `
      <div class="account-card">
        <div class="account-head"><strong>계좌 ${index + 1}</strong><button type="button" data-account-remove="${index}">삭제</button></div>
        <div class="account-fields">
          <label>구분<select data-account-index="${index}" data-account-key="side"><option value="groom" ${account.side === 'groom' ? 'selected' : ''}>신랑 측</option><option value="bride" ${account.side === 'bride' ? 'selected' : ''}>신부 측</option></select></label>
          <label>관계<input value="${escapeHtml(account.role)}" data-account-index="${index}" data-account-key="role"></label>
          <label>은행<input value="${escapeHtml(account.bank)}" data-account-index="${index}" data-account-key="bank"></label>
          <label>계좌번호<input value="${escapeHtml(account.number)}" data-account-index="${index}" data-account-key="number"></label>
          <label>예금주<input value="${escapeHtml(account.holder)}" data-account-index="${index}" data-account-key="holder"></label>
        </div>
      </div>`).join('') : '<p class="help-text">등록된 계좌가 없습니다.</p>';

    accountEditor.querySelectorAll('[data-account-index]').forEach((input) => {
      input.addEventListener('input', () => {
        content.accounts[Number(input.dataset.accountIndex)][input.dataset.accountKey] = input.value;
        scheduleSave();
      });
    });
    accountEditor.querySelectorAll('[data-account-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        content.accounts.splice(Number(button.dataset.accountRemove), 1);
        renderAccountEditor();
        scheduleSave();
      });
    });
  }

  function refreshAll() {
    populateFields();
    refreshMediaCards();
    renderGalleryEditor();
    renderAccountEditor();
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
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('사진을 읽을 수 없습니다.')); };
      image.src = objectUrl;
    });
  }

  function bindInputs() {
    document.querySelectorAll('[data-path]').forEach((input) => {
      input.addEventListener('input', () => {
        const value = input.type === 'number' ? Number(input.value) : input.value;
        setPath(content, input.dataset.path, value);
        scheduleSave();
      });
    });

    document.querySelectorAll('[data-image-input]').forEach((input) => {
      input.addEventListener('change', async () => {
        if (!input.files[0]) return;
        saveState.textContent = '사진 처리 중…';
        try {
          const dataUrl = await compressImage(input.files[0]);
          setPath(content, input.dataset.imageInput, dataUrl);
          refreshMediaCards();
          scheduleSave();
        } catch (error) {
          alert(error.message);
        }
        input.value = '';
      });
    });

    document.querySelectorAll('[data-image-clear]').forEach((button) => {
      button.addEventListener('click', () => {
        setPath(content, button.dataset.imageClear, '');
        refreshMediaCards();
        scheduleSave();
      });
    });

    document.getElementById('gallery-input').addEventListener('change', async (event) => {
      const files = [...event.target.files];
      if (!files.length) return;
      if (!Array.isArray(content.gallery)) content.gallery = [];
      for (let i = 0; i < files.length; i += 1) {
        saveState.textContent = `사진 처리 중 ${i + 1}/${files.length}`;
        try { content.gallery.push(await compressImage(files[i], 1500, 0.82)); }
        catch (error) { alert(`${files[i].name}: ${error.message}`); }
      }
      event.target.value = '';
      renderGalleryEditor();
      scheduleSave();
    });

    document.querySelector('[data-add-account]').addEventListener('click', () => {
      content.accounts.push({ side: 'groom', role: '신랑', bank: '은행', number: '', holder: '' });
      renderAccountEditor();
      scheduleSave();
    });

    document.querySelector('[data-export]').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `wedding-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });

    document.getElementById('import-input').addEventListener('change', async (event) => {
      if (!event.target.files[0]) return;
      try {
        const imported = JSON.parse(await event.target.files[0].text());
        if (!imported.couple || !imported.event) throw new Error('청첩장 백업 파일 형식이 아닙니다.');
        content = imported;
        refreshAll();
        scheduleSave();
      } catch (error) { alert(`불러오지 못했습니다. ${error.message}`); }
      event.target.value = '';
    });

    document.querySelector('[data-reset]').addEventListener('click', async () => {
      if (!confirm('모든 편집 내용을 지우고 처음 상태로 돌아갈까요?')) return;
      await clearDraft();
      content = clone(originalContent);
      refreshAll();
      scheduleSave();
    });

    document.querySelector('[data-open-publish]').addEventListener('click', () => {
      publishStatus.textContent = '';
      publishStatus.className = 'publish-status';
      publishDialog.showModal();
    });
    document.querySelector('[data-publish]').addEventListener('click', publishToGitHub);
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
  }

  function textToBase64(text) {
    return bytesToBase64(new TextEncoder().encode(text));
  }

  function dataUrlParts(dataUrl) {
    const match = String(dataUrl).match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) throw new Error('사진 데이터 형식을 읽을 수 없습니다.');
    const extension = match[1].includes('png') ? 'png' : match[1].includes('webp') ? 'webp' : 'jpg';
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
      publishStatus.className = 'publish-status error';
      return;
    }

    button.disabled = true;
    publishStatus.className = 'publish-status';
    const apiRoot = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const request = async (path, options = {}) => {
      const response = await fetch(`${apiRoot}${path}`, {
        ...options,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
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

      for (const [key, value] of Object.entries(cleanContent.images || {})) {
        if (typeof value === 'string' && value.startsWith('data:')) {
          const parts = dataUrlParts(value);
          const path = `assets/uploads/${key}-${stamp}.${parts.extension}`;
          uploadFiles.push({ path, content: parts.base64 });
          cleanContent.images[key] = path;
        }
      }
      cleanContent.gallery = (cleanContent.gallery || []).map((value, index) => {
        if (typeof value === 'string' && value.startsWith('data:')) {
          const parts = dataUrlParts(value);
          const path = `assets/uploads/gallery-${String(index + 1).padStart(2, '0')}-${stamp}.${parts.extension}`;
          uploadFiles.push({ path, content: parts.base64 });
          return path;
        }
        return value;
      });

      const treeEntries = [];
      for (let i = 0; i < uploadFiles.length; i += 1) {
        publishStatus.textContent = `사진 업로드 중 ${i + 1}/${uploadFiles.length}`;
        const blob = await request('/git/blobs', { method: 'POST', body: JSON.stringify({ content: uploadFiles[i].content, encoding: 'base64' }) });
        treeEntries.push({ path: uploadFiles[i].path, mode: '100644', type: 'blob', sha: blob.sha });
      }

      publishStatus.textContent = '수정한 내용을 정리하고 있어요…';
      const contentBlob = await request('/git/blobs', {
        method: 'POST',
        body: JSON.stringify({ content: textToBase64(`${JSON.stringify(cleanContent, null, 2)}\n`), encoding: 'base64' })
      });
      treeEntries.push({ path: 'content.json', mode: '100644', type: 'blob', sha: contentBlob.sha });

      const indexResponse = await fetch(`index.html?v=${Date.now()}`);
      if (!indexResponse.ok) throw new Error('공유 정보를 넣을 index.html을 읽을 수 없습니다');
      let indexHtml = await indexResponse.text();
      const title = escapeHtml(cleanContent.meta?.title || '결혼합니다');
      const description = escapeHtml(cleanContent.meta?.description || '소중한 분들을 초대합니다.');
      const shareUrl = escapeHtml(cleanContent.meta?.shareUrl || 'https://hittto.github.io/');
      let shareImage = cleanContent.images?.shareThumbnail || cleanContent.images?.cover || '';
      try { shareImage = new URL(shareImage, cleanContent.meta?.shareUrl || location.href).href; } catch (_) { /* keep original */ }
      shareImage = escapeHtml(shareImage);
      const replaceMeta = (property, value) => {
        const pattern = new RegExp(`<meta\\s+property=["']${property}["']\\s+content=["'][^"']*["']\\s*>`, 'i');
        const tag = `<meta property="${property}" content="${value}">`;
        indexHtml = pattern.test(indexHtml) ? indexHtml.replace(pattern, tag) : indexHtml.replace('</head>', `  ${tag}\n</head>`);
      };
      indexHtml = indexHtml.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
      indexHtml = indexHtml.replace(/<meta\s+name=["']description["']\s+content=["'][^"']*["']\s*>/i, `<meta name="description" content="${description}">`);
      replaceMeta('og:title', title);
      replaceMeta('og:description', description);
      replaceMeta('og:url', shareUrl);
      replaceMeta('og:image', shareImage);
      const indexBlob = await request('/git/blobs', {
        method: 'POST',
        body: JSON.stringify({ content: textToBase64(indexHtml), encoding: 'base64' })
      });
      treeEntries.push({ path: 'index.html', mode: '100644', type: 'blob', sha: indexBlob.sha });

      const tree = await request('/git/trees', {
        method: 'POST',
        body: JSON.stringify({ base_tree: headCommit.tree.sha, tree: treeEntries })
      });
      const commit = await request('/git/commits', {
        method: 'POST',
        body: JSON.stringify({ message: `청첩장 내용 수정 (${new Date().toLocaleString('ko-KR')})`, tree: tree.sha, parents: [headSha] })
      });
      await request(`/git/refs/heads/${encodeURIComponent(branch)}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false })
      });

      content = cleanContent;
      await storeDraft(content);
      refreshAll();
      tokenInput.value = '';
      publishStatus.innerHTML = '게시가 완료되었습니다 ✓<br>GitHub Pages 반영까지 보통 1~3분 정도 걸립니다.';
      publishStatus.className = 'publish-status success';
      saveState.textContent = '게시 완료 ✓';
    } catch (error) {
      const hint = /401|Bad credentials/i.test(error.message) ? ' 토큰이 정확한지 확인해 주세요.' : /403|Resource not accessible/i.test(error.message) ? ' 토큰의 Contents 쓰기 권한을 확인해 주세요.' : '';
      publishStatus.textContent = `게시하지 못했습니다. ${error.message}.${hint}`;
      publishStatus.className = 'publish-status error';
    } finally {
      button.disabled = false;
    }
  }

  async function initialize() {
    try {
      const response = await fetch(`content.json?v=${Date.now()}`);
      if (!response.ok) throw new Error('기본 내용을 읽을 수 없습니다.');
      originalContent = await response.json();
      content = (await loadDraft()) || clone(originalContent);
      bindInputs();
      refreshAll();
      saveState.textContent = '자동 저장 준비됨';
      previewFrame.addEventListener('load', sendPreview);
    } catch (error) {
      saveState.textContent = error.message;
      alert(`편집 작업창을 시작하지 못했습니다. ${error.message}`);
    }
  }

  initialize();
})();
