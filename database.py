"""
database.py - Database Layer untuk SiPENDEKAR Modern Messenger Edition.
Menangani akun pengguna terisolasi, enkripsi password AES Fernet, riwayat obrolan Messenger,
dan log aktivitas laporan per-pengguna secara privat.
"""

import os
import json
import base64
import sqlite3
import hashlib
from datetime import datetime
from typing import Optional, Dict, Any, List
from cryptography.fernet import Fernet

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "calo_data.db")
import secrets

def get_secret_seed() -> str:
    env_seed = os.environ.get("SIPENDEKAR_SECRET_SEED")
    if env_seed:
        return env_seed
    seed_file = os.path.join(BASE_DIR, ".db_seed")
    if os.path.exists(seed_file):
        try:
            with open(seed_file, "r", encoding="utf-8") as f:
                s = f.read().strip()
                if s:
                    return s
        except Exception:
            pass
    new_seed = secrets.token_hex(32)
    try:
        with open(seed_file, "w", encoding="utf-8") as f:
            f.write(new_seed)
        return new_seed
    except Exception:
        return new_seed

SECRET_KEY_SEED = get_secret_seed()

def get_cipher() -> Fernet:
    key_32 = hashlib.sha256(SECRET_KEY_SEED.encode("utf-8")).digest()
    fernet_key = base64.urlsafe_b64encode(key_32)
    return Fernet(fernet_key)

def encrypt_password(plain_password: str) -> str:
    cipher = get_cipher()
    return cipher.encrypt(plain_password.encode("utf-8")).decode("utf-8")

def decrypt_password(enc_password: str) -> str:
    try:
        cipher = get_cipher()
        return cipher.decrypt(enc_password.encode("utf-8")).decode("utf-8")
    except Exception:
        return enc_password

def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_FILE, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. Tabel Users Terisolasi
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nip TEXT UNIQUE NOT NULL,
            password_encrypted TEXT NOT NULL,
            name TEXT NOT NULL,
            avatar_color TEXT DEFAULT '#0084ff',
            created_at TEXT,
            last_login TEXT
        )
    """)

    # 2. Tabel Obrolan Messenger Pribadi per NIP
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nip TEXT NOT NULL,
            sender TEXT NOT NULL, -- 'user' atau 'bot'
            message TEXT NOT NULL,
            card_type TEXT DEFAULT NULL,
            card_data TEXT DEFAULT NULL,
            created_at TEXT
        )
    """)

    # 3. Tabel Riwayat Log Pengisian per NIP
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nip TEXT NOT NULL,
            action_type TEXT NOT NULL,
            message TEXT NOT NULL,
            status TEXT DEFAULT 'SUCCESS',
            created_at TEXT
        )
    """)

    # 4. Tabel Master Template e-Kinerja per NIP
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_master_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nip TEXT NOT NULL,
            template_num INTEGER NOT NULL,
            title TEXT NOT NULL,
            kode_aktifitas TEXT NOT NULL,
            nama_aktifitas TEXT NOT NULL,
            jam_mulai TEXT DEFAULT '07',
            menit_mulai TEXT DEFAULT '30',
            jam_selesai TEXT DEFAULT '17',
            menit_selesai TEXT DEFAULT '30',
            durasi_menit INTEGER DEFAULT 600,
            keterangan TEXT NOT NULL,
            volume INTEGER DEFAULT 1,
            created_at TEXT
        )
    """)

    # 5. Tabel Konfigurasi AI Asisten per NIP
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_ai_config (
            nip TEXT PRIMARY KEY,
            provider TEXT DEFAULT 'crown',
            api_key TEXT DEFAULT '',
            model TEXT DEFAULT 'zai-org/GLM-5.3-Flash',
            base_url TEXT DEFAULT 'https://crown.ai.id/v1',
            is_enabled INTEGER DEFAULT 1,
            system_prompt TEXT DEFAULT '',
            created_at TEXT,
            updated_at TEXT
        )
    """)
    try:
        cursor.execute("ALTER TABLE user_ai_config ADD COLUMN base_url TEXT DEFAULT 'https://crown.ai.id/v1'")
    except Exception:
        pass

    # 6. Tabel Sistem Jadwal Otomatis (Scheduler) per NIP
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_schedules (
            nip TEXT PRIMARY KEY,
            is_active INTEGER DEFAULT 0,
            schedule_mode TEXT DEFAULT 'daily_weekday',
            execution_time TEXT DEFAULT '16:00',
            template_num INTEGER DEFAULT 1,
            custom_activities TEXT DEFAULT '[]',
            target_dates TEXT DEFAULT '[]',
            last_run_date TEXT DEFAULT NULL,
            created_at TEXT,
            updated_at TEXT
        )
    """)

    # 7. Tabel Log Eksekusi Scheduler
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS schedule_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nip TEXT NOT NULL,
            target_date TEXT NOT NULL,
            status TEXT NOT NULL,
            details TEXT NOT NULL,
            executed_at TEXT
        )
    """)

    conn.commit()
    conn.close()

# ==============================================================================
# OPERASI PENGGUNA TERISOLASI
# ==============================================================================

def save_or_update_user(nip: str, password: str, name: Optional[str] = None) -> Dict[str, Any]:
    conn = get_db_connection()
    cursor = conn.cursor()
    enc_pw = encrypt_password(password)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute("SELECT id, name FROM users WHERE nip = ?", (nip,))
    existing = cursor.fetchone()

    palette = ["#0084ff", "#00c6ff", "#0099ff", "#06b6d4", "#10b981", "#8b5cf6"]
    import random
    avatar_color = random.choice(palette)

    if existing:
        final_name = name or existing["name"]
        cursor.execute("""
            UPDATE users 
            SET password_encrypted = ?, name = ?, last_login = ?
            WHERE nip = ?
        """, (enc_pw, final_name, now, nip))
    else:
        final_name = name or f"ASN {nip}"
        cursor.execute("""
            INSERT INTO users (nip, password_encrypted, name, avatar_color, created_at, last_login)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (nip, enc_pw, final_name, avatar_color, now, now))

    conn.commit()
    conn.close()

    return get_user_by_nip(nip)

def get_user_by_nip(nip: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE nip = ?", (nip,))
    row = cursor.fetchone()
    conn.close()
    if row:
        u = dict(row)
        u["password"] = decrypt_password(u["password_encrypted"])
        return u
    return None

# ==============================================================================
# OPERASI CHAT MESSENGER PRIBADI
# ==============================================================================

def save_user_chat(nip: str, sender: str, message: str, card_type: Optional[str] = None, card_data: Optional[Dict] = None) -> Dict[str, Any]:
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    card_json = json.dumps(card_data, ensure_ascii=False) if card_data else None

    cursor.execute("""
        INSERT INTO user_chat_messages (nip, sender, message, card_type, card_data, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (nip, sender, message, card_type, card_json, now))
    msg_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return {
        "id": msg_id,
        "nip": nip,
        "sender": sender,
        "message": message,
        "card_type": card_type,
        "card_data": card_data,
        "created_at": now
    }

def get_user_chats(nip: str, limit: int = 30) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM user_chat_messages WHERE nip = ? ORDER BY id DESC LIMIT ?
    """, (nip, limit))
    rows = cursor.fetchall()
    conn.close()

    msgs = []
    for r in reversed(rows):
        d = dict(r)
        if d.get("card_data"):
            try:
                d["card_data"] = json.loads(d["card_data"])
            except Exception:
                d["card_data"] = None
        msgs.append(d)
    return msgs

# ==============================================================================
# LOG AKTIVITAS PRIBADI
# ==============================================================================

def log_user_activity(nip: str, action_type: str, message: str, status: str = "SUCCESS"):
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute("""
        INSERT INTO user_activity_logs (nip, action_type, message, status, created_at)
        VALUES (?, ?, ?, ?, ?)
    """, (nip, action_type, message, status, now))
    conn.commit()
    conn.close()

def get_user_activity_logs(nip: str, limit: int = 20) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM user_activity_logs WHERE nip = ? ORDER BY id DESC LIMIT ?
    """, (nip, limit))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

# ==============================================================================
# MASTER TEMPLATES PENGISIAN SIPENDEKAR PRIBADI
# ==============================================================================

DEFAULT_MASTER_TEMPLATES = []

def seed_default_templates(nip: str):
    """Template awal dikosongkan sesuai preferensi pengguna."""
    pass

def clear_all_master_templates(nip: str):
    """Mengosongkan master template milik pengguna tertentu dari database."""
    if not nip:
        return
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM user_master_templates WHERE nip = ?", (nip,))
    conn.commit()
    conn.close()

def get_user_master_templates(nip: str) -> List[Dict[str, Any]]:
    """Mengambil daftar master template milik NIP tertentu."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM user_master_templates WHERE nip = ? ORDER BY template_num ASC
    """, (nip,))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

def get_template_by_num(nip: str, template_num: int) -> Optional[Dict[str, Any]]:
    """Mengambil satu master template berdasarkan nomor template."""
    seed_default_templates(nip)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM user_master_templates WHERE nip = ? AND template_num = ?
    """, (nip, template_num))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_next_template_num(nip: str) -> int:
    """Mendapatkan nomor urut template berikutnya yang belum dipakai."""
    seed_default_templates(nip)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT MAX(template_num) FROM user_master_templates WHERE nip = ?", (nip,))
    row = cursor.fetchone()
    max_num = row[0] if row and row[0] is not None else 0
    conn.close()
    return max_num + 1

def save_or_update_master_template(
    nip: str,
    template_num: int,
    title: str,
    kode_aktifitas: str,
    nama_aktifitas: str,
    jam_mulai: str,
    menit_mulai: str,
    jam_selesai: str,
    menit_selesai: str,
    durasi_menit: int,
    keterangan: str,
    volume: int = 1
) -> Dict[str, Any]:
    """Menyimpan atau memperbarui master template milik NIP."""
    seed_default_templates(nip)
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute("""
        SELECT id FROM user_master_templates WHERE nip = ? AND template_num = ?
    """, (nip, template_num))
    existing = cursor.fetchone()

    if existing:
        cursor.execute("""
            UPDATE user_master_templates SET
                title = ?,
                kode_aktifitas = ?,
                nama_aktifitas = ?,
                jam_mulai = ?,
                menit_mulai = ?,
                jam_selesai = ?,
                menit_selesai = ?,
                durasi_menit = ?,
                keterangan = ?,
                volume = ?,
                created_at = ?
            WHERE nip = ? AND template_num = ?
        """, (
            title, kode_aktifitas, nama_aktifitas,
            jam_mulai, menit_mulai, jam_selesai, menit_selesai,
            durasi_menit, keterangan, volume, now,
            nip, template_num
        ))
    else:
        cursor.execute("""
            INSERT INTO user_master_templates
            (nip, template_num, title, kode_aktifitas, nama_aktifitas, jam_mulai, menit_mulai, jam_selesai, menit_selesai, durasi_menit, keterangan, volume, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            nip, template_num, title, kode_aktifitas, nama_aktifitas,
            jam_mulai, menit_mulai, jam_selesai, menit_selesai,
            durasi_menit, keterangan, volume, now
        ))
    conn.commit()
    conn.close()
    return get_template_by_num(nip, template_num)

def delete_master_template(nip: str, template_num: int) -> bool:
    """Menghapus satu master template."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM user_master_templates WHERE nip = ? AND template_num = ?", (nip, template_num))
    conn.commit()
    affected = cursor.rowcount
    conn.close()
    return affected > 0

# ==============================================================================
# KONFIGURASI AI ASISTEN (GEMINI / GROQ / OPENAI / LOCAL)
# ==============================================================================

CROWN_API_KEY_DEFAULT = os.environ.get("CROWN_API_KEY", "crown-27f7af7aab27f0dfe005f97c6549138")
CROWN_BASE_URL_DEFAULT = "https://crown.ai.id/v1"
CROWN_MODEL_DEFAULT = "zai-org/GLM-5.3-Flash"

def get_user_ai_config(nip: str) -> Dict[str, Any]:
    """Mengambil konfigurasi AI pengguna. Default: Crown AI Bansos Agentic."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM user_ai_config WHERE nip = ?", (nip,))
    row = cursor.fetchone()
    conn.close()

    if row:
        cfg = dict(row)
        prov = cfg.get("provider", "crown")
        key = cfg.get("api_key") or ""
        # Jika provider crown dan api_key kosong, gunakan key bansos resmi
        if prov == "crown" and not key:
            key = CROWN_API_KEY_DEFAULT
            cfg["api_key"] = key
        cfg["api_key_masked"] = (key[:6] + "..." + key[-4:]) if len(key) > 10 else ("*" * len(key))
        cfg["has_api_key"] = bool(key)
        cfg["base_url"] = cfg.get("base_url") or CROWN_BASE_URL_DEFAULT
        return cfg

    return {
        "nip": nip,
        "provider": "crown",
        "api_key": CROWN_API_KEY_DEFAULT,
        "api_key_masked": CROWN_API_KEY_DEFAULT[:6] + "..." + CROWN_API_KEY_DEFAULT[-4:],
        "has_api_key": True,
        "model": CROWN_MODEL_DEFAULT,
        "base_url": CROWN_BASE_URL_DEFAULT,
        "is_enabled": 1,
        "system_prompt": ""
    }

def save_user_ai_config(nip: str, provider: str, api_key: str, model: str = "", is_enabled: int = 1, base_url: str = "") -> Dict[str, Any]:
    """Menyimpan atau memperbarui konfigurasi AI asisten pengguna."""
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute("SELECT nip, api_key FROM user_ai_config WHERE nip = ?", (nip,))
    existing = cursor.fetchone()

    # Model default berdasarkan provider
    if not model:
        if provider == "crown":
            model = CROWN_MODEL_DEFAULT
        elif provider == "gemini":
            model = "gemini-3.5-flash"
        elif provider == "groq":
            model = "llama-3.3-70b-versatile"
        elif provider == "openai":
            model = "gpt-4o-mini"
        else:
            model = "local-nlp"

    if provider == "crown":
        if not api_key:
            api_key = CROWN_API_KEY_DEFAULT
        if not base_url:
            base_url = CROWN_BASE_URL_DEFAULT
    else:
        # Jika user mengosongkan field api_key dan sudah pernah ada key tersimpan, pertahankan key lama
        if not api_key and existing and existing["api_key"]:
            api_key = existing["api_key"]

    if existing:
        cursor.execute("""
            UPDATE user_ai_config SET
                provider = ?,
                api_key = ?,
                model = ?,
                base_url = ?,
                is_enabled = ?,
                updated_at = ?
            WHERE nip = ?
        """, (provider, api_key, model, base_url, is_enabled, now, nip))
    else:
        cursor.execute("""
            INSERT INTO user_ai_config (nip, provider, api_key, model, base_url, is_enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (nip, provider, api_key, model, base_url, is_enabled, now, now))

    conn.commit()
    conn.close()
    return get_user_ai_config(nip)

# ==============================================================================
# OPERASI SISTEM JADWAL OTOMATIS (SCHEDULER)
# ==============================================================================

def get_user_schedule(nip: str) -> Dict[str, Any]:
    """Mengambil konfigurasi jadwal otomatis pengguna."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM user_schedules WHERE nip = ?", (nip,))
    row = cursor.fetchone()
    conn.close()

    if row:
        return dict(row)

    # Nilai default jika belum pernah dikonfigurasi
    return {
        "nip": nip,
        "is_active": 0,
        "schedule_mode": "daily_weekday",
        "execution_time": "16:00",
        "template_num": 1,
        "custom_activities": "[]",
        "target_dates": "[]",
        "last_run_date": None,
        "created_at": None,
        "updated_at": None
    }

def save_or_update_user_schedule(
    nip: str,
    is_active: int,
    schedule_mode: str = "daily_weekday",
    execution_time: str = "16:00",
    template_num: int = 1,
    custom_activities: str = "[]",
    target_dates: str = "[]"
) -> Dict[str, Any]:
    """Menyimpan atau memperbarui pengaturan jadwal otomatis e-Kinerja pengguna."""
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute("SELECT nip FROM user_schedules WHERE nip = ?", (nip,))
    existing = cursor.fetchone()

    if existing:
        cursor.execute("""
            UPDATE user_schedules SET
                is_active = ?,
                schedule_mode = ?,
                execution_time = ?,
                template_num = ?,
                custom_activities = ?,
                target_dates = ?,
                updated_at = ?
            WHERE nip = ?
        """, (is_active, schedule_mode, execution_time, template_num, custom_activities, target_dates, now, nip))
    else:
        cursor.execute("""
            INSERT INTO user_schedules (
                nip, is_active, schedule_mode, execution_time, template_num,
                custom_activities, target_dates, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (nip, is_active, schedule_mode, execution_time, template_num, custom_activities, target_dates, now, now))

    conn.commit()
    conn.close()
    return get_user_schedule(nip)

def update_schedule_last_run(nip: str, last_run_date: str):
    """Memperbarui tanggal eksekusi terakhir scheduler."""
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute("""
        UPDATE user_schedules SET
            last_run_date = ?,
            updated_at = ?
        WHERE nip = ?
    """, (last_run_date, now, nip))
    conn.commit()
    conn.close()

def log_schedule_execution(nip: str, target_date: str, status: str, details: str):
    """Mencatat log eksekusi otomatis scheduler."""
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute("""
        INSERT INTO schedule_logs (nip, target_date, status, details, executed_at)
        VALUES (?, ?, ?, ?, ?)
    """, (nip, target_date, status, details, now))
    conn.commit()
    conn.close()

def get_user_schedule_logs(nip: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Mengambil riwayat log eksekusi scheduler milik pengguna."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM schedule_logs
        WHERE nip = ?
        ORDER BY id DESC
        LIMIT ?
    """, (nip, limit))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_all_active_schedules() -> List[Dict[str, Any]]:
    """Mengambil semua akun yang mengaktifkan jadwal otomatis untuk diproses daemon."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM user_schedules WHERE is_active = 1")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]



