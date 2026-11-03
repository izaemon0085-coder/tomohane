@echo off
rem 🐾 モグの毎日の見回り（Windows のタスクスケジューラから動かす）。止める：schtasks /Change /TN "tomohane-mogu" /DISABLE
cd /d "%~dp0"
node mogu.mjs
