@echo off
chcp 65001 > nul
title QRAccess - Servidor
echo.
echo  ================================
echo   QRAccess - Sistema de Fichaje
echo  ================================
echo.
:: Comprobar Node.js
node --version > nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js no esta instalado o no esta en el PATH.
    echo  Descargalo desde: https://nodejs.org
    echo  Instala la version LTS.
    echo.
    pause
    exit /b 1
)
:: Ir a la carpeta qraccess donde esta server.js
cd /d "%~dp0qraccess"
echo [1/3] Instalando dependencias...
call npm install --silent
echo       OK
echo [2/3] Preparando archivos estaticos...
if not exist "public" mkdir "public"
copy /y "..\index.html" "public\index.html" > nul
copy /y "..\admin.html" "public\admin.html" > nul
copy /y "..\dashboard.html" "public\dashboard.html" > nul
if exist "..\index.css" copy /y "..\index.css" "public\index.css" > nul
echo       OK
echo [3/3] Arrancando servidor...
echo.
echo  Abre tu navegador en: http://localhost:3000
echo  Credenciales:         admin / admin123
echo.
echo  Pulsa Ctrl+C para detener el servidor.
echo.
timeout /t 2 /nobreak > nul
start http://localhost:3000
node server.js
pause