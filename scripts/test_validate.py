"""Doctor regression tests: isolated files, mocked providers, no live host access."""
import contextlib
import io
import json
import pathlib
import runpy
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch


class DoctorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="peer-doctor-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.origin = self.root / "origin"
        self.user = self.root / "user"
        self.write(self.origin / "state/deployments.json", "[]")
        self.write(self.user / ".ai-orchestrator/AI_HEALTH.md", "")
        for source, target in (("platforms/codex/AGENTS.md", ".codex/AGENTS.md"),
                               ("platforms/antigravity/GEMINI.md", ".gemini/GEMINI.md")):
            self.write(self.origin / source, "fixture")
            self.write(self.user / target, "fixture")
        (self.origin / "scripts").mkdir()
        shutil.copyfile(pathlib.Path(__file__).with_name("validate.py"), self.origin / "scripts/validate.py")
        self.manifest = {
            "sharedServers": {"fixture": {"command": sys.executable, "args": []}},
            "hosts": {"codex": ["fixture"], "antigravity-cli": [], "claude-code": ["fixture"]},
            "antigravityReview": {},
        }
        self.write(self.user / ".claude.json", json.dumps({"mcpServers": self.manifest["sharedServers"]}))

    def write(self, file, text):
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text, encoding="utf-8")

    def run_doctor(self, hosts="claude-code", on_probe=None):
        self.write(self.origin / "integrations.json", json.dumps(self.manifest))
        probes = []

        def run(argv, **kwargs):
            if "probe.mjs" in str(argv):
                spec = json.loads(kwargs["input"])
                probes.append(spec)
                if on_probe:
                    on_probe(spec)
                result = {"ok": spec["command"] == sys.executable, "tools": ["fixture"]}
                if spec.get("workspace"):
                    result.update(explicitModelSchema=True, peerCapabilitiesChecked=True,
                                  codexAvailable=True, antigravityAvailable=True,
                                  antigravityModelsAvailable=True, workspaceReady=True,
                                  antigravityDiscovery={"cli": "AVAILABLE", "catalog": "AVAILABLE"})
                return subprocess.CompletedProcess(argv, 0, json.dumps(result), "")
            return subprocess.CompletedProcess(argv, 0, str(self.root), "")

        with patch("pathlib.Path.home", return_value=self.user), \
             patch("shutil.which", return_value=sys.executable), \
             patch("subprocess.run", side_effect=run), \
             patch("urllib.request.urlopen", side_effect=OSError("fixture offline")), \
             patch.object(sys, "argv", ["validate.py", "--hosts", hosts, "--probe"]), \
             patch.object(sys, "exit"), contextlib.redirect_stdout(io.StringIO()):
            namespace = runpy.run_path(str(self.origin / "scripts/validate.py"))
        return namespace, probes

    def test_claude_only_does_not_require_other_hosts(self):
        namespace, probes = self.run_doctor()
        self.assertEqual(namespace["report"]["errors"], [])
        self.assertEqual(len(probes), 1)

    def test_unselected_broken_host_is_not_probed(self):
        self.write(self.user / ".codex/config.toml", '[mcp_servers.fixture]\ncommand="missing-fixture-executable"\nargs=[]\n')
        namespace, probes = self.run_doctor()
        self.assertEqual(namespace["report"]["errors"], [])
        self.assertEqual(len(probes), 1)

    def test_partial_receipts_are_scoped_and_rollback_is_ignored(self):
        self.manifest["sharedServers"]["jev"] = {"command": sys.executable, "args": ["${PEER_RUNTIME}", "${JEV_ENTRY}"]}
        ledger = self.user / ".peer-capabilities/host-configuration/environment.sqlite"
        ledger.parent.mkdir(parents=True)
        with contextlib.closing(sqlite3.connect(ledger)) as db:
            db.execute("CREATE TABLE host_configuration_operations (body TEXT)")
            records = [
                {"codex": {"jev": {"runtimeRoot": str(self.root / "codex-runtime"), "entry": str(self.root / "jev")}},
                 "claude-code": {"jev": {"runtimeRoot": str(self.root / "claude-runtime")}}},
                {"claude-code": {"rea": {"entry": str(self.root / "rea")}}},
                {"codex": {"jev": {"runtimeRoot": str(self.root / "rolled-back")}}},
            ]
            for index, bindings in enumerate(records):
                db.execute("INSERT INTO host_configuration_operations VALUES (?)", (json.dumps({"version": 1,
                    "status": "ROLLED_BACK" if index == 2 else "COMPLETE", "bindings": bindings}),))
            db.commit()
        namespace, _ = self.run_doctor()
        self.assertEqual(namespace["expected_server"]("codex", "jev")["args"][0], str(self.root / "codex-runtime"))
        self.assertEqual(namespace["expected_server"]("claude-code", "jev")["args"][0], str(self.root / "claude-runtime"))

    def test_peer_catalog_probes_do_not_overlap_each_other_or_other_mcps(self):
        self.manifest["sharedServers"]["peer-agents"] = {"command": sys.executable, "args": []}
        self.manifest["hosts"]["claude-code"] = ["peer-agents", "fixture"]
        self.manifest["hosts"]["codex"] = ["peer-agents", "fixture"]
        self.write(self.user / ".claude.json", json.dumps({"mcpServers": self.manifest["sharedServers"]}))
        quoted = json.dumps(sys.executable)
        self.write(self.user / ".codex/config.toml", f'[mcp_servers.peer-agents]\ncommand={quoted}\nargs=[]\n'
                   f'[mcp_servers.fixture]\ncommand={quoted}\nargs=[]\n')
        lock = threading.Lock()
        active = []
        overlaps = []
        completed = []

        def observe(spec):
            peer = bool(spec.get("workspace"))
            with lock:
                if (peer and active) or any(active):
                    overlaps.append(True)
                active.append(peer)
            time.sleep(0.02)
            with lock:
                active.remove(peer)
                completed.append(peer)

        namespace, probes = self.run_doctor("codex,claude-code", observe)
        self.assertEqual(namespace["report"]["errors"], [])
        self.assertEqual(len(probes), 4)
        self.assertEqual(overlaps, [])
        self.assertEqual(completed, [False, False, True, True])


if __name__ == "__main__":
    unittest.main()
