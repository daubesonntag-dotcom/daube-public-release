import json
import tempfile
import unittest
from pathlib import Path

import concierge
import controller
import evidence
import providers


class Fixture:
    def __init__(self):
        self.td = tempfile.TemporaryDirectory()
        self.root = Path(self.td.name)
        self.roots = {
            "jobs": self.root / "jobs",
            "bid_receipts": self.root / "bids",
            "live_bid_receipts": self.root / "live",
            "accept_receipts": self.root / "accept",
            "money_receipts": self.root / "money",
            "revenue_ledger": self.root / "ledger.jsonl",
        }
        for key, value in self.roots.items():
            if key != "revenue_ledger":
                Path(value).mkdir(parents=True, exist_ok=True)

    def job(self, project_id=1, bid_id=2, status="AWARDED_ACCEPTED"):
        directory = self.roots["jobs"] / str(project_id)
        directory.mkdir()
        (directory / "job.json").write_text(json.dumps({"project_id": project_id, "bid_id": bid_id, "status": status}))
        return directory

    def close(self):
        self.td.cleanup()


class EvidenceTests(unittest.TestCase):
    def test_bid_not_revenue(self):
        fixture = Fixture()
        (fixture.roots["bid_receipts"] / "b.json").write_text(json.dumps({"authoritative": True, "project_id": 1, "bid_id": 2}))
        resolved = evidence.resolve_project(1, fixture.roots)
        self.assertEqual(evidence.canonical_state(resolved), "BID_SUBMITTED")
        self.assertFalse(resolved.get("settlements"))
        fixture.close()

    def test_mismatched_accept_fails_closed(self):
        fixture = Fixture(); fixture.job()
        (fixture.roots["accept_receipts"] / "accept-1-2.json").write_text(json.dumps({"authoritative": True, "project_id": 999, "bid_id": 2}))
        self.assertEqual(evidence.canonical_state(evidence.resolve_project(1, fixture.roots)), "FAILED_CLOSED")
        fixture.close()

    def test_delivery_then_pending_then_settled_precedence(self):
        fixture = Fixture(); fixture.job()
        (fixture.roots["money_receipts"] / "delivery-1.json").write_text(json.dumps({"authoritative": True, "project_id": 1}))
        self.assertEqual(evidence.canonical_state(evidence.resolve_project(1, fixture.roots)), "DELIVERED")
        (fixture.roots["money_receipts"] / "milestone-release-1.json").write_text(json.dumps({"authoritative": True, "project_id": 1}))
        self.assertEqual(evidence.canonical_state(evidence.resolve_project(1, fixture.roots)), "SETTLEMENT_PENDING")
        fixture.roots["revenue_ledger"].write_text(json.dumps({"project_id": 1, "authoritative_external_settlement": True, "evidence": "official_get_milestones_released_or_paid", "amount": 100}) + "\n")
        self.assertEqual(evidence.canonical_state(evidence.resolve_project(1, fixture.roots)), "SETTLED")
        fixture.close()

    def test_fake_ledger_not_settled(self):
        fixture = Fixture(); fixture.job()
        fixture.roots["revenue_ledger"].write_text(json.dumps({"project_id": 1, "authoritative_external_settlement": False, "evidence": "test"}) + "\n")
        self.assertNotEqual(evidence.canonical_state(evidence.resolve_project(1, fixture.roots)), "SETTLED")
        fixture.close()


class ProviderTests(unittest.TestCase):
    def test_freelancer_supported_and_fiverr_write_blocked(self):
        self.assertTrue(providers.capability_allowed("freelancer", "send_message"))
        self.assertFalse(providers.capability_allowed("fiverr", "send_message"))
        self.assertFalse(providers.capability_allowed("unknown", "submit_bid"))


class ConciergeTests(unittest.TestCase):
    def test_no_unsolicited(self):
        self.assertEqual(concierge.may_send("STATUS_UPDATE", False, {}, 100, None), (False, "NO_VERIFIED_RELATIONSHIP"))

    def test_dedup(self):
        self.assertEqual(concierge.may_send("AWARD_ACK", True, {"AWARD_ACK": 1}, 100, None), (False, "DUPLICATE"))

    def test_rate_limit(self):
        self.assertEqual(concierge.may_send("STATUS_UPDATE", True, {}, 10000, 9000), (False, "RATE_LIMIT"))

    def test_new_activity_can_bypass_status_time(self):
        self.assertEqual(concierge.may_send("STATUS_UPDATE", True, {}, 10000, 9000, True), (True, "PASS"))

    def test_revision_cap_and_scope_expansion_gate(self):
        self.assertEqual(concierge.classify_client_request("fix spacing", 1), "FOUNDER_GATE")
        self.assertEqual(concierge.classify_client_request("add new feature", 0), "FOUNDER_GATE")
        self.assertEqual(concierge.classify_client_request("please adjust spacing", 0), "SAFE_REPLY")

    def test_offplatform_identity_gate(self):
        self.assertEqual(concierge.classify_client_request("pay me directly by bank transfer", 0), "FOUNDER_GATE")
        self.assertEqual(concierge.classify_client_request("fake location please", 0), "FOUNDER_GATE")

    def test_redaction(self):
        self.assertNotIn("abc123", concierge.redact("token=abc123 hello"))


class ControllerTests(unittest.TestCase):
    def test_allowlist(self):
        calls = []
        self.assertFalse(controller.safe_start("evil.service", lambda service: calls.append(service) or True))
        self.assertEqual(calls, [])

    def test_action_map_terminal_none(self):
        for state in ("FOUNDER_GATE", "SETTLED", "FAILED_CLOSED", "QA_HOLD"):
            self.assertIsNone(controller.choose_action({"state": state}))

    def test_atomic_and_one_service_per_cycle(self):
        fixture = Fixture()
        for project_id in (1, 2):
            (fixture.roots["bid_receipts"] / f"{project_id}.json").write_text(json.dumps({"authoritative": True, "project_id": project_id, "bid_id": project_id + 10}))
        output_root = fixture.root / "v10"; calls = []
        summary = controller.run_once(output_root, lambda service: calls.append(service) or True, fixture.roots)
        self.assertEqual(calls, ["daube-freelancer-award-watcher.service"])
        self.assertTrue((output_root / "state.json").is_file())
        self.assertEqual(summary["projects"], 2)
        fixture.close()

    def test_secret_scrub_keys_and_values(self):
        scrubbed = controller._scrub({"api_key": "abc", "note": "token=def123", "nested": {"password": "ghi"}})
        payload = json.dumps(scrubbed)
        for secret in ("abc", "def123", "ghi"):
            self.assertNotIn(secret, payload)

    def test_founder_gate_is_mirrored(self):
        fixture = Fixture(); job = fixture.job()
        (job / "FOUNDER_ACTION_REQUIRED.json").write_text(json.dumps({"reason": "SCOPE_EXPANSION", "note": "token=secret123"}))
        output_root = fixture.root / "v10"
        controller.run_once(output_root, lambda service: True, fixture.roots)
        gate = output_root / "founder-gates" / "1.json"
        self.assertTrue(gate.is_file())
        self.assertNotIn("secret123", gate.read_text())
        fixture.close()


if __name__ == "__main__":
    unittest.main()
