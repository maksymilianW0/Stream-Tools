import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import padconfig  # noqa: E402


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "config.json"

    def tearDown(self):
        self.tmp.cleanup()

    def test_defaults_without_file(self):
        cfg = padconfig.Store(self.path).get()
        self.assertEqual(cfg["obsPort"], 4455)
        self.assertEqual(cfg["pad"], {"scenes": {}, "sceneOrder": [], "audioInputs": None})

    def test_roundtrip_and_persistence(self):
        s = padconfig.Store(self.path)
        s.update({"obsPort": 4466, "twitchChannel": "  MrExample "})
        again = padconfig.Store(self.path).get()
        self.assertEqual(again["obsPort"], 4466)
        self.assertEqual(again["twitchChannel"], "mrexample")
        self.assertEqual([p.name for p in Path(self.tmp.name).iterdir()], ["config.json"])

    def test_partial_update_keeps_rest(self):
        s = padconfig.Store(self.path)
        s.update({"pad": {"sceneOrder": ["B", "A"]}})
        s.update({"recordDir": "/tmp/x"})
        cfg = s.get()
        self.assertEqual(cfg["pad"]["sceneOrder"], ["B", "A"])
        self.assertEqual(cfg["recordDir"], "/tmp/x")

    def test_scene_settings(self):
        s = padconfig.Store(self.path)
        s.update({"pad": {"scenes": {"Gra": {"label": " Gameplay ", "color": "#35E0C0", "hidden": True}}}})
        self.assertEqual(
            s.get()["pad"]["scenes"]["Gra"],
            {"label": "Gameplay", "color": "#35e0c0", "hidden": True},
        )

    def test_rejects_invalid_and_keeps_old_state(self):
        s = padconfig.Store(self.path)
        for bad in (
            {"obsPort": 0},
            {"obsPort": "4455"},
            {"obsPort": True},
            {"twitchChannel": "a b"},
            {"obsOnThisPc": "yes"},
            {"pad": {"scenes": {"X": {"color": "red"}}}},
            {"pad": {"audioInputs": "mic"}},
        ):
            with self.subTest(bad=bad), self.assertRaises(padconfig.ValidationError):
                s.update(bad)
        self.assertEqual(s.get()["obsPort"], 4455)
        self.assertFalse(self.path.exists())

    def test_unknown_keys_dropped(self):
        s = padconfig.Store(self.path)
        s.update({"evil": 1, "obsPort": 4460})
        self.assertNotIn("evil", json.loads(self.path.read_text()))

    def test_duplicates_removed(self):
        s = padconfig.Store(self.path)
        s.update({"pad": {"sceneOrder": ["A", "B", "A"], "audioInputs": ["Mic", "Mic"]}})
        pad = s.get()["pad"]
        self.assertEqual(pad["sceneOrder"], ["A", "B"])
        self.assertEqual(pad["audioInputs"], ["Mic"])

    def test_corrupt_file_falls_back(self):
        self.path.write_text("{nie json", encoding="utf-8")
        self.assertEqual(padconfig.Store(self.path).get()["obsPort"], 4455)

    def test_invalid_file_values_fall_back(self):
        self.path.write_text(json.dumps({"obsPort": 99999}), encoding="utf-8")
        self.assertEqual(padconfig.Store(self.path).get()["obsPort"], 4455)

    def test_env_defaults(self):
        os.environ["OBS_PORT"] = "4999"
        try:
            self.assertEqual(padconfig.Store(self.path).get()["obsPort"], 4999)
        finally:
            del os.environ["OBS_PORT"]


if __name__ == "__main__":
    unittest.main()
