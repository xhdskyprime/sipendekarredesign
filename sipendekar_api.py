"""
sipendekar_api.py - Client API untuk Sistem Informasi Penilaian Dedikasi dan Kinerja AparatuR (SiPENDEKAR)
Kabupaten Tangerang.
"""

import re
import json
import logging
from datetime import datetime, date, timedelta
from typing import Dict, List, Optional, Any, Tuple, Union
import requests
from bs4 import BeautifulSoup
import urllib3

logger = logging.getLogger("SipendekarAPI")

class SipendekarAPI:
    def __init__(self, base_url: str = "https://sipendekar.tangerangkab.go.id/2026", user_agent: Optional[str] = None, verify_ssl: bool = True):
        self.base_url = base_url.rstrip("/")
        self.verify_ssl = verify_ssl
        if not verify_ssl:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        self.session = requests.Session()
        self.user_agent = user_agent or (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
        self.session.headers.update({
            "User-Agent": self.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "id,en-US;q=0.7,en;q=0.3",
        })
        self.csrf_token: Optional[str] = None
        self.user_nip: Optional[str] = None
        self.user_name: str = ""
        self.user_jabatan: str = ""
        self.user_photo: str = ""
        self.is_logged_in: bool = False
        self._activities_cache: Optional[List[Dict[str, Any]]] = None

    def get_login_token(self) -> str:
        """Mengambil CSRF token awal dari halaman login."""
        login_url = f"{self.base_url}/login"
        resp = self.session.get(login_url, verify=self.verify_ssl, timeout=20)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        token_input = soup.find("input", {"name": "_token"})
        if not token_input or not token_input.get("value"):
            raise ValueError("Gagal menemukan input CSRF _token pada halaman login.")
        return token_input["value"]

    def login(self, username: str, password: str, fingerprint: str = "09a160f689f48ed27b96d6f2fbbeec79") -> bool:
        """
        Login ke SiPENDEKAR menggunakan NIP dan Password.
        """
        token = self.get_login_token()
        login_url = f"{self.base_url}/login"
        payload = {
            "_token": token,
            "fingerprint": fingerprint,
            "username": username,
            "password": password
        }

        resp = self.session.post(
            login_url,
            data=payload,
            headers={"Referer": login_url},
            allow_redirects=True,
            verify=self.verify_ssl,
            timeout=25
        )

        # Cek apakah diarahkan ke dashboard atau berhasil login
        # Bila gagal login, response biasanya tetap di /login dengan alert error
        if "/login" in resp.url and "Dashboard" not in resp.text:
            self.is_logged_in = False
            return False

        self.is_logged_in = True
        self.user_nip = username

        self._username = username
        self._password = password
        self._fingerprint = fingerprint

        # CSRF token dan profil akan di-refresh secara on-demand saat dibutuhkan
        return True

    def is_session_valid(self) -> bool:
        """Mengecek apakah sesi login masih aktif di SiPENDEKAR tanpa ter-redirect ke /login."""
        if not self.is_logged_in:
            return False
        try:
            resp = self.session.get(f"{self.base_url}/input/aktivitas", allow_redirects=False, verify=self.verify_ssl, timeout=10)
            return resp.status_code == 200
        except Exception:
            return False

    def relogin(self) -> bool:
        """Melakukan login ulang secara otomatis menggunakan kredensial yang tersimpan."""
        if hasattr(self, "_username") and hasattr(self, "_password"):
            return self.login(self._username, self._password, getattr(self, "_fingerprint", "09a160f689f48ed27b96d6f2fbbeec79"))
        return False

    def refresh_csrf_token(self) -> str:
        """Mengambil CSRF token terbaru dari halaman aktivitas."""
        act_url = f"{self.base_url}/input/aktivitas"
        resp = self.session.get(act_url, verify=self.verify_ssl, timeout=25)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        token_input = soup.find("input", {"name": "_token"})
        if token_input and token_input.get("value"):
            self.csrf_token = token_input["value"]
        else:
            # Fallback ke meta tag
            meta_token = soup.find("meta", {"name": "csrf-token"})
            if meta_token and meta_token.get("content"):
                self.csrf_token = meta_token["content"]

        # Parse profile header: nama, jabatan, foto resmi dari portal SiPENDEKAR
        prof_header = soup.select_one(".profile-header, a.profile-header")
        if prof_header:
            b_tag = prof_header.find("b")
            if b_tag and b_tag.text.strip():
                self.user_name = b_tag.text.strip()
            jabatan_tag = prof_header.find("span", style=lambda s: s and "font-size" in s)
            if jabatan_tag and jabatan_tag.text.strip():
                self.user_jabatan = jabatan_tag.text.strip()
            img_tag = prof_header.find("img")
            if img_tag and img_tag.get("src"):
                self.user_photo = img_tag["src"]

        # Cache aktivitas jika tersedia di halaman
        if not self._activities_cache:
            m = re.search(r'<pilih-aktivitas[^>]*:items=\'(\[.*?\])\'', resp.text, re.DOTALL)
            if m:
                try:
                    self._activities_cache = json.loads(m.group(1))
                except Exception as e:
                    logger.warning(f"Gagal mem-parse katalog aktivitas dari HTML: {e}")

        return self.csrf_token or ""

    def get_user_profile(self) -> Dict[str, str]:
        """Mengambil profil resmi pegawai (nama, jabatan, foto) langsung dari portal SiPENDEKAR."""
        if not self.user_name:
            self.refresh_csrf_token()
        return {
            "name": self.user_name or (f"Pegawai ASN {self.user_nip}" if self.user_nip else "Pegawai ASN"),
            "jabatan": self.user_jabatan,
            "photo": self.user_photo
        }

    def get_activities_catalog(self) -> List[Dict[str, Any]]:
        """Mengambil seluruh daftar katalog aktivitas yang tersedia."""
        if self._activities_cache:
            return self._activities_cache
        self.refresh_csrf_token()
        return self._activities_cache or []

    def search_catalog(self, keyword: str, limit: int = 15) -> List[Dict[str, Any]]:
        """Mencari kegiatan di katalog berdasarkan kata kunci."""
        catalog = self.get_activities_catalog()
        keyword_lower = keyword.lower()
        results = []
        for item in catalog:
            nama = item.get("nama_aktifitas", "").lower()
            kode = item.get("kode_aktifitas", "").lower()
            if keyword_lower in nama or keyword_lower in kode:
                results.append(item)
                if len(results) >= limit:
                    break
        return results

    def get_skp(self, kode_aktivitas: str) -> List[Dict[str, Any]]:
        """
        Mengambil Sasaran Kinerja Pegawai (SKP) yang valid untuk kode aktivitas tertentu.
        Returns: list of dict {'id': int, 'nama': str}
        """
        url = f"{self.base_url}/input/getKegiatan"
        headers = {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": f"{self.base_url}/input/aktivitas"
        }
        resp = self.session.get(url, params={"kode_aktivitas": kode_aktivitas}, headers=headers, verify=self.verify_ssl, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        skp_list = []
        s_ids = data.get("sasaran_kerja_id", [])
        s_names = data.get("nama_skp", [])
        for sid, name in zip(s_ids, s_names):
            if sid != 0 and name != "-":
                skp_list.append({
                    "id": sid,
                    "nama": name,
                    "nama_skp": name,
                    "sasaran_kerja": name,
                    "uraian": name
                })
        return skp_list

    def get_aktivitas_harian(self, tanggal: str, jenis: str = "kinerja") -> List[Dict[str, Any]]:
        """
        Mengambil daftar aktivitas yang sudah diisi pada tanggal tertentu.
        tanggal: Format YYYY-MM-DD
        """
        url = f"{self.base_url}/input/getaktivitastampil"
        headers = {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": f"{self.base_url}/input/aktivitas"
        }
        resp = self.session.get(url, params={"tanggal": tanggal, "jenis": jenis}, headers=headers, verify=self.verify_ssl, timeout=15)
        resp.raise_for_status()
        return resp.json()

    def get_activity_standard_time(self, kode: str) -> int:
        """Mengambil durasi menit standar (waktu) dari kode aktivitas."""
        catalog = self.get_activities_catalog()
        if not catalog:
            cat_file = os.path.join(os.path.dirname(__file__), "activities_catalog.json")
            if os.path.exists(cat_file):
                try:
                    with open(cat_file, "r", encoding="utf-8") as f:
                        catalog = json.load(f)
                except Exception:
                    pass
        if catalog:
            for item in catalog:
                if item.get("kode_aktifitas") == kode:
                    return int(item.get("waktu") or 0)
        return 0

    def get_total_menit_harian(self, tanggal: str) -> Tuple[int, List[Dict[str, Any]]]:
        """
        Menghitung total menit kegiatan yang sudah dilaporkan pada tanggal tertentu.
        Sesuai portal SiPENDEKAR: dihitung dari jumlah menit kegiatan (waktu standar) x volume laporan.
        Returns: (total_menit, list_detail_kegiatan)
        """
        data = self.get_aktivitas_harian(tanggal, jenis="kinerja")
        total_menit = 0
        detail = []
        for item in data:
            nama = item.get("nama_aktifitas", "")
            kode = item.get("kode_aktifitas", "")
            waktu_standar = int(item.get("waktu") or 0)
            if waktu_standar == 0 and kode:
                waktu_standar = self.get_activity_standard_time(kode)

            for isi in item.get("isi_aktifitas", []):
                vol = int(isi.get("volume") or 1)
                jam_m = isi.get("jam_mulai", 0)
                menit_m = isi.get("menit_mulai", 0)
                jam_s = isi.get("jam_selesai", 0)
                menit_s = isi.get("menit_selesai", 0)

                # Menit kegiatan di SiPENDEKAR: menit standar x volume
                if waktu_standar > 0:
                    durasi = waktu_standar * vol
                else:
                    durasi = ((jam_s * 60) + menit_s) - ((jam_m * 60) + menit_m)

                total_menit += durasi
                raw_status = isi.get("status")
                is_approved = (raw_status == "valid")
                is_rejected = (raw_status == "invalid")
                status_appr = "approved" if is_approved else ("rejected" if is_rejected else "proses")
                bisa_edit = not is_approved

                detail.append({
                    "id": isi.get("id"),
                    "kode_aktifitas": kode,
                    "nama_aktifitas": nama,
                    "volume": vol,
                    "waktu_standar": waktu_standar,
                    "keterangan": isi.get("keterangan", ""),
                    "durasi_menit": durasi,
                    "jam_mulai": f"{jam_m:02d}:{menit_m:02d}",
                    "jam_selesai": f"{jam_s:02d}:{menit_s:02d}",
                    "sasaran_kerja_id": isi.get("sasaran_kerja_id"),
                    "status_raw": raw_status,
                    "status_approval": status_appr,
                    "bisa_edit": bisa_edit
                })
        return total_menit, detail

    def get_total_menit_bulanan(self, timeout: int = 4) -> Dict[str, Any]:
        """
        Mengambil total menit pengisian bulan ini langsung dari portal SiPENDEKAR.
        Data ini mencakup:
        - Total Menit Aktivitas Utama Bulan ini
        - Total Menit Aktivitas Tambahan Bulan ini
        - Total Menit Minimal Bulan ini (Target BKPSDM)
        """
        try:
            resp = self.session.get(f"{self.base_url}/input/aktivitas", verify=self.verify_ssl, timeout=timeout)
            text = resp.text

            m_utama = re.search(r'Total\s+[Mm]enit\s+Aktivitas\s+Utama\s+[Bb]ulan\s+ini:\s*(\d+)', text)
            m_tambahan = re.search(r'Total\s+[Mm]enit\s+Aktivitas\s+Tambahan\s+[Bb]ulan\s+ini:\s*(\d+)', text)
            m_minimal = re.search(r'Total\s+Menit\s+Minimal\s+[Bb]ulan\s+ini:\s*(\d+)', text)

            utama = int(m_utama.group(1)) if m_utama else 0
            tambahan = int(m_tambahan.group(1)) if m_tambahan else 0
            minimal = int(m_minimal.group(1)) if m_minimal else 7920
            total = utama + tambahan

            return {
                "utama": utama,
                "tambahan": tambahan,
                "total": total,
                "minimal": minimal,
                "tercapai": total >= minimal if minimal > 0 else True
            }
        except Exception as e:
            logger.warning(f"Gagal mengambil total menit bulanan dari portal: {e}")
            return {
                "utama": 0,
                "tambahan": 0,
                "total": 0,
                "minimal": 7920,
                "tercapai": False
            }

    def get_kalender_bulan(self, tahun: int, bulan: int, timeout: int = 4) -> Dict[str, Any]:
        """
        Melihat rekap kalender per bulan dari SiPENDEKAR.
        """
        # Timestamp awal dan akhir bulan (UTC timestamp in milliseconds)
        dt_from = datetime(tahun, bulan, 1)
        if bulan == 12:
            dt_to = datetime(tahun + 1, 1, 1) - timedelta(days=1)
        else:
            dt_to = datetime(tahun, bulan + 1, 1) - timedelta(days=1)

        ts_from = int(dt_from.timestamp() * 1000)
        ts_to = int(dt_to.timestamp() * 1000)

        url = f"{self.base_url}/input/getValueCal"
        params = {
            "from": ts_from,
            "to": ts_to,
            "utc_offset_from": -420,
            "utc_offset_to": -420
        }
        headers = {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": f"{self.base_url}/input/aktivitas"
        }
        resp = self.session.get(url, params=params, headers=headers, verify=self.verify_ssl, timeout=timeout)
        resp.raise_for_status()
        return resp.json()

    def isi_aktivitas(
        self,
        tanggal: str,
        kode_aktifitas: str,
        volume: int,
        keterangan: str,
        sasaran_kerja_id: int,
        jam_mulai: str,
        menit_mulai: str,
        jam_selesai: str,
        menit_selesai: str,
        jenis: str = "kinerja",
        nip18: Optional[str] = None,
        id_input: Optional[Union[str, int]] = None
    ) -> Dict[str, Any]:
        """
        Mengirim laporan aktivitas harian.
        tanggal: YYYY-MM-DD
        jam_mulai: "07", menit_mulai: "00", dst.
        """
        if not self.csrf_token:
            self.refresh_csrf_token()

        url = f"{self.base_url}/input/isiaktifitas"
        headers = {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-CSRF-TOKEN": self.csrf_token,
            "X-Requested-With": "XMLHttpRequest",
            "Referer": f"{self.base_url}/input/aktivitas"
        }

        payload = {
            "tanggal": tanggal,
            "nip18": nip18 or self.user_nip or "",
            "kode_aktifitas": kode_aktifitas,
            "kode_kegiatan": "",
            "volume": str(volume),
            "keterangan": keterangan,
            "tupoksi": "",
            "sasaran_kerja_id": str(sasaran_kerja_id),
            "jenis": jenis,
            "jam_mulai": str(jam_mulai).zfill(2),
            "jam_selesai": str(jam_selesai).zfill(2),
            "menit_mulai": str(menit_mulai).zfill(2),
            "menit_selesai": str(menit_selesai).zfill(2),
            "id_input": str(id_input) if id_input else ""
        }

        resp = self.session.post(url, data=payload, headers=headers, verify=self.verify_ssl, timeout=20)
        resp.raise_for_status()
        result = resp.json()
        return result

    def hapus_aktivitas(self, id_laporan: int) -> Dict[str, Any]:
        """
        Membatalkan/menghapus laporan aktivitas berdasarkan ID.
        """
        if not self.csrf_token:
            self.refresh_csrf_token()

        url = f"{self.base_url}/input/hapusaktifitas"
        headers = {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-CSRF-TOKEN": self.csrf_token,
            "X-Requested-With": "XMLHttpRequest",
            "Referer": f"{self.base_url}/input/aktivitas"
        }

        payload = {"id": str(id_laporan)}
        resp = self.session.post(url, data=payload, headers=headers, verify=self.verify_ssl, timeout=20)
        resp.raise_for_status()
        return resp.json()

    def cari_hari_kosong(
        self,
        start_date: date,
        end_date: date,
        skip_weekends: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Memindai rentang tanggal untuk menemukan hari kerja yang belum ada laporannya.
        Dioptimalkan menggunakan get_kalender_bulan (1 single HTTP request) untuk kecepatan kilat.
        """
        filled_dates = set()
        try:
            # Ambil data bulan dari start_date dan end_date
            months_to_fetch = set([(start_date.year, start_date.month), (end_date.year, end_date.month)])
            for yr, mo in months_to_fetch:
                cal = self.get_kalender_bulan(yr, mo)
                for ev in cal.get("result", []):
                    start_ms = ev.get("start")
                    if start_ms:
                        d = datetime.fromtimestamp(start_ms / 1000).date()
                        filled_dates.add(d.strftime("%Y-%m-%d"))
        except Exception as e:
            logger.warning(f"Gagal mengambil kalender cepat: {e}, fallback ke per-hari")

        curr = start_date
        empty_days = []
        hari_id = {
            "Monday": "Senin", "Tuesday": "Selasa", "Wednesday": "Rabu",
            "Thursday": "Kamis", "Friday": "Jumat", "Saturday": "Sabtu", "Sunday": "Minggu"
        }
        while curr <= end_date:
            is_weekend = curr.weekday() in (5, 6) # Sabtu=5, Minggu=6
            if skip_weekends and is_weekend:
                curr += timedelta(days=1)
                continue

            tgl_str = curr.strftime("%Y-%m-%d")
            # Jika kalender cepat tersedia
            if filled_dates or hasattr(self, "_cal_fetched"):
                is_empty = tgl_str not in filled_dates
            else:
                total_menit, detail = self.get_total_menit_harian(tgl_str)
                is_empty = len(detail) == 0

            if is_empty:
                day_name_en = curr.strftime("%A")
                empty_days.append({
                    "tanggal": tgl_str,
                    "hari": day_name_en,
                    "hari_nama": hari_id.get(day_name_en, day_name_en),
                    "status": "Kosong",
                    "total_menit": 0,
                    "urgensi_hari": (date.today() - curr).days
                })
            curr += timedelta(days=1)

        return empty_days

    def get_review_summary(self) -> Dict[str, Any]:
        """
        Mengambil informasi status Review dari portal SiPENDEKAR:
        1. Badge status review (misal: '3/3')
        2. Status pembukaan fitur review perilaku
        3. Struktur reviewer 360 (atas, kiri, kanan, bawah, mereview)
        4. Data bawahan untuk verifikasi aktivitas (jika pejabat penilai)
        """
        badge = "3/3"
        notice = "Fitur review perilaku dibuka berkala oleh BKPSDM setiap awal bulan."
        is_open = False
        reviewers = {"atas": [], "kiri": [], "kanan": [], "bawah": [], "mereview": []}
        subordinates = []

        try:
            # 1. Cek badge di halaman aktivitas / dashboard
            resp_act = self.session.get(f"{self.base_url}/input/aktivitas", timeout=6, verify=self.verify_ssl)
            if resp_act.status_code == 200:
                m = re.search(r'review-perilaku.*?Review\s*<span[^>]*>([\d/]+)</span>', resp_act.text)
                if m:
                    badge = m.group(1).strip()

            # 2. Cek halaman /review-perilaku
            resp_rev = self.session.get(f"{self.base_url}/review-perilaku", timeout=6, verify=self.verify_ssl)
            if resp_rev.status_code == 200:
                text_rev = resp_rev.text
                if "Fitur belum dibuka" in text_rev or "tunggu sampai" in text_rev:
                    is_open = False
                    m_msg = re.search(r'(Fitur belum dibuka[^\.\<]+[\.\<])', text_rev)
                    if m_msg:
                        notice = m_msg.group(1).replace("<", "").strip()
                    else:
                        notice = "Fitur belum dibuka. Silakan tunggu sampai tanggal 1."
                else:
                    is_open = True
                    notice = "Fitur Review Perilaku sedang terbuka. Anda dapat melakukan penilaian."

            # 3. Cek struktur reviewer
            resp_peer = self.session.get(f"{self.base_url}/pegawai/get-reviewer", headers={"X-Requested-With": "XMLHttpRequest"}, timeout=6, verify=self.verify_ssl)
            if resp_peer.status_code == 200:
                try:
                    reviewers = resp_peer.json() or reviewers
                except Exception:
                    pass

            # 4. Cek apakah memiliki bawahan (Pejabat Penilai)
            resp_sub = self.session.get(f"{self.base_url}/verifikasi-ketercapaian/getpegawai", headers={"X-Requested-With": "XMLHttpRequest"}, timeout=6, verify=self.verify_ssl)
            if resp_sub.status_code == 200:
                try:
                    subordinates = resp_sub.json() or []
                except Exception:
                    subordinates = []

        except Exception as e:
            logger.warning(f"Error fetching review summary: {e}")

        return {
            "success": True,
            "badge": badge,
            "is_open": is_open,
            "notice": notice,
            "reviewers": reviewers,
            "subordinates": subordinates,
            "portal_review_url": f"{self.base_url}/review-perilaku"
        }
