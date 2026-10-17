"""Stream Pad server — FastAPI + wykrywanie OBS WebSocket."""

import asyncio
import ipaddress
import os
import socket
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# =====================================================================
# KONFIGURACJA — zmieniaj tylko te zmienne.
# Każdą można nadpisać zmienną środowiskową o takiej samej nazwie,
# np.:  RECORD_DIR=/mnt/nagrania python server.py
# =====================================================================

# Katalog ze stroną (index.html, help.html).
STATIC_DIR = os.environ.get("STATIC_DIR", "/home/maks/Projekty/Stream-Tools/src/static")

# Port serwera Stream Pad (strona w przeglądarce).
WEB_PORT = int(os.environ.get("WEB_PORT", 8080))

# Port serwera WebSocket w OBS (domyślnie 4455).
OBS_PORT = int(os.environ.get("OBS_PORT", 4455))

# Katalog, do którego OBS ma zapisywać nagrania.
# UWAGA: to ścieżka na komputerze, na którym działa OBS, a nie na tym,
# na którym otwierasz stronę. Przykłady:
#   Linux:   "/home/maks/Nagrania"
#   Windows: "D:/Nagrania"   (ukośniki zwykłe, nie odwrócone)
# Pusty tekst = nie zmieniaj ustawień OBS.
RECORD_DIR = os.environ.get("RECORD_DIR", "/home/maks/Wideo/OBS")

# Schemat nazwy pliku nagrania (składnia OBS, np. %CCYY-%MM-%DD_%hh-%mm-%ss).
# Pusty tekst = nie zmieniaj.
RECORD_FILENAME_FORMAT = os.environ.get("RECORD_FILENAME_FORMAT", "%CCYY-%MM-%DD_%hh-%mm-%ss")

# Czy ten serwer działa na tym samym komputerze co OBS?
# Jeśli tak, katalog nagrań zostanie utworzony przy starcie, gdy nie istnieje.
OBS_ON_THIS_PC = os.environ.get("OBS_ON_THIS_PC", "1") == "1"

# Kanał Twitch otwierany domyślnie w czacie (pusty = brak).
TWITCH_CHANNEL = os.environ.get("TWITCH_CHANNEL", "")

# =====================================================================

BASE_DIR = Path(STATIC_DIR).resolve()


def local_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def is_open(ip: str, timeout: float = 0.5) -> bool:
    try:
        with socket.create_connection((ip, OBS_PORT), timeout):
            return True
    except OSError:
        return False


def scan() -> list[str]:
    me = local_ip()
    hosts = ["127.0.0.1"]

    if me != "127.0.0.1":
        network = ipaddress.ip_network(f"{me}/24", strict=False)
        hosts.extend(str(host) for host in network.hosts())

    with ThreadPoolExecutor(max_workers=128) as executor:
        found = [
            host
            for host, opened in zip(hosts, executor.map(is_open, hosts))
            if opened
        ]

    if me in found and "127.0.0.1" in found:
        found.remove("127.0.0.1")

    return found


def prepare_record_dir() -> None:
    if RECORD_DIR and OBS_ON_THIS_PC:
        try:
            Path(RECORD_DIR).expanduser().mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            print(f"Nie udało się utworzyć katalogu nagrań {RECORD_DIR}: {exc}")


app = FastAPI(title="Stream Pad")


@app.get("/api/discover")
async def discover() -> list[str]:
    # Skanowanie sieci nie blokuje pętli zdarzeń FastAPI.
    return await asyncio.to_thread(scan)


@app.get("/api/config")
async def config() -> dict:
    return {
        "obsPort": OBS_PORT,
        "recordDir": RECORD_DIR,
        "recordFilenameFormat": RECORD_FILENAME_FORMAT,
        "obsOnThisPc": OBS_ON_THIS_PC,
        "twitchChannel": TWITCH_CHANNEL,
        "webPort": WEB_PORT,
    }


@app.get("/")
async def index():
    return FileResponse(BASE_DIR / "index.html")


@app.get("/help")
async def help_page():
    return FileResponse(BASE_DIR / "help.html")


# Pozostałe pliki (CSS, JS, ikony).
app.mount("/static", StaticFiles(directory=BASE_DIR), name="static")


if __name__ == "__main__":
    prepare_record_dir()
    ip = local_ip()
    print(
        f"Stream Pad: http://localhost:{WEB_PORT}"
        f"   |   w sieci: http://{ip}:{WEB_PORT}"
        f"   |   instrukcja: http://localhost:{WEB_PORT}/help"
    )
    uvicorn.run(app, host="0.0.0.0", port=WEB_PORT)