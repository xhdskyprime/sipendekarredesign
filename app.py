"""
app.py - Backend Server untuk SiPENDEKAR Messenger Edition (Bright & Modern).
Menyediakan antarmuka Messenger cerah dengan asisten chat interaktif, pemantauan progres,
katalog kegiatan 2.123, SKP dinamis, dan sistem multi-user terisolasi.
"""

import os
import sys

# Windows UTF-8 Safe Console Output
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
import re
import socket
import ipaddress
import urllib.parse
import json
import time
import threading
from datetime import datetime, date, timedelta
from typing import Dict, Any, Optional, Tuple, List
from functools import wraps

from flask import Flask, request, jsonify, render_template, session

import database
import ai_engine
import mcp_sipendekar
from sipendekar_api import SipendekarAPI

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def validate_external_url(url: str) -> Tuple[bool, str]:
    """
    Memvalidasi URL eksternal untuk mencegah Server-Side Request Forgery (SSRF).
    Menolak akses ke loopback (localhost, 127.0.0.1), private network (RFC 1918),
    link-local (169.254.x.x), IPv6 link-local/loopback, domain non-publik,
    dan DNS rebinding / wildcard domains (seperti nip.io atau localtest.me).
    """
    if not url or not url.strip():
        return True, ""
    try:
        parsed = urllib.parse.urlparse(url.strip())
        if parsed.scheme.lower() not in ("http", "https"):
            return False, "Hanya protokol HTTP atau HTTPS yang diperbolehkan."
        
        hostname = (parsed.hostname or "").lower()
        if not hostname:
            return False, "URL harus menyertakan hostname domain yang valid."

        blocked_hosts = {
            "localhost", "127.0.0.1", "0.0.0.0", "::1",
            "metadata.google.internal", "instance-data",
            "169.254.169.254"
        }
        if hostname in blocked_hosts or hostname.endswith(".local") or hostname.endswith(".internal"):
            return False, "Akses ke host/jaringan internal dilarang demi keamanan sistem (SSRF Protection)."

        # 1. Cek jika hostname adalah representasi IP literal
        try:
            ip = ipaddress.ip_address(hostname)
            if ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
                return False, "Akses ke alamat IP privat/internal dilarang demi keamanan sistem (SSRF Protection)."
            return True, ""
        except ValueError:
            pass

        # 2. Hostname berupa nama domain - verifikasi DNS resolution untuk mencegah DNS rebinding & nip.io
        try:
            addr_info = socket.getaddrinfo(hostname, None)
            for _, _, _, _, sockaddr in addr_info:
                res_ip_str = sockaddr[0]
                res_ip = ipaddress.ip_address(res_ip_str)
                if res_ip.is_loopback or res_ip.is_private or res_ip.is_link_local or res_ip.is_multicast or res_ip.is_reserved or res_ip.is_unspecified:
                    return False, f"Akses ke host '{hostname}' yang mengarah ke IP internal/privat ({res_ip_str}) dilarang demi keamanan sistem (SSRF Protection)."
        except (socket.gaierror, Exception):
            return False, f"Domain '{hostname}' tidak dapat diresolusi ke alamat IP publik yang valid."

        return True, ""
    except Exception as e:
        return False, f"Format URL tidak valid: {str(e)}"

def safe_error_msg(e: Exception) -> str:
    """Sanitasi pesan error backend agar tidak membocorkan path direktori, IP internal, atau trace sistem."""
    msg = str(e)
    # Redact path direktori Windows / Linux
    clean_msg = re.sub(r'[A-Za-z]:\\[^"\'\s,)]+', '[PATH_INTERNAL]', msg)
    clean_msg = re.sub(r'/[a-zA-Z0-9_\-\.]+/[a-zA-Z0-9_\-\.]+', '[PATH_INTERNAL]', clean_msg)
    # Redact IP addresses internal / privat
    clean_msg = re.sub(r'\b(127\.0\.0\.1|0\.0\.0\.0|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+)\b', '[IP_INTERNAL]', clean_msg)
    return clean_msg

def safe_error_response(e: Exception) -> Tuple[Any, int]:
    """Mengembalikan respons JSON error yang aman beserta kode status HTTP yang tepat (misal 413, 404, 500)."""
    status_code = getattr(e, "code", 500)
    if not isinstance(status_code, int) or status_code < 400 or status_code > 599:
        status_code = 500

    if status_code == 413:
        return jsonify({
            "success": False,
            "error": "Ukuran data yang Anda kirim melebihi batas maksimal server (Maksimal 2 MB)."
        }), 413

    return jsonify({"success": False, "error": safe_error_msg(e)}), status_code

CATALOG_FILE = os.path.join(BASE_DIR, "activities_catalog.json")

import secrets
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.serving import WSGIRequestHandler

# Mask Werkzeug & Python Banner completely
WSGIRequestHandler.server_version = "WebShield/1.0 (Protected)"
WSGIRequestHandler.sys_version = ""
WSGIRequestHandler.version_string = lambda self: "WebShield/1.0 (Protected)"

def get_or_create_secret_key() -> str:
    """Mengambil atau membuat secret_key dinamis yang aman dan persisten."""
    env_key = os.environ.get("FLASK_SECRET_KEY")
    if env_key and len(env_key) >= 32:
        return env_key
    key_file = os.path.join(BASE_DIR, ".secret_key")
    if os.path.exists(key_file):
        try:
            with open(key_file, "r", encoding="utf-8") as f:
                k = f.read().strip()
                if len(k) >= 32:
                    return k
        except Exception:
            pass
    new_key = secrets.token_hex(32)
    try:
        with open(key_file, "w", encoding="utf-8") as f:
            f.write(new_key)
    except Exception:
        pass
    return new_key

class StripServerHeaderMiddleware:
    """WSGI middleware untuk memastikan header server seragam tanpa duplikasi."""
    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app
    def __call__(self, environ, start_response):
        def custom_start_response(status, headers, exc_info=None):
            cleaned = [(name, value) for (name, value) in headers if name.lower() != 'server']
            return start_response(status, cleaned, exc_info)
        return self.wsgi_app(environ, custom_start_response)

app = Flask(__name__, template_folder="templates", static_folder="static")
app.wsgi_app = StripServerHeaderMiddleware(ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1))
app.secret_key = get_or_create_secret_key()

# Konfigurasi Keamanan Cookie & Session
app.config["JSON_AS_ASCII"] = False
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024  # Proteksi DoS Memori: Batas 2MB per request body

# ==============================================================================
# RATE LIMITER ENGINE (LOGIN BRUTE FORCE PROTECTION)
# ==============================================================================

class SimpleRateLimiter:
    """Melacak dan membatasi percobaan login per IP untuk mencegah serangan brute-force."""
    def __init__(self, max_attempts: int = 6, window_seconds: int = 300, block_duration: int = 300):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self.block_duration = block_duration
        self._attempts: Dict[str, List[float]] = {}
        self._blocked_until: Dict[str, float] = {}
        self._lock = threading.Lock()

    def is_blocked(self, key: str) -> Tuple[bool, int]:
        with self._lock:
            now = time.time()
            if key in self._blocked_until:
                remaining = int(self._blocked_until[key] - now)
                if remaining > 0:
                    return True, remaining
                else:
                    del self._blocked_until[key]
                    self._attempts.pop(key, None)
            return False, 0

    def record_failure(self, key: str) -> Tuple[bool, int]:
        with self._lock:
            now = time.time()
            history = self._attempts.get(key, [])
            history = [t for t in history if now - t < self.window_seconds]
            history.append(now)
            self._attempts[key] = history

            if len(history) >= self.max_attempts:
                self._blocked_until[key] = now + self.block_duration
                return True, self.block_duration
            return False, 0

    def reset(self, key: str):
        with self._lock:
            self._attempts.pop(key, None)
            self._blocked_until.pop(key, None)

login_limiter = SimpleRateLimiter(max_attempts=6, window_seconds=300, block_duration=300)

# ==============================================================================
# HTTP SECURITY HEADERS & DEFENSIVE HARDENING
# ==============================================================================

@app.after_request
def apply_security_headers_and_hardening(response):
    """Menyematkan HTTP Security Headers standar industri dan memproteksi header server."""
    # 1. Anti Clickjacking
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    # 2. Anti MIME-Sniffing
    response.headers["X-Content-Type-Options"] = "nosniff"
    # 3. XSS Filter Protection
    response.headers["X-XSS-Protection"] = "1; mode=block"
    # 4. Referrer Policy
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    # 5. Permissions Policy
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"

    # 7. HSTS (Strict-Transport-Security) bila diakses melalui HTTPS (Cloudflare Tunnel)
    is_https = request.is_secure or request.headers.get("X-Forwarded-Proto") == "https"
    if is_https:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    # 8. Content-Security-Policy (CSP)
    csp = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "img-src 'self' data: https:; "
        "connect-src 'self' https:; "
        "frame-ancestors 'self'; "
        "base-uri 'self'; "
        "form-action 'self';"
    )
    response.headers["Content-Security-Policy"] = csp

    # 9. Ensure session cookie gets Secure flag when served over HTTPS
    if is_https:
        cookies = response.headers.getlist("Set-Cookie")
        if cookies:
            response.headers.remove("Set-Cookie")
            for c in cookies:
                if "session=" in c and "Secure" not in c:
                    c += "; Secure"
                response.headers.add("Set-Cookie", c)

    return response

# ==============================================================================
# MULTI-SESSION CLIENT POOL
# ==============================================================================

class SessionPool:
    """Mengelola koneksi multi-session SipendekarAPI per NIP."""
    def __init__(self, ttl_seconds: int = 3600):
        self._pool: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()
        self.ttl = ttl_seconds

    def get_client(self, nip: str, force_new: bool = False) -> Tuple[SipendekarAPI, Dict[str, Any]]:
        user = database.get_user_by_nip(nip)
        if not user:
            raise ValueError(f"Akun NIP {nip} belum login atau tidak ditemukan.")

        with self._lock:
            now = time.time()
            cached = self._pool.get(nip)
            if cached and not force_new:
                api: SipendekarAPI = cached["api"]
                last_used = cached["timestamp"]
                if (now - last_used < self.ttl) and api.is_logged_in:
                    # Cek remote is_session_valid hanya jika sesi sudah menganggur lebih dari 15 menit
                    if (now - last_used < 900) or api.is_session_valid():
                        cached["timestamp"] = now
                        return api, user

            # Login baru
            base_url = "https://sipendekar.tangerangkab.go.id/2026"
            api = SipendekarAPI(base_url=base_url)
            password = user["password"]
            fingerprint = "09a160f689f48ed27b96d6f2fbbeec79"

            ok = api.login(nip, password, fingerprint)
            if not ok:
                time.sleep(1.0)
                ok = api.login(nip, password, fingerprint)

            if not ok:
                raise ValueError(f"Gagal login ke portal SiPENDEKAR untuk NIP {nip}. Pastikan password benar.")

            self._pool[nip] = {
                "api": api,
                "timestamp": now
            }
            return api, user

    def invalidate(self, nip: str):
        with self._lock:
            if nip in self._pool:
                del self._pool[nip]

session_pool = SessionPool()

# In-memory Activities Catalog Cache
_activities_catalog_cache: Optional[List[Dict[str, Any]]] = None

def get_activities_catalog() -> List[Dict[str, Any]]:
    global _activities_catalog_cache
    if _activities_catalog_cache is not None:
        return _activities_catalog_cache

    if os.path.exists(CATALOG_FILE):
        try:
            with open(CATALOG_FILE, "r", encoding="utf-8") as f:
                _activities_catalog_cache = json.load(f)
                return _activities_catalog_cache
        except Exception as e:
            print(f"Error loading catalog: {e}")

    _activities_catalog_cache = []
    return _activities_catalog_cache

# Auth Decorator
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        current_nip = session.get("nip")
        if not current_nip:
            return jsonify({
                "success": False,
                "authenticated": False,
                "error": "Sesi Anda telah berakhir. Silakan login kembali."
            }), 401
        return f(*args, **kwargs)
    return decorated_function

# ==============================================================================
# WEB PAGE ROUTE
# ==============================================================================

@app.route("/")
def index():
    return render_template("index.html")

# ==============================================================================
# AUTENTIKASI AKUN TERISOLASI
# ==============================================================================

@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    """Login akun pengguna secara privat dengan proteksi rate-limiting & brute force."""
    try:
        direct_remote = request.environ.get("REMOTE_ADDR") or request.remote_addr or "127.0.0.1"
        is_trusted_proxy = direct_remote in ("127.0.0.1", "::1", "localhost") or direct_remote.startswith("10.")
        if is_trusted_proxy:
            client_ip = request.headers.get("CF-Connecting-IP") or (request.headers.get("X-Forwarded-For", "").split(",")[0].strip() if request.headers.get("X-Forwarded-For") else None) or direct_remote
        else:
            client_ip = direct_remote

        data = request.get_json(silent=True) or {}
        nip = str(data.get("nip", "")).strip()
        password = str(data.get("password", "")).strip()
        if not nip or not password:
            return jsonify({"success": False, "error": "NIP dan Password wajib diisi."}), 400

        # Proteksi Brute-Force Ganda: Per IP dan Per NIP
        is_blocked_ip, rem_ip = login_limiter.is_blocked(f"ip:{client_ip}")
        is_blocked_nip, rem_nip = login_limiter.is_blocked(f"nip:{nip}")
        if is_blocked_ip or is_blocked_nip:
            remaining = max(rem_ip, rem_nip)
            return jsonify({
                "success": False,
                "error": f"Terlalu banyak percobaan login gagal. Demi keamanan sistem, akses diblokir sementara. Silakan coba lagi dalam {remaining} detik."
            }), 429

        existing_user = database.get_user_by_nip(nip)

        # 1. FAST-PATH: Jika kredensial sudah pernah diverifikasi sebelumnya, langsung izinkan login instan (<50ms)
        if existing_user and secrets.compare_digest(existing_user.get("password", ""), password):
            login_limiter.reset(f"ip:{client_ip}")
            login_limiter.reset(f"nip:{nip}")
            user = existing_user
            session.clear()  # Proteksi Session Fixation: Reset sesi lama sebelum membuat sesi baru
            session.permanent = True
            session["nip"] = nip

            # Pre-warm session client di background thread jika belum ada di pool
            def _prewarm_bg():
                try:
                    session_pool.get_client(nip)
                except Exception as ex:
                    print(f"[PREWARM BG] {ex}")
            threading.Thread(target=_prewarm_bg, daemon=True).start()

            database.log_user_activity(nip, "LOGIN_FAST", f"Pengguna {user['name']} login cepat (terotentikasi).")
            return jsonify({
                "success": True,
                "message": f"Selamat datang kembali, {user['name']}!",
                "fast_login": True,
                "user": {
                    "nip": user["nip"],
                    "name": user["name"],
                    "avatar_color": user.get("avatar_color", "#0084ff")
                }
            })

        # 2. FULL-PATH: Jika pengguna baru atau password diperbarui, validasi ke portal SiPENDEKAR
        test_api = SipendekarAPI()
        ok = test_api.login(nip, password)
        if not ok:
            is_now_blocked_ip, block_dur_ip = login_limiter.record_failure(f"ip:{client_ip}")
            is_now_blocked_nip, block_dur_nip = login_limiter.record_failure(f"nip:{nip}")
            is_now_blocked = is_now_blocked_ip or is_now_blocked_nip
            block_dur = max(block_dur_ip, block_dur_nip)
            err_msg = "Login gagal. NIP atau Password yang Anda masukkan tidak cocok di portal SiPENDEKAR."
            if is_now_blocked:
                err_msg += f" Batas percobaan terlampaui. Akses diblokir selama {block_dur // 60} menit."
                return jsonify({"success": False, "error": err_msg}), 429
            return jsonify({"success": False, "error": err_msg}), 401

        login_limiter.reset(f"ip:{client_ip}")
        login_limiter.reset(f"nip:{nip}")
        name = "MUHAMAD LUTFI, S.Kom"
        if existing_user and existing_user.get("name") and not existing_user.get("name").startswith("Pegawai ASN"):
            name = existing_user.get("name")
        else:
            prof = test_api.get_user_profile()
            portal_name = prof.get("name")
            if portal_name and not portal_name.startswith("Pegawai ASN"):
                name = portal_name

        user = database.save_or_update_user(nip, password, name)
        session.clear()  # Proteksi Session Fixation
        session.permanent = True
        session["nip"] = nip

        with session_pool._lock:
            session_pool._pool[nip] = {
                "api": test_api,
                "timestamp": time.time()
            }

        database.log_user_activity(nip, "LOGIN", f"Pengguna {user['name']} berhasil login ke sistem.")

        return jsonify({
            "success": True,
            "message": f"Selamat datang, {user['name']}!",
            "fast_login": False,
            "user": {
                "nip": user["nip"],
                "name": user["name"],
                "avatar_color": user.get("avatar_color", "#0084ff")
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    """Mengecek status autentikasi pengguna aktif."""
    current_nip = session.get("nip")
    if not current_nip:
        return jsonify({"success": True, "authenticated": False})

    user = database.get_user_by_nip(current_nip)
    if not user:
        session.pop("nip", None)
        return jsonify({"success": True, "authenticated": False})

    return jsonify({
        "success": True,
        "authenticated": True,
        "user": {
            "nip": user["nip"],
            "name": user["name"],
            "avatar_color": user.get("avatar_color", "#0084ff"),
            "last_login": user.get("last_login")
        }
    })

@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    """Logout akun aktif secara aman dan membersihkan seluruh sesi."""
    current_nip = session.get("nip")
    if current_nip:
        session_pool.invalidate(current_nip)
    session.clear()
    resp = jsonify({"success": True, "message": "Berhasil logout."})
    resp.delete_cookie(app.config.get("SESSION_COOKIE_NAME", "session"))
    return resp

# ==============================================================================
# MESSENGER CHAT PRIBADI DENGAN ASISTEN e-KINERJA
# ==============================================================================

@app.route("/api/chat", methods=["GET"])
@login_required
def get_chat_history():
    """Mengambil riwayat obrolan Messenger pribadi untuk akun yang sedang login."""
    try:
        current_nip = session["nip"]
        msgs = database.get_user_chats(current_nip, limit=40)
        return jsonify({"success": True, "messages": msgs})
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/chat", methods=["POST"])
@login_required
def send_chat_message():
    """Mengirim pesan ke Asisten Messenger via SiPENDEKAR MCP Unified Engine."""
    try:
        current_nip = session["nip"]
        api = None
        portal_error = None
        try:
            api, _ = session_pool.get_client(current_nip)
        except Exception as client_err:
            print(f"[PORTAL OFFLINE/DISCONNECTED] {client_err}")
            portal_error = safe_error_msg(client_err)

        data = request.get_json(silent=True) or {}
        user_msg = str(data.get("message", "")).strip()
        if not user_msg:
            return jsonify({"success": False, "error": "Pesan tidak boleh kosong."}), 400

        # Simpan pesan user
        database.save_user_chat(current_nip, "user", user_msg)

        # Proses melalui Model Context Protocol (MCP) Unified Agentic Dispatcher
        mcp_res = mcp_sipendekar.dispatch_mcp_chat(current_nip, user_msg, api, portal_error=portal_error)
        reply = mcp_res.get("reply", "Siap membantu pelaporan e-Kinerja Anda!")
        card_type = mcp_res.get("card_type")
        card_data = mcp_res.get("card_data")

        # Simpan balasan tunggal bot (sinkron 100% antara teks & kartu widget)
        saved_bot = database.save_user_chat(current_nip, "bot", reply, card_type, card_data)

        return jsonify({
            "success": True,
            "message": saved_bot
        })
    except Exception as e:
        return safe_error_response(e)

# ==============================================================================
# PROGRES & KALENDER PRIBADI
# ==============================================================================

@app.route("/api/progress", methods=["GET"])
@login_required
def get_user_progress():
    """Menghitung progres e-Kinerja pribadi pengguna yang sedang login."""
    try:
        current_nip = session["nip"]
        api, user = session_pool.get_client(current_nip)

        today = date.today()
        tahun = request.args.get("year", default=today.year, type=int)
        bulan = request.args.get("month", default=today.month, type=int)

        try:
            cal_data = api.get_kalender_bulan(tahun, bulan)
        except Exception as err_c:
            print(f"[WARN] Failed fetching get_kalender_bulan: {err_c}")
            cal_data = {"result": []}

        events = cal_data.get("result", []) if isinstance(cal_data, dict) else []

        filled_dates = set()
        events_by_date = {}
        for ev in events:
            start_ms = ev.get("start")
            if start_ms:
                d = datetime.fromtimestamp(start_ms / 1000).date()
                d_str = d.strftime("%Y-%m-%d")
                filled_dates.add(d_str)
                ev_class = ev.get("class", "")
                ev_title = ev.get("title", "")
                # event-success (Hijau/Diterima), event-info (Biru/Proses/Belum Approve)
                status_appr = "approved"
                if "info" in ev_class or "proses" in ev_title.lower():
                    status_appr = "proses"
                elif "important" in ev_class or "warning" in ev_class or "tolak" in ev_title.lower():
                    status_appr = "rejected"
                events_by_date[d_str] = {
                    "title": ev_title,
                    "class": ev_class,
                    "status_approval": status_appr
                }

        d_start = date(tahun, bulan, 1)
        if bulan == 12:
            d_end = date(tahun + 1, 1, 1) - timedelta(days=1)
        else:
            d_end = date(tahun, bulan + 1, 1) - timedelta(days=1)

        h7_cutoff = today - timedelta(days=7)

        total_working_days = 0
        working_days_so_far = 0
        filled_count = 0
        empty_in_h7 = []
        calendar_grid = []

        curr = d_start
        while curr <= d_end:
            is_weekend = curr.weekday() in (5, 6)
            is_future = curr > today
            tgl_str = curr.strftime("%Y-%m-%d")
            is_terisi = tgl_str in filled_dates

            if not is_weekend:
                total_working_days += 1
                if not is_future:
                    working_days_so_far += 1

            ev_info = events_by_date.get(tgl_str, {})
            appr = ev_info.get("status_approval", "none")
            appr_title = ev_info.get("title", "")

            if is_terisi:
                filled_count += 1
                if appr == "proses":
                    status = "proses"  # Biru: Menunggu approval atasan (bisa diedit)
                elif appr == "rejected":
                    status = "rejected"  # Ditolak
                else:
                    status = "terisi"  # Hijau: Diterima / Approved
            elif is_future:
                status = "future"
            elif is_weekend:
                status = "weekend"
            elif curr >= h7_cutoff:
                status = "kosong-bisa"
                empty_in_h7.append({
                    "tanggal": tgl_str,
                    "hari": curr.strftime("%A"),
                    "hari_nama": {
                        "Monday": "Senin", "Tuesday": "Selasa", "Wednesday": "Rabu",
                        "Thursday": "Kamis", "Friday": "Jumat", "Saturday": "Sabtu", "Sunday": "Minggu"
                    }.get(curr.strftime("%A"), curr.strftime("%A")),
                    "urgensi_hari": (today - curr).days,
                    "bisa_diisi": True
                })
            else:
                status = "kosong-lewat"

            calendar_grid.append({
                "tanggal": tgl_str,
                "hari_ke": curr.day,
                "weekday": curr.weekday(),
                "status": status,
                "approval_status": appr,
                "approval_title": appr_title,
                "is_terisi": is_terisi,
                "is_future": is_future,
                "is_weekend": is_weekend
            })

            curr += timedelta(days=1)

        today_str = today.strftime("%Y-%m-%d")

        try:
            menit_bulanan = api.get_total_menit_bulanan()
        except Exception as err_m:
            print(f"[WARN] Failed fetching menit_bulanan: {err_m}")
            menit_bulanan = {
                "total": 0, "utama": 0, "tambahan": 0,
                "minimal": 7920, "tercapai": False
            }

        target_menit = menit_bulanan.get("minimal", 7920) or 7920
        total_menit = menit_bulanan.get("total", 0) or 0
        if target_menit > 0:
            pct = round((total_menit / target_menit * 100), 1)
        else:
            pct = round((filled_count / working_days_so_far * 100), 1) if working_days_so_far > 0 else 0
        pct_monthly = pct
        pct_hari = round((filled_count / working_days_so_far * 100), 1) if working_days_so_far > 0 else 0

        # If employee has reached/exceeded target (100%+), their monthly duty is fulfilled
        if target_menit > 0 and total_menit >= target_menit:
            empty_in_h7 = []
        else:
            empty_in_h7.sort(key=lambda x: x["tanggal"])

        return jsonify({
            "success": True,
            "user": {
                "nip": user["nip"],
                "name": user["name"]
            },
            "periode": {
                "tahun": tahun,
                "bulan": bulan,
                "bulan_nama": [
                    "", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
                    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
                ][bulan],
                "first_weekday": d_start.weekday(),
                "total_days": d_end.day,
                "today": today_str
            },
            "summary": {
                "total_hari_kerja": total_working_days,
                "hari_kerja_berlalu": working_days_so_far,
                "hari_terisi": filled_count,
                "hari_kosong_h7": len(empty_in_h7),
                "persentase_berjalan": pct,
                "persentase_bulan_penuh": pct_monthly,
                "persentase_hari": pct_hari,
                # Total Menit Bulan Ini dari SiPENDEKAR (resmi dari portal e-Kinerja)
                "bulan_menit_total": menit_bulanan["total"],
                "bulan_menit_utama": menit_bulanan["utama"],
                "bulan_menit_tambahan": menit_bulanan["tambahan"],
                "bulan_menit_target": menit_bulanan["minimal"],
                "bulan_menit_tercapai": menit_bulanan["tercapai"],
                "bulan_jam_total": round(menit_bulanan["total"] / 60, 1),
                "bulan_jam_target": round(menit_bulanan["minimal"] / 60, 1)
            },
            "empty_days_h7": empty_in_h7,
            "calendar": calendar_grid
        })
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/days/<tanggal>", methods=["GET"])
@login_required
def get_user_day_detail(tanggal: str):
    """Melihat rincian aktivitas pengguna pada tanggal tertentu."""
    try:
        current_nip = session["nip"]
        api, _ = session_pool.get_client(current_nip)
        total_menit, details = api.get_total_menit_harian(tanggal)
        return jsonify({
            "success": True,
            "tanggal": tanggal,
            "total_menit": total_menit,
            "is_terisi": len(details) > 0,
            "total_aktivitas": len(details),
            "detail": details
        })
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

# ==============================================================================
# REVIEW PERILAKU & VALIDASI KINERJA
# ==============================================================================

@app.route("/api/review", methods=["GET"])
@login_required
def get_user_review():
    """Mengambil status Review Perilaku dan Validasi Bawahan dari portal SiPENDEKAR."""
    try:
        current_nip = session["nip"]
        api, user = session_pool.get_client(current_nip)
        review_data = api.get_review_summary()
        review_data["user"] = {
            "nip": user["nip"],
            "name": user["name"]
        }
        return jsonify(review_data)
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/review/form/<target_nip>", methods=["GET"])
@login_required
def get_user_review_form(target_nip):
    """Mengambil rincian formulir 7 Core Values BerAKHLAK untuk pegawai tertentu."""
    try:
        current_nip = session["nip"]
        api, user = session_pool.get_client(current_nip)
        form_data = api.get_review_form(str(target_nip))
        return jsonify(form_data)
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/review/save-rating", methods=["POST"])
@login_required
def save_user_review_rating():
    """Menyimpan draft penilaian satu aspek perilaku kerja di SiPENDEKAR."""
    try:
        current_nip = session["nip"]
        api, user = session_pool.get_client(current_nip)
        data = request.get_json(silent=True) or {}
        target_nip = str(data.get("target_nip", "")).strip()
        question_id = str(data.get("question_id", "")).strip()
        rating_val = str(data.get("rating_val", "")).strip()
        csrf_token = data.get("csrf_token")

        if not target_nip or not question_id or rating_val == "":
            return jsonify({"success": False, "error": "Parameter tidak lengkap."}), 400

        res = api.save_review_rating(target_nip, question_id, rating_val, reviewer_nip=current_nip, csrf_token=csrf_token)
        return jsonify(res)
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/review/submit", methods=["POST"])
@login_required
def submit_user_review():
    """Mengirim penilaian final 7 Core Values ASN BerAKHLAK ke SiPENDEKAR."""
    try:
        current_nip = session["nip"]
        api, user = session_pool.get_client(current_nip)
        data = request.get_json(silent=True) or {}
        target_nip = str(data.get("target_nip", "")).strip()
        ratings = data.get("ratings", [])
        question_ids = data.get("question_ids", [])
        csrf_token = data.get("csrf_token")

        if not target_nip or not ratings or not question_ids:
            return jsonify({"success": False, "error": "Seluruh 7 aspek penilaian wajib diisi."}), 400

        res = api.submit_final_review(target_nip, ratings, question_ids, reviewer_nip=current_nip, csrf_token=csrf_token)
        if res.get("success"):
            database.log_user_activity(current_nip, "REVIEW_SUBMIT", f"Berhasil mengirim evaluasi perilaku untuk pegawai NIP {target_nip}.")
        return jsonify(res)
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

# ==============================================================================
# KATALOG KEGIATAN & SKP DINAMIS
# ==============================================================================

@app.route("/api/catalog", methods=["GET"])
def search_catalog_route():
    """Mencari dari katalog 2.123 kegiatan SiPENDEKAR."""
    try:
        q = request.args.get("q", "").strip().lower()
        kategori = request.args.get("kategori", "").strip().upper()
        limit = request.args.get("limit", default=30, type=int)
        offset = request.args.get("offset", default=0, type=int)

        all_items = get_activities_catalog()

        filtered = []
        for item in all_items:
            if kategori and kategori != "ALL":
                if item.get("kategori", "").upper() != kategori:
                    continue
            if q:
                nama = item.get("nama_aktifitas", "").lower()
                kode = item.get("kode_aktifitas", "").lower()
                if q not in nama and q not in kode:
                    continue
            filtered.append(item)

        total_match = len(filtered)
        paged = filtered[offset : offset + limit]

        return jsonify({
            "success": True,
            "total": total_match,
            "limit": limit,
            "offset": offset,
            "items": paged
        })
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/sipendekar/ping", methods=["GET"])
@login_required
def ping_sipendekar_portal():
    """Mengukur latensi riil koneksi ke portal SiPENDEKAR (dalam milidetik)."""
    try:
        current_nip = session["nip"]
        api, _ = session_pool.get_client(current_nip)
        t0 = time.time()
        url = f"{api.base_url}/input/getKegiatan"
        resp = api.session.get(url, params={"kode_aktivitas": "UTAMA00463"}, timeout=8, verify=True)
        latency_ms = round((time.time() - t0) * 1000)
        return jsonify({
            "success": resp.status_code == 200,
            "latency_ms": latency_ms,
            "status_text": "Sangat Cepat" if latency_ms < 350 else ("Normal" if latency_ms < 800 else "Padat")
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": safe_error_msg(e),
            "latency_ms": 999,
            "status_text": "Offline/RTO"
        }), 500

@app.route("/api/skp", methods=["GET"])
@login_required
def get_user_skp_options():
    """Mengambil Sasaran Kinerja Pegawai (SKP) valid untuk akun pengguna yang sedang login."""
    try:
        kode_aktivitas = request.args.get("kode_aktivitas") or "UTAMA00463"

        current_nip = session["nip"]
        api, _ = session_pool.get_client(current_nip)
        t0 = time.time()
        skp_list = api.get_skp(kode_aktivitas)
        latency_ms = round((time.time() - t0) * 1000)
        return jsonify({
            "success": True,
            "kode_aktivitas": kode_aktivitas,
            "total_skp": len(skp_list),
            "skp": skp_list,
            "latency_ms": latency_ms
        })
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

# ==============================================================================
# PENGISIAN & PENGHAPUSAN LAPORAN (ACTIONS)
# ==============================================================================

@app.route("/api/fill/activity", methods=["POST"])
@login_required
def fill_user_activity():
    """Mengisi satu baris kegiatan pilihan pengguna ke portal SiPENDEKAR."""
    try:
        current_nip = session["nip"]
        api, user = session_pool.get_client(current_nip)
        data = request.get_json(silent=True) or {}

        tanggal = data.get("tanggal")
        kode_aktifitas = data.get("kode_aktifitas")
        nama_aktifitas = data.get("nama_aktifitas", kode_aktifitas)
        volume = int(data.get("volume", 1))
        keterangan = data.get("keterangan", "")
        sasaran_kerja_id = int(data.get("sasaran_kerja_id") or data.get("id_skp") or data.get("skp_id") or 0)
        jam_mulai = str(data.get("jam_mulai", "07"))
        menit_mulai = str(data.get("menit_mulai", "30"))
        jam_selesai = str(data.get("jam_selesai", "17"))
        menit_selesai = str(data.get("menit_selesai", "30"))
        jenis = data.get("jenis", "kinerja")

        if not tanggal or not kode_aktifitas:
            return jsonify({"success": False, "error": "Tanggal dan Kode Kegiatan wajib diisi."}), 400

        if sasaran_kerja_id == 0:
            skps = api.get_skp(kode_aktifitas)
            if skps:
                sasaran_kerja_id = skps[0]["id"]

        id_input = data.get("id_input") or data.get("id") or None
        res = api.isi_aktivitas(
            tanggal=tanggal,
            kode_aktifitas=kode_aktifitas,
            volume=volume,
            keterangan=keterangan,
            sasaran_kerja_id=sasaran_kerja_id,
            jam_mulai=jam_mulai,
            menit_mulai=menit_mulai,
            jam_selesai=jam_selesai,
            menit_selesai=menit_selesai,
            jenis=jenis,
            nip18=current_nip,
            id_input=id_input
        )

        act_info = ai_engine.get_activity_by_code(kode_aktifitas)
        waktu_standar = int(act_info.get("waktu") or 0) if act_info else 0
        satuan = act_info.get("satuan_output", "Output") if act_info else "Output"
        if waktu_standar > 0:
            durasi = waktu_standar * volume
        else:
            durasi = ((int(jam_selesai) * 60) + int(menit_selesai)) - ((int(jam_mulai) * 60) + int(menit_mulai))
            if durasi <= 0:
                durasi = 60

        msg = f"Berhasil melaporkan '{nama_aktifitas}' [{kode_aktifitas}] - {volume} {satuan} ({durasi} menit e-Kinerja) pada tanggal {tanggal}."
        database.log_user_activity(current_nip, "FILL", msg)
        database.save_user_chat(current_nip, "bot", f"✅ {msg}")
        mcp_sipendekar.invalidate_user_context_cache(current_nip)

        return jsonify({
            "success": True,
            "message": msg,
            "durasi_menit": durasi,
            "volume": volume,
            "response": res
        })
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/templates", methods=["GET"])
@login_required
def get_user_templates_list():
    """Mengambil seluruh master templates e-Kinerja milik pengguna."""
    try:
        current_nip = session["nip"]
        tmpls = database.get_user_master_templates(current_nip)
        return jsonify({"success": True, "templates": tmpls})
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/templates/save", methods=["POST"])
@app.route("/api/template/save", methods=["POST"])
@login_required
def save_user_template():
    """Menyimpan atau memperbarui Master Template pengguna."""
    try:
        current_nip = session["nip"]
        data = request.get_json(silent=True) or {}

        template_num = int(data.get("template_num") or database.get_next_template_num(current_nip))
        title = data.get("title", "").strip() or f"Template {template_num}"
        kode_aktifitas = data.get("kode_aktifitas", "").strip() or "UTAMA00463"
        nama_aktifitas = data.get("nama_aktifitas", "").strip() or "Mengikuti pelatihan/sosialisasi/pendidikan"
        jam_mulai = str(data.get("jam_mulai", "07")).zfill(2)
        menit_mulai = str(data.get("menit_mulai", "30")).zfill(2)
        jam_selesai = str(data.get("jam_selesai", "17")).zfill(2)
        menit_selesai = str(data.get("menit_selesai", "30")).zfill(2)
        keterangan = data.get("keterangan", "").strip() or nama_aktifitas.lower()
        volume = int(data.get("volume", 1))
        if volume < 1:
            volume = 1

        # Hitung durasi e-Kinerja: jumlah menit standar kegiatan x volume laporan
        act_info = ai_engine.get_activity_by_code(kode_aktifitas)
        waktu_standar = int(act_info.get("waktu") or 0) if act_info else 0
        satuan = act_info.get("satuan_output", "Laporan") if act_info else "Laporan"
        if waktu_standar > 0:
            durasi_menit = waktu_standar * volume
        else:
            durasi_menit = ((int(jam_selesai) * 60) + int(menit_selesai)) - ((int(jam_mulai) * 60) + int(menit_mulai))
            if durasi_menit <= 0:
                durasi_menit = 600

        saved = database.save_or_update_master_template(
            nip=current_nip,
            template_num=template_num,
            title=title,
            kode_aktifitas=kode_aktifitas,
            nama_aktifitas=nama_aktifitas,
            jam_mulai=jam_mulai,
            menit_mulai=menit_mulai,
            jam_selesai=jam_selesai,
            menit_selesai=menit_selesai,
            durasi_menit=durasi_menit,
            keterangan=keterangan,
            volume=volume
        )

        msg = f"Master Template {template_num} ('{title}') berhasil disimpan!"
        database.log_user_activity(current_nip, "SAVE_TEMPLATE", msg)

        # Simpan konfirmasi bot ke obrolan chat
        bot_reply = (
            f"🎉 **Master Template Berhasil Disimpan!**\n\n"
            f"📌 **Nomor:** Template {template_num}\n"
            f"🏷️ **Judul:** {title}\n"
            f"📋 **Kegiatan:** {nama_aktifitas} [{kode_aktifitas}]\n"
            f"📊 **Volume Output:** {volume} {satuan}\n"
            f"⏱️ **Total Menit e-Kinerja:** {durasi_menit} Menit ({waktu_standar}m × {volume} vol)\n"
            f"🕒 **Rentang Jam Kerja:** {jam_mulai}:{menit_mulai} - {jam_selesai}:{menit_selesai}\n"
            f"📝 **Keterangan:** {keterangan}\n\n"
            f"Sekarang Anda cukup mengetik **'template {template_num}'** di chat untuk langsung lapor e-Kinerja! 🚀"
        )
        saved_bot = database.save_user_chat(current_nip, "bot", bot_reply, "template_success_card", {
            "template_num": template_num,
            "title": title,
            "tanggal": date.today().strftime("%Y-%m-%d"),
            "durasi_menit": durasi_menit,
            "volume": volume,
            "kegiatan": nama_aktifitas
        })

        return jsonify({
            "success": True,
            "message": msg,
            "template": saved,
            "bot_message": saved_bot
        })
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/templates/<int:template_num>", methods=["DELETE"])
@login_required
def delete_user_template(template_num: int):
    """Menghapus satu Master Template pengguna."""
    try:
        current_nip = session["nip"]
        deleted = database.delete_master_template(current_nip, template_num)
        if deleted:
            msg = f"Master Template {template_num} berhasil dihapus."
            database.log_user_activity(current_nip, "DELETE_TEMPLATE", msg)
            database.save_user_chat(current_nip, "bot", f"🗑️ {msg}")
            return jsonify({"success": True, "message": msg})
        else:
            return jsonify({"success": False, "error": "Template tidak ditemukan."}), 404
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/fill/template", methods=["POST"])
@login_required
def fill_template_activity():
    """Mengisi kegiatan menggunakan Master Template pilihan pengguna."""
    try:
        current_nip = session["nip"]
        api, user = session_pool.get_client(current_nip)
        data = request.get_json(silent=True) or {}

        template_num = int(data.get("template_num", 1))
        tanggal = data.get("tanggal") or date.today().strftime("%Y-%m-%d")

        tmpl = database.get_template_by_num(current_nip, template_num)
        if not tmpl:
            return jsonify({"success": False, "error": f"Template {template_num} tidak ditemukan."}), 404

        kode_aktifitas = tmpl["kode_aktifitas"]
        nama_aktifitas = tmpl["nama_aktifitas"]
        volume = int(data.get("volume") or tmpl.get("volume") or 1)
        keterangan = data.get("keterangan", tmpl["keterangan"])
        jam_mulai = str(data.get("jam_mulai", tmpl["jam_mulai"])).zfill(2)
        menit_mulai = str(data.get("menit_mulai", tmpl["menit_mulai"])).zfill(2)
        jam_selesai = str(data.get("jam_selesai", tmpl["jam_selesai"])).zfill(2)
        menit_selesai = str(data.get("menit_selesai", tmpl["menit_selesai"])).zfill(2)

        skps = api.get_skp(kode_aktifitas)
        sasaran_kerja_id = skps[0]["id"] if skps else 0

        res = api.isi_aktivitas(
            tanggal=tanggal,
            kode_aktifitas=kode_aktifitas,
            volume=volume,
            keterangan=keterangan,
            sasaran_kerja_id=sasaran_kerja_id,
            jam_mulai=jam_mulai,
            menit_mulai=menit_mulai,
            jam_selesai=jam_selesai,
            menit_selesai=menit_selesai,
            jenis="kinerja",
            nip18=current_nip
        )

        act_info = ai_engine.get_activity_by_code(kode_aktifitas)
        waktu_standar = int(act_info.get("waktu") or 0) if act_info else 0
        satuan = act_info.get("satuan_output", "Laporan") if act_info else "Laporan"
        if waktu_standar > 0:
            durasi = waktu_standar * volume
        else:
            durasi = ((int(jam_selesai) * 60) + int(menit_selesai)) - ((int(jam_mulai) * 60) + int(menit_mulai))
            if durasi <= 0:
                durasi = 600

        msg = f"Berhasil melaporkan Template {template_num} ({tmpl['title']}) - {volume} {satuan} ({durasi} menit e-Kinerja) pada tanggal {tanggal}."
        database.log_user_activity(current_nip, "FILL_TEMPLATE", msg)

        # Simpan konfirmasi bot ke dalam database chat
        bot_reply = (
            f"✅ **Laporan Berhasil Dilaporkan ke SiPENDEKAR!**\n\n"
            f"📌 **Master Template:** Template {template_num} ({tmpl['title']})\n"
            f"📅 **Tanggal:** {tanggal}\n"
            f"📋 **Kegiatan:** {nama_aktifitas} [{kode_aktifitas}]\n"
            f"📊 **Volume Output:** {volume} {satuan}\n"
            f"⏱️ **Total Menit Diakui:** {durasi} Menit ({waktu_standar}m × {volume} vol)\n"
            f"🕒 **Rentang Jam:** {jam_mulai}:{menit_mulai} - {jam_selesai}:{menit_selesai}\n"
            f"📝 **Keterangan:** {keterangan}\n\n"
            f"Total menit bulan ini telah diperbarui secara otomatis! 🎉"
        )
        saved_bot = database.save_user_chat(current_nip, "bot", bot_reply, "template_success_card", {
            "template_num": template_num,
            "title": tmpl["title"],
            "tanggal": tanggal,
            "durasi_menit": durasi,
            "volume": volume,
            "kegiatan": nama_aktifitas
        })

        return jsonify({
            "success": True,
            "message": msg,
            "bot_message": saved_bot,
            "durasi_menit": durasi,
            "response": res
        })
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/fill/auto", methods=["POST"])
@login_required
def auto_fill_user_empty_days():
    """Mengisi otomatis semua hari kosong H-7 untuk akun pribadi pengguna."""
    try:
        current_nip = session["nip"]
        api, user = session_pool.get_client(current_nip)
        data = request.get_json(silent=True) or {}

        kode_aktifitas = data.get("kode_aktifitas", "UTAMA00463")
        nama_aktifitas = data.get("nama_aktifitas", "Mengikuti pelatihan/sosialisasi/pendidikan")
        volume = int(data.get("volume", 2))
        keterangan = data.get("keterangan", "mengikuti pelatihan jabatan fungsional pranata komputer")
        sasaran_kerja_id = int(data.get("sasaran_kerja_id", 0))

        if sasaran_kerja_id == 0:
            skps = api.get_skp(kode_aktifitas)
            if skps:
                sasaran_kerja_id = skps[-1]["id"]

        today = date.today()
        h7_start = today - timedelta(days=7)
        empty_days = api.cari_hari_kosong(h7_start, today, skip_weekends=True)

        if not empty_days:
            return jsonify({
                "success": True,
                "filled_count": 0,
                "message": "Semua hari kerja dalam 7 hari terakhir sudah terisi lengkap!"
            })

        filled_dates = []
        for item in empty_days:
            tgl = item["tanggal"]
            try:
                api.isi_aktivitas(
                    tanggal=tgl,
                    kode_aktifitas=kode_aktifitas,
                    volume=volume,
                    keterangan=keterangan,
                    sasaran_kerja_id=sasaran_kerja_id,
                    jam_mulai="07",
                    menit_mulai="00",
                    jam_selesai="17",
                    menit_selesai="00",
                    jenis="kinerja",
                    nip18=current_nip
                )
                filled_dates.append(tgl)
                time.sleep(1.0)
            except Exception as ex:
                print(f"Gagal mengisi tanggal {tgl}: {ex}")

        msg = f"Berhasil auto-fill {len(filled_dates)} hari kosong ({', '.join(filled_dates)})!"
        database.log_user_activity(current_nip, "AUTO_FILL", msg)
        database.save_user_chat(current_nip, "bot", f"⚡ {msg}")

        return jsonify({
            "success": True,
            "filled_count": len(filled_dates),
            "filled_dates": filled_dates,
            "message": msg
        })
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/activity/delete", methods=["POST"])
@login_required
def delete_user_activity():
    """Menghapus aktivitas SiPENDEKAR milik pengguna berdasarkan ID."""
    try:
        current_nip = session["nip"]
        api, _ = session_pool.get_client(current_nip)
        data = request.get_json(silent=True) or {}
        act_id = data.get("id")

        if not act_id:
            return jsonify({"success": False, "error": "Field 'id' wajib diisi."}), 400

        res = api.hapus_aktivitas(int(act_id))
        msg = f"Aktivitas ID #{act_id} berhasil dihapus dari SiPENDEKAR."
        database.log_user_activity(current_nip, "DELETE", msg)

        return jsonify({"success": True, "message": msg, "response": res})
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/history", methods=["GET"])
@login_required
def get_user_history():
    """Mengambil riwayat log pengisian milik pengguna aktif."""
    try:
        current_nip = session["nip"]
        logs = database.get_user_activity_logs(current_nip, limit=25)
        return jsonify({"success": True, "logs": logs})
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

# ==============================================================================
# HISTORI KEGIATAN SEBELUMNYA & 1-KLIK INPUT ULANG
# ==============================================================================

@app.route("/api/activities/history", methods=["GET"])
@login_required
def get_user_activities_history():
    """
    Mengambil riwayat kegiatan riil yang telah dilaporkan ke portal SiPENDEKAR
    (dalam kurun waktu 14 hari terakhir) agar pengguna dapat memilih dan menginput ulang dalam 1-klik.
    """
    try:
        current_nip = session["nip"]
        api, _ = session_pool.get_client(current_nip)
        today = date.today()

        history_items = []
        seen_keys = set()

        # 1. Cek kalender bulan ini dari portal untuk mencari tanggal-tanggal yang terisi
        try:
            cal_data = api.get_kalender_bulan(today.year, today.month)
            events = cal_data.get("result", []) if isinstance(cal_data, dict) else []
        except Exception:
            events = []

        filled_dates = []
        for ev in events:
            start_ms = ev.get("start")
            if start_ms:
                ev_date = datetime.fromtimestamp(start_ms / 1000).date()
                if (today - ev_date).days <= 14 and ev_date <= today:
                    filled_dates.append(ev_date.strftime("%Y-%m-%d"))

        filled_dates = sorted(list(set(filled_dates)), reverse=True)

        for tgl in filled_dates[:7]:
            try:
                _, details = api.get_total_menit_harian(tgl)
                for d in (details or []):
                    key = (d.get("kode_aktifitas"), d.get("keterangan"))
                    if key not in seen_keys:
                        seen_keys.add(key)
                        history_items.append({
                            "tanggal": tgl,
                            "tanggal_terakhir": tgl,
                            "kode_aktifitas": d.get("kode_aktifitas", "UTAMA00463"),
                            "nama_aktifitas": d.get("nama_aktifitas", "Kegiatan"),
                            "jam_mulai": d.get("jam_mulai", "07:30"),
                            "jam_selesai": d.get("jam_selesai", "12:30"),
                            "durasi_menit": d.get("durasi_menit", 300),
                            "volume": d.get("volume", 1),
                            "satuan": d.get("satuan", "Kegiatan"),
                            "keterangan": d.get("keterangan", ""),
                            "id_skp": d.get("id_skp", "")
                        })
            except Exception as e_h:
                print(f"[WARN] Error fetching detail for {tgl}: {e_h}")

        # 2. Tambahkan Master Template milik user jika ada
        user_tmpls = database.get_user_master_templates(current_nip)
        for t in user_tmpls:
            key = (t.get("kode_aktifitas"), t.get("keterangan"))
            if key not in seen_keys and t.get("kode_aktifitas"):
                seen_keys.add(key)
                history_items.append({
                    "tanggal": f"Master Template #{t.get('template_num', 1)}",
                    "tanggal_terakhir": f"Master Template #{t.get('template_num', 1)}",
                    "kode_aktifitas": t.get("kode_aktifitas", "UTAMA00463"),
                    "nama_aktifitas": t.get("nama_aktifitas", "Kegiatan Template"),
                    "jam_mulai": f"{t.get('jam_mulai', '07')}:{t.get('menit_mulai', '30')}",
                    "jam_selesai": f"{t.get('jam_selesai', '12')}:{t.get('menit_selesai', '30')}",
                    "durasi_menit": t.get("durasi_menit", 300),
                    "volume": t.get("volume", 1),
                    "satuan": "Kegiatan",
                    "keterangan": t.get("keterangan", ""),
                    "id_skp": "",
                    "is_template": True
                })

        # Default fallback items jika belum ada data sama sekali
        if not history_items:
            history_items = [
                {
                    "tanggal": today.strftime("%Y-%m-%d"),
                    "tanggal_terakhir": today.strftime("%Y-%m-%d"),
                    "kode_aktifitas": "UTAMA00463",
                    "nama_aktifitas": "Mengikuti pelatihan/sosialisasi/pendidikan",
                    "jam_mulai": "07:30",
                    "jam_selesai": "12:30",
                    "durasi_menit": 300,
                    "volume": 1,
                    "satuan": "Kegiatan",
                    "keterangan": "Mengikuti agenda pelatihan dan peningkatan kompetensi aparatur sipil negara."
                },
                {
                    "tanggal": today.strftime("%Y-%m-%d"),
                    "tanggal_terakhir": today.strftime("%Y-%m-%d"),
                    "kode_aktifitas": "UTAMA00030",
                    "nama_aktifitas": "Mengarsipkan dokumen/surat",
                    "jam_mulai": "08:00",
                    "jam_selesai": "09:00",
                    "durasi_menit": 60,
                    "volume": 1,
                    "satuan": "Dokumen",
                    "keterangan": "Melakukan pengarsipan berkas dokumen kedinasan dan surat dinas."
                },
                {
                    "tanggal": today.strftime("%Y-%m-%d"),
                    "tanggal_terakhir": today.strftime("%Y-%m-%d"),
                    "kode_aktifitas": "UTAMA00032",
                    "nama_aktifitas": "Mengoperasikan komputer/perangkat lunak kerja",
                    "jam_mulai": "13:00",
                    "jam_selesai": "15:00",
                    "durasi_menit": 120,
                    "volume": 1,
                    "satuan": "Laporan",
                    "keterangan": "Mengoperasikan perangkat komputer untuk penyusunan dan pengolahan data kerja."
                }
            ]

        return jsonify({
            "success": True,
            "total": len(history_items),
            "activities": history_items,
            "items": history_items
        })
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/activities/reinput", methods=["POST"])
@login_required
def reinput_previous_activity():
    """
    1-Klik menginput ulang kegiatan riwayat ke tanggal target (default hari ini).
    Tidak perlu melalui chat bot, langsung dilaporkan resmi ke SiPENDEKAR!
    """
    try:
        current_nip = session["nip"]
        api, user = session_pool.get_client(current_nip)
        data = request.get_json(silent=True) or {}

        today = date.today()
        target_date = data.get("target_date") or today.strftime("%Y-%m-%d")
        item = data.get("item") or {}
        kode = data.get("kode_aktifitas") or item.get("kode_aktifitas")
        nama = data.get("nama_aktifitas") or item.get("nama_aktifitas") or kode
        volume = int(data.get("volume") or item.get("volume") or 1)
        keterangan = data.get("keterangan") or item.get("keterangan") or ""
        jm_val = str(data.get("jam_mulai") or item.get("jam_mulai") or "08:00")
        js_val = str(data.get("jam_selesai") or item.get("jam_selesai") or "12:00")
        jam_mulai = jm_val.split(":")[0].zfill(2)
        menit_mulai = jm_val.split(":")[-1].zfill(2) if ":" in jm_val else "00"
        jam_selesai = js_val.split(":")[0].zfill(2)
        menit_selesai = js_val.split(":")[-1].zfill(2) if ":" in js_val else "00"

        if not kode:
            return jsonify({"success": False, "error": "Kode aktivitas wajib diisi."}), 400

        skps = api.get_skp(kode) if hasattr(api, "get_skp") else []
        skp_id = int(data.get("sasaran_kerja_id") or item.get("sasaran_kerja_id") or (skps[0]["id"] if skps else 0))

        res = api.isi_aktivitas(
            tanggal=target_date,
            kode_aktifitas=kode,
            volume=volume,
            keterangan=keterangan,
            sasaran_kerja_id=skp_id,
            jam_mulai=jam_mulai,
            menit_mulai=menit_mulai,
            jam_selesai=jam_selesai,
            menit_selesai=menit_selesai,
            jenis="kinerja",
            nip18=current_nip
        )

        act_info = ai_engine.get_activity_by_code(kode)
        waktu_std = int(act_info.get("waktu", 60) or 60) if act_info else 60
        durasi = waktu_std * volume

        msg = f"Berhasil menginput ulang '{nama}' [{kode}] ({durasi} menit, Vol {volume}) pada tanggal {target_date}!"
        database.log_user_activity(current_nip, "REINPUT", msg)
        database.save_user_chat(current_nip, "bot", f"⚡ {msg}")
        mcp_sipendekar.invalidate_user_context_cache(current_nip)

        return jsonify({
            "success": True,
            "message": msg,
            "durasi_menit": durasi,
            "tanggal": target_date,
            "response": res
        })
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/activities/clone-yesterday", methods=["POST"])
@login_required
def clone_yesterday_activities():
    """
    Menyalin & menginput SEMUA aktivitas persis dari hari kerja sebelumnya
    (misal 2 template / sesi kerja) langsung ke tanggal target tanpa perlu review.
    """
    try:
        current_nip = session["nip"]
        api, user = session_pool.get_client(current_nip)
        data = request.get_json(silent=True) or {}
        today_str = date.today().strftime("%Y-%m-%d")
        target_date = data.get("target_date") or today_str

        target_dt = datetime.strptime(target_date, "%Y-%m-%d").date()
        source_date = None
        source_raw_items = []

        # Cari hari kerja terdekat sebelum target_date yang memiliki aktivitas riil
        for delta in range(1, 15):
            check_date = (target_dt - timedelta(days=delta)).strftime("%Y-%m-%d")
            items = api.get_aktivitas_harian(check_date)
            if items:
                source_date = check_date
                source_raw_items = items
                break

        if not source_date or not source_raw_items:
            return jsonify({
                "success": False,
                "error": "Tidak ditemukan riwayat kegiatan dari hari kerja sebelumnya untuk disalin."
            }), 400

        to_insert = []
        for cat_item in source_raw_items:
            kode = cat_item.get("kode_aktifitas", "")
            nama = cat_item.get("nama_aktifitas", "")
            waktu_std = int(cat_item.get("waktu") or 60)
            satuan = cat_item.get("satuan_output", "Laporan")
            for isi in cat_item.get("isi_aktifitas", []):
                vol = int(isi.get("volume", 1))
                ket = isi.get("keterangan") or f"Melaksanakan {nama.lower()}"
                jm = str(isi.get("jam_mulai", 8)).zfill(2)
                mm = str(isi.get("menit_mulai", 0)).zfill(2)
                js = str(isi.get("jam_selesai", 12)).zfill(2)
                ms = str(isi.get("menit_selesai", 0)).zfill(2)
                skp_id = int(isi.get("sasaran_kerja_id", 0))

                to_insert.append({
                    "kode": kode,
                    "nama": nama,
                    "volume": vol,
                    "satuan": satuan,
                    "keterangan": ket,
                    "jam_mulai": jm,
                    "menit_mulai": mm,
                    "jam_selesai": js,
                    "menit_selesai": ms,
                    "sasaran_kerja_id": skp_id,
                    "waktu_standar": waktu_std,
                    "durasi": vol * waktu_std
                })

        if not to_insert:
            return jsonify({
                "success": False,
                "error": f"Tidak ada data rincian kegiatan pada tanggal {source_date}."
            }), 400

        inserted_count = 0
        total_menit = 0
        details = []
        errors = []

        for act in to_insert:
            skp_id = act["sasaran_kerja_id"]
            if skp_id == 0:
                skps = api.get_skp(act["kode"]) if hasattr(api, "get_skp") else []
                if skps:
                    skp_id = skps[0]["id"]

            res = api.isi_aktivitas(
                tanggal=target_date,
                kode_aktifitas=act["kode"],
                volume=act["volume"],
                keterangan=act["keterangan"],
                sasaran_kerja_id=skp_id,
                jam_mulai=act["jam_mulai"],
                menit_mulai=act["menit_mulai"],
                jam_selesai=act["jam_selesai"],
                menit_selesai=act["menit_selesai"],
                jenis="kinerja",
                nip18=current_nip
            )

            # Portal response checking
            if isinstance(res, dict) and (res.get("success") or res.get("status") == "success" or not res.get("error")):
                inserted_count += 1
                total_menit += act["durasi"]
                details.append(f"{act['nama']} ({act['jam_mulai']}:{act['menit_mulai']} - {act['jam_selesai']}:{act['menit_selesai']}, {act['durasi']}m)")
            else:
                err_msg = res.get("error") if isinstance(res, dict) else str(res)
                errors.append(f"{act['nama']}: {err_msg}")

        if inserted_count == 0:
            return jsonify({
                "success": False,
                "error": f"Gagal menginput ke portal SiPENDEKAR: {'; '.join(errors)}"
            }), 500

        hours = round(total_menit / 60, 1)
        msg = f"Berhasil menginput persis {inserted_count} kegiatan seperti tanggal {source_date} (Total {total_menit} Menit / {hours} Jam) ke tanggal {target_date}!"
        database.log_user_activity(current_nip, "CLONE_YESTERDAY", msg)
        database.save_user_chat(current_nip, "bot", f"⚡ {msg}\n\n📋 **Daftar Kegiatan:**\n" + "\n".join([f"• {d}" for d in details]))
        mcp_sipendekar.invalidate_user_context_cache(current_nip)

        return jsonify({
            "success": True,
            "source_date": source_date,
            "target_date": target_date,
            "inserted_count": inserted_count,
            "total_menit": total_menit,
            "details": details,
            "message": msg
        })
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

# ==============================================================================
# SISTEM JADWAL OTOMATIS (SCHEDULER ENGINE: SPESIFIK TANGGAL & 2 TEMPLATE)
# ==============================================================================

def _execute_single_schedule(sch: Dict[str, Any], target_date: str) -> Dict[str, Any]:
    """Mengeksekusi jadwal otomatis untuk akun tertentu pada tanggal target (mendukung 1 atau 2 template)."""
    nip = sch["nip"]
    try:
        api, _ = session_pool.get_client(nip)
        tot, acts = api.get_total_menit_harian(target_date)

        # Cek apakah tanggal target sudah terisi penuh (misal >= 480 menit)
        if acts and tot >= 480:
            msg = f"Tanggal {target_date} sudah memiliki {tot} menit kegiatan di SiPENDEKAR. Pengisian otomatis dilewati agar tidak dobel."
            database.log_schedule_execution(nip, target_date, "SKIPPED_ALREADY_FILLED", msg)
            database.update_schedule_last_run(nip, target_date)
            return {"success": True, "status": "SKIPPED_ALREADY_FILLED", "message": msg}

        # Parse custom activities (bisa 1 atau 2 template)
        custom_data = {}
        try:
            custom_data = json.loads(sch.get("custom_activities") or "{}")
        except Exception:
            custom_data = {}

        activities_to_run = []
        if isinstance(custom_data, dict):
            if "activities" in custom_data and isinstance(custom_data["activities"], list):
                activities_to_run = custom_data["activities"]
            elif custom_data.get("kode_aktifitas"):
                activities_to_run = [custom_data]
        elif isinstance(custom_data, list):
            activities_to_run = custom_data

        if not activities_to_run:
            # Fallback jika belum ada aktivitas kustom: gunakan master template atau riwayat kemarin
            tmpl_num = sch.get("template_num", 1)
            tmpl = database.get_template_by_num(nip, tmpl_num)
            if tmpl:
                activities_to_run = [{
                    "kode_aktifitas": tmpl["kode_aktifitas"],
                    "nama_aktifitas": tmpl["nama_aktifitas"],
                    "volume": tmpl.get("volume", 1),
                    "keterangan": tmpl.get("keterangan", tmpl["nama_aktifitas"]),
                    "jam_mulai": f"{str(tmpl.get('jam_mulai', '07')).zfill(2)}:{str(tmpl.get('menit_mulai', '30')).zfill(2)}",
                    "jam_selesai": f"{str(tmpl.get('jam_selesai', '12')).zfill(2)}:{str(tmpl.get('menit_selesai', '30')).zfill(2)}"
                }]

        if not activities_to_run:
            # Fallback: duplikasi dari riwayat hari kerja sebelumnya
            rep = mcp_sipendekar.execute_replicate_previous_day(nip, api, target_date_str=target_date)
            msg = f"Jadwal otomatis sukses: {rep.get('reply', '')[:120]}"
            database.log_schedule_execution(nip, target_date, "SUCCESS", msg)
            database.update_schedule_last_run(nip, target_date)
            return {"success": True, "status": "SUCCESS", "message": msg}

        inserted_count = 0
        total_durasi = 0
        details = []
        errors = []

        for act in activities_to_run:
            kode = act.get("kode_aktifitas")
            if not kode:
                continue
            nama = act.get("nama_aktifitas", kode)
            vol = int(act.get("volume", 1))
            ket = act.get("keterangan") or f"Melaksanakan {nama.lower()}"
            jm_raw = str(act.get("jam_mulai", "08:00"))
            js_raw = str(act.get("jam_selesai", "12:00"))
            jm = jm_raw.split(":")[0].zfill(2)
            mm = jm_raw.split(":")[1].zfill(2) if ":" in jm_raw else "00"
            js = js_raw.split(":")[0].zfill(2)
            ms = js_raw.split(":")[1].zfill(2) if ":" in js_raw else "00"

            skp_id = int(act.get("id_skp") or act.get("sasaran_kerja_id") or 0)
            if skp_id == 0:
                skps = api.get_skp(kode) if hasattr(api, "get_skp") else []
                if skps:
                    skp_id = skps[0]["id"]

            res = api.isi_aktivitas(
                tanggal=target_date,
                kode_aktifitas=kode,
                volume=vol,
                keterangan=ket,
                sasaran_kerja_id=skp_id,
                jam_mulai=jm,
                menit_mulai=mm,
                jam_selesai=js,
                menit_selesai=ms,
                jenis="kinerja",
                nip18=nip
            )

            act_info = ai_engine.get_activity_by_code(kode)
            waktu_std = int(act_info.get("waktu", 60) or 60) if act_info else 60
            dur = vol * waktu_std

            if isinstance(res, dict) and (res.get("success") or res.get("status") == "success" or not res.get("error")):
                inserted_count += 1
                total_durasi += dur
                details.append(f"{nama} ({jm}:{mm} - {js}:{ms}, {dur}m)")
            else:
                err_msg = res.get("error") if isinstance(res, dict) else str(res)
                errors.append(f"{nama}: {err_msg}")

        if inserted_count == 0:
            err = f"Gagal mengeksekusi jadwal otomatis: {'; '.join(errors)}"
            database.log_schedule_execution(nip, target_date, "FAILED", err)
            return {"success": False, "status": "FAILED", "error": err}

        hours = round(total_durasi / 60, 1)
        msg = f"Jadwal otomatis sukses! Menginput {inserted_count} template kegiatan ke SiPENDEKAR pada tanggal {target_date} (Total {total_durasi} Menit / {hours} Jam)."
        database.log_schedule_execution(nip, target_date, "SUCCESS", msg)
        database.log_user_activity(nip, "AUTO_SCHEDULE", msg)
        database.update_schedule_last_run(nip, target_date)
        database.save_user_chat(nip, "bot", f"⏰ **Jadwal Otomatis Sukses Dijalankan!**\n\n{msg}\n\n📋 **Detail:**\n" + "\n".join([f"• {d}" for d in details]))
        mcp_sipendekar.invalidate_user_context_cache(nip)

        return {"success": True, "status": "SUCCESS", "message": msg, "inserted_count": inserted_count, "total_durasi": total_durasi}
    except Exception as ex:
        err = f"Gagal menjalankan jadwal otomatis tanggal {target_date}: {safe_error_msg(ex)}"
        database.log_schedule_execution(nip, target_date, "FAILED", err)
        return {"success": False, "status": "FAILED", "error": err}

def run_scheduler_worker():
    """Background worker daemon yang berjalan setiap 30 detik untuk memantau jadwal otomatis."""
    print("[SCHEDULER DAEMON] Worker jadwal otomatis aktif di background.")
    while True:
        try:
            time.sleep(30)
            now = datetime.now()
            now_hm = now.strftime("%H:%M")
            today = now.date()
            today_str = today.strftime("%Y-%m-%d")
            is_weekday = today.weekday() < 5 # Senin-Jumat

            active_schedules = database.get_all_active_schedules()
            for sch in active_schedules:
                nip = sch["nip"]
                mode = sch.get("schedule_mode", "specific_date")
                exec_time = sch.get("execution_time", "08:00")
                last_run = sch.get("last_run_date")

                should_run = False
                target_date = today_str

                # Cek target date kustom jika disetel
                custom_data = {}
                try:
                    custom_data = json.loads(sch.get("custom_activities") or "{}")
                except Exception:
                    custom_data = {}

                sch_type = custom_data.get("schedule_type") or mode

                if sch_type == "specific_date":
                    cfg_target_date = custom_data.get("target_date") or sch.get("target_dates")
                    if cfg_target_date and (last_run != cfg_target_date):
                        # Eksekusi jika hari ini sudah mencapai tanggal target dan waktu sudah tiba
                        if (today_str >= cfg_target_date) and (now_hm >= exec_time or today_str > cfg_target_date):
                            should_run = True
                            target_date = cfg_target_date
                else: # daily_weekday or shift (Mon-Sun)
                    today_day_code = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][today.weekday()]
                    allowed_days = (custom_data.get("days_of_week") or sch.get("target_dates") or "mon,tue,wed,thu,fri").split(",")
                    is_scheduled_day = today_day_code in allowed_days
                    if is_scheduled_day and (now_hm >= exec_time) and (last_run != today_str):
                        should_run = True
                        target_date = today_str

                if should_run:
                    print(f"[SCHEDULER] Menjalankan jadwal otomatis untuk NIP {nip} pada {target_date}...")
                    _execute_single_schedule(sch, target_date)
        except Exception as ex:
            print(f"[SCHEDULER WORKER ERROR] {ex}")

@app.route("/api/schedule", methods=["GET"])
@login_required
def get_user_schedule_endpoint():
    """Mengambil status, konfigurasi (1 atau 2 template), dan log jadwal otomatis pengguna."""
    try:
        current_nip = session["nip"]
        sch = database.get_user_schedule(current_nip)
        tomorrow_str = (date.today() + timedelta(days=1)).strftime("%Y-%m-%d")

        if sch:
            sch = dict(sch)
            sch["scheduled_time"] = sch.get("execution_time", "08:00")
            sch["days_of_week"] = sch.get("target_dates", "mon,tue,wed,thu,fri")
            sch["schedule_mode"] = sch.get("schedule_mode", "specific_date")
            sch["target_date"] = tomorrow_str

            try:
                cust = json.loads(sch.get("custom_activities") or "{}")
                if isinstance(cust, dict):
                    if cust.get("target_date"):
                        sch["target_date"] = cust.get("target_date")
                    if cust.get("schedule_type"):
                        sch["schedule_mode"] = cust.get("schedule_type")
                    if "activities" in cust:
                        sch["activities"] = cust["activities"]
                    sch.update(cust)
            except Exception:
                pass
        else:
            sch = {
                "is_active": 0,
                "schedule_mode": "specific_date",
                "target_date": tomorrow_str,
                "scheduled_time": "08:00",
                "days_of_week": "mon,tue,wed,thu,fri",
                "activities": [
                    {
                        "kode_aktifitas": "UTAMA00529",
                        "nama_aktifitas": "Membuat rekapitulasi data",
                        "standar_waktu": 60,
                        "volume": 4,
                        "satuan": "Laporan",
                        "jam_mulai": "08:00",
                        "jam_selesai": "12:00",
                        "keterangan": "Merekap data absensi kedinasan."
                    },
                    {
                        "kode_aktifitas": "UTAMA00926",
                        "nama_aktifitas": "Pengurusan administrasi kepegawaian",
                        "standar_waktu": 60,
                        "volume": 4,
                        "satuan": "Dokumen/ Laporan",
                        "jam_mulai": "12:00",
                        "jam_selesai": "16:00",
                        "keterangan": "Pengurusan administrasi cuti dan berkas pegawai."
                    }
                ]
            }

        logs = database.get_user_schedule_logs(current_nip, limit=15)
        tmpls = database.get_user_master_templates(current_nip)
        return jsonify({
            "success": True,
            "schedule": sch,
            "logs": logs,
            "templates": tmpls
        })
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/schedule/save", methods=["POST"])
@login_required
def save_user_schedule_endpoint():
    """Menyimpan konfigurasi jadwal otomatis (mendukung tanggal target spesifik & hingga 2 template)."""
    try:
        current_nip = session["nip"]
        data = request.get_json(silent=True) or {}
        is_active = int(data.get("is_active", 0))
        scheduled_time = str(data.get("scheduled_time") or data.get("execution_time", "08:00"))
        schedule_mode = str(data.get("schedule_mode", "specific_date"))
        target_date = str(data.get("target_date") or (date.today() + timedelta(days=1)).strftime("%Y-%m-%d"))
        days_of_week = str(data.get("days_of_week", "mon,tue,wed,thu,fri"))

        # Activities list (bisa 1 atau 2 template)
        activities = data.get("activities", [])
        if not activities:
            # Fallback dari single activity jika dikirim format lama
            single_act = {
                "kode_aktifitas": data.get("kode_aktifitas", "UTAMA00463"),
                "nama_aktifitas": data.get("nama_aktifitas", "Mengikuti pelatihan/sosialisasi/pendidikan"),
                "standar_waktu": data.get("standar_waktu", 300),
                "volume": data.get("volume", 1),
                "satuan": data.get("satuan", "Kegiatan"),
                "jam_mulai": data.get("jam_mulai", "07:30"),
                "jam_selesai": data.get("jam_selesai", "12:30"),
                "keterangan": data.get("keterangan", "Melaksanakan kegiatan kedinasan."),
                "id_skp": data.get("id_skp", "")
            }
            activities = [single_act]

        custom_payload = {
            "schedule_type": schedule_mode,
            "target_date": target_date,
            "template_count": len(activities),
            "activities": activities
        }

        saved = database.save_or_update_user_schedule(
            nip=current_nip,
            is_active=is_active,
            schedule_mode=schedule_mode,
            execution_time=scheduled_time,
            template_num=len(activities),
            custom_activities=json.dumps(custom_payload),
            target_dates=target_date if schedule_mode == "specific_date" else days_of_week
        )

        status_txt = "AKTIF ✅" if is_active else "NONAKTIF ⏸️"
        target_info = f"Tanggal {target_date}" if schedule_mode == "specific_date" else f"Rutin Hari Kerja ({days_of_week})"
        msg = f"Jadwal otomatis e-Kinerja berhasil disimpan! ({status_txt}, {len(activities)} Template, {target_info}, Jam: {scheduled_time} WIB)."
        database.log_user_activity(current_nip, "SCHEDULE_CONFIG", msg)

        return jsonify({
            "success": True,
            "message": msg,
            "schedule": saved
        })
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/schedule/run-now", methods=["POST"])
@login_required
def run_user_schedule_now():
    """Memicu eksekusi jadwal otomatis sekarang juga untuk tanggal yang ditentukan / hari ini."""
    try:
        current_nip = session["nip"]
        data = request.get_json(silent=True) or {}
        sch = database.get_user_schedule(current_nip)

        # Cek tanggal target dari request, atau dari jadwal, atau default hari ini
        custom_data = {}
        try:
            custom_data = json.loads(sch.get("custom_activities") or "{}") if sch else {}
        except Exception:
            pass

        target_date = data.get("target_date") or custom_data.get("target_date") or date.today().strftime("%Y-%m-%d")

        res = _execute_single_schedule(sch, target_date)
        return jsonify(res)
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500



# ==============================================================================
# KONFIGURASI & TESTING AI ASSISTANT
# ==============================================================================

@app.route("/api/ai/config", methods=["GET", "POST"])
@login_required
def handle_user_ai_config():
    """Mengambil atau memperbarui konfigurasi AI asisten pengguna dengan proteksi Anti-SSRF."""
    try:
        current_nip = session["nip"]
        if request.method == "POST":
            data = request.get_json(silent=True) or {}
            provider = data.get("provider", "crown").strip().lower()
            api_key = data.get("api_key", "").strip()
            model = data.get("model", "").strip()
            base_url = data.get("base_url", "").strip()
            is_enabled = int(data.get("is_enabled", 1))

            # Proteksi SSRF pada kustom base_url
            if base_url:
                is_safe, err_msg = validate_external_url(base_url)
                if not is_safe:
                    return jsonify({"success": False, "error": err_msg}), 400

            updated = database.save_user_ai_config(current_nip, provider, api_key, model, is_enabled, base_url=base_url)
            safe_cfg = dict(updated)
            safe_cfg.pop("api_key", None)
            return jsonify({
                "success": True,
                "message": "Konfigurasi AI berhasil disimpan!",
                "config": safe_cfg
            })
        else:
            cfg = database.get_user_ai_config(current_nip)
            safe_cfg = dict(cfg)
            safe_cfg.pop("api_key", None)
            return jsonify({
                "success": True,
                "config": safe_cfg
            })
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

@app.route("/api/ai/test", methods=["POST"])
@login_required
def test_user_ai_connection():
    """Menguji koneksi ke provider AI yang dipilih dengan proteksi Anti-SSRF."""
    try:
        current_nip = session["nip"]
        data = request.get_json(silent=True) or {}
        provider = data.get("provider", "crown").strip().lower()
        api_key = data.get("api_key", "").strip()
        model = data.get("model", "").strip()

        # Ambil konfigurasi database pengguna
        db_cfg = database.get_user_ai_config(current_nip)

        # Jika key kosong di request, ambil dari database
        if not api_key:
            api_key = db_cfg.get("api_key", "")

        if provider == "local":
            return jsonify({
                "success": True,
                "message": "⚡ Smart Local NLP Engine siap digunakan secara offline!",
                "latency_ms": 10
            })

        if provider == "crown" and not api_key:
            api_key = database.CROWN_API_KEY_DEFAULT

        if not api_key:
            return jsonify({
                "success": False,
                "error": f"API Key untuk {provider.upper()} belum diisi."
            }), 400

        t0 = time.time()
        test_prompt = "Balas dengan tepat: 'OK SiPENDEKAR AI Siap!'"
        resp = None

        if provider == "crown":
            base_url = db_cfg.get("base_url") or database.CROWN_BASE_URL_DEFAULT
            is_safe, err_msg = validate_external_url(base_url)
            if not is_safe:
                return jsonify({"success": False, "error": err_msg}), 400
            resp = ai_engine.call_crown_api(api_key, model or database.CROWN_MODEL_DEFAULT, [{"role": "user", "content": test_prompt}], base_url=base_url)
        elif provider == "gemini":
            resp = ai_engine.call_gemini_api(api_key, model or "gemini-3.5-flash", test_prompt)
        elif provider == "groq":
            resp = ai_engine.call_groq_api(api_key, model or "llama-3.3-70b-versatile", test_prompt)
        elif provider == "openai":
            resp = ai_engine.call_openai_api(api_key, model or "gpt-4o-mini", test_prompt)
        else:
            return jsonify({"success": False, "error": "Provider tidak dikenali."}), 400

        latency = round((time.time() - t0) * 1000)

        if resp:
            return jsonify({
                "success": True,
                "message": f"Koneksi {provider.upper()} Berhasil! ({latency} ms)",
                "sample_response": resp.strip(),
                "latency_ms": latency
            })
        else:
            return jsonify({
                "success": False,
                "error": f"Gagal mendapatkan respons dari {provider.upper()}. Periksa kembali validitas API Key Anda."
            }), 400
    except Exception as e:
        return jsonify({"success": False, "error": safe_error_msg(e)}), 500

# ==============================================================================
# MAIN ENTRYPOINT
# ==============================================================================

if __name__ == "__main__":
    database.init_db()
    port = int(os.environ.get("PORT", 3015))
    print(f"\n=================================================================")
    print(f"💬 SiPENDEKAR Messenger Assistant - Cloudflare Tunnel Edition")
    print(f"=================================================================")
    print(f"Server berjalan di : http://127.0.0.1:{port}")
    print(f"Cloudflare Hostname: https://calo.rsudtgrs.my.id")
    print(f"Tekan CTRL + C untuk menghentikan server.")
    print(f"=================================================================\n")
    # Start Background Scheduler Daemon Worker
    threading.Thread(target=run_scheduler_worker, daemon=True).start()

    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
