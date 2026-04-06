@echo off
chcp 65001 > nul
title QRAccess - Servidor

echo.
echo  ================================
echo   QRAccess - Sistema de Fichaje
echo  ================================
echo.

:: Comprobar Python (intenta py, luego python, luego python3)
py --version > nul 2>&1
if not errorlevel 1 (
    set PYTHON=py
    goto :found_python
)
python --version > nul 2>&1
if not errorlevel 1 (
    set PYTHON=python
    goto :found_python
)
python3 --version > nul 2>&1
if not errorlevel 1 (
    set PYTHON=python3
    goto :found_python
)

echo [ERROR] Python no esta instalado o no esta en el PATH.
echo  Descargalo desde: https://www.python.org/downloads/
echo  Asegurate de marcar "Add Python to PATH" al instalar.
echo.
pause
exit /b 1

:found_python
echo Python encontrado: %PYTHON%
echo.

echo [1/3] Instalando dependencias...
%PYTHON% -m pip install flask qrcode pillow --quiet
echo       OK

echo [2/3] Preparando base de datos...
if not exist "fichaje.db" (
    %PYTHON% migrar_db.py
) else (
    echo       La base de datos ya existe, saltando migracion.
)

echo [3/3] Arrancando servidor...
echo.
echo  Abre tu navegador en: http://localhost:5000
echo  Panel admin en:       http://localhost:5000/admin
echo  Credenciales admin:   admin@qraccess.com / 1234
echo.
echo  Pulsa Ctrl+C para detener el servidor.
echo.

timeout /t 2 /nobreak > nul
start http://localhost:5000

%PYTHON% fichaje_qr/app.py

pause
