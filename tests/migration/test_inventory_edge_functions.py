from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "scripts" / "migration" / "inventory-edge-functions.py"


class EdgeInventoryTest(unittest.TestCase):
    def make_repo(self, config: str) -> tuple[tempfile.TemporaryDirectory[str], Path]:
        temporary = tempfile.TemporaryDirectory(prefix="edge inventory repo ")
        root = Path(temporary.name)
        (root / "supabase" / "functions" / "explicit").mkdir(parents=True)
        (root / "supabase" / "functions" / "unset").mkdir(parents=True)
        (root / "supabase" / "functions" / "_shared").mkdir(parents=True)
        (root / "supabase" / "functions" / "explicit" / "index.ts").write_text(
            "export const value = 1;\n", encoding="utf-8"
        )
        (root / "supabase" / "functions" / "unset" / "index.ts").write_text(
            "export const value = 2;\n", encoding="utf-8"
        )
        (root / "supabase" / "config.toml").write_text(config, encoding="utf-8")
        return temporary, root

    def test_explicit_and_unknown_jwt_settings(self):
        temporary, root = self.make_repo(
            '[functions.explicit]\nverify_jwt = true\n\n[functions.unset]\n'
        )
        with temporary:
            result = subprocess.run(
                [sys.executable, str(TOOL), "--repo-root", str(root)],
                check=False,
                capture_output=True,
                text=True,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        components = {item["key"]: item for item in json.loads(result.stdout)["components"]}
        self.assertTrue(components["explicit"]["configuration_known"])
        self.assertIn("verify_jwt=true", components["explicit"]["note"])
        self.assertFalse(components["unset"]["configuration_known"])
        self.assertTrue(components["explicit"]["fingerprint"].startswith("sha256:"))

    def test_orphan_config_fails_closed(self):
        temporary, root = self.make_repo(
            '[functions.explicit]\nverify_jwt = true\n\n[functions.orphan]\nverify_jwt = false\n'
        )
        with temporary:
            result = subprocess.run(
                [sys.executable, str(TOOL), "--repo-root", str(root)],
                check=False,
                capture_output=True,
                text=True,
            )
        self.assertEqual(result.returncode, 1)
        self.assertIn("config names without matching function directory", result.stderr)
        self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
