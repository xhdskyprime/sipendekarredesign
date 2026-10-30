/**
 * modern_app.js - SiPENDEKAR Assistant (Modern Mobile Edition)
 * Private Isolated User Sessions, Progress Tracking, Dynamic SKP Selector,
 * and Live e-Kinerja Filing.
 */

const AppState = {
  currentUser: null,
  currentTab: 'progress',
  selectedActivity: null,
  searchTimeout: null,
  isWidescreen: localStorage.getItem('sipendekar_widescreen') === 'true'
};

document.addEventListener('DOMContentLoaded', () => {
  initWidescreenMode();
  setupEventListeners();
  checkAuth();
});

function initWidescreenMode() {
  const container = document.getElementById('app-container');
  const btn = document.getElementById('toggle-widescreen-btn');
  if (AppState.isWidescreen) {
    if (container) container.classList.add('widescreen-mode');
    if (btn) btn.innerHTML = '📱 Mobile View';
  } else {
    if (container) container.classList.remove('widescreen-mode');
    if (btn) btn.innerHTML = '🖥️ Widescreen';
  }
}

function toggleWidescreen() {
  AppState.isWidescreen = !AppState.isWidescreen;
  localStorage.setItem('sipendekar_widescreen', AppState.isWidescreen);
  initWidescreenMode();
}

// ==============================================================================
// AUTENTIKASI PRIBADI & ISOLASI AKUN
// ==============================================================================

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me').then(r => r.json());
    if (res.success && res.authenticated) {
      AppState.currentUser = res.user;
      showAuthenticatedView(res.user);
    } else {
      showLoginView();
    }
  } catch (e) {
    console.error("Auth check error:", e);
    showLoginView();
  }
}

function showLoginView() {
  const loginView = document.getElementById('view-login');
  const authView = document.getElementById('view-authenticated');
  const userBtn = document.getElementById('user-logout-btn');

  if (loginView) loginView.style.display = 'block';
  if (authView) authView.style.display = 'none';
  if (userBtn) userBtn.style.display = 'none';
}

function showAuthenticatedView(user) {
  const loginView = document.getElementById('view-login');
  const authView = document.getElementById('view-authenticated');
  const userBtn = document.getElementById('user-logout-btn');

  if (loginView) loginView.style.display = 'none';
  if (authView) authView.style.display = 'block';
  if (userBtn) userBtn.style.display = 'inline-flex';

  // Update Hero Card
  const nameEl = document.getElementById('hero-user-name');
  const nipEl = document.getElementById('hero-user-nip');
  const avatarEl = document.getElementById('hero-user-avatar');

  if (nameEl) nameEl.textContent = user.name;
  if (nipEl) nipEl.textContent = `NIP: ${user.nip}`;
  if (avatarEl) {
    avatarEl.textContent = user.name.slice(0, 2).toUpperCase();
    if (user.avatar_color) avatarEl.style.backgroundColor = user.avatar_color;
  }

  // Set default date picker ke hari ini
  const tglInput = document.getElementById('form-tanggal');
  if (tglInput && !tglInput.value) {
    tglInput.value = new Date().toISOString().split('T')[0];
  }

  // Load Initial Tab Data
  switchTab('progress');
  searchCatalog("", "ALL");
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const nip = document.getElementById('login-nip').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const name = document.getElementById('login-name').value.trim();

  if (!nip || !password) {
    showToast("NIP dan Password wajib diisi.", "error");
    return;
  }

  const btn = document.getElementById('btn-submit-login');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Menghubungkan ke SiPENDEKAR...`;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nip, password, name })
    }).then(r => r.json());

    if (res.success) {
      showToast(res.message, "success");
      AppState.currentUser = res.user;
      showAuthenticatedView(res.user);
    } else {
      showToast(res.error || "Login gagal.", "error");
    }
  } catch (err) {
    showToast("Gagal terhubung ke server: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `Masuk ke Akun Saya 🚀`;
  }
}

async function handleLogout() {
  if (!confirm("Apakah Anda yakin ingin keluar dari akun ini?")) return;
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    AppState.currentUser = null;
    showToast("Berhasil logout.", "success");
    showLoginView();
  } catch (e) {
    showToast("Gagal logout.", "error");
  }
}

// ==============================================================================
// NAVIGATION & TABS
// ==============================================================================

function switchTab(tabName) {
  AppState.currentTab = tabName;

  // Bottom Navigation buttons
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Pages
  document.querySelectorAll('.page-view').forEach(p => {
    if (p.id === `page-${tabName}`) {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });

  if (tabName === 'progress') {
    fetchProgress();
  } else if (tabName === 'history') {
    fetchHistory();
  }
}

// ==============================================================================
// TAB 1: PROGRES & KALENDER
// ==============================================================================

async function fetchProgress(year = null, month = null) {
  try {
    const params = new URLSearchParams();
    if (year) params.append('year', year);
    if (month) params.append('month', month);

    const res = await fetch(`/api/progress?${params}`).then(r => r.json());
    if (res.success) {
      renderProgressStats(res);
      renderCalendarGrid(res.calendar);
      renderUrgencyAlert(res.empty_days_h7);
    } else {
      if (res.authenticated === false) {
        showLoginView();
      } else {
        showToast(res.error || "Gagal memuat progres.", "error");
      }
    }
  } catch (e) {
    console.error("Fetch progress error:", e);
  }
}

function renderProgressStats(data) {
  const sum = data.summary;
  const per = data.periode;

  // Month title
  const monthTitle = document.getElementById('cal-month-title');
  if (monthTitle) {
    monthTitle.textContent = `${per.bulan_nama} ${per.tahun}`;
  }

  // Circular Meter
  const pct = sum.persentase_berjalan;
  const pctEl = document.getElementById('stat-pct-val');
  if (pctEl) pctEl.textContent = `${pct}%`;

  const circleBar = document.getElementById('circle-progress-bar');
  if (circleBar) {
    const offset = 157 - (157 * pct / 100);
    circleBar.style.strokeDashoffset = offset;
    if (pct >= 80) circleBar.style.stroke = '#10b981';
    else if (pct >= 50) circleBar.style.stroke = '#f59e0b';
    else circleBar.style.stroke = '#ef4444';
  }

  // Stat 2: Hari Kerja Terisi
  const kerjaEl = document.getElementById('stat-hari-kerja');
  if (kerjaEl) kerjaEl.textContent = `${sum.hari_terisi} / ${sum.hari_kerja_berlalu} Hari`;

  // Stat 3: Menit Hari Ini
  const todayMenitEl = document.getElementById('stat-today-menit');
  if (todayMenitEl) todayMenitEl.textContent = `${sum.today_menit} / ${sum.today_target} m`;
  const todayBadge = document.getElementById('stat-today-badge');
  if (todayBadge) {
    if (sum.today_terisi) {
      todayBadge.textContent = "TERISI LENGKAP ✅";
      todayBadge.style.color = "#10b981";
    } else {
      todayBadge.textContent = "BELUM DIISI ⚠️";
      todayBadge.style.color = "#ef4444";
    }
  }

  // Stat 4: Hari Bolong H-7
  const h7CountEl = document.getElementById('stat-h7-count');
  if (h7CountEl) {
    h7CountEl.textContent = `${sum.hari_kosong_h7} Hari`;
    h7CountEl.style.color = (sum.hari_kosong_h7 > 0) ? '#ef4444' : '#10b981';
  }
}

function renderUrgencyAlert(emptyDays) {
  const banner = document.getElementById('urgent-banner');
  if (!banner) return;

  if (!emptyDays || emptyDays.length === 0) {
    banner.style.display = 'none';
    return;
  }

  banner.style.display = 'flex';
  const textEl = document.getElementById('urgent-info-text');
  if (textEl) {
    const datesStr = emptyDays.map(d => `${d.hari_nama} (${d.tanggal.slice(8, 10)}/${d.tanggal.slice(5, 7)})`).join(', ');
    textEl.textContent = `Ada ${emptyDays.length} hari kerja belum terisi: ${datesStr}. Segera laporkan sebelum terkunci otomatis oleh sistem BKPSDM!`;
  }
}

function renderCalendarGrid(cells) {
  const grid = document.getElementById('cal-days-grid');
  if (!grid) return;

  grid.innerHTML = '';
  cells.forEach(cell => {
    const el = document.createElement('div');
    el.className = `cal-cell-day ${cell.status}`;

    let tagHtml = '';
    if (cell.is_terisi) {
      tagHtml = `<span class="cal-pill-badge terisi">TERISI</span>`;
    } else if (cell.status === 'kosong-bisa') {
      tagHtml = `<span class="cal-pill-badge kosong">KOSONG</span>`;
    }

    el.innerHTML = `
      <span class="cal-day-num">${cell.hari_ke}</span>
      ${tagHtml}
    `;

    el.onclick = () => onCalendarCellClick(cell);
    grid.appendChild(el);
  });
}

async function onCalendarCellClick(cell) {
  if (cell.is_future) {
    showToast("Tanggal masa depan belum bisa diisi.", "info");
    return;
  }
  if (cell.is_weekend) {
    showToast("Hari libur akhir pekan (Sabtu/Minggu).", "info");
    return;
  }

  openDayDetailModal(cell.tanggal, cell.is_terisi, cell.status);
}

async function openDayDetailModal(dateStr, isTerisi, status) {
  const modal = document.getElementById('modal-day-detail');
  if (!modal) return;

  document.getElementById('modal-day-title').textContent = `Aktivitas Tanggal ${dateStr}`;
  const content = document.getElementById('modal-day-content');
  content.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-muted);">Memeriksa rincian...</div>`;
  modal.classList.add('active');

  try {
    const res = await fetch(`/api/days/${dateStr}`).then(r => r.json());
    if (res.success) {
      content.innerHTML = `
        <div style="margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; background: var(--bg-subtle); padding: 10px 14px; border-radius: 10px;">
          <span style="font-weight: 700; color: var(--text-primary);">Total Durasi: ${res.total_menit} Menit</span>
          <span class="pill-tag ${res.is_terisi ? 'green' : 'blue'}">${res.is_terisi ? 'SUDAH TERISI' : 'BELUM TERISI'}</span>
        </div>
      `;

      if (res.detail && res.detail.length > 0) {
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.flexDirection = 'column';
        wrap.style.gap = '10px';

        res.detail.forEach(item => {
          const card = document.createElement('div');
          card.style.background = '#ffffff';
          card.style.border = '1px solid var(--border-light)';
          card.style.borderRadius = '12px';
          card.style.padding = '12px';
          card.style.boxShadow = 'var(--shadow-sm)';

          card.innerHTML = `
            <div style="font-size: 13px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">${item.nama_aktifitas}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">
              Jam: ${item.jam_mulai} - ${item.jam_selesai} (${item.durasi_menit} Menit) | Volume: ${item.volume}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 12px; color: var(--text-secondary);">${item.keterangan || '-'}</span>
              <button class="icon-btn" style="color: var(--danger); border-color: var(--danger-border); padding: 4px 8px;" onclick="deleteActivityItem(${item.id})">
                🗑️ Hapus
              </button>
            </div>
          `;
          wrap.appendChild(card);
        });
        content.appendChild(wrap);
      } else {
        content.innerHTML += `
          <div style="text-align:center; padding: 24px 0; color: var(--text-muted); font-size: 13px;">
            Belum ada aktivitas yang dilaporkan pada tanggal ini.
          </div>
        `;
      }

      if (status === 'kosong-bisa' || !res.is_terisi) {
        const fillBtn = document.createElement('button');
        fillBtn.className = 'btn-primary';
        fillBtn.style.marginTop = '16px';
        fillBtn.innerHTML = `✍️ Isi Laporan Tanggal Ini (${dateStr})`;
        fillBtn.onclick = () => {
          closeModal('modal-day-detail');
          switchTab('activities');
          document.getElementById('form-tanggal').value = dateStr;
        };
        content.appendChild(fillBtn);
      }
    }
  } catch (e) {
    content.innerHTML = `<div style="color: var(--danger);">Gagal mengambil rincian tanggal.</div>`;
  }
}

async function deleteActivityItem(id) {
  if (!confirm(`Hapus aktivitas ID #${id}?`)) return;
  try {
    const res = await fetch('/api/activity/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    }).then(r => r.json());

    if (res.success) {
      showToast("Aktivitas berhasil dihapus.", "success");
      closeModal('modal-day-detail');
      fetchProgress();
    }
  } catch (e) {
    showToast("Gagal menghapus aktivitas.", "error");
  }
}

async function executeAutoFillH7() {
  if (!confirm("Jalankan Auto-Fill untuk SEMUA hari kerja yang masih kosong dalam 7 hari terakhir?")) return;

  const btn = document.getElementById('btn-autofill-action');
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Mengisi Otomatis...";
  }

  try {
    const res = await fetch('/api/fill/auto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }).then(r => r.json());

    if (res.success) {
      showToast(res.message, "success");
      fetchProgress();
    } else {
      showToast(res.error || "Gagal auto-fill.", "error");
    }
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `⚡ Auto-Fill Semua Hari Bolong H-7`;
    }
  }
}

// ==============================================================================
// TAB 2: PILIH KEGIATAN & SKP DINAMIS
// ==============================================================================

function onCatalogSearchInput() {
  clearTimeout(AppState.searchTimeout);
  AppState.searchTimeout = setTimeout(() => {
    const q = document.getElementById('catalog-search-query').value.trim();
    const activeBtn = document.querySelector('.filter-btn.active');
    const cat = activeBtn ? activeBtn.dataset.cat : 'ALL';
    searchCatalog(q, cat);
  }, 200);
}

function filterCategory(cat, btnEl) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');
  const q = document.getElementById('catalog-search-query').value.trim();
  searchCatalog(q, cat);
}

async function searchCatalog(q = '', kategori = 'ALL') {
  const container = document.getElementById('catalog-grid-items');
  if (!container) return;

  container.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding: 20px; color: var(--text-muted);">Memuat kegiatan...</div>`;

  try {
    const params = new URLSearchParams({ q, kategori, limit: 30 });
    const res = await fetch(`/api/catalog?${params}`).then(r => r.json());

    if (res.success && res.items) {
      container.innerHTML = '';
      if (res.items.length === 0) {
        container.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding: 30px; color: var(--text-muted);">Tidak ada kegiatan yang sesuai kata kunci.</div>`;
        return;
      }

      res.items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'catalog-item-card';
        card.onclick = () => selectActivity(item);

        card.innerHTML = `
          <div>
            <div class="catalog-item-code">${item.kode_aktifitas}</div>
            <div class="catalog-item-name">${item.nama_aktifitas}</div>
          </div>
          <div class="catalog-item-meta">
            <span>⏱️ ${item.waktu || 0} Menit</span>
            <span class="pill-tag blue">${item.satuan_output || 'Kegiatan'}</span>
          </div>
        `;
        container.appendChild(card);
      });
    }
  } catch (e) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align:center; color: var(--danger);">Gagal memuat katalog.</div>`;
  }
}

async function selectActivity(item) {
  AppState.selectedActivity = item;

  // Tampilkan Banner Terpilih
  const banner = document.getElementById('selected-activity-banner');
  if (banner) {
    banner.style.display = 'flex';
    document.getElementById('sel-act-title').textContent = item.nama_aktifitas;
    document.getElementById('sel-act-code').textContent = item.kode_aktifitas;
    document.getElementById('sel-act-time').textContent = `Standar: ${item.waktu} Menit`;
    document.getElementById('sel-act-satuan').textContent = item.satuan_output || 'Kegiatan';
  }

  // Pre-fill Form
  document.getElementById('form-kode-act').value = item.kode_aktifitas;
  document.getElementById('form-volume').value = "1";
  
  const ketInput = document.getElementById('form-keterangan');
  if (ketInput) {
    ketInput.value = item.nama_aktifitas.toLowerCase();
  }

  calculateDuration();

  // Scroll ke form
  document.getElementById('form-card-container').scrollIntoView({ behavior: 'smooth' });

  // Ambil daftar SKP Dinamis untuk aktivitas ini
  await fetchSkpForActivity(item.kode_aktifitas);
}

async function fetchSkpForActivity(kode) {
  const skpSelect = document.getElementById('form-skp-select');
  if (!skpSelect) return;

  skpSelect.innerHTML = `<option value="">Mengambil SKP valid untuk akun Anda...</option>`;

  try {
    const res = await fetch(`/api/skp?kode_aktivitas=${encodeURIComponent(kode)}`).then(r => r.json());
    if (res.success && res.skp && res.skp.length > 0) {
      skpSelect.innerHTML = '';
      res.skp.forEach((s, idx) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.nama} (#${s.id})`;
        if (idx === 0) opt.selected = true;
        skpSelect.appendChild(opt);
      });
    } else {
      skpSelect.innerHTML = `<option value="0">Tupoksi Umum / SKP Standar</option>`;
    }
  } catch (e) {
    skpSelect.innerHTML = `<option value="0">Tupoksi Umum / SKP Standar</option>`;
  }
}

function calculateDuration() {
  const jm = parseInt(document.getElementById('form-jam-mulai').value || 7, 10);
  const mm = parseInt(document.getElementById('form-menit-mulai').value || 30, 10);
  const js = parseInt(document.getElementById('form-jam-selesai').value || 17, 10);
  const ms = parseInt(document.getElementById('form-menit-selesai').value || 30, 10);
  const vol = parseInt(document.getElementById('form-volume').value || 1, 10);

  const rentangJam = ((js * 60) + ms) - ((jm * 60) + mm);
  const waktuStd = (AppState.selectedActivity && AppState.selectedActivity.waktu) ? AppState.selectedActivity.waktu : 0;
  const totalKinerja = waktuStd > 0 ? (waktuStd * vol) : rentangJam;

  const durLabel = document.getElementById('duration-calc-label');
  if (durLabel) {
    if (waktuStd > 0) {
      durLabel.textContent = `Total Diakui SiPENDEKAR: ${totalKinerja} Menit (${(totalKinerja / 60).toFixed(1)} Jam) [${vol} Vol × ${waktuStd}m]`;
    } else {
      durLabel.textContent = `Durasi: ${rentangJam} Menit (${(rentangJam / 60).toFixed(1)} Jam)`;
    }
    if (totalKinerja >= 600) {
      durLabel.style.color = '#10b981';
    } else {
      durLabel.style.color = '#2563eb';
    }
  }
}

async function handleActivityFormSubmit(e) {
  e.preventDefault();
  const kode = document.getElementById('form-kode-act').value;
  if (!kode) {
    showToast("Silakan pilih kegiatan terlebih dahulu dari daftar di bawah!", "error");
    return;
  }

  const tanggal = document.getElementById('form-tanggal').value;
  const volume = document.getElementById('form-volume').value;
  const skpId = document.getElementById('form-skp-select').value;
  const jamM = document.getElementById('form-jam-mulai').value;
  const menitM = document.getElementById('form-menit-mulai').value;
  const jamS = document.getElementById('form-jam-selesai').value;
  const menitS = document.getElementById('form-menit-selesai').value;
  const keterangan = document.getElementById('form-keterangan').value;

  const btn = document.getElementById('btn-submit-activity');
  btn.disabled = true;
  btn.textContent = "Mengirim ke SiPENDEKAR...";

  try {
    const payload = {
      tanggal,
      kode_aktifitas: kode,
      nama_aktifitas: AppState.selectedActivity ? AppState.selectedActivity.nama_aktifitas : kode,
      volume: parseInt(volume, 10) || 1,
      keterangan,
      sasaran_kerja_id: parseInt(skpId, 10) || 0,
      jam_mulai: jamM,
      menit_mulai: menitM,
      jam_selesai: jamS,
      menit_selesai: menitS,
      jenis: "kinerja"
    };

    const res = await fetch('/api/fill/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => r.json());

    if (res.success) {
      showToast(`Sukses terisi! (${res.durasi_menit} Menit)`, "success");
      switchTab('progress');
    } else {
      showToast(res.error || "Gagal mengisi laporan.", "error");
    }
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "🚀 Kirim Laporan ke SiPENDEKAR";
  }
}

// ==============================================================================
// TAB 3: RIWAYAT LAPORAN
// ==============================================================================

async function fetchHistory() {
  const container = document.getElementById('history-list-container');
  if (!container) return;

  container.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-muted);">Memuat riwayat...</div>`;

  try {
    const res = await fetch('/api/history').then(r => r.json());
    if (res.success && res.logs) {
      container.innerHTML = '';
      if (res.logs.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding: 30px; color: var(--text-muted);">Belum ada riwayat aktivitas untuk akun ini.</div>`;
        return;
      }

      res.logs.forEach(log => {
        const card = document.createElement('div');
        card.className = 'history-card';
        card.innerHTML = `
          <div>
            <div class="history-text">${log.message}</div>
            <div class="history-time">${log.created_at}</div>
          </div>
          <span class="pill-tag green">Sukses</span>
        `;
        container.appendChild(card);
      });
    }
  } catch (e) {
    container.innerHTML = `<div style="color: var(--danger);">Gagal memuat riwayat.</div>`;
  }
}

// ==============================================================================
// MODALS & UTILITIES
// ==============================================================================

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('active');
}

function showToast(text, type = "normal") {
  const toast = document.getElementById('app-toast');
  if (!toast) return;

  document.getElementById('toast-message').textContent = text;
  toast.className = 'app-toast show';
  if (type === 'success') toast.classList.add('success');
  if (type === 'error') toast.classList.add('error');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}

function setupEventListeners() {
  ['form-jam-mulai', 'form-menit-mulai', 'form-jam-selesai', 'form-menit-selesai'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', calculateDuration);
  });

  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  });
}
