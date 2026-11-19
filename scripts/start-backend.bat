@echo off
REM Arranca el backend de Core IA en Windows con SQLite.
REM
REM   scripts\start-backend.bat
REM
REM La primera vez crea .env.local con SESSION_SECRET y AGENT_API_KEY, prepara
REM un entorno virtual en backend\.venv e instala las dependencias.

setlocal enabledelayedexpansion
cd /d "%~dp0.."
set "ROOT=%CD%"
set "ENV_FILE=%ROOT%\.env.local"
set "BACKEND=%ROOT%\backend"

if exist "%ENV_FILE%" goto :load

echo - Creando %ENV_FILE% con claves nuevas...
for /f "delims=" %%S in ('python -c "import secrets;print(secrets.token_urlsafe(32))"') do set "SESSION=%%S"
for /f "delims=" %%S in ('python -c "import secrets;print(secrets.token_urlsafe(32))"') do set "AGENT=%%S"
(
  echo # Configuracion local de Core IA. No subas este archivo al repositorio.
  echo SESSION_SECRET=!SESSION!
  echo AGENT_API_KEY=!AGENT!
  echo # Clave gratuita de Google AI Studio ^(https://aistudio.google.com/apikey^).
  echo # Si la dejas vacia, se usa el motor abierto con limite de velocidad.
  echo AI_API_KEY=
  echo AI_MODEL=gemini-3.5-flash
  echo RAG_ENABLED=false
  echo DISCORD_BOT_AUTOSTART=false
) > "%ENV_FILE%"

:load
for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
  set "LINE=%%A"
  if not "!LINE:~0,1!"=="#" if not "%%A"=="" set "%%A=%%B"
)

if not defined DATABASE_URL set "DATABASE_URL=sqlite:///%BACKEND:\=/%/coreia.db"

cd /d "%BACKEND%"

if exist ".venv" goto :run
echo - Creando entorno virtual e instalando dependencias (una sola vez)...
python -m venv .venv || goto :error
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip >nul
pip install -r requirements.txt || goto :error

:run
if exist ".venv\Scripts\activate.bat" call .venv\Scripts\activate.bat

echo.
echo   Core IA - backend local
echo   URL        http://127.0.0.1:8000
echo   Clave      %AGENT_API_KEY%
echo   Base       %DATABASE_URL%
echo.
echo   Configura el CLI:  coreia config --backend http://127.0.0.1:8000 --key %AGENT_API_KEY%
echo.

python -m uvicorn main:app --host 127.0.0.1 --port 8000 --proxy-headers
goto :eof

:error
echo Error al preparar el entorno. Revisa que Python 3.11+ este instalado.
exit /b 1
