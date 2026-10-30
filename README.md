# 💬 SiPENDEKAR Assistant - Modern Messenger Edition (Cerah & Multi-User Terisolasi)

Aplikasi web modern dengan gaya antarmuka **Messenger cerah (*bright light mode*)** yang dirancang khusus untuk mempermudah pegawai ASN Kabupaten Tangerang dalam melakukan pengisian, pemantauan progres, pemilihan kegiatan SKP, dan otomasi laporan e-Kinerja **SiPENDEKAR**.

---

## 🌟 Fitur Utama

1. **🎨 Tampilan Messenger Cerah & Modern (Light Theme)**:
   - Desain bersih dan terang terinspirasi oleh **Facebook Messenger** dan **Telegram Desktop/Mobile**.
   - Dominasi warna putih bersih (`#ffffff`), abu-abu lembut (`#f0f2f5`), dan gradien biru Messenger yang cerah (`#0084ff` hingga `#00c6ff`).
   - Gelembung obrolan modern (*chat bubbles*) dengan sudut membulat 18px.
   - Dukungan tampilan **Mobile App** (terpusat elegan) dan tombol **🖥️ Widescreen Mode** untuk layar desktop/laptop.

2. **🔒 Multi-User Terisolasi Penuh (Privasi Akun Terjamin)**:
   - **Login Sesuai Akun Masing-Masing**: Setiap pegawai login menggunakan NIP & Password SiPENDEKAR masing-masing.
   - **Data Bersifat Privat**: Pengguna **TIDAK BISA** melihat akun, obrolan, progres, maupun data laporan rekan kerja lainnya.
   - **Enkripsi Kredensial**: Password disimpan dengan standar enkripsi **AES Fernet Encryption** di database lokal SQLite (`calo_data.db`).
   - Dilengkapi tombol **Keluar / Logout** yang aman.

3. **💬 Obrolan Asisten Interaktif & Kartu Widget**:
   - Chatbot asisten yang ramah untuk diajak berbicara seputar e-Kinerja.
   - Menampilkan **Kartu Widget Interaktif Langsung di Obrolan**:
     - *Kartu Progres*: Ringkasan menit terisi hari ini & tombol buka kalender.
     - *Kartu Hari Bolong H-7*: Daftar tanggal yang belum terisi lengkap dengan tombol `⚡ Auto-Fill Semua Hari Bolong`.
   - **Tombol Pintas Cepat (*Quick Action Chips*)**:
     - `⚡ Auto-Fill H-7`
     - `📊 Cek Progres`
     - `📅 Hari Bolong`
     - `📋 Pilih Kegiatan`
     - `🗓️ Kalender`

4. **📊 Tab Progres & Kalender Bulanan**:
   - **Cincin Persentase Capaian**: Meteran lingkaran visual keterisian hari kerja bulan aktif.
   - **Kotak Peringatan H-7 Mendesak**: Menyoroti tanggal-tanggal kosong dalam batas 7 hari ke belakang agar tidak terkunci oleh sistem BKPSDM.
   - **Kalender Interaktif**: Warna cerah yang informatif (🟢 Hijau Mint = Terisi, 🔴 Merah Muda = Kosong bisa diisi, Abu-abu = Libur/Lewat batas).
   - Klik tanggal manapun untuk melihat rincian aktivitas atau mengisi laporan secara instan.

5. **📋 Tab Pilih Kegiatan Sendiri & SKP Dinamis**:
   - **Katalog 2.123 Kegiatan SiPENDEKAR**: Pencarian instan dengan filter kategori (*UTAMA*, *Pelayanan*, *TI*, *Administrasi*).
   - **Auto-Fetch SKP Portal**: Begitu kegiatan dipilih, aplikasi langsung mengambil daftar **Sasaran Kinerja Pegawai (SKP)** yang valid untuk akun ASN yang sedang login langsung dari server SiPENDEKAR.
   - **Kalkulator Durasi Otomatis**: Pengaturan jam kerja (misal `07:30` s/d `17:30` = 600 Menit / 10 Jam) dengan volume dan uraian tugas.

6. **📜 Tab Riwayat Laporan**:
   - Menampilkan catatan riwayat pengisian laporan yang telah dilakukan oleh akun pengguna yang sedang login.

---

## 🚀 Cara Menjalankan

### Cara 1: Menggunakan Berkas BAT (1-Klik)
Cukup klik ganda:
👉 **`run.bat`**
Browser Anda akan otomatis terbuka mengarah ke: `http://127.0.0.1:5050`

### Cara 2: Melalui Terminal / Command Prompt
```bash
cd c:\project\sipendekarcalo
python app.py
```
Akses di browser: `http://127.0.0.1:5050`

---

## 📁 Struktur Berkas

```
c:\project\sipendekarcalo\
├── app.py                     # Server Flask, REST API, & Multi-Session Pool
├── database.py                # Database SQLite privat (users, chat, activity logs)
├── sipendekar_api.py          # Client API portal resmi SiPENDEKAR
├── activities_catalog.json    # Database 2.123 katalog kegiatan
├── run.bat                    # Script launcher 1-klik Windows
├── templates/
│   └── index.html             # Tampilan web Messenger cerah
├── static/
│   ├── css/
│   │   └── messenger.css      # Desain tema Messenger cerah & modern light mode
│   └── js/
│       └── messenger_app.js   # Logika chat asisten, widget cards, SKP dinamis, & kalender
└── README.md                  # Panduan lengkap
```
