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
MAX_RULES = 100
MAX_RULE_ACTIONS = 20
RULE_TRIGGERS = {
    "scene_enter", "scene_leave",
    "stream_start", "stream_stop",
    "record_start", "record_stop",
}
SCENE_TRIGGERS = {"scene_enter", "scene_leave"}
RULE_ACTIONS = {"mute", "unmute", "volume", "scene", "rec_start", "rec_stop"}
TARGET_ACTIONS = {"mute", "unmute", "volume", "scene"}


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
        "pad": {"scenes": {}, "sceneOrder": [], "audioInputs": None, "actions": []},
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


def _rules(value: Any, errors: list[str]) -> list[dict[str, Any]]:
    """Akcje: reguły „gdy zdarzenie → wykonaj akcje"."""
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > MAX_RULES:
        errors.append(f"Akcje: oczekiwano listy (maks. {MAX_RULES} reguł).")
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for n, rule in enumerate(value, 1):
        label = f"Reguła {n}"
        if not isinstance(rule, dict):
            errors.append(f"{label}: nieprawidłowy format.")
            continue
        rid = rule.get("id")
        if not isinstance(rid, str) or not 0 < len(rid) <= 64 or rid in seen:
            errors.append(f"{label}: nieprawidłowy identyfikator.")
            continue
        seen.add(rid)
        enabled = rule.get("enabled", True)
        if not isinstance(enabled, bool):
            errors.append(f"{label}: pole „włączona” musi być tak/nie.")
            enabled = True

        trig = rule.get("trigger")
        if not isinstance(trig, dict) or trig.get("type") not in RULE_TRIGGERS:
            errors.append(f"{label}: nieznane zdarzenie.")
            continue
        trigger: dict[str, Any] = {"type": trig["type"]}
        if trig["type"] in SCENE_TRIGGERS:
            scene = trig.get("scene")
            if not isinstance(scene, str) or not 0 < len(scene) <= MAX_NAME:
                errors.append(f"{label}: wybierz scenę.")
                continue
            trigger["scene"] = scene

        acts_in = rule.get("actions")
        if not isinstance(acts_in, list) or not 0 < len(acts_in) <= MAX_RULE_ACTIONS:
            errors.append(f"{label}: wymagane 1–{MAX_RULE_ACTIONS} akcji.")
            continue
        acts: list[dict[str, Any]] = []
        valid = True
        for a in acts_in:
            if not isinstance(a, dict) or a.get("type") not in RULE_ACTIONS:
                errors.append(f"{label}: nieznana akcja.")
                valid = False
                break
            act: dict[str, Any] = {"type": a["type"]}
            if a["type"] in TARGET_ACTIONS:
                target = a.get("target")
                if not isinstance(target, str) or not 0 < len(target) <= MAX_NAME:
                    errors.append(f"{label}: akcja bez celu.")
                    valid = False
                    break
                act["target"] = target
            if a["type"] == "volume":
                vol = a.get("value")
                if isinstance(vol, bool) or not isinstance(vol, int) or not 0 <= vol <= 100:
                    errors.append(f"{label}: głośność musi być liczbą od 0 do 100.")
                    valid = False
                    break
                act["value"] = vol
            acts.append(act)
        if valid:
            out.append({"id": rid, "enabled": enabled, "trigger": trigger, "actions": acts})
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
    rules = _rules(pad.get("actions"), errors)

    if errors:
        raise ValidationError(errors)
    return {
        "obsPort": port,
        "recordDir": record_dir,
        "recordFilenameFormat": fmt,
        "obsOnThisPc": on_this_pc,
        "twitchChannel": channel,
        "pad": {"scenes": scenes_out, "sceneOrder": order, "audioInputs": audio, "actions": rules},
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
