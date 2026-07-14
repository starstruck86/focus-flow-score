from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "scripts" / "migration" / "compare-manifests.py"


def component(
    key: str,
    *,
    kind: str = "table",
    count: int | None = 1,
    fingerprint: str | None = "sha256:same",
    configuration_known: bool = True,
    independently_verifiable: bool = True,
) -> dict[str, object]:
    return {
        "key": key,
        "kind": kind,
        "count": count,
        "fingerprint": fingerprint,
        "configuration_known": configuration_known,
        "independently_verifiable": independently_verifiable,
    }


def manifest(label: str, components: list[dict[str, object]]) -> dict[str, object]:
    return {"format_version": 1, "label": label, "components": components}


class CompareManifestCliTest(unittest.TestCase):
    def run_tool(self, source: dict[str, object], target: dict[str, object]):
        with tempfile.TemporaryDirectory(prefix="manifest comparison ") as directory:
            root = Path(directory)
            source_path = root / "source manifest.json"
            target_path = root / "target manifest.json"
            source_path.write_text(json.dumps(source), encoding="utf-8")
            target_path.write_text(json.dumps(target), encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(TOOL), str(source_path), str(target_path), "--format", "json"],
                check=False,
                capture_output=True,
                text=True,
            )

    def test_match(self):
        value = manifest("same", [component("public.accounts")])
        result = self.run_tool(value, value)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["results"][0]["outcomes"], ["Match"])

    def test_all_required_non_match_outcomes(self):
        source = manifest(
            "source",
            [
                component("public.missing"),
                component("public.counted", count=2),
                component(
                    "dashboard.oauth",
                    kind="auth",
                    count=None,
                    fingerprint=None,
                    configuration_known=False,
                    independently_verifiable=False,
                ),
            ],
        )
        target = manifest(
            "target",
            [
                component("public.unexpected"),
                component("public.counted", count=3),
                component(
                    "dashboard.oauth",
                    kind="auth",
                    count=None,
                    fingerprint=None,
                    configuration_known=False,
                    independently_verifiable=False,
                ),
            ],
        )
        result = self.run_tool(source, target)
        self.assertEqual(result.returncode, 2, result.stderr)
        outcomes = {
            row["key"]: row["outcomes"]
            for row in json.loads(result.stdout)["results"]
        }
        self.assertEqual(outcomes["public.missing"], ["Missing on target"])
        self.assertEqual(outcomes["public.unexpected"], ["Unexpected on target"])
        self.assertEqual(outcomes["public.counted"], ["Count mismatch"])
        self.assertEqual(
            outcomes["dashboard.oauth"],
            ["Not independently verifiable", "Configuration unknown"],
        )

    def test_configuration_mismatch_is_not_a_match(self):
        source = manifest("source", [component("public.accounts", fingerprint="sha256:a")])
        target = manifest("target", [component("public.accounts", fingerprint="sha256:b")])
        result = self.run_tool(source, target)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(
            json.loads(result.stdout)["results"][0]["outcomes"],
            ["Configuration mismatch"],
        )

    def test_unknown_fields_fail_closed(self):
        source = manifest("source", [component("public.accounts")])
        source["surprise"] = "ignored only by unsafe parsers"
        result = self.run_tool(source, manifest("target", []))
        self.assertEqual(result.returncode, 1)
        self.assertIn("unknown field", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_duplicate_identity_fails_closed(self):
        duplicate = manifest(
            "source", [component("public.accounts"), component("public.accounts")]
        )
        result = self.run_tool(duplicate, manifest("target", []))
        self.assertEqual(result.returncode, 1)
        self.assertIn("duplicate component identity", result.stderr)


if __name__ == "__main__":
    unittest.main()
