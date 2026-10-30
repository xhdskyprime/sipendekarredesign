@echo off
title BBM SiPENDEKAR Calo Edition (Multi-Account)
color 0B
chcp 65001 >nul
cd /d "%~dp0"

echo =====================================================================
echo    🍇 BBM SiPENDEKAR CALO EDITION (Multi-Account & Auto-Fill) 🍇
echo =====================================================================
echo.
echo Sedang menyiapkan server aplikasi...
echo URL Lokal: http://127.0.0.1:3015
echo URL Cloudflare: https://calo.rsudtgrs.my.id
echo.

start "" "http://127.0.0.1:3015"
python app.py

pause
