"""
ai_engine.py - Mesin Kecerdasan Buatan (AI) untuk SiPENDEKAR Assistant Bot.
Mendukung:
1. Google Gemini API (gemini-1.5-flash / gemini-2.0-flash)
2. Groq API (llama-3.3-70b-versatile / llama-3.1-8b-instant)
3. OpenAI API (gpt-4o-mini / gpt-4o)
4. Local Smart Heuristic NLP Engine (Offline, 0-API-Key, instant fallback)
5. Semantic Matching terhadap 2.123 Katalog Kegiatan SiPENDEKAR
"""

import os
import re
import json
import time
import requests
from datetime import datetime, date, timedelta
from typing import Dict, Any, List, Optional, Tuple

import database

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CATALOG_FILE = os.path.join(BASE_DIR, "activities_catalog.json")

# In-memory cached catalog & inverted word index
_ACTIVITIES_CACHE: List[Dict[str, Any]] = []
_WORD_INDEX: Dict[str, List[int]] = {}

def _clean_word(word: str) -> str:
    return re.sub(r'[^a-zA-Z0-9]', '', word).lower()

def load_activities_catalog() -> List[Dict[str, Any]]:
    """Memuat katalog 2.123 kegiatan dan membangun indeks kata untuk pencarian instan."""
    global _ACTIVITIES_CACHE, _WORD_INDEX
    if _ACTIVITIES_CACHE:
        return _ACTIVITIES_CACHE

    if not os.path.exists(CATALOG_FILE):
        return []

    try:
        with open(CATALOG_FILE, "r", encoding="utf-8") as f:
            items = json.load(f)

        _ACTIVITIES_CACHE = items
        # Bangun word index sederhana
        stopwords = {
            "dan", "di", "ke", "dari", "yang", "untuk", "pada", "dengan", "atau", "dalam",
            "atas", "ini", "itu", "oleh", "secara", "sebagai", "tentang", "serta"
        }
        word_idx: Dict[str, List[int]] = {}
        for idx, item in enumerate(items):
            nama = item.get("nama_aktifitas", "").lower()
            words = re.findall(r'[a-zA-Z0-9]+', nama)
            for w in set(words):
                w_clean = w.lower()
                if len(w_clean) >= 3 and w_clean not in stopwords:
                    if w_clean not in word_idx:
                        word_idx[w_clean] = []
                    word_idx[w_clean].append(idx)

        _WORD_INDEX = word_idx
        return _ACTIVITIES_CACHE
    except Exception as e:
        print(f"[AI ENGINE] Gagal memuat katalog: {e}")
def get_activity_by_code(kode: str) -> Optional[Dict[str, Any]]:
    """Mencari satu data kegiatan spesifik berdasarkan kode_aktifitas."""
    items = load_activities_catalog()
    for item in items:
        if item.get("kode_aktifitas") == kode:
            return item
    return None

def search_catalog_semantic(query: str, top_k: int = 5) -> List[Dict[str, Any]]:
    """Mencari kegiatan paling relevan dari 2.123 kegiatan SiPENDEKAR berdasarkan query natural."""
    items = load_activities_catalog()
    if not items or not query:
        return []

    PROMPT_STOPWORDS = {
        "bantu", "bantuan", "bantuannya", "bantuanku", "saya", "aku", "kami",
        "tolong", "mohon", "isi", "isiin", "isikan", "lapor", "laporin", "laporkan",
        "input", "inputkan", "sipendekar", "sama", "seperti", "kayak", "kemarin",
        "kmarin", "hari", "ini", "itu", "buatkan", "bikin", "bikinin", "coba",
        "tolongin", "dong", "saja", "aja", "nya", "kan", "dan", "di", "ke",
        "dari", "yang", "untuk", "pada", "dengan", "atau", "dalam", "atas",
        "oleh", "secara", "sebagai", "tentang", "serta", "kalo", "gimana", "gmna",
        "enaknya", "kegiatan", "aktivitas", "laporan", "mo", "mau"
    }
    q_words = [w.lower() for w in re.findall(r'[a-zA-Z0-9]+', query) if len(w) >= 3 and w.lower() not in PROMPT_STOPWORDS]
    if not q_words:
        popular_codes = ["UTAMA00529", "UTAMA00926", "UTAMA00463", "UTAMA00030", "UTAMA00461"]
        res = [act for code in popular_codes if (act := get_activity_by_code(code))]
        return res[:top_k] if res else items[:top_k]

    scores: Dict[int, float] = {}
    q_lower = query.lower()

    for w in q_words:
        matches = _WORD_INDEX.get(w, [])
        for idx in matches:
            scores[idx] = scores.get(idx, 0.0) + 2.0

    # Boost exact phrase match
    for idx, item in enumerate(items):
        nama = item.get("nama_aktifitas", "").lower()
        if any(w in nama for w in q_words):
            scores[idx] = scores.get(idx, 0.0) + 1.0
        # Boost kata kunci umum ASN (rapat, verifikasi, sosialisasi, apel, laporan)
        for kw in ["rapat", "sosialisasi", "pelatihan", "verifikasi", "validasi", "laporan", "pelayanan", "pengolahan data"]:
            if kw in q_lower and kw in nama:
                scores[idx] = scores.get(idx, 0.0) + 5.0

    if not scores:
        return items[:top_k]

    sorted_indices = sorted(scores.keys(), key=lambda i: scores[i], reverse=True)
    results = []
    for idx in sorted_indices[:top_k]:
        act = dict(items[idx])
        act["match_score"] = round(scores[idx], 2)
        results.append(act)
    return results

# ==============================================================================
# LOCAL HEURISTIC PARSER (WAKTU, TANGGAL, & INTENSI KERJA)
# ==============================================================================

def parse_work_statement(user_text: str, reference_date: Optional[date] = None) -> Dict[str, Any]:
    """
    Menganalisis kalimat bahasa Indonesia untuk mengekstrak:
    - Tanggal (hari ini, kemarin, lusa, nama hari, atau tanggal eksplisit)
    - Waktu mulai & selesai (08:00 - 15:30, jam 8 sampai 4 sore, dsb.)
    - Deskripsi pekerjaan
    - Matching katalog kegiatan
    """
    today = reference_date or date.today()
    lower = user_text.lower()

    # 1. Deteksi Tanggal (Explicit date, Backdate, Hari)
    target_date = today
    tgl_match = re.search(r'(\d{4}-\d{2}-\d{2})', lower)
    dmy_match = re.search(r'(\d{1,2})[/-](\d{1,2})[/-](\d{4})', lower)
    if tgl_match:
        try:
            target_date = datetime.strptime(tgl_match.group(1), "%Y-%m-%d").date()
        except Exception:
            pass
    elif dmy_match:
        try:
            d, m, y = int(dmy_match.group(1)), int(dmy_match.group(2)), int(dmy_match.group(3))
            target_date = date(y, m, d)
        except Exception:
            pass
    elif "kemarin" in lower:
        target_date = today - timedelta(days=1)
    elif "lusa" in lower or "2 hari lalu" in lower:
        target_date = today - timedelta(days=2)
    elif "senin" in lower:
        diff = (today.weekday() - 0) % 7
        target_date = today - timedelta(days=diff if diff > 0 else 7)
    elif "selasa" in lower:
        diff = (today.weekday() - 1) % 7
        target_date = today - timedelta(days=diff if diff > 0 else 7)
    elif "rabu" in lower:
        diff = (today.weekday() - 2) % 7
        target_date = today - timedelta(days=diff if diff > 0 else 7)
    elif "kamis" in lower:
        diff = (today.weekday() - 3) % 7
        target_date = today - timedelta(days=diff if diff > 0 else 7)
    elif "jumat" in lower:
        diff = (today.weekday() - 4) % 7
        target_date = today - timedelta(days=diff if diff > 0 else 7)

    # 2. Deteksi Jam Mulai & Jam Selesai
    # Mask date strings from text_for_time to avoid hyphens in 2026-10-26 being parsed as a time range
    text_for_time = re.sub(r'\b\d{4}-\d{2}-\d{2}\b', ' ', lower)
    text_for_time = re.sub(r'\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b', ' ', text_for_time)

    jam_mulai, menit_mulai = "08", "00"
    jam_selesai, menit_selesai = "16", "00"

    # Pattern fleksibel: jam 8 sampai 15.30 / 08:00 - 16:00 / jam 8 pagi sampai 4 sore / jam 8 sampe jam 12
    time_pat = r'(?:dari\s*)?(?:jam\s*)?(\d{1,2})(?:[.:](\d{2}))?\s*(?:pagi|siang)?\s*(?:-|sampai|sampe|s/d|hingga|sd)\s*(?:jam\s*)?(\d{1,2})(?:[.:](\d{2}))?\s*(sore|siang|malam|pagi)?'
    matches = list(re.finditer(time_pat, text_for_time, re.IGNORECASE))

    multi_activities = []
    if len(matches) >= 2:
        for idx, m in enumerate(matches):
            jm_s = int(m.group(1))
            mm_s = int(m.group(2) or 0)
            js_s = int(m.group(3))
            ms_s = int(m.group(4) or 0)
            mod_s = m.group(5) or ""
            if mod_s in ["sore", "siang", "malam"] or (js_s < jm_s and js_s <= 6):
                if js_s <= 12:
                    js_s += 12
            if not (0 <= jm_s <= 23 and 0 <= js_s <= 23 and 0 <= mm_s <= 59 and 0 <= ms_s <= 59):
                continue
            
            # Cari konteks teks terdekat dengan slot ini
            p_start = 0 if idx == 0 else matches[idx - 1].end()
            p_end = m.end()
            sub_chunk = user_text[p_start:p_end]
            sub_clean = re.sub(time_pat, '', sub_chunk, flags=re.IGNORECASE)
            sub_clean = re.sub(r'\b(dari|jam|terus|kemudian|lalu|saya|melakukan|mengerjakan|pekerjaan|dan|juga|kalo|gimana|gmna|enaknya|bikin|inputan|nya)\b', '', sub_clean, flags=re.IGNORECASE).strip()
            sub_clean = re.sub(r'\s+', ' ', sub_clean)
            
            s_cands = search_catalog_semantic(sub_clean if len(sub_clean) >= 3 else user_text, top_k=2)
            s_act = s_cands[0] if s_cands else {
                "kode_aktifitas": "UTAMA00463",
                "nama_aktifitas": "Mengikuti pelatihan/sosialisasi/pendidikan",
                "satuan_output": "Kegiatan",
                "waktu": 300
            }
            s_std = int(s_act.get("waktu", 60) or 60)
            s_dur = ((js_s * 60) + ms_s) - ((jm_s * 60) + mm_s)
            if s_dur <= 0:
                s_dur = 240
            s_vol = max(1, round(s_dur / s_std))
            s_synced = s_vol * s_std
            s_end = (jm_s * 60) + mm_s + s_synced
            s_js_str = f"{(s_end // 60) % 24:02d}"
            s_ms_str = f"{s_end % 60:02d}"
            
            multi_activities.append({
                "slot_num": idx + 1,
                "jam_mulai": f"{jm_s:02d}",
                "menit_mulai": f"{mm_s:02d}",
                "jam_selesai": s_js_str,
                "menit_selesai": s_ms_str,
                "durasi_menit": s_synced,
                "volume": s_vol,
                "waktu_standar": s_std,
                "kode_aktifitas": s_act.get("kode_aktifitas"),
                "nama_aktifitas": s_act.get("nama_aktifitas"),
                "satuan_output": s_act.get("satuan_output", "Output"),
                "keterangan": sub_clean or s_act.get("nama_aktifitas", "").lower()
            })

    if matches:
        time_flex = matches[0]
        jm = int(time_flex.group(1))
        mm = int(time_flex.group(2) or 0)
        js = int(time_flex.group(3))
        ms = int(time_flex.group(4) or 0)
        modifier = time_flex.group(5) or ""

        if modifier in ["sore", "siang", "malam"] or (js < jm and js <= 6):
            if js <= 12:
                js += 12

        if 0 <= jm <= 23 and 0 <= js <= 23 and 0 <= mm <= 59 and 0 <= ms <= 59:
            jam_mulai = f"{jm:02d}"
            menit_mulai = f"{mm:02d}"
            jam_selesai = f"{js:02d}"
            menit_selesai = f"{ms:02d}"

    # Hitung durasi awal dari teks
    durasi_menit = ((int(jam_selesai) * 60) + int(menit_selesai)) - ((int(jam_mulai) * 60) + int(menit_mulai))
    if durasi_menit <= 0:
        durasi_menit = 300

    # 3. Cari kegiatan terbaik dari katalog 2.123
    candidates = search_catalog_semantic(user_text, top_k=5)
    best_act = candidates[0] if candidates else {
        "kode_aktifitas": "UTAMA00463",
        "nama_aktifitas": "Mengikuti pelatihan/sosialisasi/pendidikan",
        "satuan_output": "Kegiatan",
        "waktu": 300
    }
    waktu_standar = int(best_act.get("waktu", 300) or 300)

    # 4. Sinkronisasi Volume & Jam Pelaksanaan
    # Di SiPENDEKAR: Menit Kinerja = Volume * Waktu Standar.
    vol_match = re.search(r'\b(?:volume|vol|sebanyak|sejumlah)\s*[:=]?\s*(\d{1,2})\b|\b(\d{1,2})\s*(?:volume|output|laporan|berkas|kegiatan)\b', lower)
    if vol_match:
        explicit_vol = int(vol_match.group(1) or vol_match.group(2))
        volume = max(1, explicit_vol)
    else:
        # Hitung volume dari rentang waktu
        volume = max(1, round(durasi_menit / waktu_standar))

    # Pastikan durasi_menit dan jam_selesai 100% sinkron dengan volume * waktu_standar
    durasi_menit = volume * waktu_standar
    start_m = int(jam_mulai) * 60 + int(menit_mulai)
    end_m = start_m + durasi_menit
    jam_selesai = f"{(end_m // 60) % 24:02d}"
    menit_selesai = f"{end_m % 60:02d}"

    # Bersihkan keterangan (hapus frasa waktu untuk deskripsi bersih)
    clean_desc = re.sub(time_pat, '', user_text, flags=re.IGNORECASE)
    clean_desc = re.sub(r'\b(hari ini|kemarin|tadi pagi|tadi|seharian|semalam)\b', '', clean_desc, flags=re.IGNORECASE)
    clean_desc = re.sub(r'\s+', ' ', clean_desc).strip()
    if len(clean_desc) < 5:
        clean_desc = best_act.get("nama_aktifitas", "").lower()

    return {
        "tanggal": target_date.strftime("%Y-%m-%d"),
        "jam_mulai": jam_mulai,
        "menit_mulai": menit_mulai,
        "jam_selesai": jam_selesai,
        "menit_selesai": menit_selesai,
        "durasi_menit": durasi_menit,
        "volume": volume,
        "waktu_standar": waktu_standar,
        "kode_aktifitas": best_act.get("kode_aktifitas"),
        "nama_aktifitas": best_act.get("nama_aktifitas"),
        "satuan_output": best_act.get("satuan_output", "Kegiatan"),
        "keterangan": clean_desc,
        "candidates": candidates,
        "multi_activities": multi_activities
    }

# ==============================================================================
# REST API CALLERS: GEMINI, GROQ, OPENAI
# ==============================================================================

def call_gemini_api(api_key: str, model: str, prompt: str, system_prompt: str = "") -> Optional[str]:
    """Memanggil Google Gemini API v1beta via direct REST request dengan model context window 1.000.000+ token."""
    preferred_models = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"]
    
    # Bersihkan nama model jika formatnya masih models/...
    clean_model = (model or "").replace("models/", "").strip()
    if clean_model in ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-2.5-flash"]:
        clean_model = "gemini-3.5-flash"

    candidates = [clean_model] if clean_model and clean_model not in preferred_models else []
    candidates.extend(preferred_models)

    contents = []
    if system_prompt:
        contents.append({
            "role": "user",
            "parts": [{"text": f"[Instruksi Sistem & Pedoman SiPENDEKAR]\n{system_prompt}\n\nKonfirmasi bahwa Anda memahami pedoman ini."}]
        })
        contents.append({
            "role": "model",
            "parts": [{"text": "Dipahami. Saya siap membantu pengguna SiPENDEKAR sesuai aturan e-Kinerja dan format JSON yang diminta."}]
        })
    
    contents.append({
        "role": "user",
        "parts": [{"text": prompt}]
    })

    payload = {
        "contents": contents,
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 2048
        }
    }

    for m in candidates:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={api_key}"
        try:
            resp = requests.post(url, json=payload, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                cand = data.get("candidates", [])
                if cand:
                    parts = cand[0].get("content", {}).get("parts", [])
                    if parts:
                        return parts[0].get("text", "")
            else:
                print(f"[AI GEMINI WARN] Model {m} returned HTTP {resp.status_code}, trying next model...")
        except Exception as e:
            print(f"[AI GEMINI EXCEPTION] Model {m}: {e}")
    return None

def call_groq_api(api_key: str, model: str, prompt: str, system_prompt: str = "") -> Optional[str]:
    """Memanggil Groq API via standard OpenAI-compatible endpoint."""
    if not model:
        model = "llama-3.3-70b-versatile"

    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 1024
    }

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=12)
        if resp.status_code == 200:
            data = resp.json()
            choices = data.get("choices", [])
            if choices:
                return choices[0].get("message", {}).get("content", "")
        else:
            print(f"[AI GROQ ERROR] HTTP {resp.status_code}: {resp.text}")
    except Exception as e:
        print(f"[AI GROQ EXCEPTION] {e}")
    return None

def call_openai_api(api_key: str, model: str, prompt: str, system_prompt: str = "") -> Optional[str]:
    """Memanggil OpenAI API standar."""
    if not model:
        model = "gpt-4o-mini"

    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 1024
    }

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            choices = data.get("choices", [])
            if choices:
                return choices[0].get("message", {}).get("content", "")
    except Exception as e:
        print(f"[AI OPENAI EXCEPTION] {e}")
    return None

def clean_llm_reasoning(text: str) -> str:
    """Membersihkan tag <think>...</think> dari model penalaran seperti DeepSeek atau GLM."""
    if not text:
        return ""
    cleaned = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL)
    cleaned = re.sub(r'<think>.*', '', cleaned, flags=re.DOTALL)
    return cleaned.strip()

def clean_unwanted_json_from_chat(text: str) -> str:
    """
    Mencegah kebocoran format JSON mentah ke gelembung obrolan Messenger/Telegram.
    Jika terdeteksi raw JSON (misal `{"action": "report_activity", ...}` atau ```json ... ```),
    fungsi ini otomatis mengkonversinya menjadi teks percakapan Markdown ramah khas SiPENDEKAR.
    """
    if not text:
        return ""
    s = text.strip()
    
    # Deteksi apakah mengandung format JSON
    is_json = (
        bool(re.search(r'```(?:json)?\s*\{.*?\}', s, re.DOTALL)) or
        (s.startswith('{') and ('"action"' in s or '"reply"' in s or '"tanggal"' in s)) or
        ('"action":' in s and ('"kode_aktifitas"' in s or '"report_activity"' in s or '"conversation"' in s))
    )
    if not is_json:
        return s

    def _extract_val(field_name: str, default: str = "") -> str:
        m = re.search(rf'["\']{field_name}["\']\s*:\s*["\']?([^"\'\n,}}]+)["\']?', s)
        return m.group(1).strip() if m else default

    action = _extract_val("action", "")

    # Kasus 1: JSON conversation dengan reply
    reply_m = re.search(r'["\']reply["\']\s*:\s*["\'](.*?)(?:["\']\s*,\s*["\']\w+["\']|["\']\}\s*$|["\']$)', s, re.DOTALL)
    if reply_m:
        cleaned_rep = reply_m.group(1).replace('\\n', '\n').replace('\\"', '"').replace('\\\\', '\\').strip()
        if len(cleaned_rep) > 5:
            return cleaned_rep

    # Kasus 2: JSON report_activity
    if "report_activity" in action or "report_activity" in s:
        tgl = _extract_val("tanggal", date.today().strftime("%Y-%m-%d"))
        jm = _extract_val("jam_mulai", "08")
        mm = _extract_val("menit_mulai", "00")
        js = _extract_val("jam_selesai", "16")
        ms = _extract_val("menit_selesai", "00")
        kode = _extract_val("kode_aktifitas", "")
        nama = _extract_val("nama_aktifitas", "")
        vol = _extract_val("volume", "1")
        durasi = _extract_val("durasi_menit", "480")
        ket = _extract_val("keterangan", "")
        exp = _extract_val("ai_explanation", "")

        act_info = get_activity_by_code(kode) if kode else None
        if act_info and not nama:
            nama = act_info.get("nama_aktifitas", "Pelaksanaan Tugas Kedinasan")
        if not nama:
            nama = "Pelaksanaan Tugas Kedinasan ASN"

        res = (
            f"✨ **Rekomendasi Rincian Pengisian e-Kinerja:**\n\n"
            f"{f'> 💡 *{exp}*' + chr(10) + chr(10) if exp else ''}"
            f"• 📋 **Kegiatan:** {nama} `{f'[{kode}]' if kode else ''}`\n"
            f"• 📅 **Tanggal:** {tgl}\n"
            f"• ⏱️ **Jam Pelaksanaan:** {jm}:{mm} - {js}:{ms} ({durasi} Menit)\n"
            f"• 📦 **Volume Output:** {vol} Output\n"
            f"• 📝 **Uraian Tugas:** {ket or nama}\n\n"
            f"💡 *Anda dapat langsung memasukkan rincian ini melalui menu **[✍️ Menu Input Mandiri]**.*"
        )
        return res

    # Kasus 3: JSON recommend_template
    if "recommend_template" in action or "recommend_template" in s:
        title = _extract_val("title", "Template Rutin Harian")
        kode = _extract_val("kode_aktifitas", "")
        nama = _extract_val("nama_aktifitas", "Kegiatan Rutin")
        jm = _extract_val("jam_mulai", "07")
        mm = _extract_val("menit_mulai", "30")
        js = _extract_val("jam_selesai", "17")
        ms = _extract_val("menit_selesai", "30")
        ket = _extract_val("keterangan", "Melaksanakan tugas rutin kedinasan")
        return (
            f"📋 **Rencana Master Template:**\n\n"
            f"• **Judul:** {title}\n"
            f"• **Kegiatan:** {nama} `{f'[{kode}]' if kode else ''}`\n"
            f"• **Waktu:** {jm}:{mm} - {js}:{ms} (600 Menit / 10 Jam Kerja)\n"
            f"• **Keterangan:** {ket}\n\n"
            f"💡 *Ketik **'template'** atau buka menu Master Template untuk menyimpannya.*"
        )

    # Fallback pembersihan tag markdown json
    cleaned = re.sub(r'^```(?:json)?\s*', '', s, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s*```$', '', cleaned).strip()
    return cleaned

def ensure_portal_offline_notice(reply: str, portal_online: bool, portal_error: str = "") -> str:
    """Memastikan bahwa jika server portal SiPENDEKAR offline/tidak terhubung, pesan chat secara eksplisit menginfokan kepada pengguna."""
    if portal_online:
        return reply

    lower_r = (reply or "").lower()
    has_notice = any(k in lower_r for k in [
        "tidak terhubung", "offline", "gangguan server", "kendala server",
        "server sipendekar sedang", "portal sipendekar sedang", "terputus", "kendala koneksi"
    ])
    if has_notice:
        return reply

    err_detail = f"\n> *Detail status: {portal_error}*" if portal_error else ""
    banner = (
        "> ⚠️ **Informasi Koneksi Server SiPENDEKAR:**\n"
        "> Saat ini server resmi portal SiPENDEKAR (BKPSDM) sedang **tidak terhubung / offline**.\n"
        f"{err_detail}\n"
        "> 💡 *Anda tetap dapat berkonsultasi, melihat template, mencari 2.123 kegiatan katalog lokal, atau menyiapkan draf laporan. Laporan siap dikirim segera setelah koneksi server pulih kembali.*\n\n"
        "---\n\n"
    )
    return banner + reply

def call_crown_api(
    api_key: str,
    model: str,
    messages: Any,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: str = "auto",
    base_url: str = "https://crown.ai.id/v1",
    timeout: int = 40,
    max_tokens: int = 1500
) -> Optional[Any]:
    """
    Memanggil Crown AI (Bansos AI Agentic) via endpoint OpenAI-compatible.
    Mendukung models:
    - zai-org/GLM-5.3-Flash
    - deepseek-ai/DeepSeek-V4-Flash-0731
    - MiniMaxAI/MiniMax-M2.7
    """
    if not api_key:
        api_key = database.CROWN_API_KEY_DEFAULT
    if not model:
        model = database.CROWN_MODEL_DEFAULT
    if not base_url:
        base_url = database.CROWN_BASE_URL_DEFAULT

    # Defense-in-depth Anti-SSRF check
    try:
        from app import validate_external_url
        is_safe, err_msg = validate_external_url(base_url)
        if not is_safe:
            print(f"[CROWN AI BLOCKED SSRF] {err_msg}")
            return None
    except Exception:
        pass

    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    if isinstance(messages, str):
        msg_list = [{"role": "user", "content": messages}]
    else:
        msg_list = messages

    payload = {
        "model": model,
        "messages": msg_list,
        "temperature": 0.2,
        "max_tokens": max_tokens
    }

    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = tool_choice

    try:
        resp = requests.post(endpoint, json=payload, headers=headers, timeout=timeout, allow_redirects=False)
        if resp.status_code == 200:
            data = resp.json()
            choices = data.get("choices", [])
            if choices:
                choice = choices[0]
                msg = choice.get("message", {})
                if tools:
                    return msg
                content = msg.get("content", "")
                return clean_llm_reasoning(content)
        else:
            print(f"[CROWN AI ERROR] HTTP {resp.status_code}: {resp.text}")
    except Exception as e:
        print(f"[CROWN AI EXCEPTION] {e}")
    return None

# Definisi Tools Agentic Format OpenAI untuk Crown AI Copilot
AGENTIC_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "check_sipendekar_connection",
            "description": "Mengecek status koneksi real-time ke portal resmi SiPENDEKAR BKPSDM (apakah server sedang online dan dapat diakses, atau offline/mengalami kendala koneksi).",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_ekinerja_progress",
            "description": "Mengambil capaian menit e-Kinerja real-time bulan berjalan dari portal SiPENDEKAR (total menit tercapai, target 7920 menit, sisa menit, dan hari terisi).",
            "parameters": {
                "type": "object",
                "properties": {
                    "year": {"type": "integer", "description": "Tahun pelaporan (default tahun berjalan)"},
                    "month": {"type": "integer", "description": "Bulan pelaporan 1-12 (default bulan berjalan)"}
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_empty_days_h7",
            "description": "Mengecek daftar hari kerja (Senin-Jumat) dalam batas aman 7 hari terakhir (H-7) yang belum dilaporkan di portal SiPENDEKAR.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_master_templates",
            "description": "Melihat daftar Master Template pengisian kegiatan rutin milik pengguna yang tersimpan di sistem.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_activities_catalog",
            "description": "Mencari kegiatan resmi yang paling relevan dari 2.123 katalog kegiatan SiPENDEKAR berdasarkan kata kunci natural.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Kata kunci pencarian pekerjaan (misal: verifikasi berkas, pelayanan, rapat koordinasi)"},
                    "limit": {"type": "integer", "description": "Jumlah rekomendasi maksimal (default 5)"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "recommend_and_save_template",
            "description": "Merancang dan menyimpan sebuah Master Template kegiatan rutin (600 menit) ke database pengguna untuk pelaporan cepat harian.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Judul template singkat dan menarik"},
                    "kode_aktifitas": {"type": "string", "description": "Kode aktivitas dari katalog resmi SiPENDEKAR"},
                    "nama_aktifitas": {"type": "string", "description": "Nama kegiatan resmi dari katalog"},
                    "keterangan": {"type": "string", "description": "Uraian tugas rutin formal harian"},
                    "jam_mulai": {"type": "string", "description": "Jam mulai format 2 digit (misal: '07')"},
                    "menit_mulai": {"type": "string", "description": "Menit mulai format 2 digit (misal: '30')"},
                    "jam_selesai": {"type": "string", "description": "Jam selesai format 2 digit (misal: '17')"},
                    "menit_selesai": {"type": "string", "description": "Menit selesai format 2 digit (misal: '30')"},
                    "durasi_menit": {"type": "integer", "description": "Durasi template dalam menit (default 600)"}
                },
                "required": ["title", "kode_aktifitas", "keterangan"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "submit_activity_report",
            "description": "Melaporkan / mengisi kegiatan e-Kinerja secara langsung ke portal resmi SiPENDEKAR BKPSDM (Auto-Submit).",
            "parameters": {
                "type": "object",
                "properties": {
                    "tanggal": {"type": "string", "description": "Tanggal pelaporan format YYYY-MM-DD"},
                    "kode_aktifitas": {"type": "string", "description": "Kode aktivitas kegiatan dari katalog resmi"},
                    "keterangan": {"type": "string", "description": "Uraian tugas pekerjaan yang dilaporkan"},
                    "jam_mulai": {"type": "string", "description": "Jam mulai (default '07')"},
                    "menit_mulai": {"type": "string", "description": "Menit mulai (default '30')"},
                    "jam_selesai": {"type": "string", "description": "Jam selesai (default '17')"},
                    "menit_selesai": {"type": "string", "description": "Menit selesai (default '30')"},
                    "volume": {"type": "integer", "description": "Volume output kegiatan (default 1)"}
                },
                "required": ["tanggal", "kode_aktifitas", "keterangan"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "copy_previous_day_activities",
            "description": "Menyalin seluruh kegiatan e-Kinerja dari hari kemarin (atau hari kerja sebelumnya yang terisi) dan melaporkannya langsung ke tanggal target (default hari ini) di portal SiPENDEKAR.",
            "parameters": {
                "type": "object",
                "properties": {
                    "target_date": {"type": "string", "description": "Tanggal tujuan pelaporan (format YYYY-MM-DD), default hari ini"}
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_day_activities",
            "description": "Mengambil rincian kegiatan e-Kinerja pengguna pada tanggal tertentu dari portal resmi SiPENDEKAR.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tanggal": {"type": "string", "description": "Tanggal yang ingin diperiksa (format YYYY-MM-DD)"}
                },
                "required": ["tanggal"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_recent_history",
            "description": "Melihat riwayat log transaksi pengisian laporan terakhir yang tersimpan di sistem.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "Jumlah riwayat terakhir (default 10)"}
                },
                "required": []
            }
        }
    }
]

def execute_agentic_tool(
    tool_name: str,
    args: Dict[str, Any],
    nip: str,
    api: Any,
    context: Dict[str, Any]
) -> Tuple[Dict[str, Any], Optional[str], Optional[Dict[str, Any]]]:
    """
    Mengeksekusi tool yang dipanggil oleh model LLM Crown AI.
    Mengembalikan (hasil_tool_dict, card_type, card_data).
    """
    today = date.today()
    portal_online = context.get("portal_online", False)
    portal_error = context.get("portal_error", "")
    card_type = None
    card_data = None
    result: Dict[str, Any] = {}

    if tool_name == "check_sipendekar_connection":
        result = {
            "portal_online": portal_online,
            "status": "ONLINE" if portal_online else "OFFLINE",
            "message": "Server portal resmi SiPENDEKAR BKPSDM sedang terhubung normal." if portal_online else f"Server portal resmi SiPENDEKAR sedang TIDAK TERHUBUNG / OFFLINE ({portal_error or 'gangguan koneksi pusat BKPSDM'}).",
            "offline_capabilities": "Pencarian 2.123 kegiatan katalog lokal, pembuatan & pemilihan Master Template, dan penyiapan draf laporan tetap dapat dilakukan 100% offline."
        }

    elif tool_name == "get_ekinerja_progress":
        if not portal_online:
            result = {
                "portal_online": False,
                "status": "SERVER_OFFLINE",
                "message": "Gagal mengambil data real-time karena server portal SiPENDEKAR sedang tidak terhubung.",
                "total_menit_catatan_lokal": context.get("total_menit", 0),
                "target_menit": context.get("target_menit", 7920),
                "sisa_menit": context.get("sisa_menit", 7920)
            }
            card_type = "progress_card"
            card_data = {
                "bulan_menit_total": context.get("total_menit", 0),
                "bulan_menit_target": context.get("target_menit", 7920),
                "bulan_menit_tercapai": context.get("tercapai", False),
                "bulan_jam_total": context.get("jam_total", 0),
                "is_offline": True
            }
        else:
            try:
                m = api.get_total_menit_bulanan() if api else {}
                cal = api.get_kalender_bulan(today.year, today.month) if api else {}
                evs = cal.get("result", []) if isinstance(cal, dict) else []
                tot = m.get("total", context.get("total_menit", 0))
                tgt = m.get("minimal", 7920)
                tercapai = m.get("tercapai", tot >= tgt)
                result = {
                    "portal_online": True,
                    "total_menit": tot,
                    "target_menit": tgt,
                    "sisa_menit": max(0, tgt - tot),
                    "tercapai": tercapai,
                    "hari_terisi": len(evs),
                    "utama_menit": m.get("utama", tot),
                    "tambahan_menit": m.get("tambahan", 0)
                }
                card_type = "progress_card"
                card_data = {
                    "bulan_menit_total": tot,
                    "bulan_menit_target": tgt,
                    "bulan_menit_tercapai": tercapai,
                    "bulan_jam_total": round(tot / 60, 1),
                    "bulan_menit_utama": m.get("utama", tot),
                    "bulan_menit_tambahan": m.get("tambahan", 0),
                    "filled_events_count": len(evs)
                }
            except Exception as e:
                result = {"portal_online": False, "error": str(e)}

    elif tool_name == "get_empty_days_h7":
        if not portal_online:
            result = {
                "portal_online": False,
                "status": "SERVER_OFFLINE",
                "message": "Pemeriksaan hari kosong memerlukan koneksi aktif ke portal SiPENDEKAR yang saat ini sedang tidak terhubung."
            }
        else:
            try:
                h7_start = today - timedelta(days=7)
                empty_days = api.cari_hari_kosong(h7_start, today, skip_weekends=True) if api else []
                result = {
                    "portal_online": True,
                    "jumlah_hari_kosong": len(empty_days),
                    "empty_days": empty_days
                }
                if empty_days:
                    card_type = "empty_days_card"
                    card_data = {"empty_days": empty_days}
            except Exception as e:
                result = {"portal_online": False, "error": str(e)}

    elif tool_name == "get_master_templates":
        templates = database.get_user_master_templates(nip)
        result = {
            "jumlah_template": len(templates),
            "templates": [
                {
                    "template_num": t["template_num"],
                    "title": t["title"],
                    "kegiatan": t["nama_aktifitas"],
                    "kode": t["kode_aktifitas"],
                    "durasi_menit": t.get("durasi_menit", 600)
                }
                for t in templates
            ]
        }
        if not templates:
            card_type = "create_template_card"
            card_data = {"next_num": 1, "existing_templates": []}

    elif tool_name == "search_activities_catalog":
        q = args.get("query", "")
        lim = int(args.get("limit", 5))
        matches = search_catalog_semantic(q, top_k=lim)
        result = {
            "query": q,
            "matches": [
                {
                    "kode_aktifitas": m["kode_aktifitas"],
                    "nama_aktifitas": m["nama_aktifitas"],
                    "satuan": m.get("satuan_output", "Kegiatan"),
                    "waktu_standar": m.get("waktu", 20)
                }
                for m in matches
            ]
        }

    elif tool_name == "recommend_and_save_template":
        next_num = database.get_next_template_num(nip)
        title = args.get("title", f"Master Template #{next_num}")
        kode = args.get("kode_aktifitas", "UTAMA00463")
        act = get_activity_by_code(kode)
        nama = args.get("nama_aktifitas") or (act["nama_aktifitas"] if act else "Kegiatan Rutin")
        jm = str(args.get("jam_mulai", "07")).zfill(2)
        mm = str(args.get("menit_mulai", "30")).zfill(2)
        js = str(args.get("jam_selesai", "17")).zfill(2)
        ms = str(args.get("menit_selesai", "30")).zfill(2)
        durasi = int(args.get("durasi_menit", 600))
        ket = args.get("keterangan", f"Melaksanakan tugas dinas rutin {nama.lower()}")

        saved = database.save_or_update_master_template(
            nip=nip,
            template_num=next_num,
            title=title,
            kode_aktifitas=kode,
            nama_aktifitas=nama,
            jam_mulai=jm,
            menit_mulai=mm,
            jam_selesai=js,
            menit_selesai=ms,
            durasi_menit=durasi,
            keterangan=ket,
            volume=1
        )
        result = {"status": "SUCCESS", "saved_template": saved}
        card_type = "template_success_card"
        card_data = {
            "template_num": next_num,
            "title": title,
            "durasi_menit": durasi,
            "kegiatan": nama
        }

    elif tool_name == "submit_activity_report":
        tgl = args.get("tanggal", today.strftime("%Y-%m-%d"))
        kode = args.get("kode_aktifitas", "")
        ket = args.get("keterangan", "")
        jm = str(args.get("jam_mulai", "07")).zfill(2)
        mm = str(args.get("menit_mulai", "30")).zfill(2)
        js = str(args.get("jam_selesai", "17")).zfill(2)
        ms = str(args.get("menit_selesai", "30")).zfill(2)
        vol = int(args.get("volume", 1))

        act = get_activity_by_code(kode)
        nama_keg = act["nama_aktifitas"] if act else kode
        waktu_standar = int(act.get("waktu", 300) or 300) if act else 300

        # Sinkronkan durasi dan jam selesai dengan volume * standar menit
        durasi = vol * waktu_standar
        start_m = int(jm) * 60 + int(mm)
        end_m = start_m + durasi
        js = f"{(end_m // 60) % 24:02d}"
        ms = f"{end_m % 60:02d}"

        if not portal_online or not api or not getattr(api, "is_logged_in", False):
            # Server offline: simpan sebagai draf aman
            result = {
                "status": "DRAFT_SAVED",
                "portal_online": False,
                "message": (
                    f"Server portal SiPENDEKAR saat ini sedang offline / tidak terhubung. "
                    f"Draf pelaporan e-Kinerja untuk tanggal {tgl} ({nama_keg}, {vol} Output, {durasi} Menit) "
                    f"telah disiapkan. Anda dapat langsung mengirimkannya via [Menu Input Mandiri] begitu server online kembali."
                ),
                "draf": {
                    "tanggal": tgl,
                    "kode_aktifitas": kode,
                    "nama_aktifitas": nama_keg,
                    "keterangan": ket,
                    "volume": vol,
                    "durasi_menit": durasi,
                    "jam_mulai": f"{jm}:{mm}",
                    "jam_selesai": f"{js}:{ms}"
                }
            }
            card_type = None
            card_data = None
        else:
            try:
                skps = api.get_skp(kode) if hasattr(api, "get_skp") else []
                skp_id = skps[0]["id"] if skps else 0
                resp = api.isi_aktivitas(
                    tanggal=tgl,
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
                database.log_user_activity(nip, "AUTO_SUBMIT", f"Lapor {nama_keg} [{kode}] {vol} Vol ({durasi} m) tgl {tgl} via Agentic AI")
                result = {
                    "status": "SUBMITTED",
                    "portal_online": True,
                    "tanggal": tgl,
                    "kegiatan": nama_keg,
                    "volume": vol,
                    "durasi_menit": durasi,
                    "jam": f"{jm}:{mm} - {js}:{ms}",
                    "response": resp
                }
                card_type = None
                card_data = None
            except Exception as e:
                result = {"status": "FAILED", "error": str(e), "portal_online": False}

    elif tool_name == "get_recent_history":
        lim = int(args.get("limit", 10))
        logs = database.get_user_activity_logs(nip, limit=lim)
        result = {"logs": logs}

    elif tool_name == "get_day_activities":
        tgl = args.get("tanggal") or today.strftime("%Y-%m-%d")
        if not portal_online or not api:
            result = {"portal_online": False, "status": "SERVER_OFFLINE", "message": "Portal SiPENDEKAR offline"}
        else:
            try:
                tot, acts = api.get_total_menit_harian(tgl)
                result = {"portal_online": True, "tanggal": tgl, "total_menit": tot, "activities": acts}
            except Exception as e:
                result = {"portal_online": False, "error": str(e)}

    elif tool_name in ["copy_previous_day_activities", "replicate_previous_day"]:
        target_date = args.get("target_date") or today.strftime("%Y-%m-%d")
        if not portal_online or not api or not getattr(api, "is_logged_in", False):
            result = {
                "portal_online": False,
                "status": "SERVER_OFFLINE",
                "message": "Portal offline, tidak dapat mengambil riwayat kemarin atau melaporkan kegiatan."
            }
        else:
            try:
                target_dt = datetime.strptime(target_date, "%Y-%m-%d").date()
            except Exception:
                target_dt = today
            found_acts = []
            source_date = None
            for i in range(1, 8):
                d = target_dt - timedelta(days=i)
                d_str = d.strftime("%Y-%m-%d")
                tot_d, acts_d = api.get_total_menit_harian(d_str)
                if acts_d:
                    found_acts = acts_d
                    source_date = d_str
                    break

            if not found_acts:
                result = {"status": "EMPTY", "message": "Tidak ditemukan riwayat kegiatan dalam 7 hari terakhir."}
            else:
                tot_t, acts_t = api.get_total_menit_harian(target_date)
                if acts_t:
                    result = {
                        "status": "ALREADY_FILLED",
                        "target_date": target_date,
                        "total_menit": tot_t,
                        "message": f"Tanggal {target_date} sudah memiliki {tot_t} menit kegiatan tercatat di portal.",
                        "existing_activities": acts_t
                    }
                else:
                    submitted = []
                    tot_sub = 0
                    for a in found_acts:
                        kode = a.get("kode_aktifitas")
                        vol = int(a.get("volume") or 1)
                        ket = a.get("keterangan") or f"Melaksanakan kegiatan {a.get('nama_aktifitas', '')}"
                        jm_str, mm_str = a.get("jam_mulai", "08:00").split(":")
                        js_str, ms_str = a.get("jam_selesai", "16:00").split(":")
                        skp_id = a.get("sasaran_kerja_id")
                        if not skp_id:
                            skps = api.get_skp(kode) if hasattr(api, "get_skp") else []
                            skp_id = skps[0]["id"] if skps else 0
                        api.isi_aktivitas(
                            tanggal=target_date,
                            kode_aktifitas=kode,
                            volume=vol,
                            keterangan=ket,
                            sasaran_kerja_id=skp_id,
                            jam_mulai=jm_str,
                            menit_mulai=mm_str,
                            jam_selesai=js_str,
                            menit_selesai=ms_str,
                            jenis="kinerja",
                            nip18=nip
                        )
                        dur = a.get("durasi_menit", 240)
                        tot_sub += dur
                        submitted.append(a)
                        database.log_user_activity(nip, "REPLICATE_DAY", f"Salin {a.get('nama_aktifitas')} ke {target_date}")
                    result = {
                        "status": "SUCCESS",
                        "target_date": target_date,
                        "source_date": source_date,
                        "total_menit_submitted": tot_sub,
                        "activities_submitted": submitted
                    }
                    card_type = "template_success_card"
                    card_data = {
                        "template_num": "COPY",
                        "title": f"Salin dari {source_date}",
                        "tanggal": target_date,
                        "durasi_menit": tot_sub,
                        "kegiatan": f"{len(submitted)} Kegiatan Kemarin"
                    }

    else:
        result = {"error": f"Tool '{tool_name}' tidak dikenal"}

    return result, card_type, card_data

def run_agentic_copilot(
    nip: str,
    user_message: str,
    api: Any,
    context: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Eksekutor AI otonom (Agentic Copilot) dengan Crown AI.
    Menjalankan loop reasoning-acting (ReAct) dengan live tools ke SiPENDEKAR.
    Jika server SiPENDEKAR offline, asisten AI menginfokan langsung di chat secara transparan.
    """
    load_activities_catalog()
    today = date.today()
    user_name = context.get("user_name", "Rekan ASN")
    portal_online = context.get("portal_online", False)
    portal_error = context.get("portal_error", "")

    ai_cfg = database.get_user_ai_config(nip)
    api_key = ai_cfg.get("api_key") or database.CROWN_API_KEY_DEFAULT
    model = ai_cfg.get("model") or database.CROWN_MODEL_DEFAULT
    base_url = ai_cfg.get("base_url") or database.CROWN_BASE_URL_DEFAULT

    conn_status_str = "✅ ONLINE & TERHUBUNG" if portal_online else f"⚠️ OFFLINE / TIDAK TERHUBUNG ({portal_error or 'Kendala koneksi ke server pusat BKPSDM'})"

    system_prompt = f"""Anda adalah SiPENDEKAR Autonomous Agentic Copilot — asisten AI resmi yang cerdas, proaktif, dan otonom untuk pelaporan e-Kinerja ASN BKPSDM Pemerintah Kabupaten Tangerang.
Anda memiliki akses ke live tools eksekusi untuk mengecek koneksi portal, memeriksa capaian menit, mengecek hari bolong H-7, mencari kegiatan dari 2.123 katalog resmi, mengelola Master Template, dan melaporkan kegiatan.

Profil Pengguna:
- Nama Pegawai: {user_name} (NIP: {nip})
- Waktu Lokal: {today.strftime('%A, %d %B %Y')} (Tanggal sistem: {today.strftime('%Y-%m-%d')})
- Capaian Terakhir: {context.get('total_menit', 0):,} / {context.get('target_menit', 7920):,} menit ({context.get('jam_total', 0)} jam)
- Status Koneksi Portal SiPENDEKAR: {conn_status_str}

KEWAJIBAN STATUS KONEKSI SERVER (SANGAT KRUSIAL):
1. Jika Status Koneksi Portal adalah OFFLINE / TIDAK TERHUBUNG:
   - Anda WAJIB MENGINFOKAN DI AWAL CHAT secara jelas, transparan, dan sopan kepada pengguna bahwa saat ini server resmi SiPENDEKAR sedang tidak terhubung / mengalami kendala koneksi dari server pusat BKPSDM.
   - Tenangkan pengguna: Sampaikan bahwa fitur konsultasi, pencarian katalog kegiatan (2.123 kegiatan), pengelolaan template, dan penyiapan draf laporan tetap aktif 100%. Laporan yang disiapkan dapat langsung dikirimkan ke portal begitu server pusat online kembali.
2. Jika pengguna bertanya apakah server sipendekar sedang terhubung atau tidak: Jawab langsung berdasarkan status koneksi saat ini ({'Online' if portal_online else 'Offline'}).
3. PENGISIAN 'SAMA SEPERTI KEMARIN' / DUPLIKAT HARI KEMARIN:
   - Jika pengguna meminta mengisi atau melaporkan kegiatan 'sama seperti hari kemarin', 'copy kemarin', 'seperti kemarin', atau 'duplikat kemarin':
     PANGGIL LANGSUNG tool `copy_previous_day_activities` dengan target_date hari ini. JANGAN mencocokkan kata 'bantu' dengan kegiatan 'Alat Bantu' dan JANGAN menganggap uraian tersebut sebagai nama kegiatan baru!

Gaya Komunikasi:
- Ramah, profesional khas aparatur sipil negara (ASN), gunakan formatting Markdown bersih (bold, bullet points, dan emoji yang pas).
- Respon Cepat & Ringkas: Berikan penjelasan yang padat, terstruktur, langsung ke inti solusi tanpa bertele-tele agar respon tercipta cepat dan nyaman dibaca.
- Otonom (Agentic): Panggil tool yang sesuai jika membutuhkan data atau mengeksekusi permintaan pengguna.
"""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message}
    ]

    last_card_type = None
    last_card_data = None
    final_reply = ""

    # Agentic loop (maksimal 3 putaran pemanggilan tool)
    max_turns = 3
    for turn in range(max_turns):
        msg = call_crown_api(
            api_key=api_key,
            model=model,
            messages=messages,
            tools=AGENTIC_TOOLS,
            tool_choice="auto",
            base_url=base_url,
            timeout=25,
            max_tokens=650
        )

        if not msg:
            print(f"[AGENTIC COPILOT] Crown AI tidak merespon di turn {turn}, fallback ke local NLP...")
            break

        tool_calls = msg.get("tool_calls")
        content = msg.get("content") or ""

        if tool_calls:
            messages.append(msg)
            for tc in tool_calls:
                fn_name = tc.get("function", {}).get("name", "")
                raw_args = tc.get("function", {}).get("arguments") or "{}"
                try:
                    fn_args = json.loads(raw_args)
                except Exception:
                    fn_args = {}

                t_res, c_type, c_data = execute_agentic_tool(fn_name, fn_args, nip, api, context)
                if c_type:
                    last_card_type = c_type
                    last_card_data = c_data

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", f"call_{fn_name}"),
                    "content": json.dumps(t_res, ensure_ascii=False)
                })
        else:
            final_reply = clean_llm_reasoning(content)
            break

    if not final_reply:
        # Cek apakah query pengguna adalah permintaan salin/copy kemarin
        import mcp_sipendekar
        lower_u = user_message.lower()
        if any(re.search(pat, lower_u) for pat in getattr(mcp_sipendekar, "REPLICATE_YESTERDAY_PATTERNS", [])):
            rep_res = mcp_sipendekar.execute_replicate_previous_day(nip, api, ctx=context)
            final_reply = rep_res.get("reply", "")
            last_card_type = rep_res.get("card_type")
            last_card_data = rep_res.get("card_data")
        else:
            # Fallback ke smart local NLP jika Crown AI timeout / error
            local_res = process_ai_chat(nip, user_message, context)
            final_reply = local_res.get("reply", "")
            if not last_card_type:
                last_card_type = local_res.get("card_type")
                last_card_data = local_res.get("card_data")

    # Jaminan keselamatan: Jika portal offline, pastikan chat menginfokan ke pengguna
    final_reply = ensure_portal_offline_notice(final_reply, portal_online, portal_error)

    return {
        "reply": final_reply,
        "card_type": last_card_type,
        "card_data": last_card_data,
        "is_ai": True,
        "provider": "crown"
    }

# ==============================================================================
# UNIFIED AI AGENT PROCESSOR
# ==============================================================================

def _internal_process_ai_chat(nip: str, user_message: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Memproses obrolan bebas pengguna dengan AI.
    1. Mengecek konfigurasi AI user (Gemini / Groq / OpenAI / Local).
    2. Mendeteksi apakah pesan berupa pelaporan aktivitas kerja atau pertanyaan/konsultasi.
    3. Jika pelaporan kerja: mengembalikan kartu draf pengisian e-Kinerja terisi otomatis!
    4. Jika pertanyaan/konsultasi: mengembalikan jawaban cerdas dengan rekomendasi konkret.
    """
    load_activities_catalog()
    today = date.today()
    user_name = context.get("user_name", "Rekan ASN")
    total_menit = context.get("total_menit", 0)
    target_menit = context.get("target_menit", 7920)
    sisa_menit = max(0, target_menit - total_menit)
    tercapai = context.get("tercapai", False)

    ai_cfg = database.get_user_ai_config(nip)
    provider = ai_cfg.get("provider", "local")
    api_key = ai_cfg.get("api_key", "").strip()
    model = ai_cfg.get("model", "")

    # Ambil 5 kegiatan katalog paling relevan untuk konteks LLM
    top_activities = search_catalog_semantic(user_message, top_k=6)
    catalog_context_str = "\n".join([
        f"- [{a['kode_aktifitas']}] {a['nama_aktifitas']} (Satuan: {a.get('satuan_output', 'Kegiatan')}, Durasi standar: {a.get('waktu', 20)} m)"
        for a in top_activities
    ])

    # Deteksi intensi khusus
    auto_submit_triggers = [
        "isi langsung", "langsung isi", "tolong isiin", "isiin langsung", "langsung lapor",
        "laporin langsung", "input langsung", "tolong inputkan", "submit langsung",
        "isi ke sipendekar", "masukin langsung", "lapor langsung", "isiin", "isikan langsung"
    ]
    is_auto_submit_req = any(t in user_message.lower() for t in auto_submit_triggers)

    template_rec_triggers = [
        "rekomendasi template", "rekomendasikan template", "bikinin template",
        "buatkan template", "template yang cocok", "saran template",
        "buat template baru", "ide template", "rekomendasiin bikin template",
        "rekomendasiin template", "rekomendasi template"
    ]
    is_template_rec_req = any(t in user_message.lower() for t in template_rec_triggers)

    report_work_triggers = [
        "isi kegiatan", "isi aktivitas", "lapor kegiatan", "catat kegiatan",
        "input kegiatan", "isi tanggal", "lapor tanggal", "lapor", "isi", "input",
        "backdate", "isi kerjaan", "masukin kegiatan", "lapor kerjaan"
    ]
    is_reporting_work = any(t in user_message.lower() for t in report_work_triggers)

    system_prompt = f"""Anda adalah SiPENDEKAR AI Assistant — asisten cerdas resmi untuk konsultasi dan pelaporan e-Kinerja ASN BKPSDM Pemerintah Kabupaten Tangerang.
Profil Pengguna Saat Ini:
- Nama Pegawai: {user_name} (NIP: {nip})
- Tanggal Hari Ini: {today.strftime('%Y-%m-%d')} ({today.strftime('%A')})
- Capaian Bulan Ini: {total_menit:,} / {target_menit:,} menit ({'✅ Target Tercapai' if tercapai else f'⚠️ Kurang {sisa_menit:,} menit'})
- Aturan Pengisian: Hari kerja Senin-Jumat, batas pengisian aman H-7, jam kerja normal 07:30 - 17:30 (10 jam / 600 menit).

Katalog Kegiatan SiPENDEKAR Terdekat dengan topik:
{catalog_context_str}

PEDOMAN FORMAT JAWABAN (SANGAT KRUSIAL):
1. SELALU GUNAKAN TEKS PERCAKAPAN MARKDOWN BERSIH, RAMAH, DAN PROFESIONAL.
   - JANGAN PERNAH mengeluarkan format kode JSON mentah seperti ```json {{ "action": ... }} ``` atau blok kurung kurawal ke layar chat!
   - Pengguna ingin membaca jawaban percakapan biasa khas Telegram (gunakan **bold**, bullet point, dan emoji yang relevan).

2. KONSULTASI PEMBAGIAN PEKERJAAN (MULTI-TASK DALAM SEHARI):
   - Jika pengguna menanyakan cara input pekerjaan untuk beberapa sesi (misal: "rekap data jam 8-12 lalu administrasi cuti jam 12-16"), jelaskan bahwa di SiPENDEKAR dianjurkan untuk MEMBAGI menjadi 2 inputan terpisah di Menu Input Mandiri agar tidak bentrok jam.
   - Rincikan dengan jelas:
     * Kegiatan 1: Jam pelaksanaan (08:00 - 12:00 = 240 menit), rekomendasi kegiatan dari katalog (nama & kode), volume output presisi, dan draft keterangannya.
     * Kegiatan 2: Jam pelaksanaan (12:00 - 16:00 = 240 menit), rekomendasi kegiatan dari katalog (nama & kode), volume output presisi, dan draft keterangannya.
     * Total capaian gabungan (misal 480 menit / 8 jam).
   - Berikan arahan ramah untuk mengisinya melalui tombol [✍️ Menu Input Mandiri].

3. HANYA JIKA PENGGUNA MINTA DIBUATKAN / DIREKOMENDASIKAN TEMPLATE BARU ("buatkan template", "bikinin template", dsb.):
   Keluarkan format JSON PERSIS agar tombol template dapat ditampilkan di chat:
   ```json
   {{
     "action": "recommend_template",
     "title": "Rutin - Judul Template Singkat Menarik",
     "kode_aktifitas": "KODE_DARI_KATALOG_DI_ATAS",
     "nama_aktifitas": "NAMA_DARI_KATALOG",
     "jam_mulai": "07",
     "menit_mulai": "30",
     "jam_selesai": "17",
     "menit_selesai": "30",
     "durasi_menit": 600,
     "volume": 1,
     "keterangan": "Uraian tugas rutin formal harian",
     "ai_explanation": "Penjelasan mengapa template ini cocok"
   }}
   ```
"""

    llm_response_text = None

    # 1. Coba panggil LLM jika API key tersedia
    if api_key and provider in ["gemini", "groq", "openai"]:
        if provider == "gemini":
            llm_response_text = call_gemini_api(api_key, model or "gemini-1.5-flash", user_message, system_prompt)
        elif provider == "groq":
            llm_response_text = call_groq_api(api_key, model or "llama-3.3-70b-versatile", user_message, system_prompt)
        elif provider == "openai":
            llm_response_text = call_openai_api(api_key, model or "gpt-4o-mini", user_message, system_prompt)

    # 2. Parsing output LLM jika berhasil
    if llm_response_text:
        try:
            parsed = None
            json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', llm_response_text, re.DOTALL)
            if json_match:
                try:
                    parsed = json.loads(json_match.group(1), strict=False)
                except Exception:
                    pass

            if not parsed:
                clean_txt = llm_response_text.strip()
                if clean_txt.startswith('{') and clean_txt.endswith('}'):
                    try:
                        parsed = json.loads(clean_txt, strict=False)
                    except Exception:
                        pass

            if not parsed:
                # Cek apakah ada pola "reply": "..."
                reply_m = re.search(r'"reply"\s*:\s*"(.*?)(?:"\s*,\s*"\w+"|"\}\s*$|\"$)', llm_response_text, re.DOTALL)
                if reply_m:
                    cleaned_reply = reply_m.group(1).replace('\\n', '\n').replace('\\"', '"').replace('\\\\', '\\').strip()
                    parsed = {"action": "conversation", "reply": cleaned_reply}
                else:
                    cleaned_raw = clean_unwanted_json_from_chat(llm_response_text)
                    parsed = {"action": "conversation", "reply": cleaned_raw}

            if parsed.get("action") == "report_activity":
                tgl = parsed.get("tanggal", today.strftime("%Y-%m-%d"))
                jm = parsed.get("jam_mulai", "07")
                mm = parsed.get("menit_mulai", "30")
                js = parsed.get("jam_selesai", "17")
                ms = parsed.get("menit_selesai", "30")
                durasi = parsed.get("durasi_menit") or (((int(js) * 60) + int(ms)) - ((int(jm) * 60) + int(mm)))
                if durasi <= 0:
                    durasi = 300
                kode = parsed.get("kode_aktifitas") or top_activities[0]["kode_aktifitas"]
                act_info = get_activity_by_code(kode)
                nama = parsed.get("nama_aktifitas") or (act_info.get("nama_aktifitas") if act_info else "Pelaksanaan Tugas Kedinasan")
                std_time = int(act_info.get("waktu", 300) if act_info else 300) or 300
                vol = parsed.get("volume") or max(1, round(durasi / std_time))
                synced_durasi = vol * std_time
                start_m = int(jm) * 60 + int(mm)
                end_m = start_m + synced_durasi
                js = f"{(end_m // 60) % 24:02d}"
                ms = f"{end_m % 60:02d}"
                jam_str = round(synced_durasi / 60, 1)
                ket = parsed.get("keterangan") or f"Melaksanakan tugas kedinasan {nama}"
                exp = parsed.get("ai_explanation") or "Rekomendasi kegiatan telah disinkronkan dengan katalog resmi SiPENDEKAR."
                auto_sub = parsed.get("auto_submit", False)

                reply = (
                    f"✨ **Analisis Aktivitas e-Kinerja Terdeteksi:**\n\n"
                    f"{exp}\n\n"
                    f"📋 **Rincian Usulan Laporan:**\n"
                    f"• **Kegiatan:** {nama} `[{kode}]`\n"
                    f"• **Tanggal:** {tgl}\n"
                    f"• **Volume Output:** {vol} Output ({std_time} Menit/Output)\n"
                    f"• **Jam Pelaksanaan:** {jm}:{mm} - {js}:{ms} ({synced_durasi} Menit / {jam_str} Jam) — *Sinkron dengan Volume*\n"
                    f"• **Uraian Tugas:** {ket}\n\n"
                    f"💡 *Formulir pelaporan mandiri dapat dibuka melalui tombol **[✍️ Menu Input Mandiri]** di bawah atau menu samping.*"
                )

                return {
                    "reply": reply,
                    "card_type": None,
                    "card_data": None,
                    "is_ai": True,
                    "auto_submit": auto_sub,
                    "provider": provider
                }
            elif parsed.get("action") == "recommend_template":
                next_num = database.get_next_template_num(nip)
                title = parsed.get("title") or f"Template Rutin #{next_num}"
                kode = parsed.get("kode_aktifitas") or top_activities[0]["kode_aktifitas"]
                nama = parsed.get("nama_aktifitas") or top_activities[0]["nama_aktifitas"]
                jm = parsed.get("jam_mulai", "07")
                mm = parsed.get("menit_mulai", "30")
                js = parsed.get("jam_selesai", "17")
                ms = parsed.get("menit_selesai", "30")
                durasi = parsed.get("durasi_menit", 600)
                ket = parsed.get("keterangan") or f"Melaksanakan tugas kedinasan {nama.lower()}"
                exp = parsed.get("ai_explanation") or f"Template ini disiapkan dengan durasi 600 menit (10 jam kerja) untuk mempermudah pemenuhan target bulanan 7.920 menit secara optimal."

                reply = (
                    f"✨ **Rekomendasi Master Template dari SiPENDEKAR AI!**\n\n"
                    f"{exp}\n\n"
                    f"📋 **Rencana Master Template #{next_num}:**\n"
                    f"• **Judul:** {title}\n"
                    f"• **Kegiatan:** {nama} `[{kode}]`\n"
                    f"• **Waktu:** {jm}:{mm} - {js}:{ms} ({durasi} Menit / 10 Jam)\n"
                    f"• **Keterangan:** {ket}\n\n"
                    f"Klik tombol **💾 Simpan Jadi Master Template** di bawah untuk langsung menyimpannya:"
                )

                card_data = {
                    "next_num": next_num,
                    "title": title,
                    "kode_aktifitas": kode,
                    "nama_aktifitas": nama,
                    "jam_mulai": jm,
                    "menit_mulai": mm,
                    "jam_selesai": js,
                    "menit_selesai": ms,
                    "durasi_menit": durasi,
                    "keterangan": ket,
                    "volume": 1,
                    "ai_provider": f"{provider.upper()} ({model or 'gemini-3.5-flash'})"
                }

                return {
                    "reply": reply,
                    "card_type": "ai_template_rec_card",
                    "card_data": card_data,
                    "is_ai": True,
                    "provider": provider
                }
            elif parsed.get("action") == "conversation":
                ans_text = clean_unwanted_json_from_chat(parsed.get("reply", llm_response_text))
                return {
                    "reply": ans_text,
                    "card_type": None,
                    "card_data": None,
                    "is_ai": True,
                    "provider": provider
                }
        except Exception as e:
            print(f"[AI PARSE WARN] {e}, cleaning raw response with sanitizer")
            clean_ans = clean_unwanted_json_from_chat(llm_response_text)
            return {
                "reply": clean_ans,
                "card_type": None,
                "card_data": None,
                "is_ai": True,
                "provider": provider
            }

    # ==============================================================================
    # 3. LOCAL HEURISTIC SMART NLP ENGINE (Fallback / Tanpa API Key)
    # ==============================================================================
    local_parsed = parse_work_statement(user_message, today)

    # Jika pengguna meminta rekomendasi template:
    if is_template_rec_req:
        next_num = database.get_next_template_num(nip)
        best = top_activities[0] if top_activities else {
            "kode_aktifitas": "UTAMA00030",
            "nama_aktifitas": "Melakukan pengolahan data / input data"
        }
        title = f"Rutin - {best['nama_aktifitas'][:35]}"
        kode = best["kode_aktifitas"]
        nama = best["nama_aktifitas"]
        jm, mm, js, ms = "07", "30", "17", "30"
        durasi = 600
        ket = f"Melaksanakan tugas dinas rutin {nama.lower()} harian"
        reply = (
            f"✨ **Rekomendasi Master Template dari SiPENDEKAR AI!**\n\n"
            f"Saya merekomendasikan template kerja rutin harian 600 menit (10 jam penuh) dari katalog kegiatan Anda:\n\n"
            f"📋 **Rencana Master Template #{next_num}:**\n"
            f"• **Judul:** {title}\n"
            f"• **Kegiatan:** {nama} `[{kode}]`\n"
            f"• **Waktu:** {jm}:{mm} - {js}:{ms} ({durasi} Menit / 10 Jam)\n"
            f"• **Keterangan:** {ket}\n\n"
            f"Dengan template ini, Anda hanya butuh ~13.2 hari kerja untuk menuntaskan target minimal 7.920 menit sebulan!\n"
            f"Klik tombol di bawah untuk langsung menyimpannya:"
        )
        card_data = {
            "next_num": next_num,
            "title": title,
            "kode_aktifitas": kode,
            "nama_aktifitas": nama,
            "jam_mulai": jm,
            "menit_mulai": mm,
            "jam_selesai": js,
            "menit_selesai": ms,
            "durasi_menit": durasi,
            "keterangan": ket,
            "volume": 1,
            "ai_provider": "Smart Local NLP Engine"
        }
        return {
            "reply": reply,
            "card_type": "ai_template_rec_card",
            "card_data": card_data,
            "is_ai": True,
            "provider": "local"
        }

    # Jika terdeteksi multi-kegiatan dalam satu hari (misal jam 8-12 rekap data, jam 12-16 cuti):
    if local_parsed.get("multi_activities"):
        multi = local_parsed["multi_activities"]
        tot_dur = sum(item["durasi_menit"] for item in multi)
        tot_jam = round(tot_dur / 60, 1)
        reply = (
            f"Halo Pak/Ibu **{user_name}**! 👋\n\n"
            f"Pertanyaan yang sangat baik! Karena Anda mengerjakan **{len(multi)} kegiatan berbeda** dalam satu hari, rekomendasi terbaiknya adalah **membuat {len(multi)} inputan kegiatan terpisah** di Menu Input Mandiri agar durasi waktu tercatat presisi dan sinkron:\n\n"
        )
        for idx, act in enumerate(multi):
            slot_title = "Pagi" if int(act['jam_mulai']) < 12 else "Siang / Sore"
            reply += (
                f"---\n"
                f"### {idx+1}️⃣ Kegiatan {idx+1} (Sesi {slot_title})\n"
                f"• 📋 **Kegiatan:** {act['nama_aktifitas']} `[{act['kode_aktifitas']}]`\n"
                f"• 📅 **Tanggal:** {local_parsed['tanggal']}\n"
                f"• ⏱️ **Rentang Jam:** **{act['jam_mulai']}:{act['menit_mulai']} s/d {act['jam_selesai']}:{act['menit_selesai']}** ({act['durasi_menit']} Menit)\n"
                f"• 📦 **Volume Output:** {act['volume']} Output *(Standar: {act['waktu_standar']} menit/output)*\n"
                f"• 📝 **Keterangan:** {act['keterangan']}\n\n"
            )
        reply += (
            f"---\n"
            f"📊 **Total Capaian Hari Ini:** **{tot_dur} Menit** ({tot_jam} Jam Kerja Diakui Penuh ✅)\n\n"
            f"💡 **Langkah Pengisiannya:**\n"
            f"Silakan klik menu **[✍️ Menu Input Mandiri]**:\n"
            f"1. Inputkan **Kegiatan 1** (jam {multi[0]['jam_mulai']}:{multi[0]['menit_mulai']} - {multi[0]['jam_selesai']}:{multi[0]['menit_selesai']}), lalu simpan.\n"
            f"2. Buka form kembali, inputkan **Kegiatan 2** (jam {multi[1]['jam_mulai']}:{multi[1]['menit_mulai']} - {multi[1]['jam_selesai']}:{multi[1]['menit_selesai']}), lalu simpan agar tidak bentrok jam (overlap)."
        )
        return {
            "reply": reply,
            "card_type": None,
            "card_data": None,
            "is_ai": True,
            "auto_submit": False,
            "provider": "local"
        }

    # Jika pengguna menceritakan pekerjaan yang telah dilakukan:
    if is_reporting_work or any(kw in user_message.lower() for kw in ["jam", "pukul", "rapat", "laporan", "kegiatan", "tadi", "kemarin", "senin", "selasa", "rabu", "kamis", "jumat"]):
        tgl = local_parsed["tanggal"]
        jm = local_parsed["jam_mulai"]
        mm = local_parsed["menit_mulai"]
        js = local_parsed["jam_selesai"]
        ms = local_parsed["menit_selesai"]
        durasi = local_parsed["durasi_menit"]
        kode = local_parsed["kode_aktifitas"]
        nama = local_parsed["nama_aktifitas"]
        ket = local_parsed["keterangan"]

        # Jika query umum dan user memiliki Master Template tersimpan, utamakan kegiatan dari template user
        user_tmpls = database.get_user_master_templates(nip)
        clean_msg = re.sub(r'\b(isi|kegiatan|tanggal|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|hari|senin|selasa|rabu|kamis|jumat|kemarin|lusa|tanpa|template)\b', '', user_message.lower()).strip()
        if user_tmpls and len(clean_msg) < 5:
            tmpl1 = user_tmpls[0]
            kode = tmpl1["kode_aktifitas"]
            nama = tmpl1["nama_aktifitas"]
            ket = tmpl1["keterangan"]
            jm = tmpl1["jam_mulai"]
            mm = tmpl1["menit_mulai"]
            js = tmpl1["jam_selesai"]
            ms = tmpl1["menit_selesai"]
            durasi = tmpl1.get("durasi_menit", 480)

        act_info = get_activity_by_code(kode)
        std_time = int(act_info.get("waktu", 300) if act_info else 300) or 300
        vol = local_parsed.get("volume") or max(1, round(durasi / std_time))
        synced_durasi = vol * std_time
        start_m = int(jm) * 60 + int(mm)
        end_m = start_m + synced_durasi
        js = f"{(end_m // 60) % 24:02d}"
        ms = f"{end_m % 60:02d}"
        jam_str = round(synced_durasi / 60, 1)

        reply = (
            f"✨ **Analisis Aktivitas e-Kinerja (Smart Local Engine):**\n\n"
            f"Saya mencocokkan uraian Anda dengan katalog kegiatan resmi SiPENDEKAR:\n"
            f"• 📋 **Kegiatan:** {nama} `[{kode}]`\n"
            f"• 📅 **Tanggal:** {tgl}\n"
            f"• 📦 **Volume:** {vol} Output ({std_time} Menit/Output)\n"
            f"• ⏱️ **Jam:** {jm}:{mm} - {js}:{ms} ({synced_durasi} Menit / {jam_str} Jam) — *Sinkron dengan Volume*\n"
            f"• 📝 **Keterangan:** {ket}\n\n"
            f"💡 *Silakan buka menu **[✍️ Menu Input Mandiri]** jika ingin langsung mengirimkan laporan ini ke portal SiPENDEKAR.*"
        )

        return {
            "reply": reply,
            "card_type": None,
            "card_data": None,
            "is_ai": True,
            "auto_submit": is_auto_submit_req,
            "provider": "local"
        }

    # Jika pertanyaan atau obrolan konsultasi tentang e-Kinerja:
    lower_msg = user_message.lower()
    if any(q in lower_msg for q in ["target", "kejar", "sisa", "kurang", "7920", "menit"]):
        if tercapai:
            ans = (
                f"🎉 **Target Bulan Ini Sudah Tercapai!**\n\n"
                f"• Capaian Anda: **{total_menit:,} Menit** (Target minimal: {target_menit:,} menit).\n"
                f"• Status: **100% Memenuhi Syarat Capaian e-Kinerja**.\n\n"
                f"💡 Anda tetap dapat menambahkan laporan kegiatan rutin harian hingga akhir bulan untuk memaksimalkan rekap kinerja Anda!"
            )
        else:
            jam_kurang = round(sisa_menit / 60, 1)
            # Asumsi hari kerja tersisa
            hari_kerja_butuh = max(1, round(sisa_menit / 600, 1))
            ans = (
                f"📊 **Analisis Kebutuhan Menit e-Kinerja ({user_name}):**\n\n"
                f"• **Capaian Saat Ini:** {total_menit:,} / {target_menit:,} Menit\n"
                f"• **Kekurangan Menit:** **{sisa_menit:,} Menit** (~{jam_kurang} Jam Kerja)\n"
                f"• **Estimasi Hari Pengisian:** Cukup **{hari_kerja_butuh} hari kerja** penuh (asumsi 10 jam / 600 menit per hari normal 07:30 - 17:30).\n\n"
                f"🚀 **Rekomendasi Cepat:**\n"
                f"1. Gunakan perintah **/hari_bolong** untuk memeriksa tanggal kerja dalam H-7 yang belum terisi.\n"
                f"2. Gunakan perintah **/autofill** untuk mengisi seluruh hari kosong tersebut dalam 1-klik!"
            )
        return {
            "reply": ans,
            "card_type": "progress_card",
            "card_data": {
                "bulan_menit_total": total_menit,
                "bulan_menit_target": target_menit,
                "bulan_menit_tercapai": tercapai,
                "bulan_jam_total": round(total_menit / 60, 1)
            },
            "is_ai": True,
            "provider": "local"
        }

    # Saran kegiatan rekomendasi
    if any(q in lower_msg for q in ["rekomendasi", "kegiatan apa", "katalog", "bagus"]):
        rec_list = "\n".join([
            f"• **[{a['kode_aktifitas']}]** {a['nama_aktifitas']} *(Satuan: {a.get('satuan_output', 'Kegiatan')})*"
            for a in top_activities[:5]
        ])
        ans = (
            f"💡 **Rekomendasi Kegiatan e-Kinerja dari 2.123 Katalog SiPENDEKAR:**\n\n"
            f"{rec_list}\n\n"
            f"💬 *Tips: Anda bisa langsung mengetik uraian tugas Anda dalam bahasa sehari-hari (misal: 'hari ini saya verifikasi berkas perizinan jam 8 sampai 4 sore') dan AI akan otomatis mengisi formulirnya untuk Anda!*"
        )
        return {
            "reply": ans,
            "card_type": None,
            "card_data": None,
            "is_ai": True,
            "provider": "local"
        }

    # Default friendly AI response
    ans = (
        f"Halo {user_name}! 👋 Saya **SiPENDEKAR AI Assistant**.\n\n"
        f"Anda dapat berbicara santai dengan saya untuk mengelola e-Kinerja Anda:\n"
        f"• ✍️ **Ceritakan kegiatan:** *\"Tadi saya ikut rapat koordinasi anggaran jam 8 sampai 15.30\"* -> AI otomatis menyiapkan draf laporannya!\n"
        f"• 📊 **Tanya progres:** *\"Berapa sisa menit saya bulan ini?\"*\n"
        f"• 📅 **Cek hari bolong:** *\"Ada hari kosong gak minggu ini?\"*\n"
        f"• ⚙️ **Konfigurasi AI:** Ketik **/ai** untuk menghubungkan Google Gemini / Groq API key gratis Anda!"
    )
    return {
        "reply": ans,
        "card_type": None,
        "card_data": None,
        "is_ai": True,
        "provider": "local"
    }

def process_ai_chat(nip: str, user_message: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """Wrapper pelindung: Menjalankan pemrosesan AI dan menjamin notice server offline selalu terpasang."""
    res = _internal_process_ai_chat(nip, user_message, context)
    portal_online = context.get("portal_online", False)
    portal_error = context.get("portal_error", "")
    if isinstance(res, dict) and "reply" in res:
        res["reply"] = clean_unwanted_json_from_chat(res["reply"])
        res["reply"] = ensure_portal_offline_notice(res["reply"], portal_online, portal_error)
    return res

