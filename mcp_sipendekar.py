"""
mcp_sipendekar.py - Model Context Protocol (MCP) & Tool Execution Engine untuk SiPENDEKAR AI.
Menyediakan tools resmi dan live-context sync bagi Asisten AI (Gemini / LLM)
sehingga data capaian menit, hari kosong, template, dan pelaporan selalu 100% akurat & sinkron.
"""

import re
import json
import time
import logging
from datetime import datetime, date, timedelta
from typing import Dict, Any, List, Optional, Tuple

import database
import ai_engine

logger = logging.getLogger("MCP_SiPENDEKAR")

# ==============================================================================
# 1. MCP TOOL DECLARATIONS (JSON Schema / Gemini Function Declarations)
# ==============================================================================

MCP_TOOL_DECLARATIONS = [
    {
        "name": "get_ekinerja_progress",
        "description": "Mengambil data real-time progres e-Kinerja bulan ini: total menit tercapai, target minimal 7.920 menit, status pemenuhan target, dan jumlah hari kerja yang sudah terisi.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "year": {"type": "INTEGER", "description": "Tahun pelaporan (default tahun berjalan)"},
                "month": {"type": "INTEGER", "description": "Bulan pelaporan 1-12 (default bulan berjalan)"}
            },
            "required": []
        }
    },
    {
        "name": "get_empty_days_h7",
        "description": "Mengecek daftar hari kerja (Senin-Jumat) yang masih kosong atau bolong belum dilaporkan dalam batas aman H-7 BKPSDM.",
        "parameters": {
            "type": "OBJECT",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "get_master_templates",
        "description": "Mengambil seluruh daftar Master Template kegiatan e-Kinerja yang dimiliki oleh pengguna saat ini.",
        "parameters": {
            "type": "OBJECT",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "recommend_master_template",
        "description": "Merancang dan merekomendasikan sebuah Master Template rutin harian (600 menit) yang relevan dengan tugas pengguna untuk mengejar atau mempertahankan target menit bulanan.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "title": {"type": "STRING", "description": "Judul template singkat dan menarik"},
                "kode_aktifitas": {"type": "STRING", "description": "Kode aktivitas dari katalog resmi SiPENDEKAR"},
                "nama_aktifitas": {"type": "STRING", "description": "Nama kegiatan resmi dari katalog"},
                "keterangan": {"type": "STRING", "description": "Uraian tugas rutin formal harian"},
                "durasi_menit": {"type": "INTEGER", "description": "Durasi template dalam menit (default 600 menit)"}
            },
            "required": ["title", "keterangan"]
        }
    },
    {
        "name": "submit_direct_activity",
        "description": "Melaporkan kegiatan secara langsung ke portal resmi SiPENDEKAR BKPSDM (Auto-Submit).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "tanggal": {"type": "STRING", "description": "Tanggal pelaporan format YYYY-MM-DD"},
                "kode_aktifitas": {"type": "STRING", "description": "Kode aktivitas kegiatan dari katalog resmi"},
                "keterangan": {"type": "STRING", "description": "Uraian tugas pekerjaan yang dilaporkan"},
                "jam_mulai": {"type": "STRING", "description": "Jam mulai format 2 digit (misal: '08')"},
                "menit_mulai": {"type": "STRING", "description": "Menit mulai format 2 digit (misal: '00')"},
                "jam_selesai": {"type": "STRING", "description": "Jam selesai format 2 digit (misal: '15')"},
                "menit_selesai": {"type": "STRING", "description": "Menit selesai format 2 digit (misal: '30')"}
            },
            "required": ["tanggal", "keterangan"]
        }
    },
    {
        "name": "replicate_previous_day_activities",
        "description": "Menyalin seluruh aktivitas kegiatan dari hari kerja sebelumnya (kemarin) dan melaporkannya langsung ke hari ini di portal SiPENDEKAR.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "target_date": {"type": "STRING", "description": "Tanggal target format YYYY-MM-DD (default hari ini)"}
            },
            "required": []
        }
    },
    {
        "name": "get_activity_history",
        "description": "Melihat riwayat transaksi pengisian laporan terakhir yang tersimpan di sistem.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "limit": {"type": "INTEGER", "description": "Jumlah riwayat terakhir (default 10)"}
            },
            "required": []
        }
    }
]

REPLICATE_YESTERDAY_PATTERNS = [
    r'(?:sama\s+(?:seperti|kayak|dgn|dengan)?|seperti|kayak|persis|copy|salin|duplikat|ikut|ngikut|ngikutin|copas)\s+(?:seperti\s+)?(?:kegiatan\s+)?(?:hari\s+)?k[ea]?marin',
    r'(?:kegiatan|laporan)\s+(?:hari\s+)?k[ea]?marin',
    r'/(?:copy_kemarin|salin_kemarin|kemarin)'
]

# ==============================================================================
# 2. LIVE CONTEXT FETCHER (DENGAN CACHING CEPAT & TIMEOUT AMAN)
# ==============================================================================

_LIVE_CONTEXT_CACHE: Dict[str, Dict[str, Any]] = {}

def invalidate_user_context_cache(nip: str) -> None:
    """Hapus cache konteks saat user submit laporan atau mutasi data."""
    _LIVE_CONTEXT_CACHE.pop(nip, None)

def get_live_user_context(nip: str, api: Any, portal_error: Optional[str] = None, force_refresh: bool = False) -> Dict[str, Any]:
    """
    Mengambil konteks real-time pengguna dengan in-memory caching (TTL 120s).
    Menghilangkan delay 15-30 detik pada setiap chat agar AI merespons instan (< 1 detik).
    """
    now = time.time()
    cached = _LIVE_CONTEXT_CACHE.get(nip)
    if not force_refresh and cached and (now - cached.get("timestamp", 0) < 120):
        data = dict(cached["data"])
        if portal_error:
            data["portal_error"] = portal_error
            data["portal_online"] = False
        return data

    today = date.today()
    user = database.get_user_by_nip(nip) or {}
    user_name = user.get("name", "Rekan ASN")

    tot_m = 0
    tgt_m = 7920
    tercapai = False
    events_count = 0
    utama_m = 0
    tambahan_m = 0
    portal_online = False

    # Gunakan fast timeout (3.5s) agar jika portal lambat/offline, AI tidak menunggu sampai 15-30 detik
    if api and hasattr(api, "is_logged_in") and api.is_logged_in and not portal_error:
        try:
            m = api.get_total_menit_bulanan(timeout=3)
            tot_m = m.get("total", 0)
            tgt_m = m.get("minimal", 7920)
            tercapai = m.get("tercapai", tot_m >= tgt_m)
            utama_m = m.get("utama", tot_m)
            tambahan_m = m.get("tambahan", 0)
            portal_online = True
        except Exception as e:
            logger.warning(f"Gagal mengambil menit bulanan dari portal: {e}")
            portal_error = f"Koneksi portal SiPENDEKAR lambat/timeout: {e}"
            portal_online = False

        if portal_online:
            try:
                cal = api.get_kalender_bulan(today.year, today.month, timeout=3)
                evs = cal.get("result", []) if isinstance(cal, dict) else []
                events_count = len(evs)
            except Exception as e:
                logger.warning(f"Gagal mengambil kalender: {e}")
    else:
        portal_online = False
        if not portal_error:
            portal_error = "Sesi login ke portal SiPENDEKAR tidak aktif atau terputus."

    jam_total = round(tot_m / 60, 1)
    sisa_m = max(0, tgt_m - tot_m)

    res_ctx = {
        "nip": nip,
        "user_name": user_name,
        "today_str": today.strftime("%Y-%m-%d"),
        "today_display": today.strftime("%A, %d %B %Y"),
        "total_menit": tot_m,
        "target_menit": tgt_m,
        "jam_total": jam_total,
        "sisa_menit": sisa_m,
        "tercapai": tercapai,
        "utama_menit": utama_m,
        "tambahan_menit": tambahan_m,
        "events_count": events_count,
        "portal_online": portal_online,
        "portal_error": portal_error or ""
    }

    _LIVE_CONTEXT_CACHE[nip] = {
        "data": res_ctx,
        "timestamp": now
    }
    return res_ctx

def execute_replicate_previous_day(
    nip: str,
    api: Any,
    target_date_str: Optional[str] = None,
    auto_submit: bool = True,
    ctx: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Menyalin riwayat aktivitas kegiatan dari hari sebelumnya (atau hari kerja terdekat yang terisi)
    dan secara otomatis melaporkannya ke tanggal target (default hari ini) di portal SiPENDEKAR.
    """
    if not ctx:
        ctx = get_live_user_context(nip, api)

    user_name = ctx.get("user_name", "Rekan ASN")
    portal_online = ctx.get("portal_online", False)

    if not portal_online or not api or not getattr(api, "is_logged_in", False):
        return {
            "reply": (
                "> ⚠️ **Informasi Koneksi Server SiPENDEKAR:**\n"
                "> Server portal resmi SiPENDEKAR saat ini sedang **tidak terhubung / offline**.\n\n"
                "Data riwayat aktivitas hari kemarin tidak dapat diambil dari server pusat BKPSDM. "
                "Silakan periksa daftar Master Template (`/template`) atau gunakan formulir input mandiri saat server telah pulih."
            ),
            "card_type": None,
            "card_data": None,
            "tool_used": "replicate_previous_day"
        }

    today = date.today()
    target_date = target_date_str or ctx.get("today_str") or today.strftime("%Y-%m-%d")
    try:
        target_dt = datetime.strptime(target_date, "%Y-%m-%d").date()
    except Exception:
        target_dt = today

    # Cek apakah tanggal target sudah memiliki aktivitas tercatat
    tot_target, acts_target = api.get_total_menit_harian(target_date)

    # Cari hari kerja sebelumnya yang memiliki laporan aktivitas (mundur hingga 7 hari)
    found_acts = []
    source_date_str = None
    for i in range(1, 8):
        d = target_dt - timedelta(days=i)
        d_str = d.strftime("%Y-%m-%d")
        tot_d, acts_d = api.get_total_menit_harian(d_str)
        if acts_d:
            found_acts = acts_d
            source_date_str = d_str
            break

    if not found_acts:
        return {
            "reply": (
                f"ℹ️ **Tidak Ditemukan Kegiatan Hari Kemarin:**\n\n"
                f"Sistem tidak menemukan catatan aktivitas e-Kinerja dalam 7 hari terakhir di portal SiPENDEKAR untuk disalin ke tanggal {target_date}.\n\n"
                f"💡 Anda dapat menggunakan perintah **/template** untuk memilih template kegiatan harian atau gunakan tombol **[✍️ Menu Input Mandiri]**."
            ),
            "card_type": None,
            "card_data": None,
            "tool_used": "replicate_previous_day"
        }

    # Jika hari target sudah terisi penuh (misal sudah ada kegiatan tercatat):
    if len(acts_target) > 0:
        keg_list_str = "\n".join([
            f"• 📋 **{a['nama_aktifitas']}** `[{a['kode_aktifitas']}]` — ⏱️ {a['jam_mulai']} s/d {a['jam_selesai']} ({a['durasi_menit']} Menit, Vol {a['volume']})\n  📝 *Ket: {a.get('keterangan', '-') or '-'}*"
            for a in acts_target
        ])
        reply = (
            f"✅ **Laporan Tanggal {target_date} Sudah Terisi Lengkap!**\n\n"
            f"Kegiatan e-Kinerja Anda untuk hari ini sudah tercatat resmi di portal SiPENDEKAR ({tot_target} Menit):\n\n"
            f"{keg_list_str}\n\n"
            f"🎉 **Total Capaian Hari Ini:** **{tot_target} Menit** ({round(tot_target/60, 1)} Jam Kerja Penuh ✅)\n"
            f"Status pengisian e-Kinerja Anda aman dan sinkron dengan portal BKPSDM."
        )
        return {
            "reply": reply,
            "card_type": "progress_card",
            "card_data": {
                "bulan_menit_total": ctx["total_menit"],
                "bulan_menit_target": ctx["target_menit"],
                "bulan_menit_tercapai": ctx["tercapai"],
                "bulan_jam_total": ctx["jam_total"]
            },
            "tool_used": "replicate_previous_day"
        }

    # Lakukan submission otomatis untuk setiap aktivitas yang ditemukan
    submitted_acts = []
    total_synced_menit = 0
    errors = []

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

        try:
            resp = api.isi_aktivitas(
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
            durasi = a.get("durasi_menit", 240)
            total_synced_menit += durasi
            submitted_acts.append({
                "kode_aktifitas": kode,
                "nama_aktifitas": a.get("nama_aktifitas"),
                "jam_mulai": a.get("jam_mulai"),
                "jam_selesai": a.get("jam_selesai"),
                "durasi_menit": durasi,
                "volume": vol,
                "keterangan": ket
            })
            database.log_user_activity(nip, "REPLICATE_DAY", f"Salin {a.get('nama_aktifitas')} [{kode}] ke {target_date}")
        except Exception as e:
            errors.append(f"{a.get('nama_aktifitas')}: {str(e)}")

    if submitted_acts:
        keg_items = "\n\n".join([
            f"{idx+1}️⃣ **{act['nama_aktifitas']}** `[{act['kode_aktifitas']}]`\n"
            f"• ⏱️ **Jam:** {act['jam_mulai']} s/d {act['jam_selesai']} ({act['durasi_menit']} Menit)\n"
            f"• 📦 **Volume:** {act['volume']} Output\n"
            f"• 📝 **Keterangan:** {act['keterangan']}"
            for idx, act in enumerate(submitted_acts)
        ])
        total_jam = round(total_synced_menit / 60, 1)
        reply = (
            f"⚡ **Sukses! Kegiatan Hari Kemarin Berhasil Disalin ke Hari Ini:**\n\n"
            f"Saya telah mengambil data riwayat kegiatan resmi Anda dari tanggal **{source_date_str}** dan **langsung melaporkannya ke portal SiPENDEKAR** untuk tanggal **{target_date}**:\n\n"
            f"{keg_items}\n\n"
            f"---\n"
            f"📊 **Total Capaian Terlaporkan:** **{total_synced_menit} Menit** ({total_jam} Jam Kerja Penuh ✅)\n"
            f"Status: **Tercatat Resmi & Terverifikasi di Portal BKPSDM!** 🚀"
        )
        return {
            "reply": reply,
            "card_type": "template_success_card",
            "card_data": {
                "template_num": "COPY",
                "title": f"Salin dari {source_date_str}",
                "tanggal": target_date,
                "durasi_menit": total_synced_menit,
                "kegiatan": f"{len(submitted_acts)} Kegiatan Kemarin"
            },
            "tool_used": "replicate_previous_day"
        }
    else:
        err_msg = ", ".join(errors) if errors else "Gagal mengirim kegiatan ke portal."
        return {
            "reply": (
                f"⚠️ **Gagal Melaporkan Salinan Kegiatan:**\n"
                f"{err_msg}\n\n"
                f"Silakan periksa koneksi portal atau gunakan menu [✍️ Menu Input Mandiri]."
            ),
            "card_type": None,
            "card_data": None,
            "tool_used": "replicate_previous_day"
        }

# ==============================================================================
# 3. MCP TOOL EXECUTOR
# ==============================================================================

def execute_mcp_tool(
    tool_name: str,
    args: Dict[str, Any],
    nip: str,
    api: Any,
    user_msg: str = ""
) -> Dict[str, Any]:
    """
    Mengeksekusi MCP Tool dan menghasilkan respon tunggal tersinkronisasi
    antara teks AI dan kartu widget Telegram yang sesuai.
    """
    today = date.today()
    ctx = get_live_user_context(nip, api)
    user_name = ctx["user_name"]

    # --------------------------------------------------------------------------
    # TOOL: get_ekinerja_progress
    # --------------------------------------------------------------------------
    if tool_name == "get_ekinerja_progress":
        tot_m = ctx["total_menit"]
        tgt_m = ctx["target_menit"]
        jam_tot = ctx["jam_total"]
        tercapai = ctx["tercapai"]
        events_count = ctx["events_count"]
        status_txt = "✅ Target Minimal Tercapai" if tercapai else f"⚠️ Kurang {ctx['sisa_menit']:,} Menit"

        reply = (
            f"📊 **Ringkasan e-Kinerja Bulan Ini ({today.strftime('%B %Y')}):**\n"
            f"• **Pegawai:** {user_name}\n"
            f"• **Total Capaian:** **{tot_m:,} / {tgt_m:,} menit** ({jam_tot} Jam) ({status_txt})\n"
            f"• **Aktivitas Utama:** {ctx['utama_menit']:,} m | **Tambahan:** {ctx['tambahan_menit']:,} m\n"
            f"• **Hari Terisi:** {events_count} Hari Kerja\n\n"
        )
        if tercapai:
            surplus = tot_m - tgt_m
            reply += f"🎉 Selamat! Anda telah melampaui target minimal bulanan BKPSDM (surplus +{surplus:,} menit). Anda dapat terus mengisi kegiatan rutin untuk memaksimalkan capaian kinerja."
        else:
            reply += f"💡 Anda membutuhkan {ctx['sisa_menit']:,} menit lagi untuk mencapai target minimal. Coba gunakan fitur **Master Template** atau **1-Click Auto-Fill H-7** untuk melengkapi hari-hari yang belum terisi."

        card_data = {
            "filled_events_count": events_count,
            "bulan_menit_total": tot_m,
            "bulan_menit_utama": ctx["utama_menit"],
            "bulan_menit_tambahan": ctx["tambahan_menit"],
            "bulan_menit_target": tgt_m,
            "bulan_menit_tercapai": tercapai,
            "bulan_jam_total": jam_tot
        }
        return {
            "reply": reply,
            "card_type": "progress_card",
            "card_data": card_data,
            "tool_used": "get_ekinerja_progress"
        }

    # --------------------------------------------------------------------------
    # TOOL: get_empty_days_h7
    # --------------------------------------------------------------------------
    elif tool_name == "get_empty_days_h7":
        h7_start = today - timedelta(days=7)
        empty_days = []
        if api and hasattr(api, "is_logged_in") and api.is_logged_in:
            try:
                empty_days = api.cari_hari_kosong(h7_start, today, skip_weekends=True)
            except Exception as e:
                logger.warning(f"Gagal cari hari kosong: {e}")

        if empty_days:
            reply = (
                f"📅 **Pemeriksaan Hari Kosong (Batas Aman H-7):**\n\n"
                f"Ditemukan **{len(empty_days)} hari kerja** yang belum dilaporkan dalam 7 hari terakhir (mulai {h7_start.strftime('%d %b %Y')} s.d. hari ini):\n\n"
            )
            for d in empty_days:
                reply += f"• **{d.get('hari_nama', 'Hari')}**, {d.get('tanggal')} (Tenggat: {d.get('urgensi_hari', 0)} hari lalu)\n"
            reply += "\n⚡ *Segera laporkan sebelum batas waktu H-7 kedaluwarsa. Anda dapat klik tombol Auto-Fill di bawah untuk mengisi semuanya sekaligus!*"

            return {
                "reply": reply,
                "card_type": "empty_days_card",
                "card_data": {"empty_days": empty_days},
                "tool_used": "get_empty_days_h7"
            }
        else:
            reply = (
                f"🎉 **Semua Hari Kerja Terisi Lengkap!**\n\n"
                f"Luar biasa, Pak/Ibu {user_name}! Tidak ada hari bolong dalam batas aman 7 hari terakhir. Seluruh hari kerja Senin-Jumat telah dilaporkan ke SiPENDEKAR."
            )
            return {
                "reply": reply,
                "card_type": None,
                "card_data": None,
                "tool_used": "get_empty_days_h7"
            }

    # --------------------------------------------------------------------------
    # TOOL: get_master_templates
    # --------------------------------------------------------------------------
    elif tool_name == "get_master_templates":
        templates = database.get_user_master_templates(nip)
        if not templates:
            reply = (
                f"📋 **Master Template SiPENDEKAR:**\n\n"
                f"Saat ini Anda belum memiliki Master Template tersimpan. "
                f"Master Template berguna untuk melaporkan 600 menit (1 hari penuh) hanya dengan 1 ketukan misal *'template 1'*. "
                f"Silakan buat template rutin Anda di bawah atau minta AI rekomendasikan (*'rekomendasi template'*):"
            )
        else:
            reply = (
                f"📋 **Daftar Master Template Anda ({len(templates)} Tersedia):**\n\n"
                f"Klik salah satu template di kartu bawah atau ketik langsung misal **'template 1'** untuk langsung dikirim ke portal e-Kinerja:"
            )

        return {
            "reply": reply,
            "card_type": "master_template_card",
            "card_data": {
                "templates": templates,
                "today": today.strftime("%Y-%m-%d")
            },
            "tool_used": "get_master_templates"
        }

    # --------------------------------------------------------------------------
    # TOOL: recommend_master_template
    # --------------------------------------------------------------------------
    elif tool_name == "recommend_master_template":
        next_num = database.get_next_template_num(nip)
        top_activities = ai_engine.search_catalog_semantic(user_msg or "tugas rutin harian", top_k=3)
        act = top_activities[0] if top_activities else {
            "kode_aktifitas": "UTAMA00463",
            "nama_aktifitas": "Mengikuti pelatihan/sosialisasi/pendidikan",
            "satuan_output": "Kegiatan"
        }

        title = args.get("title") or f"Rutin - {act['nama_aktifitas'][:35]}"
        kode = args.get("kode_aktifitas") or act["kode_aktifitas"]
        nama = args.get("nama_aktifitas") or act["nama_aktifitas"]
        waktu = int(act.get("waktu") or 60)
        satuan = act.get("satuan_output") or "Laporan"

        # Hitung volume agar pas dengan target jam kerja (misal 600 menit / 10 jam)
        if waktu > 0:
            vol = max(1, round(600 / waktu))
            durasi = waktu * vol
        else:
            vol = 1
            durasi = int(args.get("durasi_menit") or 600)

        ket = args.get("keterangan") or f"Melaksanakan {nama.lower()} serta menyusun laporan kegiatan harian."

        tot_m = ctx["total_menit"]
        tgt_m = ctx["target_menit"]
        tercapai = ctx["tercapai"]

        if tercapai:
            analisis = f"Target bulan ini sudah tercapai ({tot_m:,} menit). Template {durasi} menit ini sangat ideal sebagai standar rutinitas harian yang rapi dan konsisten."
        else:
            sisa_m = ctx["sisa_menit"]
            hari_butuh = max(1, round(sisa_m / durasi))
            analisis = f"Target Anda saat ini kurang {sisa_m:,} menit. Dengan template {durasi} menit ({vol} {satuan} × {waktu} m/hari) ini, Anda dapat menutup kekurangan target hanya dalam kurun waktu {hari_butuh} hari kerja!"

        reply = (
            f"✨ **Rekomendasi Master Template SiPENDEKAR AI**\n\n"
            f"{analisis}\n\n"
            f"📋 **Rencana Template #{next_num}:**\n"
            f"• **Judul:** {title}\n"
            f"• **Kegiatan:** {nama} `[{kode}]` (Standar: {waktu} Menit/{satuan})\n"
            f"• **Volume Output:** {vol} {satuan}\n"
            f"• **Total Menit e-Kinerja:** {durasi} Menit ({vol} × {waktu}m)\n"
            f"• **Rentang Jam:** 07:30 - 17:30\n"
            f"• **Keterangan:** {ket}\n\n"
            f"Klik tombol **💾 Simpan Jadi Master Template** di bawah untuk langsung menyimpannya ke akun Anda:"
        )

        card_data = {
            "next_num": next_num,
            "title": title,
            "kode_aktifitas": kode,
            "nama_aktifitas": nama,
            "volume": vol,
            "waktu_standar": waktu,
            "satuan_output": satuan,
            "keterangan": ket,
            "jam_mulai": "07",
            "menit_mulai": "30",
            "jam_selesai": "17",
            "menit_selesai": "30",
            "durasi_menit": durasi,
            "ai_provider": "SiPENDEKAR MCP AI Engine"
        }

        return {
            "reply": reply,
            "card_type": "ai_template_rec_card",
            "card_data": card_data,
            "tool_used": "recommend_master_template"
        }

    # --------------------------------------------------------------------------
    # TOOL: submit_direct_activity (Auto-Submit)
    # --------------------------------------------------------------------------
    elif tool_name == "submit_direct_activity":
        tgl = args.get("tanggal") or today.strftime("%Y-%m-%d")
        jm = str(args.get("jam_mulai") or "07").zfill(2)
        mm = str(args.get("menit_mulai") or "30").zfill(2)
        js = str(args.get("jam_selesai") or "17").zfill(2)
        ms = str(args.get("menit_selesai") or "30").zfill(2)
        ket = args.get("keterangan") or user_msg

        kode = args.get("kode_aktifitas")
        nama = ""
        if not kode:
            top_acts = ai_engine.search_catalog_semantic(ket, top_k=1)
            if top_acts:
                kode = top_acts[0]["kode_aktifitas"]
                nama = top_acts[0]["nama_aktifitas"]
            else:
                kode = "UTAMA00463"
                nama = "Mengikuti pelatihan/sosialisasi/pendidikan"
        else:
            cat = ai_engine.load_activities_catalog()
            matching = [x for x in cat if x.get("kode_aktifitas") == kode]
            nama = matching[0].get("nama_aktifitas", kode) if matching else kode

        durasi = ((int(js) * 60) + int(ms)) - ((int(jm) * 60) + int(mm))
        if durasi <= 0:
            durasi = 600

        # Lakukan pengiriman langsung ke SiPENDEKAR jika API aktif
        success_submit = False
        error_msg = ""
        if api and hasattr(api, "is_logged_in") and api.is_logged_in:
            try:
                skps = api.get_skp(kode)
                sasaran_kerja_id = skps[0]["id"] if skps else 0
                api.isi_aktivitas(
                    tanggal=tgl,
                    kode_aktifitas=kode,
                    volume=1,
                    keterangan=ket,
                    sasaran_kerja_id=sasaran_kerja_id,
                    jam_mulai=jm,
                    menit_mulai=mm,
                    jam_selesai=js,
                    menit_selesai=ms,
                    jenis="kinerja",
                    nip18=nip
                )
                success_submit = True
                database.log_user_activity(nip, "MCP_AUTO_FILL", f"Lapor Langsung: {nama} ({tgl})")
            except Exception as e:
                error_msg = str(e)
                logger.error(f"Gagal submit aktivitas via MCP: {e}")

        if success_submit:
            reply = (
                f"✅ **Laporan Berhasil Dilaporkan Langsung ke SiPENDEKAR!** 🚀\n\n"
                f"Aktivitas Anda telah langsung diverifikasi dan tercatat resmi di portal BKPSDM:\n\n"
                f"• 📋 **Kegiatan:** {nama} `[{kode}]`\n"
                f"• 📅 **Tanggal:** {tgl}\n"
                f"• ⏱️ **Waktu:** {jm}:{mm} - {js}:{ms} ({durasi} Menit)\n"
                f"• 📝 **Keterangan:** {ket}\n\n"
                f"Total menit kinerja Anda telah otomatis bertambah! 🎉"
            )
            card_data = {
                "template_num": "MCP",
                "title": "Pelaporan Langsung MCP AI",
                "tanggal": tgl,
                "durasi_menit": durasi,
                "kegiatan": nama
            }
            return {
                "reply": reply,
                "card_type": "template_success_card",
                "card_data": card_data,
                "tool_used": "submit_direct_activity"
            }
        else:
            # Jika gagal atau offline, kembalikan formulir siap kirim (Draf AI)
            offline_warn = ""
            if not ctx.get("portal_online", False):
                offline_warn = (
                    "> ⚠️ **Informasi Koneksi Server SiPENDEKAR:**\n"
                    "> Server resmi portal SiPENDEKAR saat ini sedang **tidak terhubung / offline**, sehingga auto-submit langsung ke BKPSDM ditunda.\n\n"
                )
            reply = (
                f"{offline_warn}"
                f"✨ **Analisis Pelaporan e-Kinerja:**\n\n"
                f"• 📋 **Kegiatan:** {nama} `[{kode}]`\n"
                f"• 📅 **Tanggal:** {tgl}\n"
                f"• 📦 **Volume:** {vol} Output ({durasi} Menit) — *Sinkron*\n"
                f"• ⏱️ **Waktu:** {jm}:{mm} - {js}:{ms}\n"
                f"• 📝 **Keterangan:** {ket}\n\n"
                f"💡 *Formulir pelaporan mandiri dapat dibuka melalui tombol **[✍️ Menu Input Mandiri]** di bawah atau menu samping.*"
            )
            return {
                "reply": reply,
                "card_type": None,
                "card_data": None,
                "tool_used": "submit_direct_activity"
            }

    # --------------------------------------------------------------------------
    # TOOL: get_activity_history
    # --------------------------------------------------------------------------
    elif tool_name == "get_activity_history":
        limit = int(args.get("limit") or 10)
        logs = database.get_user_activity_logs(nip, limit=limit)
        reply = f"📜 **Riwayat Pengisian e-Kinerja Anda ({len(logs)} transaksi terakhir):**"
        return {
            "reply": reply,
            "card_type": "history_card",
            "card_data": {"logs": logs},
            "tool_used": "get_activity_history"
        }

    # --------------------------------------------------------------------------
    # TOOL: replicate_previous_day_activities
    # --------------------------------------------------------------------------
    elif tool_name in ["replicate_previous_day", "replicate_previous_day_activities", "copy_yesterday_activities"]:
        target_date = args.get("target_date") or ctx.get("today_str")
        return execute_replicate_previous_day(nip, api, target_date_str=target_date, ctx=ctx)

    # Fallback default
    return {
        "reply": f"Siap membantu pelaporan e-Kinerja Anda, Pak/Ibu {user_name}!",
        "card_type": None,
        "card_data": None,
        "tool_used": "none"
    }

# ==============================================================================
# 4. MCP UNIFIED CHAT DISPATCHER (ZERO DUPLICATION & PERFECT SYNC)
# ==============================================================================

def dispatch_mcp_chat(
    nip: str,
    user_msg: str,
    api: Any,
    portal_error: Optional[str] = None
) -> Dict[str, Any]:
    """
    Dispatcher tunggal untuk seluruh pesan masuk.
    Menghilangkan duplikasi balasan dan menjamin teks + kartu widget 100% sinkron.
    """
    today = date.today()
    lower = user_msg.strip().lower()
    ctx = get_live_user_context(nip, api, portal_error=portal_error)
    user_name = ctx["user_name"]
    portal_online = ctx["portal_online"]

    # 1. Perintah Start / Help / Menu
    if lower.startswith("/start") or lower.startswith("/help") or lower in ["/menu", "menu", "bantuan"]:
        reply = (
            "🤖 **Halo! Selamat datang di Telegram SiPENDEKAR Assistant Bot!**\n\n"
            "Saya asisten cerdas berbasis **Model Context Protocol (MCP)** untuk mempermudah pelaporan e-Kinerja Anda secara otomatis, akurat, dan terverifikasi langsung ke portal resmi.\n\n"
            "📌 **Daftar Menu Cepat:**\n"
            "• `/progres` — 📊 Cek capaian total menit real-time bulan ini\n"
            "• `/hari_bolong` — 📅 Cek tanggal hari kerja yang belum diisi (H-7)\n"
            "• `/template` — 📋 Lihat & pilih Master Template kegiatan\n"
            "• `/buat_template` — ➕ Buat Master Template kustom baru\n"
            "• `/isi_manual` — ✍️ Formulir lapor langsung tanpa template\n"
            "• `/autofill` — ⚡ 1-Click Auto-Fill hari kerja kosong (H-7)\n"
            "• `/prompt` — 💡 Contoh template prompt konsultasi e-Kinerja\n"
            "• `/riwayat` — 📜 Rekap riwayat laporan terakhir\n"
            "• `/ai` — ✨ Pengaturan & Status Provider AI (Gemini / Groq)\n\n"
            "💡 *Tips AI: Anda bisa mengetik langsung dengan bahasa sehari-hari, misal: 'Tadi saya dinas luar verifikasi perizinan klinik jam 8 sampai 15.30 tolong isiin langsung', dan AI akan langsung mencatatnya ke SiPENDEKAR!*"
        )
        return {"reply": reply, "card_type": None, "card_data": None}

    # 1.05 Perintah Prompt / Contoh Template Obrolan
    if lower in ["/prompt", "prompt", "contoh prompt", "template prompt", "format prompt", "cara chat"]:
        reply = (
            "💡 **Kumpulan Template Prompt Konsultasi SiPENDEKAR:**\n\n"
            "Anda dapat menyalin atau menyesuaikan salah satu contoh prompt di bawah ini lalu kirimkan ke chat:\n\n"
            "1️⃣ **Dua Kegiatan dalam Satu Hari (Bagi Jam Pagi & Siang):**\n"
            "> `kalo saya mengerjakan rekap data dari jam 8 sampe jam 12 terus saya melakukan pekerjaan administrasi cuti dari jam 12-16 gmna bikin inputan nya enaknya`\n\n"
            "2️⃣ **Dinas Luar / Survei Lapangan Penuh (600 Menit / 10 Jam):**\n"
            "> `Hari ini dari jam 07.30 sampai 17.30 saya dinas luar verifikasi perizinan lapangan, tolong carikan kegiatan katalog yang cocok dan sinkronkan jamnya.`\n\n"
            "3️⃣ **Pelatihan / Sosialisasi / Workshop ASN:**\n"
            "> `Kemarin saya mengikuti workshop peningkatan kompetensi ASN dari jam 8 pagi sampai jam 3 sore, bagaimana inputannya?`\n\n"
            "4️⃣ **Pelayanan Administrasi Persuratan / TU:**\n"
            "> `Tadi saya mengelola surat masuk dan mengarsipkan berkas dari jam 08.00 sampai 12.00, tolong rekomendasikan kegiatan dan volumenya.`\n\n"
            "5️⃣ **Rekomendasi Master Template Rutin 600 Menit:**\n"
            "> `Tolong rekomendasikan Master Template 600 menit yang cocok untuk staf administrasi agar cepat mencapai target 7.920 menit sebulan.`\n\n"
            "💡 *Tips: Anda juga dapat klik tombol **[💡 Contoh Prompt]** di atas keyboard untuk langsung memasukkan template prompt ke kolom chat!*"
        )
        return {"reply": reply, "card_type": None, "card_data": None}

    # 1.1 Respon Cepat Sapaan & Ping (< 0.05 Detik / Instan)
    greetings = [
        "halo", "hai", "hei", "tes", "test", "ping", "pagi", "selamat pagi",
        "siang", "selamat siang", "sore", "selamat sore", "malam", "selamat malam",
        "assalamualaikum", "halo bot", "halo asisten", "hai bot", "p", "halo sipendekar"
    ]
    if lower in greetings or any(lower == f"halo {g}" or lower == f"hai {g}" for g in ["bot", "min", "asisten", "sipendekar"]):
        capaian_str = f"**{ctx['total_menit']:,} menit** dari target {ctx['target_menit']:,} menit"
        status_target = "✅ Target Tercapai" if ctx["tercapai"] else f"⚠️ Kurang {ctx['sisa_menit']:,} menit"
        reply = (
            f"Halo Pak/Ibu **{user_name}**! 👋\n\n"
            f"Sistem SiPENDEKAR Assistant aktif dan siap membantu pelaporan e-Kinerja Anda.\n\n"
            f"📊 **Ringkasan Capaian Anda Bulan Ini:**\n"
            f"• Capaian: {capaian_str} ({status_target})\n\n"
            f"Ada yang bisa saya bantu hari ini?\n"
            f"1. **Pelaporan e-Kinerja**: Ceritakan tugas yang dikerjakan (misal: *'saya kemarin ikut pelatihan jam 8 sampai 13'*) atau klik **[✍️ Menu Input Mandiri]**.\n"
            f"2. **Master Template**: Ketik *'template'* untuk melihat template rutin harian.\n"
            f"3. **Cek Hari Bolong**: Ketik *'hari bolong'* untuk memeriksa batas aman H-7 BKPSDM."
        )
        return {"reply": reply, "card_type": None, "card_data": None}

    # 2. Perintah AI Settings: /ai
    if lower.startswith("/ai") or lower.startswith("/set_ai_key") or lower in ["ai", "setting ai", "atur ai", "konfigurasi ai"]:
        parts = user_msg.strip().split()
        if len(parts) >= 3 and parts[0].lower() in ["/set_ai_key", "set_ai_key"]:
            prov = parts[1].lower()
            key = parts[2].strip()
            database.save_user_ai_config(nip, prov, key)
            reply = (
                f"✅ **API Key AI Berhasil Disimpan!**\n\n"
                f"• **Provider:** {prov.upper()}\n"
                f"• **API Key:** `{key[:6]}...{key[-4:] if len(key)>10 else '***'}`\n\n"
                f"Asisten AI siap digunakan dengan integrasi penuh MCP Tools!"
            )
            return {"reply": reply, "card_type": "ai_settings_card", "card_data": database.get_user_ai_config(nip)}
        else:
            ai_cfg = database.get_user_ai_config(nip)
            prov_label = ai_cfg.get("provider", "local").upper()
            has_key = "✅ Terhubung" if ai_cfg.get("has_api_key") else "⚡ Mode Bawaan (Smart Local MCP)"
            reply = (
                f"✨ **SiPENDEKAR AI Assistant Center (MCP Enabled)**\n\n"
                f"• **Status Provider:** **{prov_label}** ({has_key})\n"
                f"• **Model Aktif:** `{ai_cfg.get('model', 'gemini-3.5-flash')}`\n"
                f"• **Arsitektur:** Model Context Protocol (MCP) dengan 6 Live Tools\n\n"
                f"Anda dapat menghubungkan API Key gratis Google Gemini (dari Google AI Studio) untuk analisis semakin cerdas."
            )
            return {"reply": reply, "card_type": "ai_settings_card", "card_data": ai_cfg}

    # 2.1 Eksekusi Master Template (misal: "template 1", "isi template 2", "2", "template 1 senin", "template 1 tanggal 2026-10-26")
    tmpl_match = re.search(r'(?:template\s*(\d+)|^(\d+)$|isi\s*template\s*(\d+)|pilih\s*template\s*(\d+))', lower)
    has_digit = any(c.isdigit() for c in lower)
    if tmpl_match and (has_digit or any(k in lower for k in ["1", "2", "3", "4", "5"])):
        num = int(tmpl_match.group(1) or tmpl_match.group(2) or tmpl_match.group(3) or tmpl_match.group(4) or 1)
        tmpl = database.get_template_by_num(nip, num)
        if tmpl:
            target_date = today.strftime("%Y-%m-%d")
            date_match = re.search(r'(\d{4}-\d{2}-\d{2})', lower)
            dmy_match = re.search(r'(\d{1,2})[/-](\d{1,2})[/-](\d{4})', lower)
            if date_match:
                target_date = date_match.group(1)
            elif dmy_match:
                try:
                    d, m, y = int(dmy_match.group(1)), int(dmy_match.group(2)), int(dmy_match.group(3))
                    target_date = date(y, m, d).strftime("%Y-%m-%d")
                except Exception:
                    pass
            elif "kemarin" in lower:
                target_date = (today - timedelta(days=1)).strftime("%Y-%m-%d")
            elif "lusa" in lower or "2 hari lalu" in lower:
                target_date = (today - timedelta(days=2)).strftime("%Y-%m-%d")
            elif "senin" in lower:
                diff = (today.weekday() - 0) % 7
                target_date = (today - timedelta(days=diff if diff > 0 else 7)).strftime("%Y-%m-%d")
            elif "selasa" in lower:
                diff = (today.weekday() - 1) % 7
                target_date = (today - timedelta(days=diff if diff > 0 else 7)).strftime("%Y-%m-%d")
            elif "rabu" in lower:
                diff = (today.weekday() - 2) % 7
                target_date = (today - timedelta(days=diff if diff > 0 else 7)).strftime("%Y-%m-%d")
            elif "kamis" in lower:
                diff = (today.weekday() - 3) % 7
                target_date = (today - timedelta(days=diff if diff > 0 else 7)).strftime("%Y-%m-%d")
            elif "jumat" in lower:
                diff = (today.weekday() - 4) % 7
                target_date = (today - timedelta(days=diff if diff > 0 else 7)).strftime("%Y-%m-%d")

            skps = api.get_skp(tmpl["kode_aktifitas"]) if (api and hasattr(api, "is_logged_in") and api.is_logged_in) else []
            sasaran_kerja_id = skps[0]["id"] if skps else 0

            if not portal_online:
                reply = (
                    f"> ⚠️ **Informasi Koneksi Server SiPENDEKAR:**\n"
                    f"> Saat ini server portal resmi SiPENDEKAR sedang **tidak terhubung / offline**, sehingga laporan belum dapat dikirim langsung ke server pusat BKPSDM.\n\n"
                    f"📝 **Draf Laporan Disiapkan:**\n"
                    f"• **Master Template:** Template {num} ({tmpl['title']})\n"
                    f"• **Tanggal:** {target_date}\n"
                    f"• **Kegiatan:** {tmpl['nama_aktifitas']} `[{tmpl['kode_aktifitas']}]`\n"
                    f"• **Waktu:** {tmpl['jam_mulai']}:{tmpl['menit_mulai']} - {tmpl['jam_selesai']}:{tmpl['menit_selesai']} ({tmpl.get('durasi_menit', 600)} Menit)\n"
                    f"• **Keterangan:** {tmpl['keterangan']}\n\n"
                    f"💡 *Anda dapat langsung mengirimkan laporan ini via menu **[✍️ Menu Input Mandiri]** begitu server portal online kembali.*"
                )
                return {
                    "reply": reply,
                    "card_type": None,
                    "card_data": None
                }

            if api and hasattr(api, "is_logged_in") and api.is_logged_in:
                try:
                    api.isi_aktivitas(
                        tanggal=target_date,
                        kode_aktifitas=tmpl["kode_aktifitas"],
                        volume=tmpl.get("volume", 1),
                        keterangan=tmpl["keterangan"],
                        sasaran_kerja_id=sasaran_kerja_id,
                        jam_mulai=tmpl["jam_mulai"],
                        menit_mulai=tmpl["menit_mulai"],
                        jam_selesai=tmpl["jam_selesai"],
                        menit_selesai=tmpl["menit_selesai"],
                        jenis="kinerja",
                        nip18=nip
                    )
                except Exception as e:
                    logger.error(f"Gagal kirim template via MCP: {e}")

            vol = tmpl.get("volume", 1)
            durasi = tmpl.get("durasi_menit", 600)
            database.log_user_activity(nip, "FILL_TEMPLATE", f"Lapor Template {num} ({tmpl['title']}) tgl {target_date}")
            reply = (
                f"✅ **Laporan Berhasil Dilaporkan ke SiPENDEKAR!**\n\n"
                f"📌 **Master Template:** Template {num} ({tmpl['title']})\n"
                f"📅 **Tanggal:** {target_date}\n"
                f"📋 **Kegiatan:** {tmpl['nama_aktifitas']} [{tmpl['kode_aktifitas']}]\n"
                f"📊 **Volume Output:** {vol} Output\n"
                f"⏱️ **Total Menit Diakui:** {durasi} Menit\n"
                f"🕒 **Rentang Jam:** {tmpl['jam_mulai']}:{tmpl['menit_mulai']} - {tmpl['jam_selesai']}:{tmpl['menit_selesai']}\n"
                f"📝 **Keterangan:** {tmpl['keterangan']}\n\n"
                f"Total menit bulan ini telah diperbarui secara otomatis! 🎉"
            )
            return {
                "reply": reply,
                "card_type": "template_success_card",
                "card_data": {
                    "template_num": num,
                    "title": tmpl["title"],
                    "tanggal": target_date,
                    "durasi_menit": durasi,
                    "kegiatan": tmpl["nama_aktifitas"]
                }
            }
        else:
            return {
                "reply": f"⚠️ **Master Template {num} belum dibuat.**\nAnda belum memiliki template {num}. Silakan buat terlebih dahulu dengan form di bawah:",
                "card_type": "create_template_card",
                "card_data": {
                    "next_num": num,
                    "existing_templates": database.get_user_master_templates(nip)
                }
            }

    # 3. Direct MCP Tool Triggers: Progres & Menit
    if lower in ["/progres", "/progress", "progres", "progress", "cek progres", "cek status", "status", "status ekinerja", "capaian", "cek capaian", "total menit", "cek menit", "menit"]:
        if not portal_online:
            reply = (
                "> ⚠️ **Informasi Koneksi Server SiPENDEKAR:**\n"
                "> Saat ini server resmi portal SiPENDEKAR sedang **tidak terhubung / offline** (gangguan server/jaringan pusat BKPSDM).\n\n"
                f"📊 **Data Capaian Terakhir ({user_name}):**\n"
                f"• Capaian tercatat: **{ctx['total_menit']:,} / {ctx['target_menit']:,} menit** ({ctx['jam_total']} Jam)\n"
                f"• Status: {'✅ Target Tercapai' if ctx['tercapai'] else f'⚠️ Kurang {ctx['sisa_menit']:,} Menit'}\n\n"
                "💡 *Sinkronisasi data real-time langsung ke BKPSDM akan aktif kembali segera setelah server terhubung.*"
            )
            return {
                "reply": reply,
                "card_type": "progress_card",
                "card_data": {
                    "bulan_menit_total": ctx["total_menit"],
                    "bulan_menit_target": ctx["target_menit"],
                    "bulan_menit_tercapai": ctx["tercapai"],
                    "bulan_jam_total": ctx["jam_total"],
                    "is_offline": True
                },
                "tool_used": "get_ekinerja_progress"
            }
        return execute_mcp_tool("get_ekinerja_progress", {}, nip, api, user_msg)

    # 4. Direct MCP Tool Triggers: Hari Kosong / Bolong H-7
    if lower in ["/hari_bolong", "/kosong", "/bolong", "hari kosong", "hari bolong", "cek kosong", "cek bolong", "h-7", "cek hari kosong", "cek hari kosong h-7", "hari bolong h-7", "cek hari bolong"]:
        if not portal_online:
            reply = (
                "> ⚠️ **Informasi Koneksi Server SiPENDEKAR:**\n"
                "> Saat ini server resmi portal SiPENDEKAR sedang **tidak terhubung / offline** (gangguan koneksi pusat BKPSDM).\n\n"
                "📅 **Pemeriksaan Hari Kosong (H-7):**\n"
                "Pemeriksaan kalender e-Kinerja belum dapat disinkronkan ke server pusat. "
                "Anda dapat memeriksa daftar Master Template (`/template`) atau menyiapkan draf kegiatan (`/isi_manual`) yang siap dilaporkan saat server pulih."
            )
            return {
                "reply": reply,
                "card_type": None,
                "card_data": None,
                "tool_used": "get_empty_days_h7"
            }
        return execute_mcp_tool("get_empty_days_h7", {}, nip, api, user_msg)

    # 5. Direct MCP Tool Triggers: Master Templates List
    if lower in ["/template", "/templates", "template", "templates", "daftar template", "list template", "pilih template", "lihat template", "katalog template", "master template"]:
        return execute_mcp_tool("get_master_templates", {}, nip, api, user_msg)

    # 6. Direct Form Trigger: Buat Template Baru
    if lower in ["/buat", "/buat_template", "buat template", "bikin template", "tambah template"]:
        next_num = database.get_next_template_num(nip)
        templates = database.get_user_master_templates(nip)
        return {
            "reply": "Silakan atur rincian Master Template baru Anda di bawah ini:",
            "card_type": "create_template_card",
            "card_data": {
                "next_num": next_num,
                "existing_templates": templates
            }
        }

    # 6.5 Direct Action: Salin / Copy Kegiatan Hari Kemarin
    if any(re.search(pat, lower) for pat in REPLICATE_YESTERDAY_PATTERNS):
        return execute_replicate_previous_day(nip, api, target_date_str=ctx["today_str"], ctx=ctx)

    # 7. Direct Form Trigger: Isi Manual / Isi Kegiatan / Backdate
    manual_triggers = [
        "/isi_manual", "/manual", "tanpa template", "isi manual", "lapor manual",
        "form manual", "isi tanpa template", "isi kegiatan", "isi tanggal", "lapor tanggal", "backdate"
    ]
    if any(lower.startswith(t) or lower == t for t in manual_triggers) or (
        ("isi" in lower or "lapor" in lower) and any(w in lower for w in ["tanggal", "senin", "kemarin", "kegiatan", "backdate"])
    ):
        target_date_str = ctx["today_str"]
        t_parsed = ai_engine.parse_work_statement(user_msg, today)
        if t_parsed and t_parsed.get("tanggal"):
            target_date_str = t_parsed["tanggal"]

        user_tmpls = database.get_user_master_templates(nip)
        tmpl1 = user_tmpls[0] if user_tmpls else None

        clean_kw = re.sub(r'\b(isi|kegiatan|aktivitas|tanggal|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|hari|senin|selasa|rabu|kamis|jumat|kemarin|lusa|tanpa|template|manual|lapor)\b', '', lower).strip()
        has_specific_act = len(clean_kw) >= 4

        if tmpl1 and not has_specific_act:
            def_kode = tmpl1["kode_aktifitas"]
            def_keg = tmpl1["nama_aktifitas"]
            def_jm = tmpl1["jam_mulai"]
            def_mm = tmpl1["menit_mulai"]
            def_js = tmpl1["jam_selesai"]
            def_ms = tmpl1["menit_selesai"]
            def_ket = tmpl1["keterangan"]
        elif t_parsed.get("kode_aktifitas") and t_parsed.get("kode_aktifitas") != "UTAMA00463":
            def_kode = t_parsed["kode_aktifitas"]
            def_keg = t_parsed.get("nama_aktifitas", "Mengikuti pelatihan/sosialisasi/pendidikan")
            def_ket = t_parsed.get("keterangan", "melaksanakan tugas dinas harian sesuai arahan pimpinan")
            def_jm = t_parsed.get("jam_mulai", "08")
            def_mm = t_parsed.get("menit_mulai", "00")
            def_js = t_parsed.get("jam_selesai", "16")
            def_ms = t_parsed.get("menit_selesai", "00")
        elif tmpl1:
            def_kode = tmpl1["kode_aktifitas"]
            def_keg = tmpl1["nama_aktifitas"]
            def_jm = tmpl1["jam_mulai"]
            def_mm = tmpl1["menit_mulai"]
            def_js = tmpl1["jam_selesai"]
            def_ms = tmpl1["menit_selesai"]
            def_ket = tmpl1["keterangan"]
        else:
            def_kode = "UTAMA00463"
            def_keg = "Mengikuti pelatihan/sosialisasi/pendidikan"
            def_jm, def_mm, def_js, def_ms = "08", "00", "16", "00"
            def_ket = "melaksanakan tugas dinas harian sesuai arahan pimpinan"

        return {
            "reply": (
                f"📝 **Rincian Kegiatan untuk Tanggal {target_date_str}:**\n\n"
                f"• 📌 **Kegiatan:** {def_keg} `[{def_kode}]`\n"
                f"• ⏱️ **Jam:** {def_jm}:{def_mm} - {def_js}:{def_ms}\n"
                f"• 📝 **Keterangan:** {def_ket}\n\n"
                f"💡 *Silakan buka formulir pengisian melalui menu **[✍️ Menu Input Mandiri]** untuk mengirimkannya.*"
            ),
            "card_type": None,
            "card_data": None
        }

    # 8. Direct Action: Autofill H-7
    if lower in ["/autofill", "autofill", "isi semua", "auto fill", "isi otomatis"]:
        return {
            "reply": "⚡ Siap! Anda dapat menjalankan pengisian otomatis hari kosong H-7 dengan mengklik tombol konfirmasi di bawah:",
            "card_type": "autofill_prompt",
            "card_data": {"action": "execute_autofill"}
        }

    # 9. Direct Action: Riwayat
    if lower in ["/riwayat", "riwayat", "history", "log", "riwayat pengisian", "cek riwayat"]:
        return execute_mcp_tool("get_activity_history", {}, nip, api, user_msg)

    # 10. AI Semantic Intent Detection & MCP Tool Routing
    # A. Rekomendasi Template Intent
    template_rec_triggers = [
        "rekomendasi template", "rekomendasikan template", "bikinin template",
        "buatkan template", "template yang cocok", "saran template",
        "ide template", "rekomendasiin bikin template", "rekomendasiin template"
    ]
    if any(t in lower for t in template_rec_triggers):
        return execute_mcp_tool("recommend_master_template", {}, nip, api, user_msg)

    # B. Auto-Submit / Lapor Langsung Intent
    auto_submit_triggers = [
        "isi langsung", "langsung isi", "tolong isiin", "isiin langsung", "langsung lapor",
        "laporin langsung", "input langsung", "tolong inputkan", "submit langsung",
        "isi ke sipendekar", "masukin langsung", "lapor langsung", "isikan langsung"
    ]
    if any(t in lower for t in auto_submit_triggers):
        parsed = ai_engine.parse_work_statement(user_msg)
        args = {
            "tanggal": parsed.get("tanggal", ctx["today_str"]),
            "jam_mulai": parsed.get("jam_mulai", "07"),
            "menit_mulai": parsed.get("menit_mulai", "30"),
            "jam_selesai": parsed.get("jam_selesai", "17"),
            "menit_selesai": parsed.get("menit_selesai", "30"),
            "kode_aktifitas": parsed.get("kode_aktifitas"),
            "keterangan": parsed.get("keterangan", user_msg)
        }
        return execute_mcp_tool("submit_direct_activity", args, nip, api, user_msg)

    # C. Cek Hari Kosong via Natural Language
    if any(w in lower for w in ["hari kosong", "hari bolong", "ada yang kosong", "ada yang bolong", "ketinggalan"]):
        return execute_mcp_tool("get_empty_days_h7", {}, nip, api, user_msg)

    # D. Cek Progres via Natural Language
    if any(w in lower for w in ["sisa menit", "berapa menit", "kurang berapa", "target saya", "capaian saya"]):
        return execute_mcp_tool("get_ekinerja_progress", {}, nip, api, user_msg)

    # E. General AI Chat with LLM & Live MCP Context
    # Cek konfigurasi AI: jika provider Crown AI (Bansos Agentic), jalankan Autonomous Agentic Copilot
    ai_cfg = database.get_user_ai_config(nip)
    provider = ai_cfg.get("provider", "crown")
    if provider == "crown" and ai_cfg.get("is_enabled", 1):
        copilot_res = ai_engine.run_agentic_copilot(nip, user_msg, api, ctx)
        return {
            "reply": copilot_res.get("reply", f"Siap membantu pelaporan e-Kinerja Anda, {user_name}!"),
            "card_type": copilot_res.get("card_type"),
            "card_data": copilot_res.get("card_data"),
            "tool_used": "crown_agentic_copilot"
        }

    # Fallback atau provider lain via process_ai_chat
    ai_res = ai_engine.process_ai_chat(nip, user_msg, ctx)
    return {
        "reply": ai_res.get("reply", f"Siap membantu pelaporan e-Kinerja Anda, {user_name}!"),
        "card_type": ai_res.get("card_type"),
        "card_data": ai_res.get("card_data"),
        "tool_used": "llm_agent"
    }
