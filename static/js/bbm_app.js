/**
 * bbm_app.js - Master JavaScript Logic for SiPENDEKAR Calo (BBM Edition)
 * Handles State Management, Web Audio Synthesizer, Dynamic SKP Fetching,
 * Progress Calculation, Multi-Account Switching, Chat Assistant & PING Effects.
 */

// ==============================================================================
// 1. WEB AUDIO SYNTHESIZER (VINTAGE BBM SOUNDS)
// ==============================================================================

class BbmSoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  _initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Iconic BBM PING!!! Buzzer Sound
  playPing() {
    if (!this.enabled) return;
    try {
      this._initContext();
      if (!this.ctx) return;

      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      // Dual high vibrato frequency to replicate the BlackBerry vibration horn
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.linearRampToValueAtTime(1760, t + 0.08);
      osc.frequency.linearRampToValueAtTime(880, t + 0.16);
      osc.frequency.linearRampToValueAtTime(1760, t + 0.24);
      osc.frequency.exponentialRampToValueAtTime(220, t + 0.45);

      gain.gain.setValueAtTime(0.3, t);
      gain.gain.linearRampToValueAtTime(0.35, t + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t);
      osc.stop(t + 0.46);
    } catch (e) {
      console.warn("Audio play error:", e);
    }
  }

  // Soft Message Chime (Bell Chord)
  playMessage() {
    if (!this.enabled) return;
    try {
      this._initContext();
      if (!this.ctx) return;

      const t = this.ctx.currentTime;
      [523.25, 659.25, 783.99].forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + idx * 0.04);
        gain.gain.setValueAtTime(0.12, t + idx * 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35 + idx * 0.04);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t + idx * 0.04);
        osc.stop(t + 0.36 + idx * 0.04);
      });
    } catch (e) {}
  }

  // Delivery Tick Sound
  playTick() {
    if (!this.enabled) return;
    try {
      this._initContext();
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1200, t);
      osc.frequency.exponentialRampToValueAtTime(300, t + 0.05);
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.06);
    } catch (e) {}
  }
}

const bbmSound = new BbmSoundEngine();

// ==============================================================================
// 2. APPLICATION STATE
// ==============================================================================

const AppState = {
  activeAccount: null,
  accounts: [],
  currentTab: 'chats',
  catalogItems: [],
  selectedActivity: null,
  progressData: null,
  searchTimeout: null,
  isWidescreen: localStorage.getItem('bbm_widescreen') === 'true'
};

// ==============================================================================
// 3. INITIALIZATION & CLOCK
// ==============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initWidescreenMode();
  setupEventListeners();
  loadInitialData();
});

function initClock() {
  function updateTime() {
    const el = document.getElementById('system-clock');
    if (el) {
      const now = new Date();
      el.textContent = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
    }
  }
  updateTime();
  setInterval(updateTime, 1000);
}

function initWidescreenMode() {
  const wrapper = document.getElementById('device-wrapper');
  const btn = document.getElementById('toggle-mode-btn');
  if (AppState.isWidescreen) {
    wrapper.classList.add('widescreen-mode');
    if (btn) btn.innerHTML = '📱 BlackBerry Mode';
  } else {
    wrapper.classList.remove('widescreen-mode');
    if (btn) btn.innerHTML = '🖥️ Widescreen Mode';
  }
}

function toggleWidescreen() {
  AppState.isWidescreen = !AppState.isWidescreen;
  localStorage.setItem('bbm_widescreen', AppState.isWidescreen);
  initWidescreenMode();
}

function toggleAudio() {
  bbmSound.enabled = !bbmSound.enabled;
  const btn = document.getElementById('audio-toggle-btn');
  if (btn) {
    btn.innerHTML = bbmSound.enabled ? '🔊 Suara: ON' : '🔇 Suara: OFF';
  }
  showToast(bbmSound.enabled ? "Efek Suara BBM Aktif" : "Efek Suara BBM Dinonaktifkan");
}

// ==============================================================================
// 4. DATA FETCHING & STATE SYNC
// ==============================================================================

async function loadInitialData() {
  await fetchStatusAndAccounts();
  await loadChatHistory();
  searchCatalog("", "ALL");
}

async function fetchStatusAndAccounts() {
  try {
    const [accRes, statusRes] = await Promise.all([
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/status').then(r => r.json())
    ]);

    if (accRes.success) {
      AppState.accounts = accRes.accounts;
      renderContactsList();
    }

    if (statusRes.success && statusRes.account) {
      AppState.activeAccount = statusRes.account;
      updateProfileUI(statusRes.account, statusRes.is_connected);
      updateLedIndicator(statusRes.is_connected);
    } else {
      // Belum ada akun
      showToast("Belum ada akun ASN. Silakan tambah akun baru.");
    }
  } catch (e) {
    console.error("Error loading accounts:", e);
    showToast("Gagal terhubung ke server SiPENDEKAR Calo", "error");
  }
}

function updateProfileUI(acc, isConnected) {
  if (!acc) return;
  const nameEl = document.getElementById('profile-name');
  const pinEl = document.getElementById('profile-pin');
  const statusEl = document.getElementById('profile-status');
  const avatarEl = document.getElementById('profile-avatar');

  if (nameEl) nameEl.textContent = acc.name;
  if (pinEl) pinEl.textContent = `PIN: ${acc.pin}`;
  if (statusEl) statusEl.textContent = acc.status_message || 'Available 🟢';
  if (avatarEl) {
    avatarEl.textContent = acc.name.slice(0, 2).toUpperCase();
    if (acc.avatar_color) avatarEl.style.backgroundColor = acc.avatar_color;
  }
}

function updateLedIndicator(isConnected) {
  const led = document.getElementById('bb-led');
  if (!led) return;
  if (isConnected) {
    led.className = 'bb-led-indicator connected';
  } else {
    led.className = 'bb-led-indicator';
  }
}

// ==============================================================================
// 5. TAB SWITCHING SYSTEM
// ==============================================================================

function switchTab(tabName) {
  AppState.currentTab = tabName;

  // Update Navigation Bar
  document.querySelectorAll('.bbm-nav-tab').forEach(tab => {
    if (tab.dataset.tab === tabName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // Update Panels
  document.querySelectorAll('.tab-pane').forEach(pane => {
    if (pane.id === `tab-${tabName}`) {
      pane.classList.add('active');
    } else {
      pane.classList.remove('active');
    }
  });

  // Load Tab-specific data
  if (tabName === 'progress') {
    fetchProgress();
  } else if (tabName === 'contacts') {
    fetchStatusAndAccounts();
  } else if (tabName === 'feeds') {
    fetchFeeds();
  } else if (tabName === 'activities') {
    // Set default tanggal pengisian ke hari ini jika kosong
    const tglInput = document.getElementById('form-tanggal');
    if (tglInput && !tglInput.value) {
      tglInput.value = new Date().toISOString().split('T')[0];
    }
  }
}

// ==============================================================================
// 6. PING!!! FUNCTIONALITY
// ==============================================================================

async function triggerPing() {
  // 1. Suara PING
  bbmSound.playPing();

  // 2. Getar Layar (Shake Effect)
  const wrapper = document.getElementById('device-wrapper');
  if (wrapper) {
    wrapper.classList.remove('bbm-shake');
    void wrapper.offsetWidth; // Force Reflow
    wrapper.classList.add('bbm-shake');
  }

  // 3. LED Berkedip Merah Cepat
  const led = document.getElementById('bb-led');
  if (led) {
    led.classList.add('alerting');
    setTimeout(() => {
      led.classList.remove('alerting');
    }, 1800);
  }

  // 4. Toast PING
  showToast("💥 PING!!! Terkirim ke SiPENDEKAR Calo!", "ping");

  // 5. Kirim ke Server
  try {
    const res = await fetch('/api/ping', { method: 'POST' }).then(r => r.json());
    if (res.success) {
      // Append ke Chat
      appendChatMessage("user", "💥 PING!!!");
      setTimeout(() => {
        appendChatMessage("calo", `💥 *PING!!!* Diterima bos! Siap melayani e-Kinerja untuk NIP ${AppState.activeAccount ? AppState.activeAccount.nip : ''}. Butuh auto-fill hari apa?`);
        bbmSound.playMessage();
      }, 500);
    }
  } catch (e) {
    console.error("Ping error:", e);
  }
}

// ==============================================================================
// 7. TAB 1: 💬 BBM CHATS
// ==============================================================================

async function loadChatHistory() {
  try {
    const res = await fetch('/api/chat').then(r => r.json());
    if (res.success && res.messages) {
      const list = document.getElementById('chat-message-list');
      if (list) {
        list.innerHTML = '';
        if (res.messages.length === 0) {
          // Welcome message
          appendChatMessage('calo', `Halo ${AppState.activeAccount ? AppState.activeAccount.name : 'Rekan ASN'}! Selamat datang di **BBM SiPENDEKAR Calo Edition** 🍇.\n\nSaya siap membantu pengisian laporan e-Kinerja Anda. Ketik *progres* untuk cek status, *auto fill* untuk isi hari kosong, atau tekan tombol **PING!!!**.`);
        } else {
          res.messages.forEach(msg => {
            appendChatMessage(msg.sender, msg.message, msg.created_at, msg.status);
          });
        }
      }
    }
  } catch (e) {
    console.error("Chat load error:", e);
  }
}

function appendChatMessage(sender, message, timeStr = null, status = 'R') {
  const list = document.getElementById('chat-message-list');
  if (!list) return;

  const now = new Date();
  const time = timeStr ? timeStr.split(' ')[1] || timeStr : now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');

  const row = document.createElement('div');
  row.className = `chat-row ${sender}`;

  const isUser = (sender === 'user');
  const tickHtml = isUser 
    ? `<span class="bbm-status-tick ${status === 'R' ? 'read' : 'delivered'}">${status}</span>` 
    : '';

  // Format bold markdown (*teks*)
  const formattedMsg = message.replace(/\*(.*?)\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

  row.innerHTML = `
    <div class="chat-bubble">
      <div class="chat-text">${formattedMsg}</div>
      <div class="chat-meta">
        <span>${time}</span>
        ${tickHtml}
      </div>
    </div>
  `;

  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input-field');
  if (!input) return;
  const msg = input.value.trim();
  if (!msg) return;

  input.value = '';
  appendChatMessage('user', msg, null, 'D');
  bbmSound.playTick();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    }).then(r => r.json());

    if (res.success) {
      setTimeout(() => {
        appendChatMessage('calo', res.reply, null, 'R');
        bbmSound.playMessage();

        // Handle Chat Action
        if (res.action) {
          if (res.action.type === 'open_tab') {
            switchTab(res.action.tab);
          } else if (res.action.type === 'check_empty') {
            switchTab('progress');
          } else if (res.action.type === 'confirm_autofill') {
            executeAutoFillH7();
          } else if (res.action.type === 'ping_ack') {
            triggerPing();
          }
        }
      }, 400);
    }
  } catch (e) {
    console.error("Send chat error:", e);
    appendChatMessage('calo', '⚠️ Maaf, terjadi kesalahan saat menghubungi server.', null, 'R');
  }
}

// Quick action chips in chat
function handleChatChip(action) {
  if (action === 'autofill') {
    executeAutoFillH7();
  } else if (action === 'progres') {
    switchTab('progress');
  } else if (action === 'hari_bolong') {
    switchTab('progress');
  } else if (action === 'pilih_kegiatan') {
    switchTab('activities');
  } else if (action === 'ganti_akun') {
    switchTab('contacts');
  }
}

// ==============================================================================
// 8. TAB 2: 👥 KONTAK (MULTI-AKUN ASN)
// ==============================================================================

function renderContactsList() {
  const container = document.getElementById('contact-cards-container');
  if (!container) return;

  container.innerHTML = '';
  if (AppState.accounts.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding: 30px; color: var(--text-muted);">Belum ada kontak pegawai terdaftar. Klik tombol Tambah Akun di atas.</div>`;
    return;
  }

  AppState.accounts.forEach(acc => {
    const isActive = (acc.is_active === 1);
    const card = document.createElement('div');
    card.className = `contact-card ${isActive ? 'active-account' : ''}`;

    const initials = acc.name.slice(0, 2).toUpperCase();
    const bgCol = acc.avatar_color || '#0077c8';

    card.innerHTML = `
      <div class="contact-left">
        <div class="contact-avatar" style="background-color: ${bgCol};">${initials}</div>
        <div class="contact-details">
          <div class="contact-name-row">
            <span class="contact-name">${acc.name}</span>
            <span class="pin-pill" onclick="copyText('${acc.pin}', 'BBM PIN disalin!')">PIN: ${acc.pin}</span>
          </div>
          <div class="contact-nip">NIP: ${acc.nip}</div>
          <div class="contact-status-desc">${acc.status_message || 'Available 🟢'}</div>
        </div>
      </div>
      <div class="contact-actions">
        ${isActive 
          ? `<span class="btn-active-badge">✓ Aktif</span>`
          : `<button class="btn-switch-act" onclick="switchAccount('${acc.nip}')">Ganti Akun</button>`
        }
        <button class="btn-del-contact" title="Hapus Akun" onclick="deleteAccount(${acc.id}, '${acc.name}')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

async function switchAccount(nip) {
  try {
    showToast("Beralih akun...", "info");
    const res = await fetch('/api/accounts/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nip: nip })
    }).then(r => r.json());

    if (res.success) {
      bbmSound.playTick();
      showToast(`Aktif: ${res.active_account.name}`);
      await fetchStatusAndAccounts();
      await loadChatHistory();
      if (AppState.currentTab === 'progress') {
        fetchProgress();
      }
    } else {
      showToast(res.error || "Gagal beralih akun", "error");
    }
  } catch (e) {
    showToast("Error saat beralih akun", "error");
  }
}

async function handleAddAccountSubmit(e) {
  e.preventDefault();
  const nip = document.getElementById('modal-nip').value.trim();
  const password = document.getElementById('modal-password').value.trim();
  const name = document.getElementById('modal-name').value.trim();

  if (!nip || !password) {
    alert("NIP dan Password SiPENDEKAR wajib diisi.");
    return;
  }

  const btn = document.getElementById('btn-save-acc');
  btn.disabled = true;
  btn.textContent = "Memverifikasi ke SiPENDEKAR...";

  try {
    const res = await fetch('/api/accounts/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nip, password, name })
    }).then(r => r.json());

    if (res.success) {
      bbmSound.playMessage();
      showToast(res.message);
      closeModal('modal-add-account');
      document.getElementById('form-add-account').reset();
      await fetchStatusAndAccounts();
      switchTab('progress');
    } else {
      alert("Gagal terhubung: " + (res.error || "Password atau NIP salah."));
    }
  } catch (err) {
    alert("Koneksi gagal: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Simpan & Hubungkan Akun";
  }
}

async function deleteAccount(id, name) {
  if (!confirm(`Hapus akun ${name} dari daftar SiPENDEKAR Calo?`)) return;
  try {
    const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.success) {
      showToast("Akun berhasil dihapus.");
      await fetchStatusAndAccounts();
    }
  } catch (e) {
    showToast("Gagal menghapus akun", "error");
  }
}

// ==============================================================================
// 9. TAB 3: 📋 PILIH KEGIATAN & SKP DINAMIS
// ==============================================================================

function onCatalogSearchInput() {
  clearTimeout(AppState.searchTimeout);
  AppState.searchTimeout = setTimeout(() => {
    const q = document.getElementById('catalog-search-query').value.trim();
    const activeChip = document.querySelector('.category-chip.active');
    const cat = activeChip ? activeChip.dataset.cat : 'ALL';
    searchCatalog(q, cat);
  }, 250);
}

function filterCategory(cat, chipEl) {
  document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
  chipEl.classList.add('active');
  const q = document.getElementById('catalog-search-query').value.trim();
  searchCatalog(q, cat);
}

async function searchCatalog(q = '', kategori = 'ALL') {
  const container = document.getElementById('catalog-grid-items');
  if (!container) return;

  container.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding: 20px; color: var(--text-muted);">Memuat katalog kegiatan...</div>`;

  try {
    const params = new URLSearchParams({ q, kategori, limit: 30 });
    const res = await fetch(`/api/catalog?${params}`).then(r => r.json());

    if (res.success && res.items) {
      container.innerHTML = '';
      if (res.items.length === 0) {
        container.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding: 30px; color: var(--text-muted);">Tidak ada kegiatan yang sesuai kata kunci '${q}'.</div>`;
        return;
      }

      res.items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'catalog-card';
        card.onclick = () => selectActivity(item);

        card.innerHTML = `
          <div>
            <div class="catalog-card-code">${item.kode_aktifitas}</div>
            <div class="catalog-card-name">${item.nama_aktifitas}</div>
          </div>
          <div class="catalog-card-footer">
            <span>⏱️ ${item.waktu || 0} menit</span>
            <span class="badge-pill blue">${item.satuan_output || 'Kegiatan'}</span>
          </div>
        `;
        container.appendChild(card);
      });
    }
  } catch (e) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align:center; color: var(--status-danger);">Gagal memuat katalog.</div>`;
  }
}

async function selectActivity(item) {
  AppState.selectedActivity = item;
  bbmSound.playTick();

  // Update banner pilihan
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
  
  // Format Keterangan otomatis yang rapi
  const ketInput = document.getElementById('form-keterangan');
  if (ketInput) {
    ketInput.value = item.nama_aktifitas.toLowerCase();
  }

  // Hitung durasi jam
  calculateDuration();

  // Scroll smooth ke form
  document.getElementById('activity-fill-form').scrollIntoView({ behavior: 'smooth' });

  // Ambil daftar SKP Dinamis untuk aktivitas ini dari portal SiPENDEKAR
  await fetchSkpForActivity(item.kode_aktifitas);
}

async function fetchSkpForActivity(kode) {
  const skpSelect = document.getElementById('form-skp-select');
  if (!skpSelect) return;

  skpSelect.innerHTML = `<option value="">Mengambil SKP valid dari portal SiPENDEKAR...</option>`;

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
      skpSelect.innerHTML = `<option value="0">Tidak ada SKP khusus (Umum/Tugas Tambahan)</option>`;
    }
  } catch (e) {
    skpSelect.innerHTML = `<option value="0">Tupoksi Umum / SKP Default</option>`;
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

  const durLabel = document.getElementById('calculated-duration-label');
  if (durLabel) {
    if (waktuStd > 0) {
      durLabel.textContent = `Total Diakui SiPENDEKAR: ${totalKinerja} Menit (${(totalKinerja / 60).toFixed(1)} Jam) [${vol} Vol × ${waktuStd}m]`;
    } else {
      durLabel.textContent = `Durasi: ${rentangJam} Menit (${(rentangJam / 60).toFixed(1)} Jam)`;
    }
    if (totalKinerja >= 600) {
      durLabel.style.color = '#10b981';
    } else {
      durLabel.style.color = '#38bdf8';
    }
  }
}

async function handleActivityFormSubmit(e) {
  e.preventDefault();
  const kode = document.getElementById('form-kode-act').value;
  if (!kode) {
    alert("Silakan pilih kegiatan terlebih dahulu dari daftar di bawah!");
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
      bbmSound.playTick();
      showToast(`Sukses terisi! (${res.durasi_menit} Menit)`);
      switchTab('progress');
    } else {
      alert("Gagal mengisi laporan: " + (res.error || "Periksa kembali input Anda."));
    }
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🚀 Kirim Laporan ke SiPENDEKAR";
  }
}

// ==============================================================================
// 10. TAB 4: 📊 PROGRES PENGISIAN & KALENDER MATRIX
// ==============================================================================

async function fetchProgress(year = null, month = null) {
  const container = document.getElementById('cal-days-grid');
  if (!container) return;

  try {
    const params = new URLSearchParams();
    if (year) params.append('year', year);
    if (month) params.append('month', month);

    const res = await fetch(`/api/progress?${params}`).then(r => r.json());
    if (res.success) {
      AppState.progressData = res;
      renderProgressStats(res);
      renderCalendarGrid(res.calendar);
      renderH7UrgencyBanner(res.empty_days_h7);
    } else {
      showToast(res.error || "Gagal memuat progres", "error");
    }
  } catch (e) {
    console.error("Progress fetch error:", e);
  }
}

function renderProgressStats(data) {
  const sum = data.summary;
  const per = data.periode;

  // Judul Periode
  const monthTitle = document.getElementById('cal-month-title');
  if (monthTitle) {
    monthTitle.textContent = `${per.bulan_nama} ${per.tahun}`;
  }

  // Stat 1: Persentase Capaian Ring
  const pct = sum.persentase_berjalan;
  const pctEl = document.getElementById('stat-pct-val');
  if (pctEl) pctEl.textContent = `${pct}%`;

  const ring = document.getElementById('circle-progress-bar');
  if (ring) {
    // 157 adalah keliling lingkaran radius 25
    const offset = 157 - (157 * pct / 100);
    ring.style.strokeDashoffset = offset;
    if (pct >= 80) ring.style.stroke = '#10b981';
    else if (pct >= 50) ring.style.stroke = '#f59e0b';
    else ring.style.stroke = '#ef4444';
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
      todayBadge.style.color = "#f87171";
    }
  }

  // Stat 4: Hari Bolong H-7
  const h7CountEl = document.getElementById('stat-h7-count');
  if (h7CountEl) {
    h7CountEl.textContent = `${sum.hari_kosong_h7} Hari`;
    if (sum.hari_kosong_h7 > 0) {
      h7CountEl.style.color = '#f87171';
    } else {
      h7CountEl.style.color = '#10b981';
    }
  }
}

function renderH7UrgencyBanner(emptyDays) {
  const banner = document.getElementById('urgency-alert-card');
  if (!banner) return;

  if (!emptyDays || emptyDays.length === 0) {
    banner.style.display = 'none';
    return;
  }

  banner.style.display = 'flex';
  const textEl = document.getElementById('urgency-text-info');
  if (textEl) {
    const datesList = emptyDays.map(d => `${d.hari_nama} (${d.tanggal.slice(8, 10)}/${d.tanggal.slice(5, 7)})`).join(', ');
    textEl.textContent = `Ditemukan ${emptyDays.length} hari kerja belum terisi: ${datesList}. Segera isi sebelum terkunci otomatis oleh sistem BKPSDM!`;
  }
}

function renderCalendarGrid(cells) {
  const grid = document.getElementById('cal-days-grid');
  if (!grid) return;

  grid.innerHTML = '';
  cells.forEach(cell => {
    const el = document.createElement('div');
    el.className = `cal-day-cell ${cell.status}`;
    
    // Status text badge
    let tag = '';
    if (cell.is_terisi) {
      tag = `<span class="cal-tag-badge badge-success">TERISI</span>`;
    } else if (cell.status === 'kosong-bisa') {
      tag = `<span class="cal-tag-badge badge-danger">KOSONG</span>`;
    }

    el.innerHTML = `
      <span class="cal-num">${cell.hari_ke}</span>
      ${tag}
    `;

    // Click handler untuk lihat detail atau isi hari tersebut
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
    showToast("Hari akhir pekan (Sabtu/Minggu).", "info");
    return;
  }

  // Buka modal detail tanggal
  openDayDetailModal(cell.tanggal, cell.is_terisi, cell.status);
}

async function openDayDetailModal(dateStr, isTerisi, status) {
  const modal = document.getElementById('modal-day-detail');
  if (!modal) return;

  document.getElementById('modal-day-title').textContent = `Detail Tanggal ${dateStr}`;
  const content = document.getElementById('modal-day-content');
  content.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-muted);">Memeriksa rincian dari SiPENDEKAR...</div>`;
  modal.classList.add('active');

  try {
    const res = await fetch(`/api/days/${dateStr}`).then(r => r.json());
    if (res.success) {
      content.innerHTML = `
        <div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 700; color: #fff;">Total Durasi: ${res.total_menit} Menit</span>
          <span class="badge-pill ${res.is_terisi ? 'green' : 'blue'}">${res.is_terisi ? 'SUDAH TERISI' : 'KOSONG'}</span>
        </div>
      `;

      if (res.detail && res.detail.length > 0) {
        const listWrap = document.createElement('div');
        listWrap.style.display = 'flex';
        listWrap.style.flexDirection = 'column';
        listWrap.style.gap = '8px';

        res.detail.forEach(item => {
          const itemCard = document.createElement('div');
          itemCard.style.background = 'rgba(0,0,0,0.3)';
          itemCard.style.border = '1px solid var(--border-card)';
          itemCard.style.borderRadius = '8px';
          itemCard.style.padding = '10px';
          itemCard.innerHTML = `
            <div style="font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 4px;">${item.nama_aktifitas}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">
              Jam: ${item.jam_mulai} - ${item.jam_selesai} (${item.durasi_menit} menit) | Volume: ${item.volume}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11px; color: #94a3b8;">${item.keterangan || '-'}</span>
              <button class="btn-del-contact" title="Hapus" onclick="deleteActivityItem(${item.id})">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
              </button>
            </div>
          `;
          listWrap.appendChild(itemCard);
        });
        content.appendChild(listWrap);
      } else {
        content.innerHTML += `
          <div style="text-align:center; padding: 20px; color: var(--text-muted);">
            Belum ada aktivitas yang dilaporkan pada tanggal ini.
          </div>
        `;
      }

      // Tombol Cepat Isi Tanggal Ini
      if (status === 'kosong-bisa' || !res.is_terisi) {
        const fillBtn = document.createElement('button');
        fillBtn.className = 'btn-submit-activity';
        fillBtn.style.marginTop = '16px';
        fillBtn.innerHTML = `✍️ Isi Tanggal Ini (${dateStr})`;
        fillBtn.onclick = () => {
          closeModal('modal-day-detail');
          switchTab('activities');
          document.getElementById('form-tanggal').value = dateStr;
        };
        content.appendChild(fillBtn);
      }
    }
  } catch (e) {
    content.innerHTML = `<div style="color: var(--status-danger);">Gagal mengambil rincian tanggal.</div>`;
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
      showToast("Aktivitas berhasil dihapus.");
      closeModal('modal-day-detail');
      fetchProgress();
    }
  } catch (e) {
    showToast("Gagal menghapus aktivitas", "error");
  }
}

async function executeAutoFillH7() {
  if (!confirm("Jalankan Auto-Fill untuk SEMUA hari kerja yang masih kosong dalam 7 hari terakhir?")) return;

  showToast("Menjalankan Auto-Fill SiPENDEKAR...", "info");
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
      bbmSound.playMessage();
      showToast(res.message);
      fetchProgress();
    } else {
      alert("Auto-fill gagal: " + (res.error || "Gagal menghubungi server."));
    }
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg> Auto-Fill Semua Hari Bolong H-7`;
    }
  }
}

// ==============================================================================
// 11. TAB 5: 📢 FEEDS (STATUS UPDATES & ACTIVITY LOGS)
// ==============================================================================

async function fetchFeeds() {
  const container = document.getElementById('feed-timeline-container');
  if (!container) return;

  try {
    const res = await fetch('/api/feeds').then(r => r.json());
    if (res.success && res.feeds) {
      container.innerHTML = '';
      if (res.feeds.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding: 30px; color: var(--text-muted);">Belum ada log kejadian terkini.</div>`;
        return;
      }

      res.feeds.forEach(f => {
        const item = document.createElement('div');
        item.className = 'feed-item';

        const initials = f.name ? f.name.slice(0, 2).toUpperCase() : 'BB';
        item.innerHTML = `
          <div class="feed-avatar">${initials}</div>
          <div class="feed-content">
            <div class="feed-header-line">
              <span class="feed-author">${f.name || 'System'}</span>
              <span class="feed-time">${f.created_at || ''}</span>
            </div>
            <div class="feed-text">${f.message}</div>
          </div>
        `;
        container.appendChild(item);
      });
    }
  } catch (e) {
    console.error("Feeds error:", e);
  }
}

// ==============================================================================
// 12. MODALS & TOAST NOTIFICATIONS
// ==============================================================================

function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('active');
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('active');
}

function showToast(text, type = "normal") {
  const toast = document.getElementById('bbm-toast');
  if (!toast) return;

  document.getElementById('toast-text').textContent = text;
  toast.className = 'bbm-toast show';
  if (type === 'ping') {
    toast.classList.add('ping-alert');
  }

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}

function copyText(text, successMsg = "Teks disalin!") {
  navigator.clipboard.writeText(text).then(() => {
    bbmSound.playTick();
    showToast(successMsg);
  });
}

// ==============================================================================
// 13. DOM EVENT LISTENERS
// ==============================================================================

function setupEventListeners() {
  // Chat enter key
  const chatInput = document.getElementById('chat-input-field');
  if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendChatMessage();
      }
    });
  }

  // Time inputs duration recalculation
  ['form-jam-mulai', 'form-menit-mulai', 'form-jam-selesai', 'form-menit-selesai'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', calculateDuration);
  });

  // Modal Backdrop dismiss
  document.querySelectorAll('.modal-backdrop').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  });
}
