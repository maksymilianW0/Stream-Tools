"""Konfiguracja Stream Pad: wartości domyślne ze zmiennych środowiskowych,
zapis w config.json i walidacja. Bez zależności poza biblioteką standardową."""

from __future__ import annotations

import copy
import json
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Any

CHANNEL_RE = re.compile(r"^[a-z0-9_]{3,25}$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
MAX_SCENES = 200
MAX_AUDIO = 50
MAX_NAME = 200


class ValidationError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def env_defaults() -> dict[str, Any]:
    """Wartości startowe. Plik config.json (zapisywany z GUI) je nadpisuje."""
    return {
        "obsPort": int(os.environ.get("OBS_PORT", 4455)),
        "recordDir": os.environ.get("RECORD_DIR", "/home/maks/Wideo/OBS"),
        "recordFilenameFormat": os.environ.get(
            "RECORD_FILENAME_FORMAT", "%CCYY-%MM-%DD_%hh-%mm-%ss"
        ),
        "obsOnThisPc": os.environ.get("OBS_ON_THIS_PC", "1") == "1",
        "twitchChannel": os.environ.get("TWITCH_CHANNEL", ""),
        "pad": {"scenes": {}, "sceneOrder": [], "audioInputs": None},
    }


def _text(value: Any, maxlen: int, label: str, errors: list[str]) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        errors.append(f"{label}: oczekiwano tekstu.")
        return ""
    value = value.strip()
    if len(value) > maxlen:
        errors.append(f"{label}: maksymalnie {maxlen} znaków.")
    return value


def _names(value: Any, limit: int, label: str, errors: list[str]) -> list[str]:
    if not isinstance(value, list) or len(value) > limit:
        errors.append(f"{label}: oczekiwano listy (maks. {limit} pozycji).")
        return []
    out: list[str] = []
    for item in value:
        if not isinstance(item, str) or not 0 < len(item) <= MAX_NAME:
            errors.append(f"{label}: nieprawidłowa nazwa.")
            continue
        if item not in out:
            out.append(item)
    return out


def validate(data: Any) -> dict[str, Any]:
    """Zwraca oczyszczoną konfigurację albo zgłasza ValidationError."""
    if not isinstance(data, dict):
        raise ValidationError(["Konfiguracja musi być obiektem JSON."])
    errors: list[str] = []

    port = data.get("obsPort")
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        errors.append("Port OBS musi być liczbą od 1 do 65535.")

    record_dir = _text(data.get("recordDir"), 500, "Katalog nagrań", errors)
    fmt = _text(data.get("recordFilenameFormat"), 200, "Schemat nazwy pliku", errors)

    on_this_pc = data.get("obsOnThisPc")
    if not isinstance(on_this_pc, bool):
        errors.append("Pole „OBS na tym komputerze” musi być wartością tak/nie.")

    channel = _text(data.get("twitchChannel"), 100, "Kanał Twitch", errors).lower()
    if channel and not CHANNEL_RE.match(channel):
        errors.append("Kanał Twitch: 3–25 znaków (litery, cyfry, podkreślnik).")

    pad = data.get("pad")
    if not isinstance(pad, dict):
        errors.append("Brak sekcji „pad”.")
        pad = {}

    scenes_in = pad.get("scenes", {})
    scenes_out: dict[str, dict[str, Any]] = {}
    if not isinstance(scenes_in, dict) or len(scenes_in) > MAX_SCENES:
        errors.append(f"Sceny: oczekiwano obiektu (maks. {MAX_SCENES} pozycji).")
    else:
        for name, cfg in scenes_in.items():
            if not isinstance(name, str) or not 0 < len(name) <= MAX_NAME:
                errors.append("Sceny: nieprawidłowa nazwa sceny.")
                continue
            if not isinstance(cfg, dict):
                errors.append(f"Scena „{name}”: nieprawidłowe ustawienia.")
                continue
            label = _text(cfg.get("label", ""), 60, f"Scena „{name}” – nazwa", errors)
            color = cfg.get("color", "")
            if color != "" and not (isinstance(color, str) and COLOR_RE.match(color)):
                errors.append(f"Scena „{name}”: kolor musi mieć postać #rrggbb.")
                color = ""
            hidden = cfg.get("hidden", False)
            if not isinstance(hidden, bool):
                errors.append(f"Scena „{name}”: pole „ukryta” musi być tak/nie.")
                hidden = False
            scenes_out[name] = {"label": label, "color": color.lower(), "hidden": hidden}

    order = _names(pad.get("sceneOrder", []), MAX_SCENES, "Kolejność scen", errors)

    audio_in = pad.get("audioInputs")
    audio = None if audio_in is None else _names(audio_in, MAX_AUDIO, "Urządzenia audio", errors)

    if errors:
        raise ValidationError(errors)
    return {
        "obsPort": port,
        "recordDir": record_dir,
        "recordFilenameFormat": fmt,
        "obsOnThisPc": on_this_pc,
        "twitchChannel": channel,
        "pad": {"scenes": scenes_out, "sceneOrder": order, "audioInputs": audio},
    }


def _merge(base: dict[str, Any], patch: Any) -> dict[str, Any]:
    """Nakłada patch na base; nieznane klucze są ignorowane."""
    out = copy.deepcopy(base)
    if not isinstance(patch, dict):
        return out
    for key in base:
        if key not in patch:
            continue
        if key == "pad" and isinstance(patch[key], dict):
            out["pad"] = {**out["pad"], **copy.deepcopy(patch["pad"])}
        else:
            out[key] = copy.deepcopy(patch[key])
    return out


class Store:
    """Konfiguracja w pamięci + atomowy zapis do pliku JSON."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.Lock()
        self._data = self._load()

    def _load(self) -> dict[str, Any]:
        base = validate(env_defaults())
        if not self.path.exists():
            return base
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            return validate(_merge(base, raw))
        except (OSError, ValueError) as exc:  # w tym JSONDecodeError i ValidationError
            print(f"Ostrzeżenie: nie można wczytać {self.path} ({exc}). Używam ustawień domyślnych.")
            return base

    def get(self) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self._data)

    def update(self, patch: Any) -> dict[str, Any]:
        with self._lock:
            clean = validate(_merge(self._data, patch))
            self._write(clean)
            self._data = clean
            return copy.deepcopy(clean)

    def _write(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".config-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=2)
                fh.write("\n")
            os.replace(tmp, self.path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
