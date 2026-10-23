# 🎛️ Stream Pad

**Stream Pad** to nowoczesna, lekka i responsywna aplikacja webowa służąca do zdalnego i lokalnego sterowania OBS Studio. Została zaprojektowana z myślą o streamerach, umożliwiając wygodne zarządzanie scenami, dźwiękiem, nagrywaniem oraz czatem Twitch z poziomu dowolnego urządzenia w sieci lokalnej (np. telefonu, tabletu lub drugiego monitora).

---

## ✨ Główne funkcje

* **Kontrola transmisji i nagrywania:** Uruchamianie/zatrzymywanie streamu, nagrywania oraz bufora powtórrek z mechanizmem zabezpieczającym przed przypadkowym kliknięciem (przytrzymanie przycisku).
* **Zarządzanie scenami:** Przełączanie scen w czasie rzeczywistym, zmiana ich kolejności, ukrywanie niepotrzebnych elementów oraz personalizacja kolorów przycisków.
* **Panel audio:** Pełna kontrola nad mikserem dźwięku OBS – suwaki głośności z przelicznikami logarytmicznymi oraz przyciski wyciszania (mute).
* **Automatyzacja (Reguły „Gdy → Wtedy”):** Tworzenie zaawansowanych reguł automatycznych, np. *„po przełączeniu na scenę X automatycznie wycisz mikrofon”* lub *„po uruchomieniu streamu zacznij nagrywanie”*.
* **Czat Twitch na żywo:** Wbudowany, lekki podgląd czatu wybranego kanału Twitch (tryb anonimowy, tylko do odczytu) z obsługą kolorów użytkowników i automatycznym przewijaniem.
* **Automatyczne wykrywanie OBS:** Skanowanie sieci lokalnej w poszukiwaniu uruchomionego serwera OBS WebSocket.
* **Wygodne ustawienia:** Konfiguracja portu WebSocket, katalogu nagrań, formatu nazw plików oraz preferencji układu bezpośrednio w przejrzystym panelu w przeglądarce.

---

## 🛠️ Technologie

* **Backend:** Python, FastAPI, Uvicorn, WebSocket
* **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES Modules)
* **Komunikacja:** OBS WebSocket Protocol v5

---

## 🚀 Instalacja i uruchomienie

### 1. Wymagania wstępne
* Python 3.8 lub nowszy
* OBS Studio z włączonym serwerem **OBS WebSocket v5** (w OBS: *Narzędzia* → *Ustawienia serwera WebSocket*).

### 2. Klonowanie repozytorium
```bash
git clone [https://github.com/maksymilianW0/Stream-Tools.git](https://github.com/maksymilianW0/Stream-Tools.git)
cd Stream-Tools