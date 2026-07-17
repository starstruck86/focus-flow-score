import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
HARNESS = ROOT / "scripts" / "security" / "verify-cron-secret-rotation.ts"
CONFIG = ROOT / "supabase" / "config.toml"
INVENTORY = ROOT / "docs" / "migration" / "edge-functions.json"


def reject_duplicate_json_keys(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON key")
        value[key] = item
    return value


def load_json_strict(text: str):
    return json.loads(text, object_pairs_hook=reject_duplicate_json_keys)


def reviewed_components(inventory, expected_slugs):
    result = {}
    for component in inventory.get("components", []):
        if (
            component.get("kind") != "edge_function"
            or component.get("key") not in expected_slugs
        ):
            continue
        slug = component["key"]
        if slug in result:
            raise ValueError("duplicate reviewed inventory component")
        result[slug] = component
    return result


class CronVerifyJwtBindingTest(unittest.TestCase):
    """Bind reviewed expectations; this is not deployed-runtime observation."""

    REVIEWED_EXPECTED_MAP = {
        "daily-digest": False,
        "run-strategy-task-reaper": True,
        "run-strategy-task-reaper-receipt-v1": True,
        "schedule-daily-plan": True,
    }

    @classmethod
    def setUpClass(cls) -> None:
        harness_text = HARNESS.read_text(encoding="utf-8")
        blocks = re.findall(
            r'^const REVIEWED_EXPECTED_FUNCTIONS = Object\.freeze\(\{\n'
            r'(?P<body>.*?)^\} as const\);$',
            harness_text,
            flags=re.MULTILINE | re.DOTALL,
        )
        if len(blocks) != 1:
            raise ValueError("expected one canonical reviewed function map")
        pairs = []
        for line in blocks[0].splitlines():
            match = re.fullmatch(
                r'  "([a-z0-9-]+)": Object\.freeze\('
                r'\{ reviewedExpectedVerifyJwt: (true|false) \}\),',
                line,
            )
            if match is None:
                raise ValueError("noncanonical reviewed function map entry")
            pairs.append((match.group(1), match.group(2)))
        if len({slug for slug, _ in pairs}) != len(pairs):
            raise ValueError("duplicate reviewed function map entry")
        cls.harness_map = {slug: value == "true" for slug, value in pairs}
        cls.config_text = CONFIG.read_text(encoding="utf-8")
        cls.inventory = load_json_strict(INVENTORY.read_text(encoding="utf-8"))

    @staticmethod
    def project_id(config_text: str) -> str:
        matches = re.findall(
            r'^project_id\s*=\s*"([a-z0-9]+)"\s*$',
            config_text,
            flags=re.MULTILINE,
        )
        if len(matches) != 1:
            raise ValueError("expected exactly one literal project_id")
        return matches[0]

    @staticmethod
    def reviewed_effective_verify_jwt(config_text: str, slug: str) -> bool:
        section = re.search(
            rf'^\[functions\.{re.escape(slug)}\]\s*$'
            rf'(?P<body>.*?)(?=^\[|\Z)',
            config_text,
            flags=re.MULTILINE | re.DOTALL,
        )
        if section is None:
            # The reviewed Supabase default is true when a function has no
            # explicit table or verify_jwt field in this checked-in file.
            return True
        values = re.findall(
            r'^verify_jwt\s*=\s*(true|false)\s*(?:#.*)?$',
            section.group("body"),
            flags=re.MULTILINE,
        )
        if len(values) > 1:
            raise ValueError(f"duplicate verify_jwt field for {slug}")
        return values[0] == "true" if values else True

    def test_harness_has_exact_reviewed_expected_map(self) -> None:
        self.assertEqual(self.harness_map, self.REVIEWED_EXPECTED_MAP)

    def test_harness_matches_effective_checked_in_config(self) -> None:
        for slug, expected in self.harness_map.items():
            effective = self.reviewed_effective_verify_jwt(
                self.config_text,
                slug,
            )
            self.assertEqual(expected, effective, slug)

    def test_harness_matches_repository_inventory(self) -> None:
        self.assertEqual(
            self.inventory.get("project_ref"),
            self.project_id(self.config_text),
        )
        components = reviewed_components(
            self.inventory,
            self.REVIEWED_EXPECTED_MAP,
        )
        self.assertEqual(set(components), set(self.REVIEWED_EXPECTED_MAP))
        for slug, expected in self.harness_map.items():
            verify_jwt = components[slug]["configuration"]["verify_jwt"]
            self.assertEqual(verify_jwt["value"], expected, slug)
            section = re.search(
                rf'^\[functions\.{re.escape(slug)}\]\s*$'
                rf'(?P<body>.*?)(?=^\[|\Z)',
                self.config_text,
                flags=re.MULTILINE | re.DOTALL,
            )
            expected_source = (
                "explicit_config"
                if section is not None
                and re.search(
                    r'^verify_jwt\s*=\s*(?:true|false)\s*(?:#.*)?$',
                    section.group("body"),
                    flags=re.MULTILINE,
                )
                else "documented_default"
            )
            self.assertEqual(verify_jwt["source"], expected_source, slug)

    def test_harness_labels_configuration_as_reviewed_expected(self) -> None:
        text = HARNESS.read_text(encoding="utf-8")
        self.assertIn("reviewed_expected_verify_jwt", text)
        self.assertNotRegex(text, r"observed[_ -]runtime[_ -]verify_jwt")

    def test_inventory_duplicate_keys_fail_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "duplicate JSON key"):
            load_json_strict('{"project_ref":"first","project_ref":"second"}')

    def test_duplicate_reviewed_inventory_component_fails_closed(self) -> None:
        component = {
            "kind": "edge_function",
            "key": "daily-digest",
        }
        with self.assertRaisesRegex(
            ValueError,
            "duplicate reviewed inventory component",
        ):
            reviewed_components(
                {"components": [component, dict(component)]},
                self.REVIEWED_EXPECTED_MAP,
            )


if __name__ == "__main__":
    unittest.main()
