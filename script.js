/* =========================================
   SAHIDANGUARD - SISTEM MUTASI
   Admin, Anggota, dan Kabag
========================================= */

const STORAGE_KEY = 'worktrack_records_v2';
const SESSION_KEY = 'worktrack_logged_user';
const DB_NAME = 'worktrack_photo_db_v1';
const DB_STORE = 'photos';

const $ = selector => document.querySelector(selector);

const today = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

const formatDate = date => {
  return new Date(`${date}T00:00:00`).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
};

const getRecords = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch (error) {
    console.error(error);
    return [];
  }
};

const getRole = () => localStorage.getItem(SESSION_KEY);
const isAdmin = () => getRole() === 'admin';
const isKabag = () => getRole() === 'kabag';

const canAddRecords = () =>
  ['admin', 'anggota'].includes(getRole());

function saveRecords(records) {
  if (!canAddRecords()) {
    alert('Akun ini tidak memiliki izin menyimpan mutasi.');
    return false;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    return true;
  } catch (error) {
    console.error(error);
    alert('Catatan gagal disimpan. Penyimpanan browser mungkin penuh.');
    return false;
  }
}

const newId = () =>
  window.crypto?.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const escapeHtml = value =>
  String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[char]));

/* =========================================
   PENYIMPANAN FOTO
========================================= */

function openPhotoDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putPhoto(id, blob) {
  if (!canAddRecords()) {
    throw new Error('Akun ini tidak boleh menambah foto.');
  }

  const db = await openPhotoDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put({ id, blob });

    tx.oncomplete = () => {
      db.close();
      resolve();
    };

    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };

    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function getPhoto(id) {
  const db = await openPhotoDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const request = tx.objectStore(DB_STORE).get(id);

    request.onsuccess = () => {
      const result = request.result?.blob || null;
      db.close();
      resolve(result);
    };

    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

async function deletePhoto(id) {
  if (!isAdmin()) {
    throw new Error('Hanya Admin yang boleh menghapus foto.');
  }

  const db = await openPhotoDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(id);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };

    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function deletePhotoForCleanup(id) {
  const db = await openPhotoDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(id);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };

    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

function validatePhotos(input) {
  if (!input) return true;

  if (input.files.length > 2) {
    alert('Maksimal hanya 2 foto.');
    input.value = '';
    return false;
  }

  for (const file of input.files) {
    if (!file.type.startsWith('image/')) {
      alert('File harus berupa gambar.');
      input.value = '';
      return false;
    }
  }

  return true;
}

async function compressPhoto(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Foto gagal dibaca.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Foto tidak bisa dibuka.'));
    image.src = dataUrl;
  });

  const maxSize = 1200;
  const scale = Math.min(
    1,
    maxSize / Math.max(img.width, img.height)
  );

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));

  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Tidak bisa memproses foto.');
  }

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob
        ? resolve(blob)
        : reject(new Error('Kompres foto gagal.')),
      'image/jpeg',
      0.7
    );
  });
}

async function filesToPhotoRefs(files, recordId) {
  if (!canAddRecords()) {
    throw new Error('Akun ini tidak boleh menambah foto.');
  }

  const refs = [];
  const selected = Array.from(files || []).slice(0, 2);

  for (let i = 0; i < selected.length; i++) {
    const blob = await compressPhoto(selected[i]);
    const id = `${recordId}_${i}_${Date.now()}`;

    await putPhoto(id, blob);
    refs.push({ dbPhotoId: id });
  }

  return refs;
}

/* =========================================
   TANGGAL
========================================= */

function setDateDefaults() {
  const date = today();

  if ($('#dailyDate')) $('#dailyDate').value = date;
  if ($('#vehicleDate')) $('#vehicleDate').value = date;

  if ($('#dailyDateBadge')) {
    $('#dailyDateBadge').textContent = formatDate(date);
  }
}

/* =========================================
   NAVIGASI HALAMAN
========================================= */

function showView(id) {
  // Kabag hanya boleh membuka Lihat Mutasi dan Cari.
  if (
    isKabag() &&
    !['recordsView', 'searchView'].includes(id)
  ) {
    id = 'recordsView';
  }

  document.querySelectorAll('.content-view').forEach(view => {
    view.classList.toggle('hidden', view.id !== id);
  });

  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.view === id);
  });

  if (id === 'recordsView') {
    renderRecords(getRecords(), $('#recordsContainer'));
  }
}

/* =========================================
   TOMBOL FOTO, EDIT, DAN HAPUS
========================================= */

function photoButtons(record) {
  if (!record.photos?.length) return '';

  return `
    <button class="btn secondary small photo-btn"
      data-id="${escapeHtml(record.id)}">
      Lihat Foto (${record.photos.length})
    </button>
  `;
}

function adminButtons(record) {
  if (!isAdmin()) return '';

  return `
    <div class="record-actions">
      <button class="btn secondary small edit-btn"
        data-id="${escapeHtml(record.id)}">Edit</button>

      <button class="btn danger small delete-btn"
        data-id="${escapeHtml(record.id)}">Hapus</button>

      ${photoButtons(record)}
    </div>
  `;
}

/* =========================================
   TAMPILAN SATU CATATAN MUTASI
========================================= */

function renderRecord(record) {
  let html = '';

  if (record.type === 'daily') {
    html = `
      <div class="record-item">
        <h3>Mutasi Harian</h3>

        <div class="record-meta">
          <span class="meta">
            Shift: ${escapeHtml(record.shift)}
          </span>

          <span class="meta">
            Petugas: ${escapeHtml(record.officer)}
          </span>
        </div>

        <p class="record-note">
          ${escapeHtml(record.note)}
        </p>
    `;
  } else {
    html = `
      <div class="record-item">
        <h3>
          Mutasi Kendaraan — ${escapeHtml(record.unit)}
        </h3>

        <div class="record-meta">
          <span class="meta">
            Driver: ${escapeHtml(record.driver)}
          </span>

          <span class="meta">
            Keluar: ${escapeHtml(record.outTime || '-')}
          </span>

          <span class="meta">
            Masuk: ${escapeHtml(record.inTime || '-')}
          </span>

          <span class="meta">
            KM: ${escapeHtml(record.outKm || '-')}
            → ${escapeHtml(record.inKm || '-')}
          </span>
        </div>

        <p class="record-note">
          ${escapeHtml(record.note || 'Tidak ada keterangan.')}
        </p>
    `;
  }

  return html +
    (isAdmin() ? adminButtons(record) : photoButtons(record)) +
    '</div>';
}

/* =========================================
   TAMPILKAN DAFTAR MUTASI
========================================= */

function renderRecords(records, container) {
  if (!container) return;

  if (!records.length) {
    container.innerHTML = `
      <div class="empty">
        Belum ada mutasi yang tersimpan.
      </div>
    `;
    return;
  }

  const grouped = {};

  [...records]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .forEach(record => {
      (grouped[record.date] ??= []).push(record);
    });

  container.innerHTML = Object.entries(grouped)
    .map(([date, items]) => `
      <article class="record-day">
        <div class="record-day-header">
          <strong>${formatDate(date)}</strong>
          <span>${items.length} catatan</span>
        </div>

        <div class="record-body">
          ${items.map(renderRecord).join('')}
        </div>
      </article>
    `)
    .join('');
}

/* =========================================
   BUKA FOTO
========================================= */

async function openPhotos(recordId) {
  const record = getRecords().find(item => item.id === recordId);

  if (!record || !record.photos?.length) {
    alert('Foto tidak ditemukan.');
    return;
  }

  const container = $('#modalPhotos');
  const modal = $('#photoModal');

  if (!container || !modal) return;

  container.innerHTML = '<p>Memuat foto...</p>';
  modal.classList.remove('hidden');

  try {
    const images = [];

    for (const photo of record.photos) {
      if (photo.dbPhotoId) {
        const blob = await getPhoto(photo.dbPhotoId);

        if (blob) {
          images.push(URL.createObjectURL(blob));
        }
      } else if (typeof photo === 'string') {
        // Mendukung foto format lama yang disimpan sebagai data URL.
        images.push(photo);
      }
    }

    if (!images.length) {
      container.innerHTML = '<p>File foto tidak ditemukan.</p>';
      return;
    }

    container.innerHTML = images.map((src, index) => `
      <img
        src="${src}"
        alt="Dokumentasi foto ${index + 1}"
        style="max-width:100%;height:auto;margin-bottom:10px;"
      >
    `).join('');
  } catch (error) {
    console.error(error);
    container.innerHTML = '<p>Gagal membuka foto.</p>';
  }
}

function closePhoto() {
  const container = $('#modalPhotos');

  if (container) {
    container.querySelectorAll('img').forEach(img => {
      if (img.src.startsWith('blob:')) {
        URL.revokeObjectURL(img.src);
      }
    });

    container.innerHTML = '';
  }

  $('#photoModal')?.classList.add('hidden');
}

/* =========================================
   EDIT MUTASI - ADMIN SAJA
========================================= */

function editRecord(id) {
  if (!isAdmin()) {
    alert('Hanya Admin yang dapat mengedit.');
    return;
  }

  const records = getRecords();
  const record = records.find(item => item.id === id);

  if (!record) return;

  if (record.type === 'daily') {
    const note = prompt('Edit catatan mutasi harian:', record.note);
    if (note === null) return;

    const officer = prompt('Edit nama petugas:', record.officer);
    if (officer === null) return;

    record.note = note;

    if (officer.trim()) {
      record.officer = officer.trim();
    }

    const shift = prompt('Edit shift (PAGI/SIANG/MALAM):', record.shift);
    if (shift === null) return;

    if (shift.trim()) {
      record.shift = shift.trim().toUpperCase();
    }
  } else {
    const unit = prompt('Edit unit kendaraan:', record.unit);
    if (unit === null) return;

    const driver = prompt('Edit driver:', record.driver);
    if (driver === null) return;

    const note = prompt('Edit keterangan:', record.note || '');
    if (note === null) return;

    record.unit = unit;
    record.driver = driver;
    record.note = note;

    const outTime = prompt('Edit jam keluar:', record.outTime || '');
    if (outTime === null) return;

    const inTime = prompt('Edit jam masuk:', record.inTime || '');
    if (inTime === null) return;

    record.outTime = outTime;
    record.inTime = inTime;
  }

  if (saveRecords(records)) {
    renderRecords(getRecords(), $('#recordsContainer'));
    renderRecords(getRecords().filter(r => r.date === $('#searchDate')?.value), $('#searchResult'));
    alert('Mutasi berhasil diperbarui.');
  }
}

/* =========================================
   HAPUS MUTASI - ADMIN SAJA
========================================= */

async function deleteRecord(id) {
  if (!isAdmin()) {
    alert('Hanya Admin yang dapat menghapus.');
    return;
  }

  if (!confirm('Yakin ingin menghapus catatan ini?')) return;

  const records = getRecords();
  const record = records.find(item => item.id === id);

  if (!record) return;

  const updated = records.filter(item => item.id !== id);

  if (!saveRecords(updated)) return;

  try {
    for (const photo of record.photos || []) {
      if (photo.dbPhotoId) {
        await deletePhoto(photo.dbPhotoId);
      }
    }
  } catch (error) {
    console.error(error);
    alert('Catatan dihapus, tetapi sebagian foto mungkin masih tersimpan.');
  }

  renderRecords(getRecords(), $('#recordsContainer'));

  if ($('#searchDate')?.value) {
    renderRecords(
      getRecords().filter(r => r.date === $('#searchDate').value),
      $('#searchResult')
    );
  }

  alert('Mutasi berhasil dihapus.');
}

/* =========================================
   LOGIN DAN HAK AKSES
========================================= */

function updateLoginView() {
  const user = getRole();

  if (!user) {
    $('#loginPage')?.classList.remove('hidden');
    $('#dashboardPage')?.classList.add('hidden');
    return;
  }

  const labels = {
    admin: 'Admin',
    anggota: 'Anggota',
    kabag: 'Kabag'
  };

  $('#loggedUser') &&
    ($('#loggedUser').textContent = `Login: ${labels[user] || user}`);

  $('#loginPage')?.classList.add('hidden');
  $('#dashboardPage')?.classList.remove('hidden');

  const readOnly = isKabag();

  // Sembunyikan kedua menu input untuk Kabag.
  document.querySelectorAll('[data-view="dailyView"], [data-view="vehicleView"]')
    .forEach(tab => tab.classList.toggle('hidden', readOnly));

  // Berlaku juga jika HTML belum memiliki data-add-only.
  document.querySelectorAll('[data-add-only]')
    .forEach(element => element.classList.toggle('hidden', readOnly));

  // Form input tidak ditampilkan kepada Kabag.
  ['#dailyForm', '#vehicleForm'].forEach(selector => {
    const form = $(selector);

    if (form) {
      form.classList.toggle('hidden', readOnly);
    }
  });

  setDateDefaults();

  // Kabag langsung diarahkan ke Lihat Mutasi.
  showView(readOnly ? 'recordsView' : 'dailyView');

  renderRecords(getRecords(), $('#recordsContainer'));
}

$('#loginForm')?.addEventListener('submit', event => {
  event.preventDefault();

  const username = $('#username')?.value.trim().toLowerCase();
  const password = $('#password')?.value;

  if (username === 'windy' && password === '141414') {
    localStorage.setItem(SESSION_KEY, 'admin');
  } else if (
    username === 'anggota' &&
    password === 'anggota123'
  ) {
    localStorage.setItem(SESSION_KEY, 'anggota');
  } else if (
    username === 'kabag' &&
    password === 'kabag123'
  ) {
    localStorage.setItem(SESSION_KEY, 'kabag');
  } else {
    alert('Username atau password salah.');
    return;
  }

  updateLoginView();
});

$('#logoutBtn')?.addEventListener('click', () => {
  localStorage.removeItem(SESSION_KEY);
  location.reload();
});

/* =========================================
   SIMPAN MUTASI HARIAN
========================================= */

$('#dailyPhoto')?.addEventListener('change', event => {
  validatePhotos(event.target);
});

$('#vehiclePhoto')?.addEventListener('change', event => {
  validatePhotos(event.target);
});

$('#dailyForm')?.addEventListener('submit', async event => {
  event.preventDefault();

  if (!canAddRecords()) {
    alert('Akun ini tidak memiliki izin menambahkan mutasi.');
    return;
  }

  const form = event.currentTarget;
  const photoInput = $('#dailyPhoto');

  if (!validatePhotos(photoInput)) return;

  const record = {
    id: newId(),
    type: 'daily',
    date: $('#dailyDate').value,
    shift: $('#dailyShift').value,
    officer: $('#dailyOfficer').value.trim(),
    note: $('#dailyNote').value.trim(),
    photos: []
  };

  const submitButton = form.querySelector('[type="submit"]');

  try {
    if (submitButton) submitButton.disabled = true;

    record.photos = await filesToPhotoRefs(
      photoInput?.files || [],
      record.id
    );

    const records = getRecords();
    records.push(record);

    if (!saveRecords(records)) {
      for (const photo of record.photos) {
        if (photo.dbPhotoId) {
          await deletePhotoForCleanup(photo.dbPhotoId);
        }
      }

      return;
    }

    form.reset();
    setDateDefaults();

    renderRecords(getRecords(), $('#recordsContainer'));

    alert('Mutasi harian berhasil disimpan.');
  } catch (error) {
    console.error('Gagal menyimpan mutasi harian:', error);
    alert('Mutasi gagal disimpan. Periksa foto dan penyimpanan browser.');
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

/* =========================================
   SIMPAN MUTASI KENDARAAN
========================================= */

$('#vehicleForm')?.addEventListener('submit', async event => {
  event.preventDefault();

  if (!canAddRecords()) {
    alert('Akun ini tidak memiliki izin menambahkan mutasi.');
    return;
  }

  const form = event.currentTarget;
  const photoInput = $('#vehiclePhoto');

  if (!validatePhotos(photoInput)) return;

  const record = {
    id: newId(),
    type: 'vehicle',
    date: $('#vehicleDate').value,
    unit: $('#vehicleUnit').value.trim(),
    driver: $('#vehicleDriver').value.trim(),
    outTime: $('#outTime').value,
    inTime: $('#inTime').value,
    outKm: $('#outKm').value,
    inKm: $('#inKm').value,
    note: $('#vehicleNote').value.trim(),
    photos: []
  };

  const submitButton = form.querySelector('[type="submit"]');

  try {
    if (submitButton) submitButton.disabled = true;

    record.photos = await filesToPhotoRefs(
      photoInput?.files || [],
      record.id
    );

    const records = getRecords();
    records.push(record);

    if (!saveRecords(records)) {
      for (const photo of record.photos) {
        if (photo.dbPhotoId) {
          await deletePhotoForCleanup(photo.dbPhotoId);
        }
      }

      return;
    }

    form.reset();
    setDateDefaults();

    renderRecords(getRecords(), $('#recordsContainer'));

    alert('Mutasi kendaraan berhasil disimpan.');
  } catch (error) {
    console.error('Gagal menyimpan mutasi kendaraan:', error);
    alert('Mutasi kendaraan gagal disimpan. Periksa foto dan penyimpanan browser.');
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

/* =========================================
   CARI MUTASI BERDASARKAN TANGGAL
========================================= */

$('#searchForm')?.addEventListener('submit', event => {
  event.preventDefault();

  const date = $('#searchDate').value;

  const records = getRecords().filter(record => record.date === date);

  renderRecords(records, $('#searchResult'));
});

/* =========================================
   NAVIGASI MENU
========================================= */

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.dataset.view) {
      showView(tab.dataset.view);
    }
  });
});

$('#closeRecordsBtn')?.addEventListener('click', () => {
  // Kabag tidak diarahkan ke halaman input.
  showView(isKabag() ? 'recordsView' : 'dailyView');
});

$('#closePhotoBtn')?.addEventListener('click', closePhoto);

$('#photoModal')?.addEventListener('click', event => {
  if (event.target.id === 'photoModal') {
    closePhoto();
  }
});

document.addEventListener('click', event => {
  const photoButton = event.target.closest('.photo-btn');
  const editButton = event.target.closest('.edit-btn');
  const deleteButton = event.target.closest('.delete-btn');

  if (photoButton) {
    openPhotos(photoButton.dataset.id);
  }

  if (editButton && isAdmin()) {
    editRecord(editButton.dataset.id);
  }

  if (deleteButton && isAdmin()) {
    deleteRecord(deleteButton.dataset.id);
  }
});

/* =========================================
   MULAI APLIKASI
========================================= */

setDateDefaults();
updateLoginView();