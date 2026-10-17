"""Stream Pad server — FastAPI + wykrywanie OBS WebSocket + zapis konfiguracji."""

import asyncio
import ipaddress
import os
import socket
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import uvicorn
from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import padconfig

# =====================================================================
# Ustawienia uruchomieniowe (zmienne środowiskowe, wymagają restartu).
# Pozostałe ustawienia (port OBS, katalog nagrań, czat, układ przycisków)
# zmieniasz w aplikacji (Ustawienia) — zapisują się w pliku config.json.
# Zmienne OBS_PORT, RECORD_DIR, RECORD_FILENAME_FORMAT, OBS_ON_THIS_PC
# i TWITCH_CHANNEL służą tylko jako wartości domyślne przy pierwszym starcie.
# =====================================================================

HERE = Path(__file__).resolve().parent

# Katalog ze stroną (index.html, help.html, css/, js/).
STATIC_DIR = Path(os.environ.get("STATIC_DIR", HERE / "static")).resolve()

# Plik z zapisaną konfiguracją. Trzymaj go poza STATIC_DIR (jest tam serwowany!).
CONFIG_PATH = Path(os.environ.get("CONFIG_PATH", HERE / "config.json"))

# Port serwera Stream Pad (strona w przeglądarce).
WEB_PORT = int(os.environ.get("WEB_PORT", 8080))

# Podsieci do przeszukania, np. "192.168.1.0/24,10.0.0.0/24".
# Puste = /24 interfejsu, z którego wychodzi ruch do sieci.
SCAN_SUBNETS = [s.strip() for s in os.environ.get("SCAN_SUBNETS", "").split(",") if s.strip()]
MAX_SCAN_HOSTS = 1024

# =====================================================================

store = padconfig.Store(CONFIG_PATH)


def local_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def is_open(ip: str, port: int, timeout: float = 0.5) -> bool:
    try:
        with socket.create_connection((ip, port), timeout):
            return True
    except OSError:
        return False


def scan_targets(me: str) -> list[str]:
    hosts = ["127.0.0.1"]
    nets = SCAN_SUBNETS or ([f"{me}/24"] if me != "127.0.0.1" else [])
    for raw in nets:
        try:
            network = ipaddress.ip_network(raw, strict=False)
        except ValueError:
            print(f"SCAN_SUBNETS: pomijam nieprawidłową podsieć „{raw}”")
            continue
        if network.num_addresses > MAX_SCAN_HOSTS:
            print(f"SCAN_SUBNETS: podsieć {raw} jest za duża (maks. {MAX_SCAN_HOSTS} adresów)")
            continue
        hosts.extend(str(host) for host in network.hosts())
    return list(dict.fromkeys(hosts))


def scan(port: int) -> list[str]:
    me = local_ip()
    hosts = scan_targets(me)

    with ThreadPoolExecutor(max_workers=128) as executor:
        found = [
            host
            for host, opened in zip(hosts, executor.map(lambda ip: is_open(ip, port), hosts))
            if opened
        ]

    if me in found and "127.0.0.1" in found:
        found.remove("127.0.0.1")

    return found


def prepare_record_dir() -> None:
    cfg = store.get()
    record_dir = cfg["recordDir"]
    if record_dir and cfg["obsOnThisPc"]:
        try:
            Path(record_dir).expanduser().mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            print(f"Nie udało się utworzyć katalogu nagrań {record_dir}: {exc}")


def print_qr(url: str) -> None:
    """Kod QR w konsoli (opcjonalnie, wymaga pakietu qrcode)."""
    try:
        import qrcode

        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.make(fit=True)
        qr.print_ascii(invert=True)
    except Exception:
        pass


app = FastAPI(title="Stream Pad")


@app.get("/api/discover")
async def discover() -> list[str]:
    # Skanowanie sieci nie blokuje pętli zdarzeń FastAPI.
    port = store.get()["obsPort"]
    return await asyncio.to_thread(scan, port)


@app.get("/api/config")
async def get_config() -> dict:
    return {**store.get(), "webPort": WEB_PORT}


@app.put("/api/config")
async def put_config(payload: dict = Body(...)) -> dict:
    try:
        data = await asyncio.to_thread(store.update, payload)
    except padconfig.ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors)
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail=[f"Nie udało się zapisać pliku konfiguracji: {exc}"]
        )
    await asyncio.to_thread(prepare_record_dir)
    return {**data, "webPort": WEB_PORT}


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/help")
async def help_page():
    return FileResponse(STATIC_DIR / "help.html")


# Pozostałe pliki (CSS, JS, ikony).
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    prepare_record_dir()
    ip = local_ip()
    lan_url = f"http://{ip}:{WEB_PORT}"
    print(
        f"Stream Pad: http://localhost:{WEB_PORT}"
        f"   |   w sieci: {lan_url}"
        f"   |   instrukcja: http://localhost:{WEB_PORT}/help"
    )
    if ip != "127.0.0.1":
        print_qr(lan_url)
    uvicorn.run(app, host="0.0.0.0", port=WEB_PORT)
