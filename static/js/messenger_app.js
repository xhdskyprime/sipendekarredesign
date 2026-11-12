/**
 * messenger_app.js - Authentic Facebook Messenger UI (Desktop 3-Column & Mobile Responsive)
 * Features:
 * - Multi-Account Isolated Sessions (Users cannot see each other's accounts)
 * - Exact Calendar Day Alignment with first_weekday spacers
 * - 3-Column Desktop View (Chats list, Main Chat/Content, Info Sidebar)
 * - Full Mobile View with Back Navigation & Bottom Tab Bar
 * - Dynamic SKP Selector from SiPENDEKAR Portal
 * - 2,123 Activities Catalog Search
 * - 1-Click Auto-Fill H-7
 * - Conversation Color Customization Palette
 */

const AppState = {
  currentUser: null,
  currentTab: 'chats',
  selectedActivity: null,
  searchTimeout: null,
};

/**
 * Sanitasi string HTML untuk mencegah kerentanan DOM-based XSS
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkAuth();
});

function setupEventListeners() {
  const loginNip = document.getElementById('login-nip');
  const loginPass = document.getElementById('login-password');
  if (loginNip) {
    loginNip.addEventListener('input', () => {
      loginNip.classList.remove('input-error');
      const errBox = document.getElementById('login-error-alert');
      if (errBox) errBox.style.display = 'none';
    });
  }
  if (loginPass) {
    loginPass.addEventListener('input', () => {
      loginPass.classList.remove('input-error');
      const errBox = document.getElementById('login-error-alert');
      if (errBox) errBox.style.display = 'none';
    });
  }

  const input = document.getElementById('chat-text-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSendOrThumbs();
      } else if (e.key === 'Escape') {
        toggleBotMenu(false);
      }
    });

    input.addEventListener('input', () => {
      updateSendButtonIcon();
      const val = input.value.trim();
      const menu = document.getElementById('tg-command-menu');
      if (val.startsWith('/')) {
        toggleBotMenu(true);
        const q = val.toLowerCase();
        document.querySelectorAll('.tg-cmd-item').forEach(item => {
          const nameEl = item.querySelector('.tg-cmd-name');
          const descEl = item.querySelector('.tg-cmd-desc');
          const name = nameEl ? nameEl.textContent.toLowerCase() : '';
          const desc = descEl ? descEl.textContent.toLowerCase() : '';
          item.style.display = (name.includes(q) || desc.includes(q)) ? 'flex' : 'none';
        });
      } else {
        if (menu && menu.style.display !== 'none' && val.length > 0) {
          toggleBotMenu(false);
        }
      }
    });
  }

  // Auto calculate duration on time input change
  ['form-jam-mulai', 'form-menit-mulai', 'form-jam-selesai', 'form-menit-selesai'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', calculateFormDuration);
  });

  // AUTO-HIDE: Close right sidebar on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && AppState.rightSidebarOpen) {
      toggleRightSidebar(false);
    }
  });

  // AUTO-HIDE: Click anywhere outside right sidebar in center panel to close
  const centerPanel = document.getElementById('ms-center-panel');
  if (centerPanel) {
    centerPanel.addEventListener('click', (e) => {
      if (e.target.closest('#btn-toggle-info') || e.target.closest('#ms-sidebar-right')) return;
      if (AppState.rightSidebarOpen) {
        toggleRightSidebar(false);
      }
    });
  }

  // AUTO-HIDE: Automatically close when window shrinks / snapped
  window.addEventListener('resize', () => {
    if (window.innerWidth <= 1200 && AppState.rightSidebarOpen) {
      toggleRightSidebar(false);
    }
  });
}

function updateSendButtonIcon() {
  const btn = document.getElementById('btn-send-thumbs');
  if (!btn) return;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
    </svg>
  `;
}

// ==============================================================================
// 1. AUTHENTICATION & SESSION ISOLATION
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

function clearLoginError() {
  const errBox = document.getElementById('login-error-alert');
  const nipInput = document.getElementById('login-nip');
  const passInput = document.getElementById('login-password');
  if (errBox) errBox.style.display = 'none';
  if (nipInput) nipInput.classList.remove('input-error');
  if (passInput) passInput.classList.remove('input-error');
}

function showLoginError(msg, focusTarget = 'pass') {
  const errBox = document.getElementById('login-error-alert');
  const errText = document.getElementById('login-error-text');
  const nipInput = document.getElementById('login-nip');
  const passInput = document.getElementById('login-password');

  if (errBox && errText) {
    errText.textContent = msg;
    errBox.style.display = 'flex';
    errBox.classList.remove('shakeAlert');
    void errBox.offsetWidth;
    errBox.classList.add('shakeAlert');
  }

  if (focusTarget === 'nip' && nipInput) {
    nipInput.classList.add('input-error');
    nipInput.focus();
    nipInput.select();
  } else if (passInput) {
    passInput.classList.add('input-error');
    passInput.focus();
    passInput.select();
  }
  showToast(msg, "error");
}

function showLoginView() {
  clearLoginError();
  document.getElementById('view-login').style.display = 'flex';
  document.getElementById('app-messenger-view').style.display = 'none';
  try {
    const savedNip = localStorage.getItem('sipendekar_saved_nip');
    const nipInput = document.getElementById('login-nip');
    if (savedNip && nipInput && !nipInput.value) {
      nipInput.value = savedNip;
    }
  } catch(_) {}
}

function showAuthenticatedView(user) {
  document.getElementById('view-login').style.display = 'none';
  document.getElementById('app-messenger-view').style.display = 'flex';

  // Update profile badges
  fetchReviewData(true);
  const nameEl = document.getElementById('header-user-name');
  if (nameEl) nameEl.textContent = user.name;

  const nipEl = document.getElementById('header-user-nip');
  if (nipEl) nipEl.textContent = user.nip;

  const avatarCircle = document.getElementById('sidebar-user-avatar');
  if (avatarCircle) {
    avatarCircle.textContent = (user.name || "U").slice(0, 1).toUpperCase();
  }

  // Set default form date to today
  const todayStr = new Date().toISOString().split('T')[0];
  const tglInput = document.getElementById('form-tanggal');
  if (tglInput && !tglInput.value) {
    tglInput.value = todayStr;
  }
  const simpleTgl = document.getElementById('simple-input-tanggal');
  if (simpleTgl && !simpleTgl.value) {
    simpleTgl.value = todayStr;
  }

  // Load home as default view, prefetch SKP, progress, catalog & scheduler
  switchViewTab('home');
  loadChatHistory();
  searchCatalog("", "ALL");
  fetchProgress();
  loadSkpOptions();
  loadSchedulerConfig();
  initSimpleStageForm();

  // Ukur latensi riil ke SiPENDEKAR saat masuk dan set auto-ping tiap 30 detik
  checkSipendekarLatency();
  if (!window._latencyPingInterval) {
    window._latencyPingInterval = setInterval(checkSipendekarLatency, 30000);
  }

  // On Mobile: Directly ensure sidebar is hidden so user lands directly into the main view
  if (window.innerWidth <= 850) {
    const sidebar = document.getElementById('ms-sidebar-left');
    if (sidebar) sidebar.classList.add('mobile-hidden');
  }
}

let loginTimer = null;

async function handleLoginSubmit(e) {
  e.preventDefault();
  clearLoginError();

  const nipInput = document.getElementById('login-nip');
  const passInput = document.getElementById('login-password');
  const nip = nipInput ? nipInput.value.trim() : "";
  const password = passInput ? passInput.value.trim() : "";
  const nameEl = document.getElementById('login-name');
  const name = nameEl ? nameEl.value.trim() : "";

  if (!nip) {
    showLoginError("NIP Pegawai (18 digit) wajib diisi.", 'nip');
    return;
  }

  if (!password) {
    showLoginError("Password portal SiPENDEKAR wajib diisi.", 'pass');
    return;
  }

  try { localStorage.setItem('sipendekar_saved_nip', nip); } catch(_) {}

  const btn = document.getElementById('btn-submit-login');
  const loadingBox = document.getElementById('login-loading-box');
  const progressFill = document.getElementById('login-progress-fill');
  const statusText = document.getElementById('login-status-text');

  // Aktifkan indikator loading interaktif
  if (btn) btn.disabled = true;
  if (nipInput) nipInput.disabled = true;
  if (passInput) passInput.disabled = true;
  if (btn) {
    btn.innerHTML = `
      <div class="ms-spinner"></div>
      <span>Sedang Memproses Masuk...</span>
    `;
  }

  if (loadingBox) {
    loadingBox.style.display = 'block';
    loadingBox.style.background = '#f0f9ff';
    loadingBox.style.borderColor = '#bae6fd';
  }
  if (progressFill) progressFill.style.width = '25%';
  if (statusText) {
    statusText.innerHTML = "Memverifikasi NIP & kredensial akun...";
    statusText.style.color = '#0f172a';
  }

  let elapsedSec = 0;
  if (loginTimer) clearInterval(loginTimer);
  loginTimer = setInterval(() => {
    elapsedSec += 1;
    if (elapsedSec === 1) {
      if (progressFill) progressFill.style.width = '50%';
      if (statusText) statusText.innerHTML = "Menghubungkan ke Portal Resmi SiPENDEKAR...";
    } else if (elapsedSec === 4) {
      if (progressFill) progressFill.style.width = '75%';
      if (statusText) statusText.innerHTML = "Mengambil profil & menyinkronkan data e-Kinerja...";
    } else if (elapsedSec === 8) {
      if (progressFill) progressFill.style.width = '88%';
      if (statusText) statusText.innerHTML = "Menyiapkan sesi privat & Asisten AI...";
    } else if (elapsedSec >= 13) {
      if (progressFill) progressFill.style.width = '95%';
      if (statusText) statusText.innerHTML = "Portal BKPSDM sedang sibuk, memproses finalisasi...";
    }
  }, 1000);

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nip, password, name })
    }).then(r => r.json());

    if (loginTimer) clearInterval(loginTimer);

    if (res.success) {
      if (progressFill) progressFill.style.width = '100%';
      if (loadingBox) {
        loadingBox.style.background = '#f0fdf4';
        loadingBox.style.borderColor = '#bbf7d0';
      }
      if (statusText) {
        statusText.innerHTML = `✅ <strong>Berhasil masuk!</strong> Membuka Messenger e-Kinerja...`;
        statusText.style.color = '#15803d';
      }

      showToast(res.message, "success");
      AppState.currentUser = res.user;

      setTimeout(() => {
        showAuthenticatedView(res.user);
        if (loadingBox) loadingBox.style.display = 'none';
      }, 450);
    } else {
      if (loadingBox) loadingBox.style.display = 'none';
      showLoginError(res.error || "Login gagal. Periksa kembali NIP dan Password Anda.", 'pass');
    }
  } catch (err) {
    if (loginTimer) clearInterval(loginTimer);
    if (loadingBox) loadingBox.style.display = 'none';
    showLoginError("Koneksi gagal: " + err.message, 'pass');
  } finally {
    if (btn) btn.disabled = false;
    if (nipInput) nipInput.disabled = false;
    if (passInput) passInput.disabled = false;
    if (btn) {
      btn.innerHTML = `
        <span>Masuk ke SiPENDEKAR</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
      `;
    }
  }
}

async function handleLogout() {
  if (!confirm("Keluar dari akun Anda?")) return;
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    AppState.currentUser = null;
    showToast("Berhasil keluar.", "success");
    showLoginView();
  } catch (e) {
    showToast("Gagal logout.", "error");
  }
}

// ==============================================================================
// 2. NAVIGATION & TAB SWITCHING
// ==============================================================================

function switchTab(tabName) {
  AppState.currentTab = 'chats';

  // 1. Update Left Sidebar Conversation Item
  document.querySelectorAll('.ms-conv-item').forEach(item => {
    item.classList.add('active');
  });

  // 2. Ensure view-chats is always active
  document.querySelectorAll('.ms-tab-pane').forEach(pane => {
    pane.classList.add('active');
  });

  // 3. Header Title & Status
  const nameEl = document.getElementById('active-chat-name');
  const statusEl = document.getElementById('active-chat-status-text');
  const avatarWrap = document.getElementById('ms-active-avatar');

  if (nameEl) nameEl.textContent = "SiPENDEKAR Assistant";
  if (statusEl) statusEl.textContent = "• SiPENDEKAR Online";
  if (avatarWrap) avatarWrap.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;

  const stream = document.getElementById('chat-stream');
  if (stream) stream.scrollTop = stream.scrollHeight;

  // Handle virtual tab routing to in-chat actions
  if (tabName === 'progress') {
    openCalendarModal();
  } else if (tabName === 'activities') {
    handleActionChip('isi_kegiatan');
  } else if (tabName === 'history') {
    handleActionChip('riwayat');
  }

  // AUTO-HIDE: Always auto-close right sidebar
  if (AppState.rightSidebarOpen) {
    toggleRightSidebar(false);
  }

  // 5. On Mobile: hide sidebar when conversation is clicked
  if (window.innerWidth <= 850) {
    const sidebar = document.getElementById('ms-sidebar-left');
    if (sidebar) sidebar.classList.add('mobile-hidden');
  }
}

function mobileBackToSidebar() {
  const sidebar = document.getElementById('ms-sidebar-left');
  if (sidebar) sidebar.classList.remove('mobile-hidden');
}

function filterConversations(query) {
  const q = query.toLowerCase().trim();
  document.querySelectorAll('.ms-conv-item').forEach(item => {
    const text = item.innerText.toLowerCase();
    item.style.display = text.includes(q) ? 'flex' : 'none';
  });
}

function toggleRightSidebar(forceState) {
  const right = document.getElementById('ms-sidebar-right');
  const infoBtn = document.getElementById('btn-toggle-info');
  const backdrop = document.getElementById('ms-sidebar-backdrop');
  if (!right) return;

  if (typeof forceState === 'boolean') {
    AppState.rightSidebarOpen = forceState;
  } else {
    AppState.rightSidebarOpen = !AppState.rightSidebarOpen;
  }

  if (AppState.rightSidebarOpen) {
    right.classList.remove('collapsed');
    right.classList.add('open');
    if (infoBtn) infoBtn.classList.add('active');
    if (backdrop) backdrop.classList.add('active');
  } else {
    right.classList.add('collapsed');
    right.classList.remove('open');
    if (infoBtn) infoBtn.classList.remove('active');
    if (backdrop) backdrop.classList.remove('active');
  }
}

function changeThemeColor(color, btn) {
  document.documentElement.style.setProperty('--ms-blue', color);
  document.documentElement.style.setProperty('--bubble-user', `linear-gradient(135deg, ${color} 0%, #0099ff 100%)`);

  document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
  if (btn) btn.classList.add('active');
  showToast("Warna tema Messenger diperbarui!", "success");
}

function focusChatInput() {
  switchTab('chats');
  const input = document.getElementById('chat-text-input');
  if (input) input.focus();
}

function handleCallAction(type) {
  showToast(`Menghubungkan ${type === 'audio' ? 'panggilan suara' : 'video call'} ke SiPENDEKAR Assistant...`, "info");
}

function openPhotoModal(index) {
  showToast(`Membuka lampiran kegiatan #${index}...`, "info");
}

// ==============================================================================
// 3. TAB 1: 💬 MESSENGER CHAT & ASISTEN
// ==============================================================================

async function loadChatHistory() {
  try {
    const res = await fetch('/api/chat').then(r => r.json());
    const stream = document.getElementById('chat-stream');
    if (!stream) return;

    stream.innerHTML = '';

    // Date separator pill (Image 1)
    const dateDiv = document.createElement('div');
    dateDiv.className = 'ms-date-divider';
    dateDiv.textContent = 'HARI INI 18:14';
    stream.appendChild(dateDiv);

    if (res.success && res.messages && res.messages.length > 0) {
      res.messages.forEach(msg => {
        appendChatBubble(msg.sender, msg.message, msg.created_at, msg.card_type, msg.card_data);
      });
    } else {
      const welcome = `Halo **${AppState.currentUser ? AppState.currentUser.name : 'Rekan ASN'}**! 👋\n\nSelamat datang di **Telegram SiPENDEKAR Assistant Bot** 🤖\n\nKlik tombol **[≡ Menu]** di pojok kiri bawah atau ketik **/** untuk membuka pilihan perintah otomasi pelaporan e-Kinerja Anda!`;
      appendChatBubble('bot', welcome, null, 'progress_card', null);
    }

    setTimeout(() => {
      stream.scrollTop = stream.scrollHeight;
    }, 60);
  } catch (e) {
    console.error("Chat load error:", e);
  }
}

function appendChatBubble(sender, message, timeStr = null, cardType = null, cardData = null) {
  const stream = document.getElementById('chat-stream');
  if (!stream) return;

  const now = new Date();
  const time = timeStr ? (timeStr.split(' ')[1] || timeStr).slice(0, 5) : now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');

  const row = document.createElement('div');
  row.className = `chat-msg-row ${sender} ${cardType ? 'has-widget' : ''}`;

  const isAi = (cardData && cardData.is_ai_draft) || (cardType === 'ai_settings_card') || (message && message.includes('✨'));
  const botAvatar = (sender === 'bot')
    ? `<div class="bot-avatar-small tg-avatar">${isAi ? '✨' : '🤖'}</div>`
    : '';

  const safeMsg = escapeHtml(message);
  let formatted = safeMsg
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');

  let widgetHtml = '';
  if (cardType && cardData) {
    widgetHtml = renderCardWidget(cardType, cardData);
  }

  const botTag = isAi
    ? `<span class="tg-bubble-bot-tag ai">✨ AI</span>`
    : `<span class="tg-bubble-bot-tag">bot</span>`;
  const botName = isAi ? "SiPENDEKAR AI" : "SiPENDEKAR Assistant";

  const botHeader = (sender === 'bot')
    ? `<div class="tg-bubble-sender-row"><span class="tg-bubble-sender-name">${botName}</span> ${botTag}</div>`
    : '';
  const ticks = (sender === 'user') ? `<span class="tg-ticks">✓✓</span>` : '';

  row.innerHTML = `
    ${botAvatar}
    <div>
      <div class="chat-msg-bubble">
        ${botHeader}
        <div>${formatted}</div>
        ${widgetHtml}
        <div class="chat-msg-time"><span>${time}</span>${ticks}</div>
      </div>
    </div>
  `;

  stream.appendChild(row);
  stream.scrollTop = stream.scrollHeight;
}

let inchatCardCounter = 0;

function renderCardWidget(cardType, cardData) {
  if (cardType === 'fill_activity_card' && cardData) {
    inchatCardCounter++;
    const cid = `c${inchatCardCounter}_${Date.now()}`;
    const today = cardData.today || new Date().toISOString().split('T')[0];
    const defKode = escapeHtml(cardData.default_kode || 'UTAMA00463');
    const defKeg = escapeHtml(cardData.default_kegiatan || 'Mengikuti pelatihan/sosialisasi/pendidikan');
    const defKet = escapeHtml(cardData.default_keterangan || 'mengikuti pelatihan jabatan fungsional pranata komputer');
    const jmMulai = cardData.default_jam_mulai || '07';
    const mmMulai = cardData.default_menit_mulai || '30';
    const jmSelesai = cardData.default_jam_selesai || '17';
    const mmSelesai = cardData.default_menit_selesai || '30';

    setTimeout(() => {
      populateInchatSkp(cid, defKode);
      updateInchatDuration(cid);
    }, 60);

    return `
      <div class="inchat-fill-card" id="inchat-card-${cid}">
        <div class="inchat-card-header">
          <span class="inchat-card-title">📝 Formulir Pelaporan e-Kinerja</span>
          <span class="tag-badge" style="background:#eff6ff;color:var(--ms-blue);">SiPENDEKAR Direct</span>
        </div>

        <!-- Tanggal & Volume -->
        <div class="inchat-field-row two-col">
          <div>
            <label class="inchat-label">Tanggal Pelaksanaan</label>
            <input type="date" class="inchat-input" id="inchat-tgl-${cid}" value="${today}">
          </div>
          <div>
            <label class="inchat-label">Volume Output</label>
            <input type="number" class="inchat-input" id="inchat-vol-${cid}" min="1" max="99" value="1" oninput="updateInchatDuration('${cid}')">
          </div>
        </div>

        <!-- Pilih Kegiatan -->
        <div class="inchat-field-row">
          <label class="inchat-label">Pilih Kegiatan</label>
          <select class="inchat-select" id="inchat-act-${cid}" onchange="onInchatActivitySelect('${cid}', this)">
            <option value="UTAMA00463" data-waktu="300" data-satuan="Laporan" selected>UTAMA00463 - Mengikuti pelatihan/sosialisasi/pendidikan (300 Menit)</option>
            <option value="UTAMA00030" data-waktu="60" data-satuan="Laporan">UTAMA00030 - Melakukan pengolahan data / input data (60 Menit)</option>
            <option value="UTAMA00120" data-waktu="120" data-satuan="Laporan">UTAMA00120 - Melaksanakan kegiatan pelayanan teknis (120 Menit)</option>
            <option value="UTAMA00015" data-waktu="60" data-satuan="Laporan">UTAMA00015 - Mengikuti rapat dinas / koordinasi (60 Menit)</option>
            <option value="UTAMA00001" data-waktu="30" data-satuan="Laporan">UTAMA00001 - Mengikuti apel pagi / upacara dinas (30 Menit)</option>
            <option value="UTAMA00050" data-waktu="60" data-satuan="Laporan">UTAMA00050 - Melakukan verifikasi dan validasi berkas (60 Menit)</option>
            <option value="UTAMA00080" data-waktu="60" data-satuan="Laporan">UTAMA00080 - Pembuatan laporan berkala / dokumentasi (60 Menit)</option>
          </select>
          <input type="hidden" id="inchat-kode-${cid}" value="${defKode}">
          <input type="hidden" id="inchat-nama-${cid}" value="${defKeg}">
          <input type="hidden" id="inchat-waktu-${cid}" value="300">
          <input type="hidden" id="inchat-satuan-${cid}" value="Laporan">
          <button type="button" class="inchat-btn-catalog" onclick="openCatalogPicker('${cid}')">
            🔍 Cari dari 2.123 Katalog Kegiatan SiPENDEKAR
          </button>
        </div>

        <!-- SKP Dropdown -->
        <div class="inchat-field-row">
          <label class="inchat-label">Sasaran Kinerja Pegawai (SKP Portal)</label>
          <select class="inchat-select" id="inchat-skp-${cid}">
            <option value="0">⏳ Mengambil SKP Anda dari portal SiPENDEKAR...</option>
          </select>
        </div>

        <!-- Jam Kerja -->
        <div class="inchat-field-row">
          <label class="inchat-label">Jam Pelaksanaan</label>
          <div class="inchat-time-grid">
            <div class="inchat-time-cell">
              <input type="number" class="inchat-input" id="inchat-jm-${cid}" min="0" max="23" value="${jmMulai}" placeholder="Jam" oninput="updateInchatDuration('${cid}')">
              <input type="number" class="inchat-input" id="inchat-mm-${cid}" min="0" max="59" value="${mmMulai}" placeholder="Mnt" oninput="updateInchatDuration('${cid}')">
            </div>
            <div class="inchat-time-cell">
              <input type="number" class="inchat-input" id="inchat-js-${cid}" min="0" max="23" value="${jmSelesai}" placeholder="Jam" oninput="updateInchatDuration('${cid}')">
              <input type="number" class="inchat-input" id="inchat-ms-${cid}" min="0" max="59" value="${mmSelesai}" placeholder="Mnt" oninput="updateInchatDuration('${cid}')">
            </div>
          </div>
        </div>

        <div class="inchat-duration-pill" id="inchat-dur-${cid}">
          Durasi: 600 Menit (10.0 Jam)
        </div>

        <!-- Keterangan -->
        <div class="inchat-field-row">
          <label class="inchat-label">Keterangan / Uraian Tugas</label>
          <textarea class="inchat-textarea" id="inchat-ket-${cid}" placeholder="Uraian ringkas hasil pekerjaan...">${defKet}</textarea>
        </div>

        <!-- Submit Button -->
        <button type="button" class="inchat-btn-submit" id="btn-inchat-submit-${cid}" onclick="submitInchatActivity('${cid}')">
          🚀 Kirim Laporan ke SiPENDEKAR
        </button>
      </div>
    `;
  } else if (cardType === 'history_card' && cardData) {
    const logs = cardData.logs || [];
    if (logs.length === 0) {
      return `
        <div class="chat-widget-card">
          <div style="font-size: 12.5px; color: var(--text-muted); text-align: center; padding: 12px;">
            Belum ada catatan riwayat laporan di database lokal.
          </div>
        </div>
      `;
    }

    const itemsHtml = logs.map(l => {
      const durasiStr = l.durasi_menit ? `${escapeHtml(l.durasi_menit)} Menit` : '';
      const waktuStr = (l.jam_mulai && l.jam_selesai) ? `${escapeHtml(l.jam_mulai)} - ${escapeHtml(l.jam_selesai)}` : '';
      const safeKeg = escapeHtml(l.kegiatan_nama || 'Laporan Kegiatan');
      const safeStatus = escapeHtml(l.status || 'Berhasil');
      const safeKet = escapeHtml(l.keterangan || '');
      const safeTgl = escapeHtml(l.tanggal || '');
      return `
        <div class="inchat-history-item">
          <div class="inchat-hist-top">
            <span class="inchat-hist-name">${safeKeg}</span>
            <span class="tag-badge" style="background:#ecfdf5;color:#059669;">${safeStatus}</span>
          </div>
          <div class="inchat-hist-meta">
            <span>📅 ${safeTgl} ${waktuStr ? `(${waktuStr})` : ''}</span>
            <span><strong>${durasiStr}</strong></span>
          </div>
          ${safeKet ? `<div style="font-size: 11px; color: var(--text-muted); font-style: italic;">"${safeKet}"</div>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="chat-widget-card">
        <div class="widget-title-row">
          <span class="widget-title">📜 Riwayat Laporan e-Kinerja</span>
          <span class="tag-badge" style="background: #f3e8ff; color: #9333ea;">${logs.length} Data Terakhir</span>
        </div>
        <div class="inchat-history-list">
          ${itemsHtml}
        </div>
        <button class="widget-btn-action" onclick="openCalendarModal()">
          🗓️ Lihat di Kalender Lengkap
        </button>
      </div>
    `;
  } else if (cardType === 'progress_card' && cardData) {
    const totalMnt = cardData.bulan_menit_total || 0;
    const targetMnt = cardData.bulan_menit_target || 7920;
    const jamTotal = cardData.bulan_jam_total || (totalMnt / 60).toFixed(1);
    const tercapai = cardData.bulan_menit_tercapai;

    return `
      <div class="chat-widget-card">
        <div class="widget-title-row">
          <span class="widget-title">📊 Status e-Kinerja Bulan Ini</span>
          <span class="tag-badge" style="background: #e0f2fe; color: #0284c7;">${cardData.filled_events_count || 0} Hari Terisi</span>
        </div>
        <div style="font-size: 13px; color: var(--text-primary); margin-bottom: 4px;">
          Total Menit Bulan Ini: <strong>${totalMnt.toLocaleString('id-ID')} / ${targetMnt.toLocaleString('id-ID')} m</strong> (${jamTotal} Jam)
        </div>
        <div style="font-size: 11.5px; font-weight: 700; color: ${tercapai ? '#10b981' : '#f59e0b'}; margin-bottom: 8px;">
          ${tercapai ? '✅ Target Minimal BKPSDM Tercapai' : '⚠️ Belum Mencapai Target Minimal'}
        </div>
        <button class="widget-btn-action" onclick="openCalendarModal()">
          🗓️ Buka Kalender Lengkap
        </button>
      </div>
    `;
  } else if (cardType === 'empty_days_card' && cardData) {
    const listHtml = (cardData.empty_days || []).map(d => `
      <div class="widget-item-pill">
        <span><strong>${escapeHtml(d.hari_nama)}</strong>, ${escapeHtml(d.tanggal)}</span>
        <span class="tag-badge" style="background: #fee2e2; color: #b91c1c;">Kosong</span>
      </div>
    `).join('');

    return `
      <div class="chat-widget-card">
        <div class="widget-title" style="margin-bottom: 8px;">Daftar Hari Bolong (H-7)</div>
        ${listHtml}
        <button class="widget-btn-action" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);" onclick="executeAutoFillH7()">
          ⚡ Auto-Fill Semua Hari Bolong
        </button>
      </div>
    `;
  } else if (cardType === 'autofill_prompt') {
    return `
      <div class="chat-widget-card" style="text-align: center;">
        <div class="widget-title" style="margin-bottom: 8px;">Konfirmasi Pengisian Otomatis</div>
        <p style="font-size: 11.5px; color: var(--text-secondary); margin-bottom: 10px;">
          Sistem akan mengisi seluruh hari kerja yang masih kosong dalam 7 hari terakhir dengan kegiatan standar.
        </p>
        <button class="widget-btn-action" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);" onclick="executeAutoFillH7()">
          ⚡ Jalankan Auto-Fill Sekarang
        </button>
      </div>
    `;
  } else if (cardType === 'open_tab') {
    return `
      <div class="chat-widget-card">
        <button class="widget-btn-action" onclick="handleActionChip('isi_kegiatan')">
          📝 Buka Formulir Pelaporan di Chat
        </button>
      </div>
    `;
  } else if (cardType === 'master_template_card' && cardData) {
    inchatCardCounter++;
    const cid = `tmpl_${inchatCardCounter}_${Date.now()}`;
    const today = cardData.today || new Date().toISOString().split('T')[0];
    const templates = cardData.templates || [];

    if (templates.length === 0) {
      return `
        <div class="master-template-widget" id="tmpl-widget-${cid}">
          <div class="tmpl-widget-header">
            <div class="tmpl-header-title">📋 Master Template SiPENDEKAR</div>
            <div class="tmpl-header-sub">Belum ada template tersimpan</div>
          </div>
          
          <div class="tmpl-empty-state-box" style="padding: 20px 14px; text-align: center;">
            <div style="font-size: 36px; margin-bottom: 8px;">📋</div>
            <div style="font-size: 13.5px; font-weight: 700; color: var(--text-primary); margin-bottom: 5px;">
              Daftar Master Template Masih Kosong
            </div>
            <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 16px;">
              Semua template awal telah dikosongkan. Anda dapat membuat master template baru untuk kegiatan rutin Anda atau melapor langsung tanpa template.
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <button type="button" class="tmpl-btn-submit" onclick="sendUserMessage('buat template')" style="width: 100%;">
                ➕ Buat Master Template 1 Sekarang
              </button>
              <button type="button" class="tmpl-btn-secondary" onclick="sendUserMessage('isi tanpa template')" style="width: 100%; border: 1.5px solid #cbd5e1; background: #ffffff; padding: 7px 12px; border-radius: 8px; font-size: 11.5px; font-weight: 700; cursor: pointer; color: var(--text-primary);">
                ✍️ Isi Langsung (Tanpa Template)
              </button>
            </div>
          </div>
        </div>
      `;
    }

    const itemsHtml = templates.map(t => {
      const jamStr = `${t.jam_mulai}:${t.menit_mulai} - ${t.jam_selesai}:${t.menit_selesai}`;
      const vol = t.volume || 1;
      const durasi = t.durasi_menit || 600;
      const jamTotal = (durasi / 60).toFixed(1);
      const safeTitle = escapeHtml(t.title);
      const safeNama = escapeHtml(t.nama_aktifitas);
      const safeKode = escapeHtml(t.kode_aktifitas);
      const safeKet = escapeHtml(t.keterangan);
      return `
        <div class="tmpl-card-item">
          <div class="tmpl-badge-wrap">
            <span class="tmpl-number-badge">Template ${t.template_num}</span>
            <span class="tmpl-durasi-badge">⏱️ ${durasi} Menit (${jamTotal} Jam)</span>
          </div>
          <div class="tmpl-title">${safeTitle}</div>
          <div class="tmpl-activity">${safeNama} <span class="tmpl-code">[${safeKode}]</span></div>
          <div class="tmpl-time" style="display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; margin: 5px 0;">
            <span>🕒 Jam: <strong>${jamStr}</strong></span>
            <span>📊 Volume Standar: <strong style="color: #2563eb;">${vol} Output</strong></span>
          </div>
          <div class="tmpl-desc">📝 "${safeKet}"</div>
          
          <div style="display: flex; gap: 8px; align-items: center; margin-top: 10px;">
            <div style="display: flex; align-items: center; gap: 4px; background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 8px; padding: 4px 8px;" title="Atur volume untuk laporan hari ini">
              <span style="font-size: 11px; font-weight: 700; color: #64748b;">Vol:</span>
              <input type="number" id="tmpl-vol-${cid}-${t.template_num}" min="1" max="99" value="${vol}" style="width: 42px; height: 24px; border: none; background: transparent; font-size: 13px; font-weight: 800; color: #1e293b; text-align: center;">
            </div>
            <button type="button" class="tmpl-btn-submit" style="flex: 1; margin-top: 0;" id="btn-tmpl-${cid}-${t.template_num}" onclick="sendTemplateReport(${t.template_num}, '${cid}')">
              ⚡ Kirim Template ${t.template_num} Sekarang
            </button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="master-template-widget" id="tmpl-widget-${cid}">
        <div class="tmpl-widget-header">
          <div class="tmpl-header-title">📋 Master Template SiPENDEKAR</div>
          <div class="tmpl-header-sub">Pilih salah satu template di bawah untuk lapor instan dengan 1 klik:</div>
        </div>
        
        <div class="tmpl-date-picker-row">
          <label class="tmpl-date-label">📅 Tanggal Pelaporan:</label>
          <input type="date" class="tmpl-date-input" id="tmpl-date-${cid}" value="${today}">
        </div>

        <div class="tmpl-cards-container">
          ${itemsHtml}
        </div>

        <div class="tmpl-bottom-action-bar">
          <button type="button" class="tmpl-btn-ghost" onclick="sendUserMessage('buat template')">
            ➕ Buat Template Baru
          </button>
          <button type="button" class="tmpl-btn-ghost highlight" onclick="sendUserMessage('isi tanpa template')">
            ✍️ Isi Tanpa Template
          </button>
        </div>
      </div>
    `;
  } else if (cardType === 'create_template_card' && cardData) {
    inchatCardCounter++;
    const cid = `create_tmpl_${inchatCardCounter}_${Date.now()}`;
    const nextNum = cardData.next_num || 1;
    const defKode = 'UTAMA00463';
    const defKeg = 'Mengikuti pelatihan/sosialisasi/pendidikan';
    const defKet = 'melaksanakan tugas operasional kedinasan';

    setTimeout(() => {
      updateCreateTmplDuration(cid);
    }, 60);

    return `
      <div class="master-template-widget" id="create-tmpl-${cid}">
        <div class="tmpl-widget-header">
          <div class="tmpl-header-title">➕ Buat Master Template Baru</div>
          <div class="tmpl-header-sub">Simpan template kustom Anda agar bisa dipanggil instan kapan saja:</div>
        </div>

        <div class="tmpl-form-grid">
          <div class="tmpl-form-row two-col">
            <div>
              <label class="tmpl-input-label">Nomor Template</label>
              <input type="number" class="tmpl-form-input" id="ct-num-${cid}" min="1" max="99" value="${nextNum}">
            </div>
            <div>
              <label class="tmpl-input-label">Judul Template</label>
              <input type="text" class="tmpl-form-input" id="ct-title-${cid}" placeholder="Contoh: Monev Lapangan" value="Template ${nextNum}">
            </div>
          </div>

          <div class="tmpl-form-row">
            <label class="tmpl-input-label">Kegiatan Standar</label>
            <select class="tmpl-form-select" id="ct-act-${cid}" onchange="onCtActivitySelect('${cid}', this)">
              <option value="UTAMA00463" data-waktu="300" data-satuan="Laporan" selected>UTAMA00463 - Mengikuti pelatihan/sosialisasi/pendidikan (300 Menit / Laporan)</option>
              <option value="UTAMA00030" data-waktu="60" data-satuan="Laporan">UTAMA00030 - Melakukan pengolahan data / input data (60 Menit)</option>
              <option value="UTAMA00120" data-waktu="120" data-satuan="Laporan">UTAMA00120 - Melaksanakan kegiatan pelayanan teknis (120 Menit)</option>
              <option value="UTAMA00015" data-waktu="60" data-satuan="Laporan">UTAMA00015 - Mengikuti rapat dinas / koordinasi (60 Menit)</option>
              <option value="UTAMA00001" data-waktu="30" data-satuan="Laporan">UTAMA00001 - Mengikuti apel pagi / upacara dinas (30 Menit)</option>
              <option value="UTAMA00050" data-waktu="60" data-satuan="Laporan">UTAMA00050 - Melakukan verifikasi dan validasi berkas (60 Menit)</option>
              <option value="UTAMA00080" data-waktu="60" data-satuan="Laporan">UTAMA00080 - Pembuatan laporan berkala / dokumentasi (60 Menit)</option>
            </select>
            <input type="hidden" id="ct-kode-${cid}" value="${defKode}">
            <input type="hidden" id="ct-nama-${cid}" value="${defKeg}">
            <input type="hidden" id="ct-waktu-${cid}" value="300">
            <input type="hidden" id="ct-satuan-${cid}" value="Laporan">
            <button type="button" class="tmpl-btn-catalog" onclick="openCatalogPicker('${cid}')">
              🔍 Cari dari 2.123 Katalog SiPENDEKAR
            </button>
          </div>

          <!-- Volume Output Laporan -->
          <div class="tmpl-form-row two-col">
            <div>
              <label class="tmpl-input-label">📊 Volume Output Laporan</label>
              <input type="number" class="tmpl-form-input" id="ct-vol-${cid}" min="1" max="99" value="2" oninput="updateCreateTmplDuration('${cid}')">
            </div>
            <div>
              <label class="tmpl-input-label">Satuan Output</label>
              <input type="text" class="tmpl-form-input" id="ct-satuan-label-${cid}" value="Laporan" readonly style="background:#f1f5f9;color:#64748b;font-weight:600;">
            </div>
          </div>

          <div class="tmpl-form-row">
            <label class="tmpl-input-label">Jam Kerja Bawaan</label>
            <div class="tmpl-time-picker-row">
              <div class="tmpl-time-box">
                <span class="time-lbl">Mulai</span>
                <div class="tmpl-time-inputs-wrap">
                  <input type="number" class="tmpl-time-input" id="ct-jm-${cid}" min="0" max="23" value="07" oninput="updateCreateTmplDuration('${cid}')">
                  <span class="tmpl-time-colon">:</span>
                  <input type="number" class="tmpl-time-input" id="ct-mm-${cid}" min="0" max="59" value="30" oninput="updateCreateTmplDuration('${cid}')">
                </div>
              </div>
              <div class="tmpl-time-arrow">➡️</div>
              <div class="tmpl-time-box">
                <span class="time-lbl">Selesai</span>
                <div class="tmpl-time-inputs-wrap">
                  <input type="number" class="tmpl-time-input" id="ct-js-${cid}" min="0" max="23" value="17" oninput="updateCreateTmplDuration('${cid}')">
                  <span class="tmpl-time-colon">:</span>
                  <input type="number" class="tmpl-time-input" id="ct-ms-${cid}" min="0" max="59" value="30" oninput="updateCreateTmplDuration('${cid}')">
                </div>
              </div>
            </div>
            <div class="tmpl-dur-preview" id="ct-dur-${cid}">
              Durasi: 600 Menit (10.0 Jam)
            </div>
          </div>

          <div class="tmpl-form-row">
            <label class="tmpl-input-label">Keterangan / Uraian Bawaan</label>
            <textarea class="tmpl-form-textarea" id="ct-ket-${cid}" placeholder="Uraian kegiatan...">${defKet}</textarea>
          </div>

          <div class="tmpl-action-row">
            <button type="button" class="tmpl-btn-submit" id="btn-save-tmpl-${cid}" onclick="submitSaveTemplate('${cid}')">
              💾 Simpan Master Template
            </button>
            <button type="button" class="tmpl-btn-secondary" onclick="sendUserMessage('pilih template')">
              Batal
            </button>
          </div>
        </div>
      </div>
    `;
  } else if (cardType === 'fill_manual_card' && cardData) {
    // Sesuai instruksi: Di chat asisten murni percakapan (chatan saja), tidak ada form berukuran besar di bubble chat.
    // Form tetap berada di Menu Input Mandiri tersendiri (Modal #modal-manual-input).
    const today = cardData.today || new Date().toISOString().split('T')[0];
    const defKode = cardData.default_kode || 'UTAMA00463';
    const defKeg = cardData.default_kegiatan || 'Mengikuti pelatihan/sosialisasi/pendidikan';
    const defKet = cardData.default_keterangan || 'Melaksanakan tugas kedinasan harian sesuai arahan pimpinan.';
    const jmMulai = cardData.default_jam_mulai || '08';
    const mmMulai = cardData.default_menit_mulai || '00';
    const jmSelesai = cardData.default_jam_selesai || '13';
    const mmSelesai = cardData.default_menit_selesai || '00';
    const vol = cardData.volume || 1;
    const waktu = cardData.waktu || 300;

    AppState.latestAiDraft = {
      tgl: today,
      kode: defKode,
      keg: defKeg,
      ket: defKet,
      jm: jmMulai,
      mm: mmMulai,
      js: jmSelesai,
      ms: mmSelesai,
      vol: vol,
      waktu: waktu
    };

    return `
      <div style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap;">
        <button class="tg-key-btn highlight" style="background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;padding:6px 14px;border-radius:18px;font-size:12px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;" onclick="openManualInputModalWithDraft()">
          <span>📝 Buka di Menu Input Mandiri</span>
        </button>
      </div>
    `;
  } else if (cardType === 'ai_settings_card' && cardData) {
    const hasKey = cardData.has_api_key;
    const prov = (cardData.provider || 'local').toUpperCase();
    const model = cardData.model || 'local-nlp';
    const masked = cardData.api_key_masked || 'Belum diisi';

    return `
      <div class="ai-settings-widget">
        <div class="ai-widget-header">
          <div class="ai-widget-badge">✨ AI COPILOT</div>
          <div class="ai-widget-title">Pusat Asisten Cerdas SiPENDEKAR</div>
        </div>
        <div class="ai-widget-body">
          <div class="ai-stat-row">
            <span>Provider Aktif:</span>
            <strong>${prov} ${hasKey ? '✅' : '⚡ (Mode Bawaan)'}</strong>
          </div>
          <div class="ai-stat-row">
            <span>Model:</span>
            <code>${model}</code>
          </div>
          <div class="ai-stat-row">
            <span>API Key:</span>
            <span>${masked}</span>
          </div>
        </div>
        <div class="ai-widget-actions">
          <button class="tmpl-btn-submit" onclick="openAiSettingsModal()" style="background: linear-gradient(135deg, #7c3aed, #2563eb) !important;">
            ⚙️ Atur API Key
          </button>
          <button class="tmpl-btn-secondary" onclick="testAiConnection()">
            🧪 Uji Koneksi
          </button>
        </div>
      </div>
    `;
  } else if (cardType === 'ai_template_rec_card' && cardData) {
    inchatCardCounter++;
    const cid = `ai_tmpl_${inchatCardCounter}_${Date.now()}`;
    const tnum = cardData.next_num || 1;
    const title = cardData.title || `Master Template ${tnum}`;
    const kode = cardData.kode_aktifitas || 'UTAMA00030';
    const nama = cardData.nama_aktifitas || 'Melakukan pengolahan data / input data';
    const jm = cardData.jam_mulai || '07';
    const mm = cardData.menit_mulai || '30';
    const js = cardData.jam_selesai || '17';
    const ms = cardData.menit_selesai || '30';
    const dur = cardData.durasi_menit || 600;
    const ket = cardData.keterangan || '';
    const vol = cardData.volume || 1;
    const waktuStd = cardData.waktu_standar || Math.round(dur / vol);
    const satuan = cardData.satuan_output || 'Output';

    window._aiRecStore = window._aiRecStore || {};
    window._aiRecStore[cid] = { tnum, title, kode, nama, jm, mm, js, ms, dur, ket, vol };

    const safeTitle = escapeHtml(title);
    const safeNama = escapeHtml(nama);
    const safeKode = escapeHtml(kode);
    const safeKet = escapeHtml(ket);
    const safeSatuan = escapeHtml(satuan);

    return `
      <div class="ai-settings-widget" style="border: 1px solid #c4b5fd;">
        <div class="ai-widget-header" style="background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%);">
          <div class="ai-widget-badge">✨ REKOMENDASI AI (${aiProv})</div>
          <div class="ai-widget-title">Master Template #${tnum} - Siap Dipakai Kapan Saja</div>
        </div>
        <div class="ai-widget-body">
          <div class="ai-stat-row">
            <span>🏷️ Judul Template:</span>
            <strong>${safeTitle}</strong>
          </div>
          <div class="ai-stat-row">
            <span>📋 Kegiatan:</span>
            <span style="font-weight:600;color:#1e293b;">${safeNama} [${safeKode}]</span>
          </div>
          <div class="ai-stat-row">
            <span>📊 Volume Output:</span>
            <strong style="color:#059669;">${vol} ${safeSatuan} (Standar: ${waktuStd} Menit/${safeSatuan})</strong>
          </div>
          <div class="ai-stat-row">
            <span>⏱️ Total Menit e-Kinerja:</span>
            <strong style="color:var(--ms-blue);">${dur} Menit (${(dur/60).toFixed(1)} Jam) [Jam: ${jm}:${mm} - ${js}:${ms}]</strong>
          </div>
          <div class="ai-stat-row" style="flex-direction:column;align-items:flex-start;gap:4px;">
            <span>📝 Uraian Tugas Standar:</span>
            <div style="background:#f1f5f9;padding:6px 10px;border-radius:6px;width:100%;box-sizing:border-box;">${safeKet}</div>
          </div>
        </div>
        <div class="ai-widget-actions">
          <button class="tmpl-btn-submit" id="btn-save-ai-tmpl-${cid}" onclick="saveAiRecommendedTemplateFromStore('${cid}')" style="background: linear-gradient(135deg, #7c3aed, #2563eb) !important; font-weight:700;">
            💾 Simpan Jadi Master Template ${tnum}
          </button>
          <button class="tmpl-btn-secondary" onclick="sendUserMessage('/template')">
            📋 Lihat Template Saya
          </button>
        </div>
      </div>
    `;
  } else if (cardType === 'template_success_card' && cardData) {
    const jamTotal = ((cardData.durasi_menit || 600) / 60).toFixed(1);
    const safeTmplTitle = escapeHtml(cardData.title || '');
    const safeTgl = escapeHtml(cardData.tanggal || '');
    const safeKeg = escapeHtml(cardData.kegiatan || '');
    return `
      <div class="template-success-card">
        <div class="tmpl-success-header">
          <span class="tmpl-success-icon">✅</span>
          <div>
            <div class="tmpl-success-title">Laporan Diterima SiPENDEKAR</div>
            <div class="tmpl-success-sub">Template ${cardData.template_num || 1} • ${safeTmplTitle}</div>
          </div>
        </div>
        <div class="tmpl-success-body">
          <div class="tmpl-success-row">
            <span>📅 Tanggal:</span>
            <strong>${safeTgl}</strong>
          </div>
          <div class="tmpl-success-row">
            <span>⏱️ Durasi:</span>
            <strong style="color:var(--ms-blue);">${cardData.durasi_menit || 600} Menit (${jamTotal} Jam)</strong>
          </div>
          <div class="tmpl-success-row">
            <span>📋 Kegiatan:</span>
            <span style="font-weight:600;">${safeKeg}</span>
          </div>
        </div>
        <div class="tmpl-success-actions">
          <button class="tmpl-btn-secondary" onclick="sendUserMessage('progres')">
            📊 Cek Total Menit Bulan Ini
          </button>
          <button class="tmpl-btn-secondary" onclick="sendUserMessage('pilih template')">
            📋 Lapor Template Lain
          </button>
        </div>
      </div>
    `;
  }
  return '';
}

function updateInchatDuration(cid) {
  const jmEl = document.getElementById(`inchat-jm-${cid}`);
  const mmEl = document.getElementById(`inchat-mm-${cid}`);
  const jsEl = document.getElementById(`inchat-js-${cid}`);
  const msEl = document.getElementById(`inchat-ms-${cid}`);
  const volEl = document.getElementById(`inchat-vol-${cid}`);
  const waktuEl = document.getElementById(`inchat-waktu-${cid}`);
  const pill = document.getElementById(`inchat-dur-${cid}`);
  if (!pill) return;

  const jm = parseInt(jmEl ? jmEl.value : 7) || 0;
  const mm = parseInt(mmEl ? mmEl.value : 30) || 0;
  const js = parseInt(jsEl ? jsEl.value : 17) || 0;
  const ms = parseInt(msEl ? msEl.value : 30) || 0;
  const vol = parseInt(volEl ? volEl.value : 1) || 1;
  const waktuStandar = parseInt(waktuEl ? waktuEl.value : 300) || 300;

  const totalMenitKinerja = waktuStandar * vol;
  const jam = (totalMenitKinerja / 60).toFixed(1);

  pill.innerHTML = `
    <div style="font-size: 13px; font-weight: 800; color: #0284c7;">
      ⚡ Total Diakui SiPENDEKAR: <strong>${totalMenitKinerja} Menit</strong> (${jam} Jam)
    </div>
    <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
      Hitungan: ${vol} Volume × ${waktuStandar} Menit/Output | Jam: ${String(jm).padStart(2,'0')}:${String(mm).padStart(2,'0')} - ${String(js).padStart(2,'0')}:${String(ms).padStart(2,'0')}
    </div>
  `;
  pill.style.borderColor = '#bae6fd';
}

async function populateInchatSkp(cid, kode = "") {
  const select = document.getElementById(`inchat-skp-${cid}`);
  if (!select) return;

  if (AppState.cachedSkpList && AppState.cachedSkpList.length > 0) {
    renderSkpToSelect(select, AppState.cachedSkpList);
    return;
  }

  try {
    const url = kode ? `/api/skp?kode_aktivitas=${encodeURIComponent(kode)}` : '/api/skp';
    const res = await fetch(url).then(r => r.json());
    if (res.success && res.skp && res.skp.length > 0) {
      AppState.cachedSkpList = res.skp;
      renderSkpToSelect(select, res.skp);
    } else {
      select.innerHTML = `<option value="0">Standar Kegiatan Pokok (Otomatis)</option>`;
    }
  } catch (e) {
    select.innerHTML = `<option value="0">Standar SKP Pegawai</option>`;
  }
}

function renderSkpToSelect(select, list) {
  select.innerHTML = '';
  list.forEach((skp, idx) => {
    const opt = document.createElement('option');
    opt.value = skp.id;
    const name = skp.nama || skp.nama_skp || skp.sasaran_kerja || skp.uraian || `SKP #${skp.id}`;
    opt.textContent = `${idx + 1}. ${name} [ID: ${skp.id}]`;
    opt.title = name;
    select.appendChild(opt);
  });
  select.selectedIndex = 0;
}

function onInchatActivitySelect(cid, selectEl) {
  const kode = selectEl.value;
  const opt = selectEl.options[selectEl.selectedIndex];
  const text = opt.text;
  const parts = text.split(' - ');
  const nama = parts.length > 1 ? parts[1].replace(/\(.*\)/, '').trim() : text;
  const waktu = parseInt(opt.dataset.waktu) || 60;
  const satuan = opt.dataset.satuan || 'Laporan';

  const kodeInput = document.getElementById(`inchat-kode-${cid}`);
  const namaInput = document.getElementById(`inchat-nama-${cid}`);
  const waktuInput = document.getElementById(`inchat-waktu-${cid}`);
  const satuanInput = document.getElementById(`inchat-satuan-${cid}`);
  const ketInput = document.getElementById(`inchat-ket-${cid}`);

  if (kodeInput) kodeInput.value = kode;
  if (namaInput) namaInput.value = nama;
  if (waktuInput) waktuInput.value = waktu;
  if (satuanInput) satuanInput.value = satuan;
  if (ketInput && (!ketInput.value || ketInput.value.includes('pelatihan'))) {
    ketInput.value = nama.toLowerCase();
  }

  populateInchatSkp(cid, kode);
  updateInchatDuration(cid);
}

function openCatalogPicker(targetCid) {
  AppState.activeInchatCardId = targetCid;
  const modal = document.getElementById('modal-catalog-picker');
  if (modal) modal.classList.add('active');
  searchCatalog("", "ALL");
}

function selectCatalogItemForInchat(item) {
  const cid = AppState.activeInchatCardId;
  closeModal('modal-catalog-picker');
  if (!cid) return;

  // Khusus Modal Input Mandiri
  if (cid === 'dedicated_modal') {
    const kodeEl = document.getElementById('ded-input-kode');
    const namaEl = document.getElementById('ded-input-nama');
    const waktuEl = document.getElementById('ded-input-waktu');
    const satuanEl = document.getElementById('ded-input-satuan');
    const selectEl = document.getElementById('ded-input-activity');
    const ketEl = document.getElementById('ded-input-keterangan');

    if (kodeEl) kodeEl.value = item.kode_aktifitas;
    if (namaEl) namaEl.value = item.nama_aktifitas;
    if (waktuEl) waktuEl.value = item.waktu || 300;
    if (satuanEl) satuanEl.value = item.satuan || item.satuan_output || 'Kegiatan';
    if (ketEl && (!ketEl.value || ketEl.value.trim().length < 5)) {
      ketEl.value = `Melaksanakan ${item.nama_aktifitas.toLowerCase()} sesuai arahan pimpinan.`;
    }

    if (selectEl) {
      let exists = false;
      for (let i = 0; i < selectEl.options.length; i++) {
        if (selectEl.options[i].value === item.kode_aktifitas) {
          selectEl.selectedIndex = i;
          exists = true;
          break;
        }
      }
      if (!exists) {
        const newOpt = document.createElement('option');
        newOpt.value = item.kode_aktifitas;
        newOpt.dataset.waktu = item.waktu || 300;
        newOpt.dataset.satuan = item.satuan || item.satuan_output || 'Kegiatan';
        newOpt.textContent = `${item.kode_aktifitas} - ${item.nama_aktifitas} (${item.waktu || 300} Menit)`;
        selectEl.prepend(newOpt);
        selectEl.selectedIndex = 0;
      }
    }

    populateDedicatedSkp(item.kode_aktifitas);
    onDedicatedVolumeOrTimeChange('activity');
    return;
  }

  const select = document.getElementById(`inchat-act-${cid}`) || document.getElementById(`ct-act-${cid}`);
  const kodeInput = document.getElementById(`inchat-kode-${cid}`) || document.getElementById(`ct-kode-${cid}`);
  const namaInput = document.getElementById(`inchat-nama-${cid}`) || document.getElementById(`ct-nama-${cid}`);
  const ketInput = document.getElementById(`inchat-ket-${cid}`) || document.getElementById(`ct-ket-${cid}`);

  const waktuInput = document.getElementById(`inchat-waktu-${cid}`) || document.getElementById(`ct-waktu-${cid}`);
  const satuanInput = document.getElementById(`inchat-satuan-${cid}`) || document.getElementById(`ct-satuan-${cid}`);
  const satuanLabel = document.getElementById(`ct-satuan-label-${cid}`);

  if (kodeInput) kodeInput.value = item.kode_aktifitas;
  if (namaInput) namaInput.value = item.nama_aktifitas;
  if (waktuInput) waktuInput.value = item.waktu || 30;
  if (satuanInput) satuanInput.value = item.satuan || item.satuan_output || 'Laporan';
  if (satuanLabel) satuanLabel.value = item.satuan || item.satuan_output || 'Laporan';
  if (ketInput) ketInput.value = item.nama_aktifitas.toLowerCase();

  if (select) {
    let exists = false;
    for (let i = 0; i < select.options.length; i++) {
      if (select.options[i].value === item.kode_aktifitas) {
        select.selectedIndex = i;
        exists = true;
        break;
      }
    }
    if (!exists) {
      const newOpt = document.createElement('option');
      newOpt.value = item.kode_aktifitas;
      newOpt.dataset.waktu = item.waktu || 30;
      newOpt.dataset.satuan = item.satuan || item.satuan_output || 'Laporan';
      newOpt.textContent = `${item.kode_aktifitas} - ${item.nama_aktifitas} (${item.waktu || 30} Menit)`;
      select.prepend(newOpt);
      select.selectedIndex = 0;
    }
  }

  populateInchatSkp(cid, item.kode_aktifitas);
  updateCreateTmplDuration(cid);
  updateInchatDuration(cid);
  showToast(`Kegiatan dipilih: ${item.nama_aktifitas} (${item.waktu || 30} Menit)`, "success");
}

function updateCreateTmplDuration(cid) {
  const jmEl = document.getElementById(`ct-jm-${cid}`);
  const mmEl = document.getElementById(`ct-mm-${cid}`);
  const jsEl = document.getElementById(`ct-js-${cid}`);
  const msEl = document.getElementById(`ct-ms-${cid}`);
  const volEl = document.getElementById(`ct-vol-${cid}`);
  const waktuEl = document.getElementById(`ct-waktu-${cid}`);
  const pill = document.getElementById(`ct-dur-${cid}`);
  if (!pill) return;

  const jm = parseInt(jmEl ? jmEl.value : 7) || 0;
  const mm = parseInt(mmEl ? mmEl.value : 30) || 0;
  const js = parseInt(jsEl ? jsEl.value : 17) || 0;
  const ms = parseInt(msEl ? msEl.value : 30) || 0;
  const vol = parseInt(volEl ? volEl.value : 1) || 1;
  const waktuStandar = parseInt(waktuEl ? waktuEl.value : 300) || 300;

  const totalMenitKinerja = waktuStandar * vol;
  const jam = (totalMenitKinerja / 60).toFixed(1);

  pill.innerHTML = `
    <div style="font-size: 13px; font-weight: 800; color: #0284c7;">
      ⚡ Total Diakui SiPENDEKAR: <strong>${totalMenitKinerja} Menit</strong> (${jam} Jam)
    </div>
    <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
      Hitungan: ${vol} Volume × ${waktuStandar} Menit/Output | Jam: ${String(jm).padStart(2,'0')}:${String(mm).padStart(2,'0')} - ${String(js).padStart(2,'0')}:${String(ms).padStart(2,'0')}
    </div>
  `;
  pill.style.borderColor = '#bae6fd';
}

// ==============================================================================
// MODAL TEMPLATE PROMPT CHAT
// ==============================================================================

function openPromptTemplateModal() {
  const modal = document.getElementById('modal-prompt-templates');
  if (modal) modal.classList.add('active');
}

function usePromptTemplate(promptText) {
  closeModal('modal-prompt-templates');
  const input = document.getElementById('chat-text-input');
  if (input) {
    input.value = promptText;
    input.focus();
    updateSendButtonIcon();
    showToast("Template prompt dimasukkan ke chat!", "info");
  }
}

// ==============================================================================
// MODAL INPUT MANDIRI RESMI (DEDICATED FORM DENGAN SINKRONISASI VOLUME & JAM)
// ==============================================================================

function openManualInputModal(draft = null) {
  const modal = document.getElementById('modal-manual-input');
  if (!modal) return;
  modal.classList.add('active');
  modal.style.display = 'flex';

  const tglEl = document.getElementById('ded-input-tanggal');
  const volEl = document.getElementById('ded-input-volume');
  const actSelect = document.getElementById('ded-input-activity');
  const kodeEl = document.getElementById('ded-input-kode');
  const namaEl = document.getElementById('ded-input-nama');
  const waktuEl = document.getElementById('ded-input-waktu');
  const satuanEl = document.getElementById('ded-input-satuan');
  const jmEl = document.getElementById('ded-input-jm');
  const mmEl = document.getElementById('ded-input-mm');
  const jsEl = document.getElementById('ded-input-js');
  const msEl = document.getElementById('ded-input-ms');
  const ketEl = document.getElementById('ded-input-keterangan');

  const todayStr = new Date().toISOString().split('T')[0];

  const tgl = draft && draft.tgl ? draft.tgl : (tglEl && tglEl.value ? tglEl.value : todayStr);
  const vol = draft && draft.vol ? draft.vol : 1;
  const kode = draft && draft.kode ? draft.kode : 'UTAMA00463';
  const nama = draft && draft.keg ? draft.keg : 'Mengikuti pelatihan/sosialisasi/pendidikan';
  const ket = draft && draft.ket ? draft.ket : 'Melaksanakan tugas kedinasan harian sesuai arahan pimpinan.';
  const jm = draft && draft.jm ? draft.jm : '08';
  const mm = draft && draft.mm ? draft.mm : '00';
  const js = draft && draft.js ? draft.js : '13';
  const ms = draft && draft.ms ? draft.ms : '00';
  const waktu = draft && draft.waktu ? draft.waktu : 300;

  if (tglEl) tglEl.value = tgl;
  if (volEl) volEl.value = vol;
  if (kodeEl) kodeEl.value = kode;
  if (namaEl) namaEl.value = nama;
  if (waktuEl) waktuEl.value = waktu;
  if (satuanEl) satuanEl.value = 'Kegiatan';
  if (jmEl) jmEl.value = jm;
  if (mmEl) mmEl.value = mm;
  if (jsEl) jsEl.value = js;
  if (msEl) msEl.value = ms;
  if (ketEl) ketEl.value = ket;

  // Pastikan dropdown kegiatan populer terisi
  if (actSelect && actSelect.options.length <= 1) {
    actSelect.innerHTML = `
      <option value="UTAMA00463" data-waktu="300" data-satuan="Kegiatan">UTAMA00463 - Mengikuti pelatihan/sosialisasi/pendidikan (300 Menit)</option>
      <option value="UTAMA00106" data-waktu="300" data-satuan="Laporan">UTAMA00106 - Melaksanakan pengumpulan data, validasi data, analisis data (300 Menit)</option>
      <option value="UTAMA00030" data-waktu="60" data-satuan="Laporan">UTAMA00030 - Melakukan pengolahan data / input data (60 Menit)</option>
      <option value="UTAMA00120" data-waktu="120" data-satuan="Laporan">UTAMA00120 - Melaksanakan kegiatan pelayanan teknis (120 Menit)</option>
      <option value="UTAMA00015" data-waktu="60" data-satuan="Laporan">UTAMA00015 - Mengikuti rapat dinas / koordinasi (60 Menit)</option>
      <option value="UTAMA00001" data-waktu="30" data-satuan="Laporan">UTAMA00001 - Mengikuti apel pagi / upacara dinas (30 Menit)</option>
      <option value="UTAMA00050" data-waktu="60" data-satuan="Laporan">UTAMA00050 - Melakukan verifikasi dan validasi berkas (60 Menit)</option>
      <option value="UTAMA00080" data-waktu="60" data-satuan="Laporan">UTAMA00080 - Pembuatan laporan berkala / dokumentasi (60 Menit)</option>
    `;
  }

  if (actSelect) {
    let exists = false;
    for (let i = 0; i < actSelect.options.length; i++) {
      if (actSelect.options[i].value === kode) {
        actSelect.selectedIndex = i;
        exists = true;
        break;
      }
    }
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = kode;
      opt.dataset.waktu = waktu;
      opt.textContent = `${kode} - ${nama} (${waktu} Menit)`;
      actSelect.prepend(opt);
      actSelect.selectedIndex = 0;
    }
  }

  populateDedicatedSkp(kode);
  onDedicatedVolumeOrTimeChange('init');
}

function openManualInputModalWithDraft() {
  openManualInputModal(AppState.latestAiDraft);
}

function openDedicatedCatalogPicker() {
  AppState.activeInchatCardId = 'dedicated_modal';
  const modal = document.getElementById('modal-catalog-picker');
  if (modal) modal.classList.add('active');
  searchCatalog("", "ALL");
}

function onDedicatedActivitySelect(selectEl) {
  const opt = selectEl.options[selectEl.selectedIndex];
  if (!opt) return;
  const kode = opt.value;
  const waktu = parseInt(opt.dataset.waktu) || 300;
  const satuan = opt.dataset.satuan || 'Kegiatan';
  const nama = opt.textContent.replace(/^[^-]+-\s*/, '').replace(/\s*\(\d+\s*Menit\)$/, '');

  document.getElementById('ded-input-kode').value = kode;
  document.getElementById('ded-input-nama').value = nama;
  document.getElementById('ded-input-waktu').value = waktu;
  document.getElementById('ded-input-satuan').value = satuan;

  populateDedicatedSkp(kode);
  onDedicatedVolumeOrTimeChange('activity');
}

async function populateDedicatedSkp(kode = "") {
  const select = document.getElementById('ded-input-skp');
  if (!select) return;

  if (AppState.cachedSkpList && AppState.cachedSkpList.length > 0) {
    renderSkpToSelect(select, AppState.cachedSkpList);
    return;
  }

  try {
    const url = kode ? `/api/skp?kode_aktivitas=${encodeURIComponent(kode)}` : '/api/skp';
    const res = await fetch(url).then(r => r.json());
    if (res.success && res.skp && res.skp.length > 0) {
      AppState.cachedSkpList = res.skp;
      renderSkpToSelect(select, res.skp);
    } else {
      select.innerHTML = `<option value="0">Standar Kegiatan Pokok (Otomatis)</option>`;
    }
  } catch (e) {
    select.innerHTML = `<option value="0">Standar SKP Pegawai</option>`;
  }
}

/**
 * Sinkronisasi Dua Arah: Volume Output <-> Jam Pelaksanaan
 * Di SiPENDEKAR: Menit Kinerja = Volume * Waktu Standar.
 * Jam selesai harus presisi dan sesuai kelipatan standar waktu.
 */
function onDedicatedVolumeOrTimeChange(source = 'volume') {
  const volEl = document.getElementById('ded-input-volume');
  const waktuEl = document.getElementById('ded-input-waktu');
  const jmEl = document.getElementById('ded-input-jm');
  const mmEl = document.getElementById('ded-input-mm');
  const jsEl = document.getElementById('ded-input-js');
  const msEl = document.getElementById('ded-input-ms');
  const durPreview = document.getElementById('ded-input-dur-preview');

  if (!volEl || !waktuEl || !jmEl || !mmEl || !jsEl || !msEl || !durPreview) return;

  const waktu = parseInt(waktuEl.value) || 300;
  let jm = parseInt(jmEl.value) || 8;
  let mm = parseInt(mmEl.value) || 0;
  let js = parseInt(jsEl.value) || 13;
  let ms = parseInt(msEl.value) || 0;

  jm = Math.max(0, Math.min(23, jm));
  mm = Math.max(0, Math.min(59, mm));
  js = Math.max(0, Math.min(23, js));
  ms = Math.max(0, Math.min(59, ms));

  let vol = parseInt(volEl.value) || 1;
  if (vol < 1) vol = 1;

  if (source === 'volume' || source === 'activity' || source === 'init') {
    // Volume menentukan durasi total & Jam Selesai
    const targetMinutes = vol * waktu;
    const startMinutes = jm * 60 + mm;
    const endMinutes = startMinutes + targetMinutes;

    const calcJs = Math.floor(endMinutes / 60) % 24;
    const calcMs = endMinutes % 60;

    jsEl.value = String(calcJs).padStart(2, '0');
    msEl.value = String(calcMs).padStart(2, '0');
    js = calcJs;
    ms = calcMs;

    durPreview.className = "tmpl-dur-preview success";
    durPreview.innerHTML = `
      <div style="font-weight: 700; color: #0284c7; display: flex; align-items: center; gap: 6px;">
        <span>⚡ Total Diakui SiPENDEKAR:</span>
        <span style="font-size: 13.5px; color: #0369a1;">${targetMinutes.toLocaleString('id-ID')} Menit (${(targetMinutes / 60).toFixed(1)} Jam)</span>
      </div>
      <div style="font-size: 11.5px; color: #475569; margin-top: 3px;">
        Hitungan: <strong>${vol} Volume</strong> × <strong>${waktu} Menit/Output</strong> | Jam: <strong>${String(jm).padStart(2,'0')}:${String(mm).padStart(2,'0')} - ${String(js).padStart(2,'0')}:${String(ms).padStart(2,'0')}</strong>
        <span style="display:inline-block; margin-left: 6px; background: #dcfce7; color: #15803d; padding: 1px 7px; border-radius: 4px; font-weight: 700;">✅ Sinkron 100%</span>
      </div>
    `;
  } else if (source === 'time') {
    // Rentang jam menentukan volume
    const startMinutes = jm * 60 + mm;
    let endMinutes = js * 60 + ms;
    let diff = endMinutes - startMinutes;
    if (diff <= 0) {
      diff = waktu;
      endMinutes = startMinutes + diff;
    }

    const newVol = Math.max(1, Math.round(diff / waktu));
    volEl.value = newVol;
    vol = newVol;

    // Sinkronkan jam selesai agar tepat kelipatan waktu standar
    const targetMinutes = newVol * waktu;
    const syncedEndMinutes = startMinutes + targetMinutes;
    const calcJs = Math.floor(syncedEndMinutes / 60) % 24;
    const calcMs = syncedEndMinutes % 60;

    jsEl.value = String(calcJs).padStart(2, '0');
    msEl.value = String(calcMs).padStart(2, '0');
    js = calcJs;
    ms = calcMs;

    durPreview.className = "tmpl-dur-preview success";
    durPreview.innerHTML = `
      <div style="font-weight: 700; color: #0284c7; display: flex; align-items: center; gap: 6px;">
        <span>⚡ Total Diakui SiPENDEKAR:</span>
        <span style="font-size: 13.5px; color: #0369a1;">${targetMinutes.toLocaleString('id-ID')} Menit (${(targetMinutes / 60).toFixed(1)} Jam)</span>
      </div>
      <div style="font-size: 11.5px; color: #475569; margin-top: 3px;">
        Hitungan: <strong>${newVol} Volume</strong> × <strong>${waktu} Menit/Output</strong> | Jam: <strong>${String(jm).padStart(2,'0')}:${String(mm).padStart(2,'0')} - ${String(js).padStart(2,'0')}:${String(ms).padStart(2,'0')}</strong>
        <span style="display:inline-block; margin-left: 6px; background: #dcfce7; color: #15803d; padding: 1px 7px; border-radius: 4px; font-weight: 700;">✅ Sinkron Otomatis</span>
      </div>
    `;
  }
}

async function submitDedicatedManualActivity(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-submit-dedicated-form');
  const tgl = document.getElementById('ded-input-tanggal').value;
  const vol = parseInt(document.getElementById('ded-input-volume').value) || 1;
  const kode = document.getElementById('ded-input-kode').value;
  const nama = document.getElementById('ded-input-nama').value || kode;
  const waktu = parseInt(document.getElementById('ded-input-waktu').value) || 300;
  const jm = document.getElementById('ded-input-jm').value;
  const mm = document.getElementById('ded-input-mm').value;
  const js = document.getElementById('ded-input-js').value;
  const ms = document.getElementById('ded-input-ms').value;
  const skpEl = document.getElementById('ded-input-skp');
  const skpId = skpEl ? parseInt(skpEl.value) || 0 : 0;
  const ket = document.getElementById('ded-input-keterangan').value.trim();

  if (!tgl || !kode || !ket) {
    showToast("Harap lengkapi tanggal, kegiatan, dan uraian tugas.", "error");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<div class="ms-spinner"></div><span>Mengirim ke SiPENDEKAR...</span>`;
  }

  try {
    const res = await fetch('/api/fill/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tanggal: tgl,
        kode_aktifitas: kode,
        nama_aktifitas: nama,
        volume: vol,
        keterangan: ket,
        sasaran_kerja_id: skpId,
        jam_mulai: jm,
        menit_mulai: mm,
        jam_selesai: js,
        menit_selesai: ms
      })
    }).then(r => r.json());

    if (res.success) {
      closeModal('modal-manual-input');
      showToast(`✅ Laporan kegiatan berhasil dikirim ke SiPENDEKAR!`, "success");

      const durasi = vol * waktu;
      const jamStr = (durasi / 60).toFixed(1);

      appendChatBubble(
        'bot',
        `✅ **Laporan Kegiatan Berhasil Dikirim ke SiPENDEKAR!**\n\n` +
        `• **Tanggal:** ${tgl}\n` +
        `• **Kegiatan:** ${nama} \`[${kode}]\`\n` +
        `• **Volume:** ${vol} Output (${waktu} Menit/Output)\n` +
        `• **Jam Pelaksanaan:** ${jm}:${mm} - ${js}:${ms} (${durasi} Menit / ${jamStr} Jam) — *Sinkron 100%*\n` +
        `• **Keterangan:** ${ket}\n\n` +
        `🎉 Data e-Kinerja Anda telah tercatat dan tersinkronisasi ke server BKPSDM.`
      );

      fetchProgress();
    } else {
      showToast(res.error || "Gagal mengirim laporan ke SiPENDEKAR.", "error");
    }
  } catch (err) {
    showToast("Kesalahan jaringan: " + err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `🚀 1-Klik Kirim Laporan ke SiPENDEKAR`;
    }
  }
}

function onCtActivitySelect(cid, selectEl) {
  const kode = selectEl.value;
  const opt = selectEl.options[selectEl.selectedIndex];
  const text = opt.text;
  const parts = text.split(' - ');
  const nama = parts.length > 1 ? parts[1].replace(/\(.*\)/, '').trim() : text;
  const waktu = parseInt(opt.dataset.waktu) || 60;
  const satuan = opt.dataset.satuan || 'Laporan';

  const kodeInput = document.getElementById(`ct-kode-${cid}`);
  const namaInput = document.getElementById(`ct-nama-${cid}`);
  const waktuInput = document.getElementById(`ct-waktu-${cid}`);
  const satuanInput = document.getElementById(`ct-satuan-${cid}`);
  const satuanLabel = document.getElementById(`ct-satuan-label-${cid}`);
  const ketInput = document.getElementById(`ct-ket-${cid}`);

  if (kodeInput) kodeInput.value = kode;
  if (namaInput) namaInput.value = nama;
  if (waktuInput) waktuInput.value = waktu;
  if (satuanInput) satuanInput.value = satuan;
  if (satuanLabel) satuanLabel.value = satuan;
  if (ketInput && (!ketInput.value || ketInput.value.includes('kegiatan dinas'))) {
    ketInput.value = nama.toLowerCase();
  }

  updateCreateTmplDuration(cid);
}

async function submitSaveTemplate(cid) {
  const numInput = document.getElementById(`ct-num-${cid}`);
  const titleInput = document.getElementById(`ct-title-${cid}`);
  const kodeInput = document.getElementById(`ct-kode-${cid}`);
  const namaInput = document.getElementById(`ct-nama-${cid}`);
  const volInput = document.getElementById(`ct-vol-${cid}`);
  const waktuInput = document.getElementById(`ct-waktu-${cid}`);
  const jmInput = document.getElementById(`ct-jm-${cid}`);
  const mmInput = document.getElementById(`ct-mm-${cid}`);
  const jsInput = document.getElementById(`ct-js-${cid}`);
  const msInput = document.getElementById(`ct-ms-${cid}`);
  const ketInput = document.getElementById(`ct-ket-${cid}`);
  const btn = document.getElementById(`btn-save-tmpl-${cid}`);

  const num = parseInt(numInput ? numInput.value : 1) || 1;
  const title = (titleInput && titleInput.value.trim()) ? titleInput.value.trim() : `Template ${num}`;
  const kode = (kodeInput && kodeInput.value) ? kodeInput.value : 'UTAMA00463';
  const nama = (namaInput && namaInput.value) ? namaInput.value : 'Pelatihan / Sosialisasi';
  const vol = parseInt(volInput ? volInput.value : 1) || 1;
  const waktuStandar = parseInt(waktuInput ? waktuInput.value : 300) || 300;
  const jm = (jmInput && jmInput.value) ? jmInput.value.padStart(2, '0') : '07';
  const mm = (mmInput && mmInput.value) ? mmInput.value.padStart(2, '0') : '30';
  const js = (jsInput && jsInput.value) ? jsInput.value.padStart(2, '0') : '17';
  const ms = (msInput && msInput.value) ? msInput.value.padStart(2, '0') : '30';
  const ket = (ketInput && ketInput.value.trim()) ? ketInput.value.trim() : nama.toLowerCase();

  const durasiMenit = waktuStandar * vol;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `⏳ Menyimpan Template...`;
  }

  try {
    const res = await fetch('/api/templates/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_num: num,
        title: title,
        kode_aktifitas: kode,
        nama_aktifitas: nama,
        volume: vol,
        durasi_menit: durasiMenit,
        jam_mulai: jm,
        menit_mulai: mm,
        jam_selesai: js,
        menit_selesai: ms,
        keterangan: ket
      })
    }).then(r => r.json());

    if (res.success) {
      showToast(`Master Template ${num} berhasil disimpan!`, "success");
      if (btn) {
        btn.innerHTML = `✅ Template ${num} Tersimpan!`;
        btn.style.background = '#10b981';
      }

      appendChatBubble('user', `Simpan Master Template ${num} (${title})`);

      if (res.bot_message) {
        setTimeout(() => {
          appendChatBubble('bot', res.bot_message.message, res.bot_message.created_at, res.bot_message.card_type, res.bot_message.card_data);
        }, 250);
      }
    } else {
      showToast(res.error || "Gagal menyimpan template.", "error");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `💾 Coba Simpan Lagi`;
      }
    }
  } catch (err) {
    showToast("Kesalahan: " + err.message, "error");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `💾 Simpan Master Template`;
    }
  }
}

async function submitInchatActivity(cid) {
  const btn = document.getElementById(`btn-inchat-submit-${cid}`);
  const tgl = document.getElementById(`inchat-tgl-${cid}`).value;
  const vol = parseInt(document.getElementById(`inchat-vol-${cid}`).value) || 1;
  const kode = document.getElementById(`inchat-kode-${cid}`).value;
  const nama = document.getElementById(`inchat-nama-${cid}`).value;
  const skpId = parseInt(document.getElementById(`inchat-skp-${cid}`).value) || 0;
  const jm = document.getElementById(`inchat-jm-${cid}`).value.padStart(2, '0');
  const mm = document.getElementById(`inchat-mm-${cid}`).value.padStart(2, '0');
  const js = document.getElementById(`inchat-js-${cid}`).value.padStart(2, '0');
  const ms = document.getElementById(`inchat-ms-${cid}`).value.padStart(2, '0');
  const ket = document.getElementById(`inchat-ket-${cid}`).value.trim();

  if (!tgl) {
    showToast("Silakan pilih tanggal pelaksanaan.", "error");
    return;
  }
  if (!kode) {
    showToast("Silakan pilih kegiatan.", "error");
    return;
  }

  const durasiMenit = ((parseInt(js) * 60) + parseInt(ms)) - ((parseInt(jm) * 60) + parseInt(mm));
  if (durasiMenit <= 0) {
    showToast("Jam selesai harus lebih besar dari jam mulai!", "error");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `⏳ Mengirim laporan ke portal SiPENDEKAR...`;
  }

  try {
    const res = await fetch('/api/fill/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tanggal: tgl,
        kode_aktifitas: kode,
        nama_aktifitas: nama,
        volume: vol,
        sasaran_kerja_id: skpId,
        jam_mulai: jm,
        menit_mulai: mm,
        jam_selesai: js,
        menit_selesai: ms,
        keterangan: ket
      })
    }).then(r => r.json());

    if (res.success) {
      showToast(res.message, "success");
      if (btn) {
        btn.innerHTML = `✅ Berhasil Dilaporkan!`;
        btn.style.background = '#10b981';
      }

      const confirmMsg = `✅ **Laporan Berhasil Dilaporkan ke SiPENDEKAR!**\n📅 **Tanggal:** ${tgl}\n📋 **Kegiatan:** ${nama} [${kode}]\n⏱️ **Waktu:** ${jm}:${mm} - ${js}:${ms} (${durasiMenit} Menit)\n📝 **Keterangan:** ${ket || '-'}\nTotal menit bulan ini telah diperbarui secara otomatis.`;
      appendChatBubble('bot', confirmMsg);

      fetchProgress();
    } else {
      showToast(res.error || "Gagal mengirim laporan.", "error");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `🚀 Coba Kirim Ulang`;
      }
    }
  } catch (err) {
    showToast("Kesalahan: " + err.message, "error");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `🚀 Kirim Laporan ke SiPENDEKAR`;
    }
  }
}

async function sendTemplateReport(templateNum, cid) {
  const btn = document.getElementById(`btn-tmpl-${cid}-${templateNum}`);
  const dateInput = document.getElementById(`tmpl-date-${cid}`);
  const volInput = document.getElementById(`tmpl-vol-${cid}-${templateNum}`);
  const tanggal = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];
  const vol = volInput ? (parseInt(volInput.value) || 1) : 1;

  if (!tanggal) {
    showToast("Silakan tentukan tanggal pelaporan.", "error");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `⏳ Melaporkan ke SiPENDEKAR...`;
  }

  try {
    const res = await fetch('/api/fill/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_num: templateNum,
        tanggal: tanggal,
        volume: vol
      })
    }).then(r => r.json());

    if (res.success) {
      showToast(`Berhasil melaporkan Template ${templateNum} (${vol} Output)!`, "success");
      if (btn) {
        btn.innerHTML = `✅ Sukses Dilaporkan!`;
        btn.style.background = '#10b981';
      }

      // Add user speech bubble showing action
      appendChatBubble('user', `Kirim Template ${templateNum} (${tanggal}, ${vol} Output)`);

      // Add bot confirmation bubble
      setTimeout(() => {
        appendChatBubble('bot', res.message, null, 'template_success_card', {
          template_num: templateNum,
          title: `Template ${templateNum}`,
          tanggal: tanggal,
          durasi_menit: res.durasi_menit || 600,
          volume: vol,
          kegiatan: 'Pelaporan e-Kinerja via Master Template'
        });
      }, 250);

      fetchProgress();
    } else {
      showToast(res.error || "Gagal melaporkan template.", "error");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `⚡ Coba Kirim Ulang`;
      }
    }
  } catch (err) {
    showToast("Kesalahan koneksi: " + err.message, "error");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `⚡ Kirim Template ${templateNum}`;
    }
  }
}

function openCalendarModal() {
  const modal = document.getElementById('modal-calendar-full');
  if (modal) modal.classList.add('active');
  fetchProgress();
}

function onSendOrThumbs() {
  const input = document.getElementById('chat-text-input');
  if (!input) return;

  const msg = input.value.trim();
  if (msg) {
    input.value = '';
    updateSendButtonIcon();
    sendUserMessage(msg);
  } else {
    // Thumbs-up action
    sendUserMessage('👍');
  }
}

let typingStepInterval = null;

function showTypingIndicator(customText = "SiPENDEKAR Assistant sedang menganalisis...") {
  const stream = document.getElementById('chat-stream');
  if (!stream) return;
  hideTypingIndicator();

  // Telegram Topbar Header status transition
  const statusEl = document.getElementById('active-chat-status-text');
  if (statusEl) {
    statusEl.innerHTML = `<span style="color:#0284c7; font-weight:600;" class="animate-pulse">✍️ sedang mengetik...</span>`;
  }

  const typingRow = document.createElement('div');
  typingRow.className = 'chat-msg-row bot typing-indicator-row';
  typingRow.id = 'bot-typing-indicator';
  typingRow.innerHTML = `
    <div class="tg-bot-avatar">🤖</div>
    <div>
      <div class="chat-msg-bubble typing-bubble">
        <div class="typing-dots">
          <span></span><span></span><span></span>
        </div>
        <span class="typing-text" id="typing-status-label">${customText}</span>
      </div>
    </div>
  `;
  stream.appendChild(typingRow);
  stream.scrollTop = stream.scrollHeight;

  const steps = [
    "🔍 Menganalisis pesan & e-Kinerja Anda...",
    "📊 Memeriksa katalog kegiatan & status SKP...",
    "✨ AI Agent sedang merumuskan jawaban...",
    "⚡ Menghubungkan ke portal SiPENDEKAR..."
  ];
  let stepIdx = 0;
  if (typingStepInterval) clearInterval(typingStepInterval);
  typingStepInterval = setInterval(() => {
    stepIdx = (stepIdx + 1) % steps.length;
    const label = document.getElementById('typing-status-label');
    if (label) label.textContent = steps[stepIdx];
  }, 2400);
}

function hideTypingIndicator() {
  if (typingStepInterval) {
    clearInterval(typingStepInterval);
    typingStepInterval = null;
  }
  const el = document.getElementById('bot-typing-indicator');
  if (el) el.remove();

  const statusEl = document.getElementById('active-chat-status-text');
  if (statusEl) {
    statusEl.innerHTML = `• SiPENDEKAR Online`;
  }
}

let isSendingChat = false;

async function sendUserMessage(msg) {
  if (isSendingChat) return; // Mencegah double sending dan balasan ganda/staggered
  isSendingChat = true;

  appendChatBubble('user', msg);

  const input = document.getElementById('chat-text-input');
  const btn = document.getElementById('btn-send-thumbs');
  if (input) input.disabled = true;
  if (btn) btn.disabled = true;

  showTypingIndicator("SiPENDEKAR Assistant sedang menganalisis...");

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    }).then(r => r.json());

    hideTypingIndicator();

    if (res.success && res.message) {
      appendChatBubble(
        'bot',
        res.message.message,
        res.message.created_at,
        res.message.card_type,
        res.message.card_data
      );

      // Auto update kalender dan widget jika ada aktivitas baru atau cek progres
      if (['progress_card', 'template_success_card'].includes(res.message.card_type)) {
        fetchProgress();
      }
    } else {
      appendChatBubble('bot', `⚠️ ${res.error || 'Terjadi kendala saat menghubungi asisten.'}`, null);
    }
  } catch (e) {
    hideTypingIndicator();
    appendChatBubble('bot', '⚠️ Terjadi kendala saat menghubungi asisten e-Kinerja.', null);
  } finally {
    isSendingChat = false;
    if (input) {
      input.disabled = false;
      input.focus();
    }
    if (btn) btn.disabled = false;
    updateSendButtonIcon();
  }
}

function handleActionChip(cmd) {
  // If clicked on mobile sidebar shortcuts, ensure chat view is shown
  if (window.innerWidth <= 850) {
    const sidebar = document.getElementById('ms-sidebar-left');
    if (sidebar) sidebar.classList.add('mobile-hidden');
  }

  if (cmd === 'prompt' || cmd === 'contoh_prompt' || cmd === 'template_prompt') {
    openPromptTemplateModal();
    return;
  } else if (cmd === 'ai' || cmd === 'ai_settings') {
    openAiSettingsModal();
  } else if (cmd === 'autofill') {
    executeAutoFillH7();
  } else if (cmd === 'progres') {
    sendUserMessage('progres');
  } else if (cmd === 'template' || cmd === 'pilih_template') {
    sendUserMessage('pilih template');
  } else if (cmd === 'buat_template' || cmd === 'bikin_template') {
    sendUserMessage('buat template');
  } else if (cmd === 'isi_manual' || cmd === 'tanpa_template' || cmd === 'isi_kegiatan' || cmd === 'pilih_kegiatan') {
    openManualInputModal();
  } else if (cmd === 'template_1') {
    sendUserMessage('template 1');
  } else if (cmd === 'template_2') {
    sendUserMessage('template 2');
  } else if (cmd === 'hari_bolong') {
    sendUserMessage('cek hari kosong H-7');
  } else if (cmd === 'kalender') {
    openCalendarModal();
  } else if (cmd === 'riwayat') {
    sendUserMessage('riwayat');
  }
}

function toggleActionMenu() {
  showToast("Fitur lampiran SiPENDEKAR aktif", "info");
}

function insertEmoji(emoji) {
  const input = document.getElementById('chat-text-input');
  if (input) {
    input.value += emoji;
    input.focus();
    updateSendButtonIcon();
  }
}

// ==============================================================================
// TELEGRAM BOT COMMAND MENU & KEYBOARD LOGIC
// ==============================================================================

function toggleBotMenu(forceState, e) {
  if (e && typeof e.stopPropagation === 'function') {
    e.stopPropagation();
  }
  const menu = document.getElementById('tg-command-menu');
  if (!menu) return;

  let open;
  if (typeof forceState === 'boolean') {
    open = forceState;
  } else {
    open = (menu.style.display === 'none' || menu.style.display === '');
  }

  menu.style.display = open ? 'block' : 'none';

  if (open) {
    document.querySelectorAll('.tg-cmd-item').forEach(item => item.style.display = 'flex');
    setTimeout(() => {
      document.addEventListener('click', onDocClickCloseTgMenu);
    }, 100);
  } else {
    document.removeEventListener('click', onDocClickCloseTgMenu);
  }
}

function onDocClickCloseTgMenu(e) {
  const menu = document.getElementById('tg-command-menu');
  const btn = document.getElementById('btn-tg-menu');
  const trigger = document.querySelector('.tg-cmd-trigger-btn');
  if (menu && menu.contains(e.target)) return;
  if (btn && btn.contains(e.target)) return;
  if (trigger && trigger.contains(e.target)) return;
  toggleBotMenu(false);
}

function executeBotCommand(cmd) {
  toggleBotMenu(false);
  const input = document.getElementById('chat-text-input');
  if (input) input.value = '';

  if (cmd === '/prompt') {
    openPromptTemplateModal();
    return;
  }
  if (cmd === '/isi_manual') {
    openManualInputModal();
    return;
  }
  if (cmd === '/kalender') {
    openCalendarModal();
    return;
  }
  if (cmd === '/ai') {
    openAiSettingsModal();
    return;
  }

  sendUserMessage(cmd);
}

function toggleReplyKeyboard() {
  const kb = document.getElementById('tg-reply-keyboard');
  if (!kb) return;
  const isHidden = (kb.style.display === 'none');
  kb.style.display = isHidden ? 'flex' : 'none';
  showToast(isHidden ? "Keyboard perintah aktif" : "Keyboard disembunyikan", "info");
}

// ==============================================================================
// 4. TAB 2: 📊 PROGRES & KALENDER BULANAN (EXACT DAY ALIGNMENT BUG FIX)
// ==============================================================================

async function fetchProgress(year = null, month = null) {
  try {
    const t0 = performance.now();
    const params = new URLSearchParams();
    if (year) params.append('year', year);
    if (month) params.append('month', month);

    const res = await fetch(`/api/progress?${params}`).then(r => r.json());
    const rt = Math.round(performance.now() - t0);
    updateSipendekarLatency(rt);

    if (res.success) {
      renderProgressStats(res);
      const firstWeekday = (res.periode && res.periode.first_weekday !== undefined) ? res.periode.first_weekday : 0;
      renderCalendarGrid(res.calendar, firstWeekday);
      renderUrgentBanner(res.empty_days_h7);
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

  const monthEl = document.getElementById('cal-month-name');
  if (monthEl) monthEl.textContent = `${per.bulan_nama} ${per.tahun}`;

  const mTotal = sum.bulan_menit_total || 0;
  const mTarget = sum.bulan_menit_target || 7920;
  const mJam = sum.bulan_jam_total || (mTotal / 60).toFixed(1);
  const mTercapai = sum.bulan_menit_tercapai || (mTotal >= mTarget);

  // Percentage calculated directly from total minutes vs target minutes (e.g. 9840 / 7920 = 124.2%)
  const pct = mTarget > 0 ? Number(((mTotal / mTarget) * 100).toFixed(1)) : (sum.persentase_berjalan || 0);
  const pctEl = document.getElementById('stat-pct-val');
  if (pctEl) pctEl.textContent = `${pct}%`;

  const circleBar = document.getElementById('circle-progress-bar');
  if (circleBar) {
    const circleVisual = Math.min(100, Math.max(0, pct));
    const offset = 157 - (157 * circleVisual / 100);
    circleBar.style.strokeDashoffset = offset;
    if (pct >= 100) circleBar.style.stroke = '#10b981';
    else if (pct >= 80) circleBar.style.stroke = '#10b981';
    else if (pct >= 50) circleBar.style.stroke = '#f59e0b';
    else circleBar.style.stroke = '#ef4444';
  }

  // Stats Box
  const kerjaEl = document.getElementById('stat-hari-kerja');
  if (kerjaEl) kerjaEl.textContent = `${sum.hari_terisi} Hari Dilaporkan`;

  const bulanMenitEl = document.getElementById('stat-bulan-menit') || document.getElementById('stat-today-menit');
  if (bulanMenitEl) {
    bulanMenitEl.textContent = `${mTotal.toLocaleString('id-ID')} / ${mTarget.toLocaleString('id-ID')} m`;
  }

  const bulanBadge = document.getElementById('stat-bulan-badge') || document.getElementById('stat-today-badge');
  if (bulanBadge) {
    bulanBadge.textContent = mTercapai ? `TERCAPAI (${mJam} Jam) ✅` : `BELUM TERCAPAI (${mJam} Jam) ⚠️`;
    bulanBadge.style.color = mTercapai ? "#10b981" : "#ef4444";
  }

  const h7El = document.getElementById('stat-h7-count');
  if (h7El) {
    h7El.textContent = `${sum.hari_kosong_h7} Hari`;
    h7El.style.color = (sum.hari_kosong_h7 > 0) ? '#ef4444' : '#10b981';
  }

  // Update Main Stage Calendar View
  const stageMonthEl = document.getElementById('stage-cal-month-name');
  if (stageMonthEl) stageMonthEl.textContent = `${per.bulan_nama} ${per.tahun}`;

  // Update all instances across view-home and view-calendar
  document.querySelectorAll('#stage-stat-pct-val').forEach(el => el.textContent = `${pct}%`);

  const stageCircleBar = document.getElementById('stage-circle-progress-bar');
  if (stageCircleBar) {
    const circleVisual = Math.min(100, Math.max(0, pct));
    const offset = 157 - (157 * circleVisual / 100);
    stageCircleBar.style.strokeDashoffset = offset;
    if (pct >= 100) stageCircleBar.style.stroke = '#10b981';
    else if (pct >= 80) stageCircleBar.style.stroke = '#10b981';
    else if (pct >= 50) stageCircleBar.style.stroke = '#f59e0b';
    else stageCircleBar.style.stroke = '#ef4444';
  }

  document.querySelectorAll('#stage-stat-hari-kerja').forEach(el => el.textContent = `${sum.hari_terisi} Hari Dilaporkan`);
  document.querySelectorAll('#stage-stat-bulan-menit').forEach(el => el.textContent = `${mTotal.toLocaleString('id-ID')} / ${mTarget.toLocaleString('id-ID')} m`);
  document.querySelectorAll('#stage-stat-bulan-badge').forEach(el => {
    el.textContent = mTercapai ? "TERPENUHI" : "BELUM LENGKAP";
    el.style.color = mTercapai ? "#16a34a" : "#dc2626";
  });
  document.querySelectorAll('#stage-stat-h7-count').forEach(el => {
    el.textContent = `${data.empty_days_h7 ? data.empty_days_h7.length : 0} Hari Kosong`;
    el.style.color = (data.empty_days_h7 && data.empty_days_h7.length > 0) ? '#ef4444' : '#10b981';
  });

  const sideCalBadge = document.getElementById('sidebar-cal-badge');
  if (sideCalBadge) sideCalBadge.textContent = `${pct}%`;

  // Update Right Sidebar Stats (Image 1)
  const rightHari = document.getElementById('right-stat-hari');
  if (rightHari) rightHari.textContent = `${sum.hari_terisi} Hari Dilaporkan`;

  const rightMenit = document.getElementById('right-stat-menit');
  if (rightMenit) rightMenit.textContent = `${mTotal.toLocaleString('id-ID')} / ${mTarget.toLocaleString('id-ID')} m`;

  const rightH7 = document.getElementById('right-stat-h7');
  if (rightH7) rightH7.textContent = `${sum.hari_kosong_h7} Hari`;

  const badgeConv = document.getElementById('conv-badge-progress');
  if (badgeConv) badgeConv.textContent = `${pct}%`;

  const previewConv = document.getElementById('conv-preview-progress');
  if (previewConv) previewConv.textContent = `${mTotal.toLocaleString('id-ID')} menit • ${sum.hari_terisi} hari terisi`;
}

function renderUrgentBanner(emptyDays) {
  ['ms-urgent-card', 'stage-urgent-card'].forEach(bannerId => {
    const banner = document.getElementById(bannerId);
    if (!banner) return;

    // Shift & Over-achievement logic: If monthly target is already met (>=100%), do not alarm with red warning
    const sum = AppState.progressData && AppState.progressData.summary;
    const isTargetMet = sum && (sum.bulan_menit_total >= (sum.bulan_menit_target || 7920));

    if (isTargetMet || !emptyDays || emptyDays.length === 0) {
      banner.style.display = 'none';
      return;
    }

    banner.style.display = 'flex';
    const textId = (bannerId === 'stage-urgent-card') ? 'stage-urgent-text-desc' : 'urgent-text-desc';
    const textEl = document.getElementById(textId);
    if (textEl) {
      const datesStr = emptyDays.map(d => `${d.hari_nama} (${d.tanggal.slice(8, 10)}/${d.tanggal.slice(5, 7)})`).join(', ');
      textEl.textContent = `Ditemukan ${emptyDays.length} hari kerja belum dilaporkan: ${datesStr}. Segera isi sebelum terkunci BKPSDM!`;
    }
  });
}

/**
 * EXACT DAY ALIGNMENT BUG FIX:
 * Grid has 7 columns (Sen, Sel, Rab, Kam, Jum, Sab, Min).
 * If Month Day 1 starts on Thursday (Kamis, weekday = 3), we PREPEND 3 empty spacer cells.
 * So Day 1 is placed under Kamis, Day 2 under Jumat, etc.
 * Today will be placed under correct weekday!
 */
function renderCalendarGrid(cells, firstWeekday = 0) {
  ['cal-days-grid', 'stage-cal-days-grid'].forEach(gridId => {
    const grid = document.getElementById(gridId);
    if (!grid) return;

    grid.innerHTML = '';

    // 1. Insert empty spacer cells before Day 1
    for (let i = 0; i < firstWeekday; i++) {
      const spacer = document.createElement('div');
      spacer.className = 'cal-cell empty-spacer';
      grid.appendChild(spacer);
    }

    // 2. Insert actual day cells
    cells.forEach(cell => {
      const el = document.createElement('div');
      el.className = `cal-cell ${cell.status}`;

      if (cell.is_weekend) el.classList.add('weekend-day');
      if (cell.is_future) el.classList.add('future-day');

      let tagHtml = '';
      if (cell.status === 'proses') {
        el.classList.add('proses');
        tagHtml = `<span class="cal-tag proses">PROSES</span>`;
      } else if (cell.status === 'terisi' || (cell.is_terisi && cell.status !== 'rejected')) {
        tagHtml = `<span class="cal-tag terisi">DITERIMA</span>`;
      } else if (cell.status === 'kosong-bisa') {
        tagHtml = `<span class="cal-tag kosong">KOSONG</span>`;
      }

      el.innerHTML = `
        <span class="cal-num">${cell.hari_ke}</span>
        ${tagHtml}
      `;

      el.onclick = () => onCalendarCellClick(cell);
      grid.appendChild(el);
    });
  });
}

function onCalendarCellClick(cell) {
  if (cell.is_future) {
    showToast("Tanggal masa depan belum bisa diisi.", "info");
    return;
  }
  if (false && cell.is_weekend) {
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
  content.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-muted);">Memeriksa rincian dari portal...</div>`;
  modal.classList.add('active');
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/days/${dateStr}`).then(r => r.json());
    if (res.success) {
      content.innerHTML = `
        <div style="margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; background: var(--bg-subtle); padding: 10px 14px; border-radius: 10px;">
          <span style="font-weight: 700; color: var(--text-primary);">Total Durasi: ${res.total_menit} Menit</span>
          <span class="tag-badge" style="background: ${res.is_terisi ? '#d1fae5' : '#fee2e2'}; color: ${res.is_terisi ? '#065f46' : '#991b1b'};">
            ${res.is_terisi ? 'SUDAH TERISI' : 'BELUM TERISI'}
          </span>
        </div>
      `;

      if (res.detail && res.detail.length > 0) {
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.flexDirection = 'column';
        wrap.style.gap = '8px';

        window._currentDayDetails = {};
        res.detail.forEach(item => {
          const card = document.createElement('div');
          card.style.background = '#ffffff';
          card.style.border = '1px solid var(--border-light)';
          card.style.borderRadius = '10px';
          card.style.padding = '12px';

          const safeNama = escapeHtml(item.nama_aktifitas || '');
          const safeKet = escapeHtml(item.keterangan || '-');
          const safeJm = escapeHtml(item.jam_mulai || '');
          const safeJs = escapeHtml(item.jam_selesai || '');
          const safeDur = parseInt(item.durasi_menit) || 0;
          const safeVol = parseInt(item.volume) || 1;
          const safeId = parseInt(item.id) || 0;
          window._currentDayDetails[safeId] = { ...item, tanggal: dateStr };

          const isEditable = item.bisa_edit === true || (item.status_approval === 'proses') || (item.status_raw !== 'valid');
          const isApproved = (item.status_approval === 'approved') || (item.status_raw === 'valid');

          let statusBadge = '';
          if (isApproved) {
            statusBadge = `<span style="font-size: 11px; font-weight: 700; color: #047857; background: #d1fae5; border: 1px solid #a7f3d0; padding: 2px 8px; border-radius: 6px;">🟢 Diterima (ACC)</span>`;
          } else if (item.status_approval === 'rejected' || item.status_raw === 'invalid') {
            statusBadge = `<span style="font-size: 11px; font-weight: 700; color: #b91c1c; background: #fee2e2; border: 1px solid #fecaca; padding: 2px 8px; border-radius: 6px;">🔴 Ditolak</span>`;
          } else {
            statusBadge = `<span style="font-size: 11px; font-weight: 700; color: #0284c7; background: #e0f2fe; border: 1px solid #bae6fd; padding: 2px 8px; border-radius: 6px;">🔵 Proses (Belum ACC)</span>`;
          }

          let actionButtons = '';
          if (isEditable) {
            actionButtons = `
              <div style="display: flex; gap: 6px; align-items: center;">
                <button type="button" class="btn-edit-act" onclick="editActivityItemById(${safeId})" title="Edit Laporan Ini">
                  ✏️ Edit
                </div>
                <button type="button" class="ms-btn-logout-icon" style="width: 28px; height: 28px;" onclick="deleteActivityItem(${safeId})" title="Hapus Laporan Ini">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </div>
              </div>
            `;
          } else {
            actionButtons = `
              <span style="font-size: 11px; color: #059669; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;" title="Laporan sudah disetujui atasan sehingga terkunci dari perubahan">
                🔒 Terkunci (Sudah ACC)
              </span>
            `;
          }

          card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 4px;">
              <div style="font-size: 13px; font-weight: 700; color: var(--text-primary);">${safeNama}</div>
              ${statusBadge}
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">
              Jam: ${safeJm} - ${safeJs} (${safeDur} Menit) | Volume: ${safeVol}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 12px; color: var(--text-secondary);">${safeKet}</span>
              ${actionButtons}
            </div>
          `;
          wrap.appendChild(card);
        });

        content.appendChild(wrap);
      } else {
        content.innerHTML += `
          <div style="text-align: center; padding: 24px; color: var(--text-muted);">
            Tidak ada aktivitas yang tercatat pada tanggal ini.
            <div style="margin-top: 12px;">
              <button class="btn-submit-report" onclick="fillDayFast('${dateStr}')">
                ✍️ Isi Laporan Tanggal Ini
              </button>
            </div>
          </div>
        `;
      }
    }
  } catch (e) {
    content.innerHTML = `<div style="color: var(--danger); text-align: center;">Gagal memuat rincian: ${e.message}</div>`;
  }
}

function fillDayFast(dateStr) {
  closeModal('modal-day-detail');
  closeModal('modal-calendar-full');
  switchViewTab('simple-input');
  const tgl = document.getElementById('simple-input-tanggal');
  if (tgl) tgl.value = dateStr;
  showToast(`Tanggal pelaksanaan disetel ke: ${dateStr}`, "info");
}

function editActivityItemById(id) {
  const item = window._currentDayDetails && window._currentDayDetails[id];
  if (!item) {
    showToast("Data aktivitas tidak ditemukan untuk diedit.", "error");
    return;
  }
  editActivityItem(item, item.tanggal);
}

function editActivityItem(item, dateStr) {
  closeModal('modal-day-detail');
  closeModal('modal-calendar-full');
  switchViewTab('simple-input');

  const idInput = document.getElementById('simple-input-id');
  if (idInput) idInput.value = item.id || '';

  const tglInput = document.getElementById('simple-input-tanggal');
  if (tglInput) tglInput.value = dateStr || '';

  const skpSelect = document.getElementById('simple-input-skp');
  if (skpSelect && item.sasaran_kerja_id) {
    skpSelect.value = String(item.sasaran_kerja_id);
  }

  const codeVal = document.getElementById('simple-val-kode');
  if (codeVal) codeVal.value = item.kode_aktifitas || '';

  const nameVal = document.getElementById('simple-val-nama');
  if (nameVal) nameVal.value = item.nama_aktifitas || '';

  const waktuVal = document.getElementById('simple-val-waktu');
  if (waktuVal) waktuVal.value = item.waktu_standar || '60';

  const actInp = document.getElementById('simple-search-activity');
  if (actInp) actInp.value = item.nama_aktifitas || '';

  const clearBtn = document.getElementById('simple-search-clear');
  if (clearBtn) clearBtn.style.display = item.nama_aktifitas ? 'block' : 'none';

  const codeBadge = document.getElementById('simple-selected-code');
  if (codeBadge && item.kode_aktifitas) {
    codeBadge.textContent = item.kode_aktifitas;
    codeBadge.style.display = 'inline-block';
  }

  const volInp = document.getElementById('simple-input-volume');
  if (volInp) volInp.value = item.volume || 1;

  const timeStart = document.getElementById('simple-input-time-start');
  if (timeStart) timeStart.value = item.jam_mulai || '07:30';

  const timeEnd = document.getElementById('simple-input-time-end');
  if (timeEnd) timeEnd.value = item.jam_selesai || '12:30';

  const ketInp = document.getElementById('simple-input-keterangan');
  if (ketInp) ketInp.value = item.keterangan || '';

  const editBanner = document.getElementById('simple-edit-mode-banner');
  if (editBanner) {
    editBanner.style.display = 'flex';
    const desc = document.getElementById('simple-edit-mode-desc');
    if (desc) desc.textContent = `Aktivitas #${item.id} (${item.nama_aktifitas || item.kode_aktifitas}) - SiPENDEKAR`;
  }

  const btn = document.getElementById('btn-submit-simple-stage');
  if (btn) {
    btn.innerHTML = `<span>💾 Simpan Perubahan Aktivitas #${item.id}</span>`;
  }

  syncSimpleDuration();
  showToast(`Mode edit aktif: Aktivitas #${item.id} siap diperbarui.`, "info");
}

function cancelSimpleEditMode() {
  resetSimpleInputForm();
  showToast("Mode edit dibatalkan. Formulir kembali ke mode input baru.", "info");
}


async function deleteActivityItem(id) {
  if (!confirm(`Hapus aktivitas #${id} dari portal SiPENDEKAR?`)) return;
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
    } else {
      showToast(res.error || "Gagal menghapus.", "error");
    }
  } catch (e) {
    showToast("Kesalahan: " + e.message, "error");
  }
}

// ==============================================================================
// 5. TAB 3: 📋 PILIH KEGIATAN & SKP DINAMIS
// ==============================================================================

async function searchCatalog(query = "", kategori = "ALL") {
  const container = document.getElementById('catalog-cards-container');
  if (!container) return;

  container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: var(--text-muted);">Memuat katalog...</div>`;

  try {
    const params = new URLSearchParams({ q: query, kategori, limit: 30 });
    const res = await fetch(`/api/catalog?${params}`).then(r => r.json());

    if (res.success && res.items) {
      if (res.items.length === 0) {
        container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 30px; color: var(--text-muted);">Tidak ada kegiatan yang cocok dengan "${escapeHtml(query)}".</div>`;
        return;
      }

      container.innerHTML = '';
      res.items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'catalog-item-card';

        const safeNama = escapeHtml(item.nama_aktifitas || '');
        const safeKode = escapeHtml(item.kode_aktifitas || '');
        const waktuStr = escapeHtml(item.waktu ? `${item.waktu} Menit` : 'Fleksibel');
        const satuanStr = escapeHtml(item.satuan || 'Kegiatan');

        card.innerHTML = `
          <div>
            <div class="cat-card-name">${safeNama}</div>
          </div>
          <div class="cat-card-meta">
            <span class="tag-badge" style="color: var(--ms-blue);">${safeKode}</span>
            <span class="tag-badge" style="color: #059669;">⏱️ ${waktuStr}</span>
            <span class="tag-badge">${satuanStr}</span>
          </div>
        `;

        card.onclick = () => selectActivityItem(item);
        container.appendChild(card);
      });
    }
  } catch (e) {
    console.error("Catalog load error:", e);
  }
}

function onCatalogSearchInput() {
  clearTimeout(AppState.searchTimeout);
  AppState.searchTimeout = setTimeout(() => {
    const q = document.getElementById('catalog-search-query').value.trim();
    const activeCatBtn = document.querySelector('.cat-pill.active');
    const cat = activeCatBtn ? activeCatBtn.dataset.cat : 'ALL';
    searchCatalog(q, cat);
  }, 250);
}

function filterCategory(cat, btn) {
  document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const q = document.getElementById('catalog-search-query').value.trim();
  searchCatalog(q, cat);
}

function openDedicatedCatalogPicker(target = 'simple') {
  AppState.catalogTarget = target;
  const modal = document.getElementById('modal-catalog-picker');
  if (modal) {
    modal.classList.add('active');
  modal.style.display = 'flex';
    searchCatalog("", "ALL");
  }
}

async function selectActivityItem(item) {
  AppState.selectedActivity = item;
  closeModal('modal-catalog-picker');

  if (AppState.catalogTarget === 'scheduler' || AppState.currentTab === 'scheduler') {
    selectSchedulerActivity(item);
    return;
  }

  if (AppState.catalogTarget === 'simple' || AppState.currentTab === 'simple-input') {
    switchViewTab('simple-input');
    selectSimpleActivity(item);
    return;
  }

  if (AppState.activeInchatCardId) {
    selectCatalogItemForInchat(item);
    return;
  }

  // Look for any rendered inchat form
  const lastInchat = document.querySelector('.inchat-fill-card');
  if (lastInchat) {
    const cid = lastInchat.id.replace('inchat-card-', '');
    AppState.activeInchatCardId = cid;
    selectCatalogItemForInchat(item);
    return;
  }

  // Fallback to simple input
  switchViewTab('simple-input');
  applySimpleActivityPreset(item.kode_aktifitas, item.nama_aktifitas, item.waktu || 120, item.satuan || 'Kegiatan', `Melaksanakan ${item.nama_aktifitas.toLowerCase()}`);
}

// ==============================================================================
// LIVE SIPENDEKAR LATENCY & SKP LOADER
// ==============================================================================

function updateSipendekarLatency(ms) {
  if (ms === undefined || ms === null || isNaN(ms)) return;
  AppState.sipendekarLatency = ms;

  const headerBadge = document.getElementById('header-sipendekar-latency');
  const stageBadge = document.getElementById('stage-cal-latency-badge');
  const simpleBadge = document.getElementById('simple-form-latency-badge');

  let colorClass = 'fast';
  let qualityText = 'Sangat Cepat';

  if (ms < 350) {
    colorClass = 'fast';
    qualityText = 'Sangat Cepat';
  } else if (ms < 800) {
    colorClass = 'medium';
    qualityText = 'Normal';
  } else {
    colorClass = 'slow';
    qualityText = 'Padat';
  }

  const badgeHtml = `<span class="latency-pulse"></span> ⚡ ${ms} ms`;
  const titleText = `Koneksi SiPENDEKAR: ${ms} ms (${qualityText}). Klik untuk cek ulang ping.`;

  if (headerBadge) {
    headerBadge.className = `latency-badge ${colorClass}`;
    headerBadge.innerHTML = badgeHtml;
    headerBadge.title = titleText;
  }
  if (stageBadge) {
    stageBadge.className = `latency-pill ${colorClass}`;
    stageBadge.innerHTML = `⚡ SiPENDEKAR: <strong>${ms} ms</strong>`;
    stageBadge.title = titleText;
  }
  if (simpleBadge) {
    simpleBadge.className = `latency-pill ${colorClass}`;
    simpleBadge.innerHTML = `⚡ SiPENDEKAR: <strong>${ms} ms</strong>`;
    simpleBadge.title = titleText;
  }
}

async function checkSipendekarLatency() {
  const headerBadge = document.getElementById('header-sipendekar-latency');
  if (headerBadge) {
    headerBadge.innerHTML = `<span class="latency-pulse"></span> ⏳ Ping...`;
  }
  try {
    const t0 = performance.now();
    const res = await fetch('/api/sipendekar/ping').then(r => r.json());
    const rt = Math.round(performance.now() - t0);
    const latency = res.latency_ms !== undefined ? res.latency_ms : rt;
    updateSipendekarLatency(latency);
  } catch (e) {
    updateSipendekarLatency(999);
  }
}

async function loadSkpOptions(kodeAktifitas = "", targetOrPref = null, preferredId = null) {
  let targetSelectId = null;
  let targetPreferred = null;

  if (typeof targetOrPref === 'string' && (targetOrPref.includes('skp') || targetOrPref.includes('select') || targetOrPref.includes('input'))) {
    targetSelectId = targetOrPref;
    targetPreferred = preferredId;
  } else if (targetOrPref) {
    targetPreferred = targetOrPref;
  }

  const allPossibleIds = ['simple-input-skp', 'sch-skp-select', 'sch-skp-select2', 'ded-input-skp'];
  const targetIds = targetSelectId ? [targetSelectId] : allPossibleIds;
  const selectElements = targetIds.map(id => document.getElementById(id)).filter(Boolean);

  if (selectElements.length === 0) return;

  // Ensure options exist without wiping with a loading screen
  selectElements.forEach(sEl => {
    if (sEl.options.length === 0) {
      sEl.innerHTML = `<option value="0">Standar SKP Pegawai (SiPENDEKAR)</option>`;
    }
  });

  const code = kodeAktifitas || document.getElementById('simple-val-kode')?.value || 'UTAMA00463';

  // Fast cache hit: 0ms instant display without network call
  window._skpCache = window._skpCache || {};
  if (window._skpCache[code] && window._skpCache[code].length > 0) {
    applySkpListToSelects(selectElements, window._skpCache[code], targetPreferred);
    return;
  }

  try {
    const res = await fetch(`/api/skp?kode_aktivitas=${encodeURIComponent(code)}`).then(r => r.json());
    if (res.latency_ms) updateSipendekarLatency(res.latency_ms);

    if (res.success && res.skp && res.skp.length > 0) {
      const opts = res.skp.map((s, idx) => {
        const skpName = s.nama || s.nama_skp || s.sasaran_kerja || s.uraian || `SKP #${s.id}`;
        return { id: s.id, nama: `${idx + 1}. ${skpName} [ID: ${s.id}]` };
      });
      window._skpCache[code] = opts;
      AppState.skpOptions = opts;
      applySkpListToSelects(selectElements, opts, targetPreferred);
    }
  } catch (e) {
    // Keep existing SKP options quietly without throwing UI errors
  }
}

function applySkpListToSelects(selectElements, opts, targetPreferred) {
  let prefVal = null;
  if (targetPreferred && !isNaN(Number(targetPreferred)) && Number(targetPreferred) > 0) {
    prefVal = String(targetPreferred);
  }

  selectElements.forEach(sEl => {
    const currentVal = prefVal || sEl.value;
    sEl.innerHTML = '';
    opts.forEach(optData => {
      const opt = document.createElement('option');
      opt.value = optData.id;
      opt.textContent = optData.nama;
      sEl.appendChild(opt);
    });

    if (currentVal && currentVal !== "0" && !isNaN(Number(currentVal))) {
      let matched = false;
      for (let i = 0; i < sEl.options.length; i++) {
        if (String(sEl.options[i].value) === String(currentVal)) {
          sEl.selectedIndex = i;
          matched = true;
          break;
        }
      }
      if (!matched) sEl.selectedIndex = 0;
    } else {
      sEl.selectedIndex = 0;
    }
  });
}


function calculateFormDuration() {
  const jm = parseInt(document.getElementById('form-jam-mulai').value) || 0;
  const mm = parseInt(document.getElementById('form-menit-mulai').value) || 0;
  const js = parseInt(document.getElementById('form-jam-selesai').value) || 0;
  const ms = parseInt(document.getElementById('form-menit-selesai').value) || 0;

  const totalMenit = ((js * 60) + ms) - ((jm * 60) + mm);
  const label = document.getElementById('duration-calc-label');
  if (label) {
    if (totalMenit > 0) {
      const jam = (totalMenit / 60).toFixed(1);
      label.textContent = `Durasi: ${totalMenit} Menit (${jam} Jam)`;
      label.style.color = 'var(--ms-blue)';
    } else {
      label.textContent = `Jam selesai harus lebih besar dari jam mulai!`;
      label.style.color = 'var(--danger)';
    }
  }
}

async function handleActivityFormSubmit(e) {
  e.preventDefault();
  const kode_aktifitas = document.getElementById('form-kode-act').value;
  if (!kode_aktifitas) {
    showToast("Silakan pilih kegiatan dari katalog di bawah terlebih dahulu.", "error");
    return;
  }

  const tanggal = document.getElementById('form-tanggal').value;
  const volume = parseInt(document.getElementById('form-volume').value) || 1;
  const sasaran_kerja_id = parseInt(document.getElementById('form-skp-select').value) || 0;
  const jam_mulai = document.getElementById('form-jam-mulai').value.padStart(2, '0');
  const menit_mulai = document.getElementById('form-menit-mulai').value.padStart(2, '0');
  const jam_selesai = document.getElementById('form-jam-selesai').value.padStart(2, '0');
  const menit_selesai = document.getElementById('form-menit-selesai').value.padStart(2, '0');
  const keterangan = document.getElementById('form-keterangan').value.trim();

  const nama_aktifitas = AppState.selectedActivity ? AppState.selectedActivity.nama_aktifitas : kode_aktifitas;

  const btn = document.getElementById('btn-submit-activity');
  btn.disabled = true;
  btn.textContent = "Mengirim laporan ke portal SiPENDEKAR...";

  try {
    const res = await fetch('/api/fill/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tanggal,
        kode_aktifitas,
        nama_aktifitas,
        volume,
        sasaran_kerja_id,
        jam_mulai,
        menit_mulai,
        jam_selesai,
        menit_selesai,
        keterangan
      })
    }).then(r => r.json());

    if (res.success) {
      showToast(res.message, "success");
      switchTab('progress');
    } else {
      showToast(res.error || "Gagal mengisi laporan.", "error");
    }
  } catch (err) {
    showToast("Kesalahan koneksi: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "🚀 Kirim Laporan ke SiPENDEKAR";
  }
}

// ==============================================================================
// 6. 1-CLICK AUTO-FILL H-7
// ==============================================================================

async function executeAutoFillH7() {
  if (!confirm("Jalankan Auto-Fill untuk seluruh hari kerja yang masih kosong dalam 7 hari terakhir?")) return;

  showToast("Menjalankan pengisian otomatis ke portal...", "info");

  try {
    const res = await fetch('/api/fill/auto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }).then(r => r.json());

    if (res.success) {
      showToast(res.message, "success");
      appendChatBubble('bot', `⚡ **Auto-Fill H-7 Selesai!**\n${res.message}\nSemua hari kerja kosong telah terisi.`);
      fetchProgress();
    } else {
      showToast(res.error || "Gagal auto-fill.", "error");
    }
  } catch (e) {
    showToast("Kesalahan sistem: " + e.message, "error");
  }
}

// ==============================================================================
// 7. TAB 4: 📜 RIWAYAT LAPORAN PRIBADI
// ==============================================================================

async function fetchHistory() {
  const container = document.getElementById('history-list-container');
  if (!container) return;

  container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);">Memuat riwayat Anda...</div>`;

  try {
    const res = await fetch('/api/history').then(r => r.json());
    if (res.success && res.logs) {
      if (res.logs.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 30px; color: var(--text-muted);">Belum ada riwayat aktivitas yang tercatat.</div>`;
        return;
      }

      container.innerHTML = '';
      res.logs.forEach(log => {
        const item = document.createElement('div');
        item.style.background = '#ffffff';
        item.style.border = '1px solid var(--border-light)';
        item.style.borderRadius = '10px';
        item.style.padding = '12px 16px';
        item.style.marginBottom = '8px';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';

        item.innerHTML = `
          <div>
            <div style="font-size: 13.5px; font-weight: 700; color: var(--text-primary);">${log.description}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${log.created_at}</div>
          </div>
          <span class="tag-badge" style="background: var(--ms-blue-light); color: var(--ms-blue);">${log.action}</span>
        `;
        container.appendChild(item);
      });
    }
  } catch (e) {
    container.innerHTML = `<div style="color: var(--danger); text-align: center;">Gagal memuat riwayat: ${e.message}</div>`;
  }
}

// ==============================================================================
// 8. UTILITIES & MODAL
// ==============================================================================

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
}

function showToast(message, type = 'info', duration = null) {
  const toast = document.getElementById('ms-toast');
  const text = document.getElementById('ms-toast-text');
  if (!toast || !text) return;

  text.textContent = message;
  toast.className = `ms-toast show active ${type}`;

  const defaultDuration = (type === 'error') ? 2500 : 1200;
  const timeoutMs = duration !== null ? duration : defaultDuration;

  if (window._toastTimeout) clearTimeout(window._toastTimeout);
  window._toastTimeout = setTimeout(() => {
    toast.classList.remove('show', 'active');
  }, timeoutMs);
}

function toggleForceMobileView() {
  const vp = document.getElementById('messenger-viewport');
  const icon = document.getElementById('viewmode-icon');
  if (!vp) return;

  vp.classList.toggle('force-mobile-mode');
  const isMobile = vp.classList.contains('force-mobile-mode');
  if (icon) icon.textContent = isMobile ? '🖥️' : '📱';
  showToast(isMobile ? "Beralih ke tampilan Mobile Messenger" : "Beralih ke tampilan Desktop 3-Kolom", "info");
}

// ==============================================================================
// 9. AI COPILOT & SETTINGS HANDLERS
// ==============================================================================

async function openAiSettingsModal() {
  const modal = document.getElementById('modal-ai-settings');
  if (!modal) return;

  const resBox = document.getElementById('ai-test-result-box');
  if (resBox) resBox.style.display = 'none';

  try {
    const res = await fetch('/api/ai/config').then(r => r.json());
    if (res.success && res.config) {
      const cfg = res.config;
      const provSel = document.getElementById('ai-provider-select');
      const keyInput = document.getElementById('ai-api-key-input');
      const statusText = document.getElementById('ai-key-status-text');

      if (provSel) provSel.value = cfg.provider || 'crown';
      onAiProviderChange(cfg.provider || 'crown');

      const modelSel = document.getElementById('ai-model-select');
      if (modelSel && cfg.model) {
        modelSel.value = cfg.model;
      }

      if (keyInput) keyInput.value = '';
      if (statusText) {
        if (cfg.has_api_key) {
          statusText.innerHTML = `✅ <strong>Tersimpan:</strong> <code style="background:#e2e8f0;padding:2px 4px;border-radius:3px;">${cfg.api_key_masked}</code> (Kosongkan jika tidak ingin mengubah)`;
          statusText.style.color = '#15803d';
        } else {
          statusText.textContent = cfg.provider === 'local' ? '⚡ Mode Smart Local NLP aktif (tidak memerlukan API key).' : '⚠️ Belum ada API key tersimpan.';
          statusText.style.color = 'var(--text-muted)';
        }
      }
    }
  } catch (e) {
    console.error("AI config load error:", e);
  }

  modal.classList.add('active');
  modal.style.display = 'flex';
}

function onAiProviderChange(provider) {
  const modelSel = document.getElementById('ai-model-select');
  const keyGroup = document.getElementById('ai-apikey-group');
  const keyHelpLink = document.getElementById('ai-key-help-link');

  if (modelSel) {
    modelSel.innerHTML = '';
    if (provider === 'crown') {
      modelSel.innerHTML = `
        <option value="zai-org/GLM-5.3-Flash" selected>zai-org/GLM-5.3-Flash (Rekomendasi Utama - Full Agentic Tools)</option>
        <option value="deepseek-ai/DeepSeek-V4-Flash-0731">deepseek-ai/DeepSeek-V4-Flash-0731 (Ultra Cepat ~1.3s)</option>
        <option value="MiniMaxAI/MiniMax-M2.7">MiniMaxAI/MiniMax-M2.7 (Reasoning & Logika Kuat)</option>
      `;
      if (keyHelpLink) {
        keyHelpLink.href = 'https://crown.ai.id';
        keyHelpLink.innerHTML = '👑 Bansos AI Crown Endpoint (Aktif & Siap Pakai)';
        keyHelpLink.style.display = 'inline-block';
      }
      if (keyGroup) keyGroup.style.display = 'block';
    } else if (provider === 'gemini') {
      modelSel.innerHTML = `
        <option value="gemini-3.5-flash" selected>gemini-3.5-flash (1.048.576 Tokens - Rekomendasi Utama)</option>
        <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (1.048.576 Tokens - Ringan & Cepat)</option>
        <option value="gemini-flash-latest">gemini-flash-latest (1.048.576 Tokens - Versi Terbaru)</option>
      `;
      if (keyHelpLink) {
        keyHelpLink.href = 'https://aistudio.google.com/app/apikey';
        keyHelpLink.innerHTML = '🔑 Ambil API Key Gratis di Google AI Studio &rarr;';
        keyHelpLink.style.display = 'inline-block';
      }
      if (keyGroup) keyGroup.style.display = 'block';
    } else if (provider === 'groq') {
      modelSel.innerHTML = `
        <option value="llama-3.3-70b-versatile" selected>llama-3.3-70b-versatile (Terbaik, Cepat <0.5s)</option>
        <option value="llama-3.1-8b-instant">llama-3.1-8b-instant (Ultra Ringan & Kilat)</option>
      `;
      if (keyHelpLink) {
        keyHelpLink.href = 'https://console.groq.com/keys';
        keyHelpLink.innerHTML = '🔑 Ambil API Key Gratis di Groq Console &rarr;';
        keyHelpLink.style.display = 'inline-block';
      }
      if (keyGroup) keyGroup.style.display = 'block';
    } else if (provider === 'openai') {
      modelSel.innerHTML = `
        <option value="gpt-4o-mini" selected>gpt-4o-mini (Hemat & Responsif)</option>
        <option value="gpt-4o">gpt-4o (Penalaran Kompleks Maksimal)</option>
      `;
      if (keyHelpLink) {
        keyHelpLink.href = 'https://platform.openai.com/api-keys';
        keyHelpLink.innerHTML = '🔑 Ambil API Key di OpenAI Platform &rarr;';
        keyHelpLink.style.display = 'inline-block';
      }
      if (keyGroup) keyGroup.style.display = 'block';
    } else {
      modelSel.innerHTML = `
        <option value="local-nlp" selected>Smart Local NLP Engine (Offline, 0-API-Key)</option>
      `;
      if (keyGroup) keyGroup.style.display = 'none';
    }
  }
}

function toggleAiKeyVisibility() {
  const input = document.getElementById('ai-api-key-input');
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

async function testAiConnection() {
  const prov = document.getElementById('ai-provider-select').value;
  const key = document.getElementById('ai-api-key-input').value.trim();
  const model = document.getElementById('ai-model-select').value;
  const resBox = document.getElementById('ai-test-result-box');
  const btn = document.getElementById('btn-test-ai-key');

  if (resBox) {
    resBox.style.display = 'block';
    resBox.style.background = '#f8fafc';
    resBox.style.color = '#334155';
    resBox.style.border = '1px solid #cbd5e1';
    resBox.innerHTML = `⏳ Menguji koneksi ke <strong>${prov.toUpperCase()}</strong>...`;
  }
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: prov, api_key: key, model: model })
    }).then(r => r.json());

    if (res.success) {
      if (resBox) {
        resBox.style.background = '#f0fdf4';
        resBox.style.color = '#15803d';
        resBox.style.border = '1px solid #bbf7d0';
        resBox.innerHTML = `
          <div><strong>✅ ${res.message}</strong></div>
          <div style="font-size:11.5px;margin-top:4px;">Sampel respons: <em>"${res.sample_response || 'Siap'}"</em></div>
        `;
      }
      showToast("Koneksi AI berhasil!", "success");
    } else {
      if (resBox) {
        resBox.style.background = '#fef2f2';
        resBox.style.color = '#b91c1c';
        resBox.style.border = '1px solid #fecaca';
        resBox.innerHTML = `<strong>⚠️ Gagal:</strong> ${res.error || 'Tidak ada respons dari provider.'}`;
      }
      showToast(res.error || "Uji koneksi AI gagal.", "error");
    }
  } catch (e) {
    if (resBox) {
      resBox.style.background = '#fef2f2';
      resBox.style.color = '#b91c1c';
      resBox.style.border = '1px solid #fecaca';
      resBox.innerHTML = `<strong>⚠️ Kesalahan:</strong> ${e.message}`;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function saveAiConfigForm(e) {
  e.preventDefault();
  const prov = document.getElementById('ai-provider-select').value;
  const key = document.getElementById('ai-api-key-input').value.trim();
  const model = document.getElementById('ai-model-select').value;
  const btn = document.getElementById('btn-save-ai-key');

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Menyimpan...";
  }

  try {
    const res = await fetch('/api/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: prov, api_key: key, model: model })
    }).then(r => r.json());

    if (res.success) {
      closeModal('modal-ai-settings');
      showToast("Konfigurasi AI berhasil disimpan!", "success");
      sendUserMessage('/ai');
    } else {
      showToast(res.error || "Gagal menyimpan konfigurasi AI.", "error");
    }
  } catch (err) {
    showToast("Kesalahan: " + err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "💾 Simpan Konfigurasi";
    }
  }
}

function saveAiRecommendedTemplateFromStore(cid) {
  const d = window._aiRecStore && window._aiRecStore[cid];
  if (!d) return;
  saveAiRecommendedTemplate(cid, d.tnum, d.title, d.kode, d.nama, d.jm, d.mm, d.js, d.ms, d.dur, d.ket, d.vol);
}

async function saveAiRecommendedTemplate(cid, num, title, kode, nama, jm, mm, js, ms, durasi, ket, vol = 1) {
  const btn = document.getElementById(`btn-save-ai-tmpl-${cid}`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `⏳ Menyimpan Master Template...`;
  }

  try {
    const res = await fetch('/api/templates/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_num: num,
        title: title,
        kode_aktifitas: kode,
        nama_aktifitas: nama,
        jam_mulai: jm,
        menit_mulai: mm,
        jam_selesai: js,
        menit_selesai: ms,
        durasi_menit: durasi,
        keterangan: ket,
        volume: vol
      })
    }).then(r => r.json());

    if (res.success) {
      showToast(`Master Template ${num} berhasil disimpan!`, "success");
      if (btn) {
        btn.innerHTML = `✅ Tersimpan Sebagai Template ${num}!`;
        btn.style.background = '#10b981';
      }
      appendChatBubble('user', `Simpan Master Template ${num} (${vol} Output)`);
      setTimeout(() => {
        appendChatBubble('bot', `🎉 **Master Template ${num} Berhasil Disimpan!**\n\n📌 **Judul:** ${title}\n📋 **Kegiatan:** ${nama} [${kode}]\n📊 **Volume Output:** ${vol} Output\n⏱️ **Total Menit e-Kinerja:** ${durasi} Menit\n📝 **Keterangan:** ${ket}\n\nSekarang Anda cukup mengetik **template ${num}** kapan saja di obrolan untuk langsung melaporkannya! ⚡`);
      }, 250);
    } else {
      showToast(res.error || "Gagal menyimpan template.", "error");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `💾 Coba Simpan Ulang`;
      }
    }
  } catch (err) {
    showToast("Kesalahan: " + err.message, "error");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `💾 Simpan Jadi Master Template ${num}`;
    }
  }
}

// ==============================================================================
// 10. DIRECT APPLICATION VIEWS & NAVIGATION TABS
// ==============================================================================

function switchViewTab(tabName) {
  if (!tabName) tabName = 'home';
  AppState.currentTab = tabName;

  // 1. Update top nav tabs
  document.querySelectorAll('.top-nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
  });

  // 2. Update sidebar navigation items
  document.querySelectorAll('.ms-conv-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-tab') === tabName);
  });

  // 3. Update tab panes
  document.querySelectorAll('.ms-tab-pane').forEach(pane => {
    pane.classList.remove('active');
  });
  const targetPane = document.getElementById(`view-${tabName}`);
  if (targetPane) {
    targetPane.classList.add('active');
  }

  // Scroll to top of content body for true separate view experience
  const contentBody = document.querySelector('.app-content-body');
  if (contentBody) {
    contentBody.scrollTop = 0;
  }

  // 4. Update top bar titles
  const titles = {
    'home': 'Beranda e-Kinerja',
    'calendar': 'Kalender e-Kinerja',
    'simple-input': 'Form Input Simpel',
    'history': 'Histori & Input Ulang',
    'scheduler': 'Jadwal Otomatis (Scheduler)',
    'review': 'Review & Validasi e-Kinerja',
    'chats': 'SiPENDEKAR Assistant'
  };
  const activeChatName = document.getElementById('active-chat-name');
  if (activeChatName) {
    activeChatName.textContent = titles[tabName] || 'SiPENDEKAR e-Kinerja';
  }

  // Update back button in header
  const headerBackBtn = document.getElementById('header-back-home-btn');
  if (headerBackBtn) {
    headerBackBtn.style.display = (tabName === 'home') ? 'none' : 'inline-flex';
  }

  // 5. On mobile, transition into content view
  if (window.innerWidth <= 850) {
    const sidebar = document.getElementById('ms-sidebar-left');
    if (sidebar) sidebar.classList.add('mobile-hidden');
  }

  // 6. Tab-specific initializers
  if (tabName === 'calendar' || tabName === 'home') {
    fetchProgress();
  } else if (tabName === 'simple-input') {
    initSimpleStageForm();
  } else if (tabName === 'history') {
    loadActivitiesHistory();
  } else if (tabName === 'scheduler') {
    loadSchedulerConfig();
  } else if (tabName === 'review') {
    fetchReviewData();
  }
}
window.switchTab = switchViewTab;

// ==============================================================================
// 11. FEATURE 2: SIMPLE DIRECT INPUT FORM
// ==============================================================================

function initSimpleStageForm() {
  const tgl = document.getElementById('simple-input-tanggal');
  if (tgl && !tgl.value) {
    tgl.value = new Date().toISOString().split('T')[0];
  }

  // Selalu pastikan input nama kegiatan bersih/kosong saat mau input jika belum dipilih
  const codeVal = document.getElementById('simple-val-kode');
  const actInp = document.getElementById('simple-search-activity');
  const clearBtn = document.getElementById('simple-search-clear');
  const codeBadge = document.getElementById('simple-selected-code');

  if (!codeVal || !codeVal.value) {
    if (actInp) actInp.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    if (codeBadge) {
      codeBadge.textContent = '';
      codeBadge.style.display = 'none';
    }
  }

  // Sync SKP options
  const skpSelect = document.getElementById('simple-input-skp');
  if (skpSelect) {
    if (AppState.skpOptions && AppState.skpOptions.length > 0) {
      if (skpSelect.options.length <= 1) {
        const cur = skpSelect.value;
        skpSelect.innerHTML = AppState.skpOptions.map(o => `<option value="${o.id}">${o.nama}</option>`).join('');
        if (cur && cur !== "0") skpSelect.value = cur;
      }
    } else {
      loadSkpOptions();
    }
  }

  syncSimpleDuration();
}

function resetSimpleInputForm() {
  const actInp = document.getElementById('simple-search-activity');
  if (actInp) actInp.value = '';

  const clearBtn = document.getElementById('simple-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';

  const codeVal = document.getElementById('simple-val-kode');
  if (codeVal) codeVal.value = '';

  const nameVal = document.getElementById('simple-val-nama');
  if (nameVal) nameVal.value = '';

  const waktuVal = document.getElementById('simple-val-waktu');
  if (waktuVal) waktuVal.value = '60';

  const codeBadge = document.getElementById('simple-selected-code');
  if (codeBadge) {
    codeBadge.textContent = '';
    codeBadge.style.display = 'none';
  }

  const stdEl = document.getElementById('simple-standar-display');
  if (stdEl) stdEl.textContent = 'Standar: -';

  const ketInp = document.getElementById('simple-input-keterangan');
  if (ketInp) ketInp.value = '';

  const listEl = document.getElementById('simple-activity-autocomplete-list');
  if (listEl) listEl.classList.remove('active');

  const idInput = document.getElementById('simple-input-id');
  if (idInput) idInput.value = '';

  const editBanner = document.getElementById('simple-edit-mode-banner');
  if (editBanner) editBanner.style.display = 'none';

  const btn = document.getElementById('btn-submit-simple-stage');
  if (btn) btn.innerHTML = `<span>🚀 1-Klik Kirim Laporan ke SiPENDEKAR</span>`;

  syncSimpleDuration();
}

function populateActivityDropdowns() {
  const defaultActivities = [
    { kode: 'UTAMA00463', nama: 'Mengikuti pelatihan/sosialisasi/pendidikan', waktu: 300, satuan: 'Kegiatan' },
    { kode: 'UTAMA00030', nama: 'Mengarsipkan dokumen/surat', waktu: 60, satuan: 'Dokumen' },
    { kode: 'UTAMA00028', nama: 'Menerima dan memeriksa surat masuk/keluar', waktu: 60, satuan: 'Surat' },
    { kode: 'UTAMA00032', nama: 'Mengoperasikan komputer/perangkat lunak kerja', waktu: 120, satuan: 'Laporan' },
    { kode: 'UTAMA00122', nama: 'Mengikuti rapat koordinasi internal/eksternal', waktu: 120, satuan: 'Kegiatan' },
    { kode: 'UTAMA00035', nama: 'Menyusun laporan hasil pelaksanaan tugas', waktu: 120, satuan: 'Laporan' },
    { kode: 'UTAMA00185', nama: 'Melakukan pemeliharaan dan backup sistem TI', waktu: 120, satuan: 'Kegiatan' },
    { kode: 'UTAMA00010', nama: 'Melaksanakan apel pagi / upacara bendera', waktu: 30, satuan: 'Kegiatan' }
  ];

  ['simple-input-activity', 'sch-activity-select', 'ded-input-activity'].forEach(selectId => {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = defaultActivities.map(a => 
      `<option value="${a.kode}" data-nama="${a.nama}" data-waktu="${a.waktu}" data-satuan="${a.satuan}">
        ${a.nama} (${a.waktu}m / ${a.satuan}) [${a.kode}]
      </option>`
    ).join('');
  });
}

// ==============================================================================
// DIRECT AUTOCOMPLETE ENGINE (SIMPLE FORM & SCHEDULER)
// ==============================================================================

let simpleSearchDebounce = null;
let schSearchDebounce = null;
let currentHighlightedIndex = -1;

const POPULAR_ACTIVITIES_CATALOG = [
  { kode_aktifitas: 'UTAMA00463', nama_aktifitas: 'Mengikuti pelatihan/sosialisasi/pendidikan', waktu: 300, satuan: 'Kegiatan', kategori: 'PELATIHAN' },
  { kode_aktifitas: 'UTAMA00030', nama_aktifitas: 'Mengarsipkan dokumen/surat', waktu: 60, satuan: 'Dokumen', kategori: 'ADMINISTRASI' },
  { kode_aktifitas: 'UTAMA00028', nama_aktifitas: 'Menerima dan memeriksa surat masuk/keluar', waktu: 60, satuan: 'Surat', kategori: 'ADMINISTRASI' },
  { kode_aktifitas: 'UTAMA00032', nama_aktifitas: 'Mengoperasikan komputer/perangkat lunak kerja', waktu: 120, satuan: 'Laporan', kategori: 'TI' },
  { kode_aktifitas: 'UTAMA00122', nama_aktifitas: 'Mengikuti rapat koordinasi internal/eksternal', waktu: 120, satuan: 'Kegiatan', kategori: 'RAPAT' },
  { kode_aktifitas: 'UTAMA00035', nama_aktifitas: 'Menyusun laporan hasil pelaksanaan tugas', waktu: 120, satuan: 'Laporan', kategori: 'LAPORAN' },
  { kode_aktifitas: 'UTAMA00185', nama_aktifitas: 'Melakukan pemeliharaan dan backup sistem TI', waktu: 120, satuan: 'Kegiatan', kategori: 'TI' },
  { kode_aktifitas: 'UTAMA00010', nama_aktifitas: 'Melaksanakan apel pagi / upacara bendera', waktu: 30, satuan: 'Kegiatan', kategori: 'DISIPLIN' }
];

function highlightAutocompleteMatch(text, query) {
  if (!text) return '';
  const safeText = escapeHtml(text);
  if (!query || !query.trim()) return safeText;
  const safeQuery = escapeHtml(query.trim());
  const escaped = safeQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  return safeText.replace(regex, '<mark>$1</mark>');
}

// ------------------------------------------------------------------------------
// Simple Stage Form Autocomplete
// ------------------------------------------------------------------------------
function onSimpleSearchInput(val) {
  const clearBtn = document.getElementById('simple-search-clear');
  if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';

  clearTimeout(simpleSearchDebounce);
  simpleSearchDebounce = setTimeout(() => {
    fetchSimpleAutocomplete(val.trim());
  }, 120);
}

function onSimpleSearchFocus() {
  const inp = document.getElementById('simple-search-activity');
  const val = inp ? inp.value.trim() : '';
  const clearBtn = document.getElementById('simple-search-clear');
  if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';
  fetchSimpleAutocomplete(val);
}

function clearSimpleActivitySearch() {
  const inp = document.getElementById('simple-search-activity');
  if (inp) {
    inp.value = '';
    inp.focus();
  }
  const clearBtn = document.getElementById('simple-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';

  const codeVal = document.getElementById('simple-val-kode');
  if (codeVal) codeVal.value = '';

  const nameVal = document.getElementById('simple-val-nama');
  if (nameVal) nameVal.value = '';

  const codeBadge = document.getElementById('simple-selected-code');
  if (codeBadge) {
    codeBadge.textContent = '';
    codeBadge.style.display = 'none';
  }

  const stdEl = document.getElementById('simple-standar-display');
  if (stdEl) stdEl.textContent = 'Standar: -';

  fetchSimpleAutocomplete('');
}

async function fetchSimpleAutocomplete(query) {
  const listEl = document.getElementById('simple-activity-autocomplete-list');
  if (!listEl) return;

  listEl.classList.add('active');
  currentHighlightedIndex = -1;

  try {
    let items = [];
    if (!query || query.length < 2) {
      items = POPULAR_ACTIVITIES_CATALOG;
    } else {
      const res = await fetch(`/api/catalog?q=${encodeURIComponent(query)}&limit=25`).then(r => r.json());
      if (res.success && res.items) {
        items = res.items;
      }
    }

    if (!items || items.length === 0) {
      listEl.innerHTML = `<div class="autocomplete-empty">Tidak ada kegiatan yang cocok dengan <em>"${escapeHtml(query)}"</em>.<br><small style="color:#94a3b8;">Coba kata kunci umum seperti 'surat', 'arsip', 'komputer', 'rapat'.</small></div>`;
      return;
    }

    listEl.innerHTML = items.map((item, idx) => {
      const waktu = item.waktu || 60;
      const satuan = escapeHtml(item.satuan || 'Kegiatan');
      const kode = item.kode_aktifitas || 'UTAMA';
      const highlightedName = highlightAutocompleteMatch(item.nama_aktifitas, query);
      const highlightedCode = highlightAutocompleteMatch(kode, query);

      return `
        <div class="autocomplete-item" data-idx="${idx}" onmousedown="selectSimpleActivityByIndex(${idx})">
          <div class="autocomplete-item-name">${highlightedName}</div>
          <div class="autocomplete-item-meta">
            <span class="autocomplete-item-code">${highlightedCode}</span>
            <span class="autocomplete-item-time">⏱️ ${waktu} Menit</span>
            <span class="autocomplete-item-satuan">${satuan}</span>
          </div>
        </div>
      `;
    }).join('');

    AppState._simpleAutocompleteItems = items;
  } catch (err) {
    listEl.innerHTML = `<div class="autocomplete-empty" style="color: #ef4444;">Gagal memuat katalog: ${escapeHtml(err.message)}</div>`;
  }
}

function selectSimpleActivityByIndex(idx) {
  if (!AppState._simpleAutocompleteItems || !AppState._simpleAutocompleteItems[idx]) return;
  const item = AppState._simpleAutocompleteItems[idx];
  selectSimpleActivity(item);
}

function selectSimpleActivity(item) {
  const kode = item.kode_aktifitas;
  const nama = item.nama_aktifitas;
  const waktu = parseInt(item.waktu || 60, 10);
  const satuan = item.satuan || 'Kegiatan';

  const inp = document.getElementById('simple-search-activity');
  if (inp) inp.value = nama;

  document.getElementById('simple-val-kode').value = kode;
  document.getElementById('simple-val-nama').value = nama;
  document.getElementById('simple-val-waktu').value = waktu;
  document.getElementById('simple-val-satuan').value = satuan;

  const codeEl = document.getElementById('simple-selected-code');
  if (codeEl) {
    codeEl.textContent = kode;
    codeEl.style.display = 'inline-block';
  }

  const stdEl = document.getElementById('simple-standar-display');
  if (stdEl) stdEl.textContent = `Standar: ${waktu}m / ${satuan}`;

  // Smart default description
  const ketEl = document.getElementById('simple-input-keterangan');
  if (ketEl && (!ketEl.value || ketEl.value.includes('Mengikuti pelatihan') || ketEl.value.includes('Tuliskan') || ketEl.value.includes('Melaksanakan'))) {
    ketEl.value = `Melaksanakan ${nama.toLowerCase()} sesuai penugasan kedinasan.`;
  }

  // Hide dropdown
  const listEl = document.getElementById('simple-activity-autocomplete-list');
  if (listEl) listEl.classList.remove('active');

  const clearBtn = document.getElementById('simple-search-clear');
  if (clearBtn) clearBtn.style.display = 'flex';

  // Load SKP
  loadSkpOptions(kode, 'simple-input-skp');

  // Recalculate duration & times
  syncSimpleTimeFromVolume();
  syncSimpleDuration();
}

function onSimpleSearchKeyDown(e) {
  const listEl = document.getElementById('simple-activity-autocomplete-list');
  if (!listEl || !listEl.classList.contains('active')) return;

  const items = listEl.querySelectorAll('.autocomplete-item');
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    currentHighlightedIndex = (currentHighlightedIndex + 1) % items.length;
    updateHighlightedItems(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    currentHighlightedIndex = (currentHighlightedIndex - 1 + items.length) % items.length;
    updateHighlightedItems(items);
  } else if (e.key === 'Enter') {
    if (currentHighlightedIndex >= 0 && currentHighlightedIndex < items.length) {
      e.preventDefault();
      selectSimpleActivityByIndex(currentHighlightedIndex);
    }
  } else if (e.key === 'Escape') {
    listEl.classList.remove('active');
  }
}

function updateHighlightedItems(items) {
  items.forEach((item, i) => {
    if (i === currentHighlightedIndex) {
      item.classList.add('selected');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('selected');
    }
  });
}

function applySimpleActivityPreset(kode, nama, waktu, satuan, keterangan) {
  document.getElementById('simple-val-kode').value = kode;
  document.getElementById('simple-val-nama').value = nama;
  document.getElementById('simple-val-waktu').value = waktu;
  document.getElementById('simple-val-satuan').value = satuan;

  const inp = document.getElementById('simple-search-activity');
  if (inp) inp.value = nama;

  const clearBtn = document.getElementById('simple-search-clear');
  if (clearBtn) clearBtn.style.display = 'flex';

  const codeEl = document.getElementById('simple-selected-code');
  if (codeEl) {
    codeEl.textContent = kode;
    codeEl.style.display = 'inline-block';
  }

  const ketEl = document.getElementById('simple-input-keterangan');
  if (ketEl && keterangan) ketEl.value = keterangan;

  const stdEl = document.getElementById('simple-standar-display');
  if (stdEl) stdEl.textContent = `Standar: ${waktu}m / ${satuan}`;

  const listEl = document.getElementById('simple-activity-autocomplete-list');
  if (listEl) listEl.classList.remove('active');

  loadSkpOptions(kode, 'simple-input-skp');
  syncSimpleTimeFromVolume();
  showToast(`Kegiatan disetel: ${nama}`, "info");
}

// ------------------------------------------------------------------------------
// Scheduler Form Autocomplete
// ------------------------------------------------------------------------------
function onSchedulerSearchInput(val) {
  const clearBtn = document.getElementById('sch-search-clear');
  if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';

  clearTimeout(schSearchDebounce);
  schSearchDebounce = setTimeout(() => {
    fetchSchedulerAutocomplete(val.trim());
  }, 120);
}

function onSchedulerSearchFocus() {
  const inp = document.getElementById('sch-search-activity');
  const val = inp ? inp.value.trim() : '';
  const clearBtn = document.getElementById('sch-search-clear');
  if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';
  fetchSchedulerAutocomplete(val);
}

function clearSchedulerActivitySearch() {
  const inp = document.getElementById('sch-search-activity');
  if (inp) {
    inp.value = '';
    inp.focus();
  }
  const clearBtn = document.getElementById('sch-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  fetchSchedulerAutocomplete('');
}

async function fetchSchedulerAutocomplete(query) {
  const listEl = document.getElementById('sch-activity-autocomplete-list');
  if (!listEl) return;

  
  listEl.classList.add('active');
  currentHighlightedIndex = -1;

  try {
    let items = [];
    if (!query || query.length < 2) {
      items = POPULAR_ACTIVITIES_CATALOG;
    } else {
      const res = await fetch(`/api/catalog?q=${encodeURIComponent(query)}&limit=25`).then(r => r.json());
      if (res.success && res.items) {
        items = res.items;
      }
    }

    if (!items || items.length === 0) {
      listEl.innerHTML = `<div class="autocomplete-empty">Tidak ada kegiatan yang cocok dengan <em>"${escapeHtml(query)}"</em>.</div>`;
      return;
    }

    listEl.innerHTML = items.map((item, idx) => {
      const waktu = item.waktu || 60;
      const satuan = escapeHtml(item.satuan || 'Kegiatan');
      const kode = item.kode_aktifitas || 'UTAMA';
      const highlightedName = highlightAutocompleteMatch(item.nama_aktifitas, query);
      const highlightedCode = highlightAutocompleteMatch(kode, query);

      return `
        <div class="autocomplete-item" data-idx="${idx}" onmousedown="selectSchedulerActivityByIndex(${idx})">
          <div class="autocomplete-item-name">${highlightedName}</div>
          <div class="autocomplete-item-meta">
            <span class="autocomplete-item-code">${highlightedCode}</span>
            <span class="autocomplete-item-time">⏱️ ${waktu} Menit</span>
            <span class="autocomplete-item-satuan">${satuan}</span>
          </div>
        </div>
      `;
    }).join('');

    AppState._schAutocompleteItems = items;
  } catch (err) {
    listEl.innerHTML = `<div class="autocomplete-empty" style="color: #ef4444;">Gagal memuat katalog: ${escapeHtml(err.message)}</div>`;
  }
}

function selectSchedulerActivityByIndex(idx) {
  if (!AppState._schAutocompleteItems || !AppState._schAutocompleteItems[idx]) return;
  const item = AppState._schAutocompleteItems[idx];
  selectSchedulerActivity(item);
}

function selectSchedulerActivity(item) {
  const kode = item.kode_aktifitas;
  const nama = item.nama_aktifitas;
  const waktu = parseInt(item.waktu || 60, 10);
  const satuan = item.satuan || 'Kegiatan';

  const inp = document.getElementById('sch-search-activity');
  if (inp) inp.value = nama;

  document.getElementById('sch-val-kode').value = kode;
  document.getElementById('sch-val-nama').value = nama;
  document.getElementById('sch-val-waktu').value = waktu;
  document.getElementById('sch-val-satuan').value = satuan;

  const codeEl = document.getElementById('sch-selected-code');
  if (codeEl) codeEl.textContent = kode;

  const stdEl = document.getElementById('sch-standar-display');
  if (stdEl) stdEl.textContent = `Standar: ${waktu}m / ${satuan}`;

  const ketEl = document.getElementById('sch-input-keterangan');
  if (ketEl && (!ketEl.value || ketEl.value.includes('Mengikuti pelatihan') || ketEl.value.includes('Otomatis') || ketEl.value.includes('Melaksanakan'))) {
    ketEl.value = `Melaksanakan ${nama.toLowerCase()} secara rutin kedinasan.`;
  }

  const listEl = document.getElementById('sch-activity-autocomplete-list');
  if (listEl) listEl.classList.remove('active');

  const clearBtn = document.getElementById('sch-search-clear');
  if (clearBtn) clearBtn.style.display = 'flex';

  loadSkpOptions(kode, 'sch-skp-select');
  syncSchedulerTimeFromVolume();
  syncSchedulerDuration();

  showToast(`Kegiatan terjadwal dipilih: ${nama}`, "info");
}

function onSchedulerSearchKeyDown(e) {
  const listEl = document.getElementById('sch-activity-autocomplete-list');
  if (!listEl || !listEl.classList.contains('active')) return;

  const items = listEl.querySelectorAll('.autocomplete-item');
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    currentHighlightedIndex = (currentHighlightedIndex + 1) % items.length;
    updateHighlightedItems(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    currentHighlightedIndex = (currentHighlightedIndex - 1 + items.length) % items.length;
    updateHighlightedItems(items);
  } else if (e.key === 'Enter') {
    if (currentHighlightedIndex >= 0 && currentHighlightedIndex < items.length) {
      e.preventDefault();
      selectSchedulerActivityByIndex(currentHighlightedIndex);
    }
  } else if (e.key === 'Escape') {
    listEl.classList.remove('active');
  }
}

// ------------------------------------------------------------------------------
// Scheduler Template 2 Autocomplete
// ------------------------------------------------------------------------------
let schSearchDebounce2 = null;

function onSchedulerSearchInput2(val) {
  const clearBtn = document.getElementById('sch-search-clear2');
  if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';

  clearTimeout(schSearchDebounce2);
  schSearchDebounce2 = setTimeout(() => {
    fetchSchedulerAutocomplete2(val.trim());
  }, 120);
}

function onSchedulerSearchFocus2() {
  const inp = document.getElementById('sch-search-activity2');
  const val = inp ? inp.value.trim() : '';
  const clearBtn = document.getElementById('sch-search-clear2');
  if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';
  fetchSchedulerAutocomplete2(val);
}

function clearSchedulerActivitySearch2() {
  const inp = document.getElementById('sch-search-activity2');
  if (inp) {
    inp.value = '';
    inp.focus();
  }
  const clearBtn = document.getElementById('sch-search-clear2');
  if (clearBtn) clearBtn.style.display = 'none';
  fetchSchedulerAutocomplete2('');
}

async function fetchSchedulerAutocomplete2(query) {
  const listEl = document.getElementById('sch-activity-autocomplete-list2');
  if (!listEl) return;

  
  listEl.classList.add('active');
  currentHighlightedIndex = -1;

  try {
    let items = [];
    if (!query || query.length < 2) {
      items = POPULAR_ACTIVITIES_CATALOG;
    } else {
      const res = await fetch(`/api/catalog?q=${encodeURIComponent(query)}&limit=25`).then(r => r.json());
      if (res.success && res.items) {
        items = res.items;
      }
    }

    if (!items || items.length === 0) {
      listEl.innerHTML = `<div class="autocomplete-empty">Tidak ada kegiatan yang cocok dengan <em>"${escapeHtml(query)}"</em>.</div>`;
      return;
    }

    listEl.innerHTML = items.map((item, idx) => {
      const waktu = item.waktu || 60;
      const satuan = escapeHtml(item.satuan || 'Kegiatan');
      const kode = item.kode_aktifitas || 'UTAMA';
      const highlightedName = highlightAutocompleteMatch(item.nama_aktifitas, query);
      const highlightedCode = highlightAutocompleteMatch(kode, query);

      return `
        <div class="autocomplete-item" data-idx="${idx}" onmousedown="selectSchedulerActivityByIndex2(${idx})">
          <div class="autocomplete-item-name">${highlightedName}</div>
          <div class="autocomplete-item-meta">
            <span class="autocomplete-item-code">${highlightedCode}</span>
            <span class="autocomplete-item-time">⏱️ ${waktu} Menit</span>
            <span class="autocomplete-item-satuan">${satuan}</span>
          </div>
        </div>
      `;
    }).join('');

    AppState._schAutocompleteItems2 = items;
  } catch (err) {
    listEl.innerHTML = `<div class="autocomplete-empty" style="color: #ef4444;">Gagal memuat katalog: ${escapeHtml(err.message)}</div>`;
  }
}

function selectSchedulerActivityByIndex2(idx) {
  if (!AppState._schAutocompleteItems2 || !AppState._schAutocompleteItems2[idx]) return;
  const item = AppState._schAutocompleteItems2[idx];
  selectSchedulerActivity2(item);
}

function selectSchedulerActivity2(item) {
  const kode = item.kode_aktifitas;
  const nama = item.nama_aktifitas;
  const waktu = parseInt(item.waktu || 60, 10);
  const satuan = item.satuan || 'Kegiatan';

  const inp = document.getElementById('sch-search-activity2');
  if (inp) inp.value = nama;

  document.getElementById('sch-val-kode2').value = kode;
  document.getElementById('sch-val-nama2').value = nama;
  document.getElementById('sch-val-waktu2').value = waktu;
  document.getElementById('sch-val-satuan2').value = satuan;

  const codeEl = document.getElementById('sch-selected-code2');
  if (codeEl) codeEl.textContent = kode;

  const ketEl = document.getElementById('sch-keterangan-input2');
  if (ketEl && (!ketEl.value || ketEl.value.includes('Pengurusan') || ketEl.value.includes('Melaksanakan'))) {
    ketEl.value = `Melaksanakan ${nama.toLowerCase()} kedinasan.`;
  }

  const listEl = document.getElementById('sch-activity-autocomplete-list2');
  if (listEl) listEl.classList.remove('active');

  const clearBtn = document.getElementById('sch-search-clear2');
  if (clearBtn) clearBtn.style.display = 'flex';

  loadSkpOptions(kode, 'sch-skp-select2');
  syncSchedulerTimeFromVolume2();
  syncSchedulerDuration();

  showToast(`Template 2 dipilih: ${nama}`, "info");
}

function onSchedulerSearchKeyDown2(e) {
  const listEl = document.getElementById('sch-activity-autocomplete-list2');
  if (!listEl || !listEl.classList.contains('active')) return;

  const items = listEl.querySelectorAll('.autocomplete-item');
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    currentHighlightedIndex = (currentHighlightedIndex + 1) % items.length;
    updateHighlightedItems(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    currentHighlightedIndex = (currentHighlightedIndex - 1 + items.length) % items.length;
    updateHighlightedItems(items);
  } else if (e.key === 'Enter') {
    if (currentHighlightedIndex >= 0 && currentHighlightedIndex < items.length) {
      e.preventDefault();
      selectSchedulerActivityByIndex2(currentHighlightedIndex);
    }
  } else if (e.key === 'Escape') {
    listEl.classList.remove('active');
  }
}

function syncSchedulerTimeFromVolume2() {
  const vol = parseInt(document.getElementById('sch-volume-input2').value || '1', 10);
  const std = parseInt(document.getElementById('sch-val-waktu2').value || '60', 10);
  const targetMinutes = Math.min(600, vol * std);

  const startVal = document.getElementById('sch-time-start2').value || '12:00';
  const [sH, sM] = startVal.split(':').map(Number);
  const totalStart = sH * 60 + sM;
  const totalEnd = totalStart + targetMinutes;

  const eH = Math.floor(totalEnd / 60) % 24;
  const eM = totalEnd % 60;
  const endFormatted = `${String(eH).padStart(2, '0')}:${String(eM).padStart(2, '0')}`;

  document.getElementById('sch-time-end2').value = endFormatted;
  syncSchedulerDuration();
}

// Global click outside listener to close autocomplete dropdowns
document.addEventListener('click', function(e) {
  const simpleWrap = document.getElementById('simple-activity-search-wrap');
  if (simpleWrap && !simpleWrap.contains(e.target)) {
    const listEl = document.getElementById('simple-activity-autocomplete-list');
    if (listEl) listEl.classList.remove('active');
  }

  const schWrap = document.getElementById('sch-activity-search-wrap');
  if (schWrap && !schWrap.contains(e.target)) {
    const listEl = document.getElementById('sch-activity-autocomplete-list');
    if (listEl) listEl.classList.remove('active');
  }

  const schWrap2 = document.getElementById('sch-activity-search-wrap2');
  if (schWrap2 && !schWrap2.contains(e.target)) {
    const listEl2 = document.getElementById('sch-activity-autocomplete-list2');
    if (listEl2) listEl2.classList.remove('active');
  }
});


function applySimpleTimePreset(start, end) {
  document.getElementById('simple-input-time-start').value = start;
  document.getElementById('simple-input-time-end').value = end;
  syncSimpleDuration();
}

function syncSimpleDuration() {
  const s = document.getElementById('simple-input-time-start').value;
  const e = document.getElementById('simple-input-time-end').value;
  if (!s || !e) return;

  const [sH, sM] = s.split(':').map(Number);
  const [eH, eM] = e.split(':').map(Number);
  let dur = (eH * 60 + eM) - (sH * 60 + sM);
  if (dur < 0) dur += 24 * 60;

  const hours = (dur / 60).toFixed(1);
  const durEl = document.getElementById('simple-duration-display');
  if (durEl) {
    durEl.textContent = `⏱️ Durasi Laporan: ${dur} Menit (${hours} Jam)`;
  }
}

function syncSimpleTimeFromVolume() {
  const vol = parseInt(document.getElementById('simple-input-volume').value || '1', 10);
  const std = parseInt(document.getElementById('simple-val-waktu').value || '60', 10);
  const targetMinutes = Math.min(600, vol * std);

  const startVal = document.getElementById('simple-input-time-start').value || '07:30';
  const [sH, sM] = startVal.split(':').map(Number);
  const totalStart = sH * 60 + sM;
  const totalEnd = totalStart + targetMinutes;

  const eH = Math.floor(totalEnd / 60) % 24;
  const eM = totalEnd % 60;
  const endFormatted = `${String(eH).padStart(2, '0')}:${String(eM).padStart(2, '0')}`;

  document.getElementById('simple-input-time-end').value = endFormatted;
  syncSimpleDuration();
}

async function handleSimpleStageSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-submit-simple-stage');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>⏳ Mengirim Laporan ke Portal SiPENDEKAR...</span>`;
  }

  const tanggal = document.getElementById('simple-input-tanggal').value;
  const kode = document.getElementById('simple-val-kode').value;
  const searchInp = document.getElementById('simple-search-activity');
  const nama = document.getElementById('simple-val-nama').value || (searchInp ? searchInp.value.trim() : '');

  if (!kode || !nama) {
    showToast("Silakan ketik & pilih nama kegiatan dari katalog terlebih dahulu.", "error");
    if (searchInp) {
      searchInp.focus();
      onSimpleSearchFocus();
    }
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span>🚀 1-Klik Kirim Laporan ke SiPENDEKAR</span>`;
    }
    return;
  }

  const volume = parseInt(document.getElementById('simple-input-volume').value || '1', 10);
  const satuan = document.getElementById('simple-val-satuan').value || 'Kegiatan';
  const keterangan = document.getElementById('simple-input-keterangan').value.trim();

  const timeStart = document.getElementById('simple-input-time-start').value || '07:30';
  const timeEnd = document.getElementById('simple-input-time-end').value || '12:30';
  const [jm, mm] = timeStart.split(':');
  const [js, ms] = timeEnd.split(':');

  const skpSelect = document.getElementById('simple-input-skp');
  const idSkp = skpSelect ? skpSelect.value : "";

  try {
    const idInput = document.getElementById('simple-input-id');
    const idVal = idInput ? idInput.value : "";

    const res = await fetch('/api/fill/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_input: idVal || null,
        tanggal: tanggal,
        kode_aktifitas: kode,
        nama_aktifitas: nama,
        jam_mulai: jm,
        menit_mulai: mm,
        jam_selesai: js,
        menit_selesai: ms,
        volume: volume,
        satuan: satuan,
        keterangan: keterangan,
        sasaran_kerja_id: parseInt(idSkp, 10) || 0,
        id_skp: idSkp
      })
    }).then(r => r.json());

    if (res.success) {
      if (btn) {
        btn.innerHTML = `<span>✅ Berhasil Terinput!</span>`;
        btn.style.background = '#10b981';
      }
      showToast(idVal ? `✅ Perubahan #${idVal} tersimpan!` : `✅ Berhasil tersimpan di SiPENDEKAR!`, "success", 1200);

      // Reset form immediately so user can input next activity right away
      resetSimpleInputForm();

      // Silent background refreshes (no loading screens)
      fetchProgress().catch(() => {});
      loadActivitiesHistory(true).catch(() => {});

      setTimeout(() => {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = `<span>🚀 1-Klik Kirim Laporan ke SiPENDEKAR</span>`;
          btn.style.background = '';
        }
      }, 400);
    } else {
      showToast(res.error || "Gagal mengirim laporan ke SiPENDEKAR.", "error");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<span>🚀 1-Klik Kirim Laporan ke SiPENDEKAR</span>`;
        btn.style.background = '';
      }
    }
  } catch (err) {
    showToast("Terjadi kendala jaringan: " + err.message, "error");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span>🚀 1-Klik Kirim Laporan ke SiPENDEKAR</span>`;
      btn.style.background = '';
    }
  }
}

// ==============================================================================
// 12. FEATURE 3: HISTORI KEGIATAN & INPUT ULANG
// ==============================================================================

async function loadActivitiesHistory(silent = false) {
  const container = document.getElementById('history-items-container');
  if (!container) return;

  if (!silent && !container.children.length) {
    container.innerHTML = `<div style="text-align: center; padding: 40px; color: #64748b;">Memuat riwayat kegiatan...</div>`;
  }

  try {
    const res = await fetch('/api/activities/history').then(r => r.json());
    if (res.success && res.items && res.items.length > 0) {
      AppState.historyItems = res.items;
      renderHistoryCards(res.items);
    } else {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #64748b;">
          <p style="font-size: 15px; font-weight: 600; color: #334155;">Belum ada riwayat kegiatan ditemukan.</p>
          <p style="font-size: 12.5px;">Gunakan menu <strong>Form Input Simpel</strong> atau <strong>1-Click Auto-Fill</strong> untuk mulai mengisi laporan.</p>
        </div>
      `;
    }
  } catch (e) {
    console.error("Load history error:", e);
    container.innerHTML = `<div style="text-align: center; padding: 30px; color: #ef4444;">Gagal memuat riwayat: ${e.message}</div>`;
  }
}

function renderHistoryCards(items) {
  const container = document.getElementById('history-items-container');
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 30px; color: #64748b;">Tidak ada kegiatan yang cocok dengan pencarian.</div>`;
    return;
  }

  container.innerHTML = items.map((item, idx) => {
    const tgl = escapeHtml(item.tanggal || "Template Harian");
    const jm = escapeHtml(item.jam_mulai || "07:30");
    const js = escapeHtml(item.jam_selesai || "12:30");
    const durasi = parseInt(item.durasi_menit) || 300;
    const vol = parseInt(item.volume) || 1;
    const satuan = escapeHtml(item.satuan || 'Kegiatan');
    const kode = escapeHtml(item.kode_aktifitas || 'UTAMA00463');
    const nama = escapeHtml(item.nama_aktifitas || 'Kegiatan e-Kinerja');
    const ket = escapeHtml(item.keterangan || '-');

    return `
      <div class="activity-history-item" data-idx="${idx}">
        <div class="act-item-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="act-badge-date">📅 ${tgl}</span>
            <span style="font-size: 11.5px; font-weight: 600; color: #64748b;">🕒 ${jm} - ${js}</span>
          </div>
          <span class="act-badge-durasi">⏱️ ${durasi} Menit (${vol} ${satuan})</span>
        </div>

        <div class="act-item-title">${nama} <span style="font-size: 11px; font-weight: 500; color: #2563eb;">[${kode}]</span></div>
        <div class="act-item-desc">${ket}</div>

        <div class="act-item-actions">
          <button type="button" class="btn-act-copy" onclick="copyActivityToSimpleForm(${idx})">
            ✍️ Salin ke Form Input
          </button>
          <button type="button" class="btn-act-reinput" onclick="reinputActivityNow(${idx})">
            ⚡ Input Ulang ke Hari Ini
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function filterHistoryCards(query) {
  if (!AppState.historyItems) return;
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    renderHistoryCards(AppState.historyItems);
    return;
  }
  const filtered = AppState.historyItems.filter(item => {
    const nama = (item.nama_aktifitas || '').toLowerCase();
    const ket = (item.keterangan || '').toLowerCase();
    const tgl = (item.tanggal || '').toLowerCase();
    const kode = (item.kode_aktifitas || '').toLowerCase();
    return nama.includes(q) || ket.includes(q) || tgl.includes(q) || kode.includes(q);
  });
  renderHistoryCards(filtered);
}

function copyActivityToSimpleForm(idx) {
  const item = (AppState.historyItems && AppState.historyItems[idx]) ? AppState.historyItems[idx] : null;
  if (!item) return;

  switchViewTab('simple-input');

  const kode = item.kode_aktifitas || 'UTAMA00463';
  const nama = item.nama_aktifitas || 'Mengikuti pelatihan/sosialisasi/pendidikan';
  const waktu = item.durasi_menit || 300;
  const satuan = item.satuan || 'Kegiatan';
  const ket = item.keterangan || '';

  applySimpleActivityPreset(kode, nama, waktu, satuan, ket);

  if (item.jam_mulai && item.jam_selesai) {
    document.getElementById('simple-input-time-start').value = item.jam_mulai;
    document.getElementById('simple-input-time-end').value = item.jam_selesai;
  }
  if (item.volume) {
    document.getElementById('simple-input-volume').value = item.volume;
  }

  syncSimpleDuration();
  showToast("Kegiatan disalin ke formulir input. Silakan periksa & kirim!", "success");
}

async function directCloneYesterdayActivities() {
  const targetDateInput = document.getElementById('simple-input-tanggal');
  const targetDate = (targetDateInput && targetDateInput.value) ? targetDateInput.value : new Date().toISOString().split('T')[0];

  const btnBanner = document.getElementById('btn-copy-yesterday');
  const hintText = document.getElementById('yesterday-hint-text');

  if (!confirm(`Langsung input persis seluruh kegiatan hari kerja kemarin (semua template) ke tanggal ${targetDate} di SiPENDEKAR tanpa review?`)) {
    return;
  }

  if (btnBanner) {
    btnBanner.disabled = true;
    btnBanner.innerHTML = `<span>⏳ Menginput persis ke SiPENDEKAR...</span>`;
  }
  showToast(`⏳ Mengirim seluruh kegiatan hari kerja kemarin ke ${targetDate}...`, "info");

  try {
    const res = await fetch('/api/activities/clone-yesterday', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_date: targetDate })
    }).then(r => r.json());

    if (res.success) {
      const hours = (res.total_menit / 60).toFixed(1);
      const msg = `🎉 Berhasil menginput ${res.inserted_count} kegiatan persis dari ${res.source_date} ke ${res.target_date} (Total ${res.total_menit} Menit / ${hours} Jam)!`;
      showToast(msg, "success");

      // Update calendar progress & history lists immediately
      fetchProgress();
      loadActivitiesHistory();

      // Clear any unsubmitted input so form is clean
      resetSimpleInputForm();

      if (hintText) {
        hintText.innerHTML = `✅ <strong>Berhasil terinput persis:</strong> ${res.inserted_count} kegiatan dari tanggal ${res.source_date} (${res.total_menit} Menit) ke tanggal ${res.target_date}.`;
      }

      // Append confirmation to chat bot stream
      appendChatBubble('bot', `⚡ **Input Persis Seperti Kemarin Selesai!**\n\n📅 **Tanggal Target:** ${res.target_date}\n📌 **Disalin Dari:** ${res.source_date}\n⏱️ **Total Durasi:** ${res.total_menit} Menit (${res.inserted_count} Kegiatan)\n\n📋 **Rincian:**\n` + (res.details || []).map(d => `• ${d}`).join('\n'));
    } else {
      showToast(res.error || "Gagal menginput kegiatan kemarin.", "error");
      if (hintText) {
        hintText.textContent = `❌ Kendala: ${res.error || "Gagal menginput."}`;
      }
    }
  } catch (err) {
    showToast("Kendala jaringan: " + err.message, "error");
  } finally {
    if (btnBanner) {
      btnBanner.disabled = false;
      btnBanner.innerHTML = `<span>⚡ Input Persis Seperti Hari Kemarin</span>`;
    }
  }
}

// Aliases for compatibility
window.directCloneYesterdayActivities = directCloneYesterdayActivities;
window.copyYesterdayActivityToForm = directCloneYesterdayActivities;


async function reinputActivityNow(idx) {
  const item = (AppState.historyItems && AppState.historyItems[idx]) ? AppState.historyItems[idx] : null;
  if (!item) return;

  const todayStr = new Date().toISOString().split('T')[0];
  const confirmMsg = `Input ulang kegiatan:\n"${item.nama_aktifitas}"\nke tanggal hari ini (${todayStr})?`;
  if (!confirm(confirmMsg)) return;

  showToast("⏳ Menginput ulang ke SiPENDEKAR hari ini...", "info");

  try {
    const res = await fetch('/api/activities/reinput', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item: item,
        target_date: todayStr
      })
    }).then(r => r.json());

    if (res.success) {
      showToast(`🎉 Berhasil input ulang ke ${todayStr}!`, "success");
      fetchProgress();
      loadActivitiesHistory();
      appendChatBubble('bot', `⚡ **1-Klik Input Ulang Berhasil!**\n\n📅 **Tanggal:** ${todayStr}\n📋 **Kegiatan:** ${item.nama_aktifitas}\n⏱️ **Durasi:** ${item.durasi_menit || 300} Menit\n📝 **Keterangan:** ${item.keterangan || '-'}`);
    } else {
      showToast(res.error || "Gagal input ulang.", "error");
    }
  } catch (e) {
    showToast("Kesalahan: " + e.message, "error");
  }
}

// ==============================================================================
// 13. FEATURE 4: BACKGROUND SCHEDULER & OTOMASI HARIAN (TANGGAL & 2 TEMPLATE)
// ==============================================================================

function selectSchedulerMode(mode) {
  const isDate = mode === 'specific_date';
  const rDate = document.getElementById('sch-mode-date');
  const rWeek = document.getElementById('sch-mode-weekday');
  if (rDate) rDate.checked = isDate;
  if (rWeek) rWeek.checked = !isDate;

  const cDate = document.getElementById('sch-mode-date-card');
  const cWeek = document.getElementById('sch-mode-weekday-card');
  if (cDate) cDate.classList.toggle('active', isDate);
  if (cWeek) cWeek.classList.toggle('active', !isDate);

  const wrapDate = document.getElementById('sch-target-date-wrap');
  const wrapWeek = document.getElementById('sch-weekdays-wrap');
  if (wrapDate) wrapDate.style.display = isDate ? 'block' : 'none';
  if (wrapWeek) wrapWeek.style.display = isDate ? 'none' : 'block';
}

function setSchedulerTargetDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const targetDateInp = document.getElementById('sch-target-date');
  if (targetDateInp) {
    targetDateInp.value = d.toISOString().split('T')[0];
  }
}

function setSchedulerNextMonday() {
  const d = new Date();
  const day = d.getDay(); // 0 is Sun, 1 is Mon...
  const diff = (day === 0) ? 1 : (8 - day);
  d.setDate(d.getDate() + diff);
  const targetDateInp = document.getElementById('sch-target-date');
  if (targetDateInp) {
    targetDateInp.value = d.toISOString().split('T')[0];
  }
}

function toggleSchedulerTemplate2(enabled) {
  const chk = document.getElementById('sch-enable-tmpl2');
  if (chk) chk.checked = !!enabled;

  const fields = document.getElementById('sch-tmpl2-fields');
  if (fields) fields.style.display = enabled ? 'block' : 'none';

  syncSchedulerDuration();
}

async function copyYesterdayToScheduler() {
  showToast("⏳ Mengambil data kegiatan kemarin dari portal...", "info");
  try {
    const res = await fetch('/api/activities/history').then(r => r.json());
    let acts = [];
    if (res.success && res.items && res.items.length > 0) {
      acts = res.items.filter(a => !a.is_template && a.kode_aktifitas);
      if (acts.length === 0) acts = res.items;
    }

    if (acts.length >= 2) {
      const a1 = acts[0];
      const a2 = acts[1];

      // Template 1
      document.getElementById('sch-val-kode').value = a1.kode_aktifitas;
      document.getElementById('sch-val-nama').value = a1.nama_aktifitas;
      document.getElementById('sch-val-waktu').value = a1.durasi_menit && a1.volume ? Math.round(a1.durasi_menit / a1.volume) : 60;
      document.getElementById('sch-val-satuan').value = a1.satuan || 'Laporan';
      document.getElementById('sch-search-activity').value = a1.nama_aktifitas;
      document.getElementById('sch-selected-code').textContent = a1.kode_aktifitas;
      document.getElementById('sch-volume-input').value = a1.volume || 4;
      document.getElementById('sch-time-start').value = a1.jam_mulai || '08:00';
      document.getElementById('sch-time-end').value = a1.jam_selesai || '12:00';
      document.getElementById('sch-keterangan-input').value = a1.keterangan || `Melaksanakan ${a1.nama_aktifitas.toLowerCase()}`;
      loadSkpOptions(a1.kode_aktifitas, 'sch-skp-select', a1.id_skp);

      // Template 2
      toggleSchedulerTemplate2(true);
      document.getElementById('sch-val-kode2').value = a2.kode_aktifitas;
      document.getElementById('sch-val-nama2').value = a2.nama_aktifitas;
      document.getElementById('sch-val-waktu2').value = a2.durasi_menit && a2.volume ? Math.round(a2.durasi_menit / a2.volume) : 60;
      document.getElementById('sch-val-satuan2').value = a2.satuan || 'Dokumen/ Laporan';
      document.getElementById('sch-search-activity2').value = a2.nama_aktifitas;
      document.getElementById('sch-selected-code2').textContent = a2.kode_aktifitas;
      document.getElementById('sch-volume-input2').value = a2.volume || 4;
      document.getElementById('sch-time-start2').value = a2.jam_mulai || '12:00';
      document.getElementById('sch-time-end2').value = a2.jam_selesai || '16:00';
      document.getElementById('sch-keterangan-input2').value = a2.keterangan || `Melaksanakan ${a2.nama_aktifitas.toLowerCase()}`;
      loadSkpOptions(a2.kode_aktifitas, 'sch-skp-select2', a2.id_skp);

      syncSchedulerDuration();
      showToast("⚡ Sukses! 2 Template disamakan persis dg kegiatan kemarin (480 Menit / 8 Jam)!", "success");
    } else {
      // Default fallback 2 templates popular: UTAMA00529 (Rekap data) & UTAMA00926 (Administrasi kepegawaian)
      document.getElementById('sch-val-kode').value = 'UTAMA00529';
      document.getElementById('sch-val-nama').value = 'Membuat rekapitulasi data';
      document.getElementById('sch-val-waktu').value = 60;
      document.getElementById('sch-val-satuan').value = 'Laporan';
      document.getElementById('sch-search-activity').value = 'Membuat rekapitulasi data';
      document.getElementById('sch-selected-code').textContent = 'UTAMA00529';
      document.getElementById('sch-volume-input').value = 4;
      document.getElementById('sch-time-start').value = '08:00';
      document.getElementById('sch-time-end').value = '12:00';
      document.getElementById('sch-keterangan-input').value = 'Merekap data absensi kedinasan.';
      loadSkpOptions('UTAMA00529', 'sch-skp-select');

      toggleSchedulerTemplate2(true);
      document.getElementById('sch-val-kode2').value = 'UTAMA00926';
      document.getElementById('sch-val-nama2').value = 'Pengurusan administrasi kepegawaian';
      document.getElementById('sch-val-waktu2').value = 60;
      document.getElementById('sch-val-satuan2').value = 'Dokumen/ Laporan';
      document.getElementById('sch-search-activity2').value = 'Pengurusan administrasi kepegawaian';
      document.getElementById('sch-selected-code2').textContent = 'UTAMA00926';
      document.getElementById('sch-volume-input2').value = 4;
      document.getElementById('sch-time-start2').value = '12:00';
      document.getElementById('sch-time-end2').value = '16:00';
      document.getElementById('sch-keterangan-input2').value = 'Pengurusan administrasi cuti dan berkas pegawai.';
      loadSkpOptions('UTAMA00926', 'sch-skp-select2');

      syncSchedulerDuration();
      showToast("⚡ Sukses mengisi Template 1 & Template 2 (Total 480 Menit / 8 Jam)!", "success");
    }
  } catch (err) {
    showToast("Gagal menyalin: " + err.message, "error");
  }
}

async function loadSchedulerConfig() {
  try {
    const res = await fetch('/api/schedule').then(r => r.json());
    if (res.success && res.schedule) {
      const sch = res.schedule;
      const isAct = sch.is_active === 1;

      // Switch & Status
      const sw = document.getElementById('sch-switch-active');
      if (sw) sw.checked = isAct;

      updateSchedulerStatusBadge(isAct, sch.scheduled_time || '08:00');

      // Mode: specific_date vs daily_weekday
      const mode = sch.schedule_mode || 'specific_date';
      selectSchedulerMode(mode);

      // Target Date
      const targetDateInp = document.getElementById('sch-target-date');
      if (targetDateInp) {
        if (sch.target_date) {
          targetDateInp.value = sch.target_date;
        } else {
          const d = new Date();
          d.setDate(d.getDate() + 1);
          targetDateInp.value = d.toISOString().split('T')[0];
        }
      }

      // Time & Days
      const timeInp = document.getElementById('sch-time-input');
      if (timeInp) timeInp.value = sch.scheduled_time || '08:00';

      const days = (sch.days_of_week || 'mon,tue,wed,thu,fri').split(',');
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach(d => {
        const el = document.getElementById(`sch-day-${d}`);
        if (el) el.checked = days.includes(d);
      });

      // Activities: Array of 1 or 2 templates
      const acts = sch.activities || [];
      if (acts.length > 0) {
        const a1 = acts[0];
        if (a1.kode_aktifitas) {
          document.getElementById('sch-val-kode').value = a1.kode_aktifitas;
          document.getElementById('sch-val-nama').value = a1.nama_aktifitas || '';
          document.getElementById('sch-val-waktu').value = a1.standar_waktu || 60;
          document.getElementById('sch-val-satuan').value = a1.satuan || 'Laporan';

          const schInp1 = document.getElementById('sch-search-activity');
          if (schInp1) schInp1.value = a1.nama_aktifitas || '';

          const schCode1 = document.getElementById('sch-selected-code');
          if (schCode1) schCode1.textContent = a1.kode_aktifitas;

          if (a1.volume) document.getElementById('sch-volume-input').value = a1.volume;
          if (a1.jam_mulai) document.getElementById('sch-time-start').value = a1.jam_mulai;
          if (a1.jam_selesai) document.getElementById('sch-time-end').value = a1.jam_selesai;
          if (a1.keterangan) document.getElementById('sch-keterangan-input').value = a1.keterangan;

          loadSkpOptions(a1.kode_aktifitas, 'sch-skp-select', a1.id_skp);
        }

        // Template 2
        const t2Check = document.getElementById('sch-enable-tmpl2');
        if (acts.length > 1) {
          const a2 = acts[1];
          if (t2Check) t2Check.checked = true;
          toggleSchedulerTemplate2(true);

          document.getElementById('sch-val-kode2').value = a2.kode_aktifitas || 'UTAMA00926';
          document.getElementById('sch-val-nama2').value = a2.nama_aktifitas || '';
          document.getElementById('sch-val-waktu2').value = a2.standar_waktu || 60;
          document.getElementById('sch-val-satuan2').value = a2.satuan || 'Dokumen/ Laporan';

          const schInp2 = document.getElementById('sch-search-activity2');
          if (schInp2) schInp2.value = a2.nama_aktifitas || '';

          const schCode2 = document.getElementById('sch-selected-code2');
          if (schCode2) schCode2.textContent = a2.kode_aktifitas || 'UTAMA00926';

          if (a2.volume) document.getElementById('sch-volume-input2').value = a2.volume;
          if (a2.jam_mulai) document.getElementById('sch-time-start2').value = a2.jam_mulai;
          if (a2.jam_selesai) document.getElementById('sch-time-end2').value = a2.jam_selesai;
          if (a2.keterangan) document.getElementById('sch-keterangan-input2').value = a2.keterangan;

          loadSkpOptions(a2.kode_aktifitas, 'sch-skp-select2', a2.id_skp);
        } else {
          if (t2Check) t2Check.checked = false;
          toggleSchedulerTemplate2(false);
        }
      } else if (sch.kode_aktifitas) {
        // Fallback jika single template
        document.getElementById('sch-val-kode').value = sch.kode_aktifitas;
        document.getElementById('sch-val-nama').value = sch.nama_aktifitas || '';
        document.getElementById('sch-val-waktu').value = sch.standar_waktu || 60;
        document.getElementById('sch-val-satuan').value = sch.satuan || 'Kegiatan';

        const schInp = document.getElementById('sch-search-activity');
        if (schInp) schInp.value = sch.nama_aktifitas || '';

        const schCode = document.getElementById('sch-selected-code');
        if (schCode) schCode.textContent = sch.kode_aktifitas;

        if (sch.volume) document.getElementById('sch-volume-input').value = sch.volume;
        if (sch.jam_mulai && sch.jam_selesai) {
          document.getElementById('sch-time-start').value = sch.jam_mulai;
          document.getElementById('sch-time-end').value = sch.jam_selesai;
        }
        if (sch.keterangan) document.getElementById('sch-keterangan-input').value = sch.keterangan;

        loadSkpOptions(sch.kode_aktifitas, 'sch-skp-select', sch.id_skp);

        const t2Check = document.getElementById('sch-enable-tmpl2');
        if (t2Check) t2Check.checked = false;
        toggleSchedulerTemplate2(false);
      }

      syncSchedulerDuration();
      renderSchedulerLogs(res.logs || []);
    }
  } catch (e) {
    console.error("Load scheduler error:", e);
  }
}

function updateSchedulerStatusBadge(isActive, timeStr) {
  const badge = document.getElementById('sch-header-status-badge');
  const desc = document.getElementById('sch-status-description');
  const sideStatus = document.getElementById('sidebar-sch-status');
  const sideDot = document.getElementById('sidebar-sch-dot');

  if (isActive) {
    if (badge) {
      badge.style.background = '#dcfce7';
      badge.style.color = '#15803d';
      badge.textContent = `🟢 AKTIF (${timeStr} WIB)`;
    }
    if (desc) desc.textContent = `Bot otomatis mengisi kegiatan pada pukul ${timeStr} WIB.`;
    if (sideStatus) { sideStatus.textContent = 'Aktif'; sideStatus.style.color = '#10b981'; }
    if (sideDot) { sideDot.style.background = '#10b981'; }
  } else {
    if (badge) {
      badge.style.background = '#f1f5f9';
      badge.style.color = '#64748b';
      badge.textContent = `⚪ NON-AKTIF`;
    }
    if (desc) desc.textContent = `Jadwal otomatis dimatikan. Aktifkan saklar untuk mengotomasi input SiPENDEKAR.`;
    if (sideStatus) { sideStatus.textContent = 'Mati'; sideStatus.style.color = '#94a3b8'; }
    if (sideDot) { sideDot.style.background = '#cbd5e1'; }
  }
}

function syncSchedulerDuration() {
  // Template 1
  const s1 = document.getElementById('sch-time-start') ? document.getElementById('sch-time-start').value : '08:00';
  const e1 = document.getElementById('sch-time-end') ? document.getElementById('sch-time-end').value : '12:00';
  let dur1 = 0;
  if (s1 && e1) {
    const [sH1, sM1] = s1.split(':').map(Number);
    const [eH1, eM1] = e1.split(':').map(Number);
    dur1 = (eH1 * 60 + eM1) - (sH1 * 60 + sM1);
    if (dur1 < 0) dur1 += 24 * 60;
  }

  // Template 2
  let dur2 = 0;
  const tmpl2Enabled = document.getElementById('sch-enable-tmpl2') && document.getElementById('sch-enable-tmpl2').checked;
  if (tmpl2Enabled) {
    const s2 = document.getElementById('sch-time-start2') ? document.getElementById('sch-time-start2').value : '12:00';
    const e2 = document.getElementById('sch-time-end2') ? document.getElementById('sch-time-end2').value : '16:00';
    if (s2 && e2) {
      const [sH2, sM2] = s2.split(':').map(Number);
      const [eH2, eM2] = e2.split(':').map(Number);
      dur2 = (eH2 * 60 + eM2) - (sH2 * 60 + sM2);
      if (dur2 < 0) dur2 += 24 * 60;
    }
  }

  const totalDur = dur1 + dur2;
  const totalHours = (totalDur / 60).toFixed(1);
  const durEl = document.getElementById('sch-dur-display');
  if (durEl) {
    if (tmpl2Enabled) {
      const isTargetMet = totalDur >= 480;
      durEl.innerHTML = `⏱️ <strong>Total Durasi per Eksekusi:</strong> Template 1 (${dur1} m) + Template 2 (${dur2} m) = <span style="color:${isTargetMet ? '#15803d' : '#b45309'}; font-weight:800;">${totalDur} Menit (${totalHours} Jam)</span> ${isTargetMet ? '✨ <span style="color:#15803d;">(Memenuhi Target Harian 480m)</span>' : ''}`;
    } else {
      durEl.innerHTML = `⏱️ <strong>Total Durasi per Eksekusi:</strong> <strong>${dur1} Menit (${totalHours} Jam)</strong> (Hanya Template 1)`;
    }
  }
}

function syncSchedulerTimeFromVolume() {
  const vol = parseInt(document.getElementById('sch-volume-input').value || '1', 10);
  const std = parseInt(document.getElementById('sch-val-waktu').value || '60', 10);
  const targetMinutes = Math.min(600, vol * std);

  const startVal = document.getElementById('sch-time-start').value || '08:00';
  const [sH, sM] = startVal.split(':').map(Number);
  const totalStart = sH * 60 + sM;
  const totalEnd = totalStart + targetMinutes;

  const eH = Math.floor(totalEnd / 60) % 24;
  const eM = totalEnd % 60;
  const endFormatted = `${String(eH).padStart(2, '0')}:${String(eM).padStart(2, '0')}`;

  document.getElementById('sch-time-end').value = endFormatted;
  syncSchedulerDuration();
}

async function onSchedulerSwitchToggle(isChecked) {
  const timeVal = document.getElementById('sch-time-input').value || '08:00';
  updateSchedulerStatusBadge(isChecked, timeVal);
  showToast(isChecked ? "Jadwal otomatis diaktifkan. Klik 'Simpan' untuk memfinalisasi." : "Jadwal otomatis dinonaktifkan.", "info");
}

async function saveSchedulerConfigForm(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save-scheduler');
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Menyimpan Pengaturan...";
  }

  const isActive = document.getElementById('sch-switch-active').checked ? 1 : 0;
  const scheduledTime = document.getElementById('sch-time-input').value || '08:00';

  const isSpecificDate = document.getElementById('sch-mode-date') && document.getElementById('sch-mode-date').checked;
  const scheduleMode = isSpecificDate ? 'specific_date' : 'daily_weekday';
  const targetDate = document.getElementById('sch-target-date') ? document.getElementById('sch-target-date').value : '';

  const daysArr = [];
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach(d => {
    const el = document.getElementById(`sch-day-${d}`);
    if (el && el.checked) daysArr.push(d);
  });

  // Template 1
  const t1 = {
    kode_aktifitas: document.getElementById('sch-val-kode').value,
    nama_aktifitas: document.getElementById('sch-val-nama').value,
    standar_waktu: parseInt(document.getElementById('sch-val-waktu').value || '60', 10),
    satuan: document.getElementById('sch-val-satuan').value || 'Kegiatan',
    volume: parseInt(document.getElementById('sch-volume-input').value || '1', 10),
    jam_mulai: document.getElementById('sch-time-start').value || '08:00',
    jam_selesai: document.getElementById('sch-time-end').value || '12:00',
    keterangan: document.getElementById('sch-keterangan-input').value.trim(),
    id_skp: document.getElementById('sch-skp-select') ? document.getElementById('sch-skp-select').value : ''
  };

  const activities = [t1];

  // Template 2 (if enabled)
  const tmpl2Enabled = document.getElementById('sch-enable-tmpl2') && document.getElementById('sch-enable-tmpl2').checked;
  if (tmpl2Enabled) {
    const t2 = {
      kode_aktifitas: document.getElementById('sch-val-kode2').value,
      nama_aktifitas: document.getElementById('sch-val-nama2').value,
      standar_waktu: parseInt(document.getElementById('sch-val-waktu2').value || '60', 10),
      satuan: document.getElementById('sch-val-satuan2').value || 'Kegiatan',
      volume: parseInt(document.getElementById('sch-volume-input2').value || '1', 10),
      jam_mulai: document.getElementById('sch-time-start2').value || '12:00',
      jam_selesai: document.getElementById('sch-time-end2').value || '16:00',
      keterangan: document.getElementById('sch-keterangan-input2').value.trim(),
      id_skp: document.getElementById('sch-skp-select2') ? document.getElementById('sch-skp-select2').value : ''
    };
    activities.push(t2);
  }

  try {
    const res = await fetch('/api/schedule/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        is_active: isActive,
        scheduled_time: scheduledTime,
        schedule_mode: scheduleMode,
        target_date: targetDate,
        days_of_week: daysArr.join(','),
        activities: activities
      })
    }).then(r => r.json());

    if (res.success) {
      showToast(`✅ Jadwal otomatis (${activities.length} Template) berhasil disimpan!`, "success");
      updateSchedulerStatusBadge(isActive === 1, scheduledTime);
      loadSchedulerConfig();
    } else {
      showToast(res.error || "Gagal menyimpan jadwal.", "error");
    }
  } catch (err) {
    showToast("Kesalahan: " + err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "💾 Simpan Pengaturan Jadwal";
    }
  }
}

async function testRunSchedulerNow() {
  const btn = document.getElementById('btn-test-scheduler');
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Menguji...";
  }

  const targetDate = document.getElementById('sch-target-date') ? document.getElementById('sch-target-date').value : '';
  showToast(`🧪 Menguji eksekusi scheduler untuk tanggal ${targetDate || 'target'}...`, "info");

  try {
    const res = await fetch('/api/schedule/run-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_date: targetDate })
    }).then(r => r.json());

    if (res.success) {
      showToast(`Hasil: ${res.message}`, res.status === 'SUCCESS' ? "success" : "info");
      loadSchedulerConfig();
      fetchProgress();
    } else {
      showToast(res.error || "Uji coba gagal.", "error");
    }
  } catch (e) {
    showToast("Kesalahan uji coba: " + e.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🧪 Uji Jalankan Sekarang";
    }
  }
}

function renderSchedulerLogs(logs) {
  const container = document.getElementById('sch-logs-container');
  if (!container) return;

  if (!logs || logs.length === 0) {
    container.innerHTML = `<div style="font-size: 12px; color: #64748b; font-style: italic; padding: 10px 0;">Belum ada log eksekusi scheduler.</div>`;
    return;
  }

  container.innerHTML = logs.map(l => {
    let badgeColor = '#64748b';
    let badgeBg = '#f1f5f9';
    const safeStatus = escapeHtml(l.status || '');
    if (safeStatus === 'SUCCESS') { badgeColor = '#15803d'; badgeBg = '#dcfce7'; }
    else if (safeStatus === 'SKIPPED' || safeStatus.startsWith('SKIPPED')) { badgeColor = '#b45309'; badgeBg = '#fef3c7'; }
    else if (safeStatus === 'FAILED') { badgeColor = '#b91c1c'; badgeBg = '#fee2e2'; }

    const safeTgl = escapeHtml(l.target_date || '-');
    const safeExec = escapeHtml(l.executed_at || '-');
    const safeMsg = escapeHtml(l.message || l.details || '-');

    return `
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center; font-size: 12px;">
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <div style="font-weight: 700; color: #0f172a;">📅 Tanggal Target: ${safeTgl} <span style="font-size: 11px; font-weight: normal; color: #64748b;">(Waktu Eksekusi: ${safeExec})</span></div>
          <div style="color: #475569;">${safeMsg}</div>
        </div>
        <span style="background: ${badgeBg}; color: ${badgeColor}; padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 11px;">
          ${safeStatus}
        </span>
      </div>
    `;
  }).join('');
}

// ==============================================================================
// 15. FEATURE: REVIEW PERILAKU & VALIDASI KINERJA
// ==============================================================================

async function fetchReviewData(silent = false) {
  try {
    const res = await fetch('/api/review').then(r => r.json());
    if (!res.success) {
      if (!silent) showToast(res.error || "Gagal memuat data review", "error");
      return;
    }

    // Update badges
    const badgeStr = res.badge || "3/3";
    const navBadge = document.getElementById('nav-review-badge');
    const tileBadge = document.getElementById('tile-review-badge');
    const circleBadge = document.getElementById('review-badge-circle');
    if (navBadge) navBadge.textContent = badgeStr;
    if (tileBadge) tileBadge.textContent = badgeStr;
    if (circleBadge) circleBadge.textContent = badgeStr;

    // Update status pill & notice
    const statusPill = document.getElementById('review-status-pill');
    const statusLabel = document.getElementById('review-status-label');
    const noticeDesc = document.getElementById('review-notice-desc');

    if (statusPill && statusLabel) {
      if (res.is_open) {
        statusPill.classList.add('open');
        statusLabel.textContent = `Review Perilaku: TERBUKA (${badgeStr})`;
      } else {
        statusPill.classList.remove('open');
        statusLabel.textContent = `Review Perilaku: ${badgeStr} Selesai`;
      }
    }

    if (noticeDesc && res.notice) {
      noticeDesc.textContent = res.notice;
    }

    // Render Dedicated 1-Click Review Cards
    const allReviewees = res.reviewees || (res.reviewers && res.reviewers.mereview) || [];
    renderReviewTargetCards(allReviewees);

    // Update 360 Matrix
    const rev = res.reviewers || {};
    renderMatrixList('list-review-atas', 'count-atas', rev.atas, 'Belum ada data atasan penilai');

    // Rekan (kiri + kanan / rekan)
    const rekanList = rev.rekan && rev.rekan.length > 0 ? rev.rekan : [...(rev.kiri || []), ...(rev.kanan || [])];
    renderMatrixList('list-review-rekan', 'count-rekan', rekanList, 'Belum ada rekan penilai terdaftar');

    // Bawahan / Diri Sendiri
    const bawahList = (rev.bawah && rev.bawah.length > 0) ? rev.bawah : (rev.pribadi || []);
    renderMatrixList('list-review-bawah', 'count-bawah', bawahList, 'Tidak ada bawahan langsung');
    renderMatrixList('list-review-mereview', 'count-mereview', rev.mereview, 'Tidak ada antrean review yang tertunda', true);

    // Subordinates (Pejabat Penilai)
    const subCard = document.getElementById('review-subordinates-card');
    const subList = document.getElementById('subordinates-list');
    if (subCard && subList) {
      const subs = res.subordinates || [];
      if (subs.length > 0) {
        subCard.style.display = 'block';
        subList.innerHTML = subs.map(s => `
          <div class="matrix-user-item" style="padding: 12px; margin-bottom: 8px;">
            <div>
              <div class="matrix-user-name" style="font-size: 13.5px;">${escapeHtml(s.name || s.peg_nama || 'Pegawai')}</div>
              <div style="font-size: 11px; color: #64748b;">NIP: ${s.nip || s.nip18 || '-'} | ${s.jabatan || s.jabatan_nama || ''}</div>
            </div>
            <a href="https://sipendekar.tangerangkab.go.id/2026/input/aktivitas" target="_blank" rel="noopener noreferrer" class="btn-refresh-review" style="padding: 6px 12px; font-size: 11px; text-decoration: none;">
              <span>Validasi Kinerja</span>
            </a>
          </div>
        `).join('');
      } else {
        subCard.style.display = 'none';
      }
    }

    if (!silent) {
      showToast("Data Review & Validasi berhasil disinkronkan.", "success");
    }
  } catch (err) {
    if (!silent) showToast("Koneksi gagal: " + err.message, "error");
  }
}

function renderReviewTargetCards(reviewees) {
  const container = document.getElementById('review-cards-container');
  const badgeEl = document.getElementById('review-pending-badge');
  if (!container) return;

  const arr = Array.isArray(reviewees) ? reviewees : [];
  window._revieweesMap = window._revieweesMap || {};
  arr.forEach(it => {
    if (it && (it.nip || it.id)) {
      window._revieweesMap[it.nip || it.id] = it;
    }
  });
  const pendingCount = arr.filter(it => !it.is_done && !it.status?.toLowerCase().includes('sudah')).length;

  if (badgeEl) {
    if (pendingCount === 0 && arr.length > 0) {
      badgeEl.textContent = '🎉 Semua Review Telah Selesai';
      badgeEl.style.background = '#dcfce7';
      badgeEl.style.color = '#15803d';
      badgeEl.style.borderColor = '#86efac';
    } else {
      badgeEl.textContent = `${pendingCount} dari ${arr.length} Pegawai Belum Direview`;
      badgeEl.style.background = '#fee2e2';
      badgeEl.style.color = '#dc2626';
      badgeEl.style.borderColor = '#fca5a5';
    }
  }

  if (arr.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 36px 20px; background: #ffffff; border-radius: 16px; border: 1.5px dashed #e2e8f0; color: #64748b;">
        <span style="font-size: 32px; display: block; margin-bottom: 8px;">⏳</span>
        <div style="font-weight: 700; font-size: 14px; color: #334155;">Belum Ada Antrean Review Perilaku</div>
        <div style="font-size: 12px; margin-top: 4px;">Data daftar penilai sedang disinkronkan langsung dari server SiPENDEKAR.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = arr.map(item => {
    const isDone = item.is_done || item.status?.toLowerCase().includes('sudah');
    const fotoUrl = item.foto || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.nama)}&background=ede9fe&color=6d28d9&bold=true`;
    const initial = (item.nama || 'P').charAt(0).toUpperCase();
    const roleBadgeClass = item.hubungan === 'bawahan' ? 'atas' : (item.hubungan === 'rekan' ? 'rekan' : (item.hubungan === 'pribadi' ? 'pribadi' : 'bawah'));
    const reviewUrl = item.review_url || `https://sipendekar.tangerangkab.go.id/2026/review-perilaku/view/${item.id || item.nip}`;

    return `
      <div class="review-person-card ${isDone ? 'completed' : 'pending'}">
        <div class="review-card-top">
          <div class="review-avatar-wrap">
            <img src="${fotoUrl}" alt="${escapeHtml(item.nama)}" class="review-card-avatar" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\'review-avatar-fallback\'>${initial}</div>';">
          </div>
          <div class="review-card-header-info">
            <span class="matrix-role-badge ${roleBadgeClass}" style="margin-bottom: 4px; display: inline-block;">
              ${escapeHtml(item.peran || 'Pegawai')}
            </span>
            <h4 class="review-card-name" title="${escapeHtml(item.nama)}">${escapeHtml(item.nama)}</h4>
            <div class="review-card-nip">NIP: ${escapeHtml(item.nip)}</div>
          </div>
        </div>

        <div class="review-card-jabatan" title="${escapeHtml(item.jabatan)}">
          ${escapeHtml(item.jabatan || 'Pegawai ASN Pemerintah Kabupaten Tangerang')}
        </div>

        <div class="review-card-divider"></div>

        <div class="review-card-bottom">
          <div class="review-card-status-box">
            <span class="review-status-pill-small ${isDone ? 'done' : 'pending'}">
              ${isDone ? '✅ Sudah Direview' : '🔴 Belum Direview'}
            </span>
            <span class="review-progress-note">${item.jumlah || 0}/${item.harus || 7} Core Values</span>
          </div>
          <button type="button" class="btn-review-action ${isDone ? 'done' : 'primary'}" onclick="openReviewModal('${item.nip || item.id}')">
            <span>${isDone ? '👁️ Lihat Penilaian' : '⭐ Nilai Perilaku'}</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function renderMatrixList(listId, countId, items, emptyText, isTarget = false) {
  const listEl = document.getElementById(listId);
  const countEl = document.getElementById(countId);
  const arr = Array.isArray(items) ? items : [];
  window._revieweesMap = window._revieweesMap || {};
  arr.forEach(it => {
    if (it && (it.nip || it.id)) {
      window._revieweesMap[it.nip || it.id] = it;
    }
  });

  if (countEl) countEl.textContent = arr.length;
  if (!listEl) return;

  if (arr.length === 0) {
    listEl.innerHTML = `<div class="matrix-empty">${emptyText}</div>`;
    return;
  }

  listEl.innerHTML = arr.map(item => {
    const name = item.peg_nama || item.name || item.nama || 'Pegawai ASN';
    const nip = item.nip || '-';
    const jabatan = item.jabatan || '';
    const status = item.status || (isTarget ? 'Belum Direview' : 'Terdaftar');
    const isDone = item.is_done || status.toLowerCase().includes('sudah') || status.toLowerCase().includes('selesai');
    const reviewUrl = item.review_url || `https://sipendekar.tangerangkab.go.id/2026/review-perilaku/view/${item.id || item.nip}`;

    return `
      <div class="matrix-user-item" style="display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 12px; margin-bottom: 6px; background: #ffffff; border: 1px solid #f1f0f7; box-shadow: 0 2px 6px rgba(0,0,0,0.02);">
        <div style="flex: 1; min-width: 0;">
          <div class="matrix-user-name" style="font-size: 13px; font-weight: 700; color: #1e1b4b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(name)}</div>
          <div style="font-size: 10.5px; color: #64748b; margin-top: 1px;">NIP: ${escapeHtml(nip)}${jabatan ? ` • ${escapeHtml(jabatan).slice(0, 35)}...` : ''}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          <span class="matrix-user-status ${isDone ? 'done' : 'pending'}" style="font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 8px;">
            ${isDone ? '✅ Selesai' : '⏳ Belum'}
          </span>
          <button type="button" class="btn-review-mini" style="background: ${isDone ? '#f0fdf4' : '#eff6ff'}; color: ${isDone ? '#16a34a' : '#2563eb'}; border: 1px solid ${isDone ? '#bbf7d0' : '#bfdbfe'}; padding: 4px 10px; border-radius: 6px; font-size: 10.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;" onclick="openReviewModal('${nip}')">
            ${isDone ? 'Lihat' : 'Nilai'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}
window.fetchReviewData = fetchReviewData;


// ==============================================================================
// 10. REVIEW PERILAKU INTERACTIVE FORM MODAL
// ==============================================================================
let currentReviewSession = null;

async function openReviewModal(targetNip, maybeNama, maybePeran, maybeJabatan, maybeFoto) {
  const modal = document.getElementById('modal-review-form');
  if (!modal) return;

  const cached = (window._revieweesMap && window._revieweesMap[targetNip]) || {};
  const targetNama = maybeNama || cached.nama || cached.peg_nama || cached.name || 'Pegawai ASN';
  const targetPeran = maybePeran || cached.peran || 'Pegawai';
  const targetJabatan = maybeJabatan || cached.jabatan || 'Pemerintah Kabupaten Tangerang';
  const targetFoto = maybeFoto || cached.foto || '';

  // Setup modal header info
  const nameEl = document.getElementById('review-modal-name');
  const metaEl = document.getElementById('review-modal-meta');
  const roleEl = document.getElementById('review-modal-role');
  const avatarEl = document.getElementById('review-modal-avatar');
  const statusBadge = document.getElementById('review-modal-status-badge');
  const loadingEl = document.getElementById('review-questions-loading');
  const listEl = document.getElementById('review-questions-list');
  const noteEl = document.getElementById('review-footer-note');
  const submitBtn = document.getElementById('btn-submit-review-final');

  if (nameEl) nameEl.textContent = targetNama;
  if (metaEl) metaEl.textContent = `NIP: ${targetNip || '-'} • ${targetJabatan}`;
  if (roleEl) {
    roleEl.textContent = targetPeran;
    const roleLower = (targetPeran || '').toLowerCase();
    roleEl.className = 'matrix-role-badge ' + (roleLower.includes('bawah') ? 'atas' : (roleLower.includes('rekan') ? 'rekan' : (roleLower.includes('pribadi') ? 'pribadi' : 'bawah')));
  }
  if (avatarEl) {
    const avatarSrc = targetFoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(targetNama || 'P')}&background=ede9fe&color=6d28d9&bold=true`;
    avatarEl.src = avatarSrc;
  }

  // Reset modal state
  currentReviewSession = {
    targetNip,
    targetNama,
    targetPeran,
    csrfToken: null,
    isSubmitted: false,
    questions: [],
    ratings: {}
  };

  if (statusBadge) {
    statusBadge.textContent = 'Memuat...';
    statusBadge.style.background = '#f1f5f9';
    statusBadge.style.color = '#64748b';
  }
  if (noteEl) noteEl.innerHTML = '💡 Setiap pilihan nilai otomatis tersimpan langsung ke server SiPENDEKAR.';
  if (submitBtn) {
    submitBtn.style.display = 'inline-flex';
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.6';
    submitBtn.style.cursor = 'not-allowed';
    submitBtn.innerHTML = '<span>🚀 Selesaikan & Kirim Review</span>';
  }

  updateReviewModalProgress();

  if (loadingEl) loadingEl.style.display = 'block';
  if (listEl) listEl.innerHTML = '';

  modal.classList.add('active');
  modal.style.display = 'flex';

  // Fetch 7 questions from backend API
  try {
    const resp = await fetch(`/api/review/form/${encodeURIComponent(targetNip)}`);
    const data = await resp.json();

    if (!data.success) {
      if (loadingEl) loadingEl.style.display = 'none';
      if (listEl) {
        listEl.innerHTML = `
          <div style="text-align: center; padding: 30px 16px; color: #dc2626; background: #fef2f2; border-radius: 14px; border: 1px solid #fecaca;">
            <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px;">Gagal Memuat Formulir Review</div>
            <div style="font-size: 12px; color: #64748b;">${escapeHtml(data.error || 'Terjadi kesalahan saat memuat form.')}</div>
          </div>
        `;
      }
      return;
    }

    currentReviewSession.csrfToken = data.csrf_token;
    currentReviewSession.isSubmitted = Boolean(data.is_submitted);
    currentReviewSession.questions = data.questions || [];

    // Prepopulate existing ratings
    currentReviewSession.questions.forEach(q => {
      if (q.selected_value !== null && q.selected_value !== undefined && q.selected_value !== '') {
        currentReviewSession.ratings[q.id] = String(q.selected_value);
      }
    });

    if (loadingEl) loadingEl.style.display = 'none';

    renderReviewQuestions(currentReviewSession);
    updateReviewModalProgress();

  } catch (err) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (listEl) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 30px 16px; color: #dc2626; background: #fef2f2; border-radius: 14px; border: 1px solid #fecaca;">
          <div style="font-weight: 700; font-size: 14px;">Terjadi Kesalahan Jaringan</div>
          <div style="font-size: 12px; color: #64748b; margin-top: 4px;">${escapeHtml(err.message)}</div>
        </div>
      `;
    }
  }
}

function renderReviewQuestions(session) {
  const listEl = document.getElementById('review-questions-list');
  const statusBadge = document.getElementById('review-modal-status-badge');
  const noteEl = document.getElementById('review-footer-note');
  const submitBtn = document.getElementById('btn-submit-review-final');
  if (!listEl) return;

  const isLocked = session.isSubmitted;

  if (statusBadge) {
    if (isLocked) {
      statusBadge.textContent = '✅ Sudah Direview (Final)';
      statusBadge.style.background = '#dcfce7';
      statusBadge.style.color = '#15803d';
    } else {
      statusBadge.textContent = '📝 Siap Dinilai';
      statusBadge.style.background = '#e0f2fe';
      statusBadge.style.color = '#0369a1';
    }
  }

  if (isLocked) {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.7';
      submitBtn.style.cursor = 'default';
      submitBtn.style.background = '#10b981';
      submitBtn.innerHTML = '<span>✅ Penilaian Final Telah Terkirim</span>';
    }
    if (noteEl) {
      noteEl.innerHTML = '🔒 Penilaian ini telah difinalisasi di portal SiPENDEKAR dan tidak dapat diubah lagi.';
    }
  }

  listEl.innerHTML = session.questions.map(q => {
    const curVal = session.ratings[q.id];
    const isAnswered = curVal !== undefined && curVal !== null && curVal !== '';

    const optionsHtml = (q.options || []).map(opt => {
      const isSelected = String(curVal) === String(opt.value);
      return `
        <button type="button" 
          class="rating-pill-btn ${isSelected ? 'active' : ''} ${isLocked ? 'locked' : ''}" 
          id="btn-pill-${q.number}-${opt.value}"
          data-qnum="${q.number}" 
          data-qid="${q.id}" 
          data-val="${opt.value}"
          title="${escapeHtml(opt.desc || opt.label)}"
          onclick="selectRatingPill(${q.number}, '${q.id}', '${opt.value}')">
          <div class="rating-pill-num">${opt.value}</div>
          <div class="rating-pill-label">${escapeHtml(opt.label)}</div>
        </button>
      `;
    }).join('');

    return `
      <div class="review-q-card ${isAnswered ? 'answered' : ''}" id="review-q-card-${q.number}">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span class="review-q-category">${escapeHtml(q.category || 'CORE VALUES ASN')}</span>
          <span style="font-size: 11px; font-weight: 700; color: #64748b;">Aspek ${q.number} dari 7</span>
        </div>
        <div class="review-q-text">${q.number}. ${escapeHtml(q.question)}</div>
        <div class="review-rating-pills">
          ${optionsHtml}
        </div>
      </div>
    `;
  }).join('');
}

async function selectRatingPill(qNum, qId, val) {
  if (!currentReviewSession || currentReviewSession.isSubmitted) return;

  currentReviewSession.ratings[qId] = String(val);

  // Update visual selection inside this question
  const cardEl = document.getElementById(`review-q-card-${qNum}`);
  if (cardEl) {
    cardEl.classList.add('answered');
    const pills = cardEl.querySelectorAll('.rating-pill-btn');
    pills.forEach(p => {
      if (p.getAttribute('data-val') === String(val)) {
        p.classList.add('active');
      } else {
        p.classList.remove('active');
      }
    });
  }

  updateReviewModalProgress();

  // Auto-save to SiPENDEKAR
  const indicator = document.getElementById('review-modal-autosave-indicator');
  if (indicator) {
    indicator.innerHTML = '<span style="display:inline-block;width:7px;height:7px;background:#f59e0b;border-radius:50%;animation:spin 1s infinite;"></span><span>Menyimpan...</span>';
    indicator.style.color = '#d97706';
  }

  try {
    const res = await fetch('/api/review/save-rating', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_nip: currentReviewSession.targetNip,
        question_id: qId,
        rating_val: String(val),
        csrf_token: currentReviewSession.csrfToken
      })
    });
    const result = await res.json();
    if (result.success) {
      if (indicator) {
        indicator.innerHTML = '<span style="display:inline-block;width:7px;height:7px;background:#10b981;border-radius:50%;"></span><span>Tersimpan di SiPENDEKAR</span>';
        indicator.style.color = '#10b981';
      }
    } else {
      if (indicator) {
        indicator.innerHTML = '<span style="display:inline-block;width:7px;height:7px;background:#ef4444;border-radius:50%;"></span><span>Gagal simpan</span>';
        indicator.style.color = '#ef4444';
      }
      showToast("Auto-save gagal: " + (result.error || "Coba lagi"), "error");
    }
  } catch (err) {
    if (indicator) {
      indicator.innerHTML = '<span style="display:inline-block;width:7px;height:7px;background:#ef4444;border-radius:50%;"></span><span>Koneksi offline</span>';
      indicator.style.color = '#ef4444';
    }
  }
}

function updateReviewModalProgress() {
  if (!currentReviewSession) return;

  const total = (currentReviewSession.questions || []).length || 7;
  const answeredCount = Object.keys(currentReviewSession.ratings || {}).length;
  const pct = Math.min(100, Math.round((answeredCount / total) * 100));

  const textEl = document.getElementById('review-modal-progress-text');
  const barEl = document.getElementById('review-modal-progress-bar');
  const submitBtn = document.getElementById('btn-submit-review-final');

  if (textEl) textEl.textContent = `${answeredCount} / ${total} Terisi`;
  if (barEl) barEl.style.width = `${pct}%`;

  if (submitBtn && !currentReviewSession.isSubmitted) {
    if (answeredCount >= total && total > 0) {
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
      submitBtn.style.cursor = 'pointer';
      submitBtn.style.background = 'linear-gradient(135deg, #7c3aed, #6d28d9)';
      submitBtn.innerHTML = '<span>🚀 Selesaikan & Kirim Review Final</span>';
    } else {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.6';
      submitBtn.style.cursor = 'not-allowed';
      submitBtn.innerHTML = `<span>🚀 Isi ${total - answeredCount} Aspek Lagi</span>`;
    }
  }
}

async function submitCurrentReviewFinal() {
  if (!currentReviewSession || currentReviewSession.isSubmitted) return;

  const questions = currentReviewSession.questions || [];
  const total = questions.length;
  const answeredCount = Object.keys(currentReviewSession.ratings || {}).length;

  if (answeredCount < total) {
    showToast(`Mohon isi seluruh ${total} aspek Core Values BerAKHLAK terlebih dahulu.`, "warning");
    return;
  }

  const confirmMsg = `Konfirmasi Penilaian Final:\n\nApakah Anda yakin ingin menyelesaikan dan mengirimkan hasil penilaian evaluasi perilaku kerja untuk:\n\nPegawai: ${currentReviewSession.targetNama}\nNIP: ${currentReviewSession.targetNip}\n\nPERHATIAN: Setelah disubmit ke portal SiPENDEKAR, evaluasi bersifat permanen dan tidak dapat diubah lagi.`;

  if (!confirm(confirmMsg)) return;

  const submitBtn = document.getElementById('btn-submit-review-final');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳ Mengirim ke SiPENDEKAR...</span>';
  }

  const orderedRatings = [];
  const orderedIds = [];
  questions.forEach(q => {
    orderedIds.push(q.id);
    orderedRatings.push(currentReviewSession.ratings[q.id]);
  });

  try {
    const res = await fetch('/api/review/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_nip: currentReviewSession.targetNip,
        ratings: orderedRatings,
        question_ids: orderedIds,
        csrf_token: currentReviewSession.csrfToken
      })
    });
    const result = await res.json();

    if (result.success) {
      showToast("🎉 Penilaian perilaku kerja berhasil diselesaikan dan dikirim ke SiPENDEKAR!", "success");
      closeModal('modal-review-form');
      fetchReviewData(); // refresh cards and badge counts on the main page
    } else {
      showToast("Gagal submit review: " + (result.error || "Silakan coba beberapa saat lagi."), "error");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>🚀 Selesaikan & Kirim Review Final</span>';
      }
    }
  } catch (err) {
    showToast("Kesalahan koneksi saat submit: " + err.message, "error");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>🚀 Selesaikan & Kirim Review Final</span>';
    }
  }
}

window.openReviewModal = openReviewModal;
window.selectRatingPill = selectRatingPill;
window.submitCurrentReviewFinal = submitCurrentReviewFinal;
