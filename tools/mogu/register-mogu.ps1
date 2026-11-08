# 🐾 モグの毎日の見回りを、Windows のタスクスケジューラに登録する（もうあるときは上書き）
# ・毎日21時。窓（黒い画面）を出さずに動く（窓を閉じると途中で止まってしまうため）
# ・パソコンが21時に止まっていたら、次についたときに動く
# 使い方：powershell -ExecutionPolicy Bypass -File tools\mogu\register-mogu.ps1
# 止める：schtasks /Change /TN tomohane-mogu /DISABLE
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cmd = Join-Path $here 'mogu-daily.cmd'

# conhost --headless：窓を作らずにコマンドを動かす（Windows 11）
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless cmd.exe /c `"$cmd`"" -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -Daily -At 21:00
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'tomohane-mogu' -Action $action -Trigger $trigger -Settings $settings -Description '🐾 モグの見回り：コミット・送り忘れを知らせて、全部のリポジトリとデータの写しを作る' -Force | Out-Null
Write-Output '🐾 モグの見回りを登録したモグ（毎日21時・窓は出さない）'
