"""Offline regression checks. These test logic, not real model accuracy or live auth."""
import io
import hashlib
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api"))
import _ai
import _openai_client
import _screening


def evidence():
    return {
        "is_valid_government_id": True, "id_type_matches_declared": True,
        "detected_document_type": "Student ID", "extracted_name": "Juan Santos",
        "extracted_first_name": "Juan", "extracted_middle_name": "", "extracted_last_name": "Santos",
        "extracted_birth_date": "2000-01-01", "extracted_id_number": "2024-123456",
        "alternate_id_numbers": [], "unreadable_or_occluded_fields": [], "confidence": "high",
        "lines": ["Student ID", "Juan Santos", "Date of Birth: 2000-01-01", "2024-123456"],
    }


class ScreeningTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "OPENAI_DEMO_SCREENING_ENABLED": "true", "OPENAI_API_KEY": "test-only",
            "OPENAI_MODEL": "configured-test-model",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.entered = {"full_name": "Juan Santos", "first_name": "Juan", "last_name": "Santos",
                        "birth_date": "2000-01-01", "id_type": "Student ID", "id_number": "2024-123456"}

    def extract(self, payload):
        with patch.object(_openai_client, "complete", return_value=json.dumps(payload)):
            return _ai.extract_id_text(b"fake-image", id_type="Student ID")

    def test_clear_matching_details(self):
        checks = _ai.compare_fields(self.entered, self.extract(evidence()))
        self.assertTrue(checks)
        self.assertTrue(all(c["status"] == "match" for c in checks), checks)

    def test_mixed_application_has_real_mismatch(self):
        self.entered["id_number"] = "9999-999999"
        checks = _ai.compare_fields(self.entered, self.extract(evidence()))
        self.assertEqual(next(c for c in checks if c["key"] == "id_number")["status"], "mismatch")
        self.assertEqual(next(c for c in checks if c["key"] == "name")["status"], "match")

    def test_unreadable_details_are_not_matches(self):
        data = evidence()
        data["unreadable_or_occluded_fields"] = ["name", "birth_date", "id_number"]
        data["lines"] = ["Student ID"]
        checks = _ai.compare_fields(self.entered, self.extract(data))
        self.assertTrue(all(c["status"] != "match" for c in checks), checks)

    def test_malformed_output_requires_manual_review(self):
        data = self.extract({"lines": "not an array"})
        self.assertFalse(data["available"])
        self.assertTrue(all(c["status"] == "unverified" for c in _ai.compare_fields(self.entered, data)))

    def test_missing_key_never_calls_provider(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}), patch("urllib.request.urlopen") as call:
            self.assertEqual(_openai_client.complete([]), "")
            call.assert_not_called()

    def test_demo_screening_disabled_never_calls_provider(self):
        with patch.dict(os.environ, {"OPENAI_DEMO_SCREENING_ENABLED": "false"}), patch("urllib.request.urlopen") as call:
            self.assertEqual(_openai_client.complete([]), "")
            call.assert_not_called()

    def test_quota_error_does_not_retry(self):
        error = urllib.error.HTTPError("https://api.openai.com", 429, "quota", {}, None)
        with patch("urllib.request.urlopen", side_effect=error) as call:
            self.assertEqual(_openai_client.complete([]), "")
            self.assertEqual(call.call_count, 1)

    def test_request_schema_and_original_images(self):
        raw = json.dumps({"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(evidence())}}]}).encode()
        with patch("urllib.request.urlopen", return_value=io.BytesIO(raw)) as call:
            result = _ai.extract_id_text_with_fallback(b"cropped", raw_front=b"original", id_type="Student ID")
            self.assertTrue(result["available"])
            body = json.loads(call.call_args.args[0].data)
            self.assertEqual(body["response_format"]["type"], "json_schema")
            self.assertFalse(body["store"])
            self.assertFalse(body["response_format"]["json_schema"]["schema"]["additionalProperties"])
            self.assertEqual(call.call_count, 1)

    def test_default_uses_bounded_vision_request(self):
        raw = json.dumps({"choices": [{"finish_reason": "stop", "message": {"content": "{}"}}]}).encode()
        with patch.dict(os.environ, {"OPENAI_MODEL": "", "OPENAI_REASONING_EFFORT": ""}), \
             patch("urllib.request.urlopen", return_value=io.BytesIO(raw)) as call:
            _openai_client.complete([])
            body = json.loads(call.call_args.args[0].data)
        self.assertEqual(body["model"], "gpt-5.4-mini")
        self.assertEqual(body["reasoning_effort"], "none")
        self.assertEqual(body["max_completion_tokens"], 2048)

    def test_non_id_without_text_is_reported(self):
        payload = evidence()
        payload.update(is_valid_government_id=False, detected_document_type="Selfie", lines=[])
        data = self.extract(payload)
        self.assertTrue(data["available"])
        self.assertFalse(data["is_valid_government_id"])
        self.assertEqual(data["extracted_name"], "")

    def test_refusal_requires_review(self):
        raw = json.dumps({"choices": [{"finish_reason": "stop", "message": {"refusal": "cannot read"}}]}).encode()
        with patch("urllib.request.urlopen", return_value=io.BytesIO(raw)):
            self.assertEqual(_openai_client.complete([]), "")

    def test_save_failure_is_reported(self):
        row = {"id": "test", "ref_no": "TEST", "id_image_url": "test", **self.entered}
        with patch.object(_screening, "_fetch_application", return_value=row), \
             patch.object(_screening, "_download_image_bytes", return_value=b"fake"), \
             patch.object(_screening, "_check_duplicate_images", return_value={}), \
             patch.object(_screening, "_evaluate_front_and_back_quality", return_value=({"readable": True}, None, None)), \
             patch.object(_ai, "extract_id_text_with_fallback", return_value={"available": False}), \
             patch.object(_screening, "_patch_application", return_value=False):
            self.assertFalse(_screening.run_application_screening("test")["screened"])

    def test_unchanged_images_reuse_ocr_and_compare_the_corrected_number(self):
        raw = b"fictional-example"
        digest = hashlib.sha256(raw).hexdigest()
        row = {"id": "test", "ref_no": "TEST", "id_image_url": "front", "id_back_image_url": "back", **self.entered}
        row["id_number"] = "9999-999999"
        row["screening"] = {
            "front_sha256": digest, "back_sha256": digest,
            "ocr_model": "configured-test-model", "ocr_id_type": "Student ID", "ocr_prompt_version": 2,
            "ocr": self.extract(evidence()),
        }
        with patch.object(_screening, "_fetch_application", return_value=row), \
             patch.object(_screening, "_download_image_bytes", return_value=raw), \
             patch.object(_screening, "_check_duplicate_images", return_value={}), \
             patch.object(_screening, "_evaluate_front_and_back_quality", return_value=({"readable": True}, None, None)), \
             patch.object(_ai, "extract_id_text_with_fallback") as new_call, \
             patch.object(_screening, "_patch_application", return_value=True), \
             patch.object(_screening, "_insert_table_row"):
            result = _screening.run_application_screening("test")
        self.assertTrue(result["screened"])
        new_call.assert_not_called()
        status = next(field["status"] for field in result["screening"]["comparisons"] if field["key"] == "id_number")
        self.assertEqual(status, "mismatch")

    def test_other_staff_claim_prevents_duplicate_request(self):
        row = {"id": "test", "updated_at": "2026-11-15T01:00:00+00:00", "screening": {"state": "pending_agent"}}
        with patch.object(_screening, "_fetch_application", return_value=row), \
             patch.object(_screening, "_patch_application", return_value=False), \
             patch.object(_screening, "run_application_screening") as check:
            result = _screening.run_automatic_screening("test")
        self.assertTrue(result["queued"])
        check.assert_not_called()

    def test_automatic_check_has_bounded_retries(self):
        row = {"id": "test", "updated_at": "2026-11-15T01:00:00+00:00",
               "screening": {"state": "unavailable", "attempt_count": 3}}
        with patch.object(_screening, "_fetch_application", return_value=row), \
             patch.object(_screening, "run_application_screening") as check:
            self.assertFalse(_screening.run_automatic_screening("test")["screened"])
        check.assert_not_called()

    def test_automatic_check_recovers_failed_processing(self):
        row = {"id": "test", "updated_at": "2026-11-15T01:00:00+00:00", "screening": {"state": "pending_agent"}}
        with patch.object(_screening, "_fetch_application", return_value=row), \
             patch.object(_screening, "_patch_application", return_value=True) as save, \
             patch.object(_screening, "run_application_screening", side_effect=OSError("unavailable")):
            self.assertFalse(_screening.run_automatic_screening("test")["screened"])
        self.assertEqual(save.call_count, 2)
        claimed_time = save.call_args_list[0].args[1]["updated_at"]
        self.assertEqual(save.call_args_list[1].args[2], claimed_time)
        self.assertEqual(save.call_args_list[1].args[1]["screening"]["state"], "unavailable")

    def test_empty_conditional_update_is_a_conflict(self):
        with patch.dict(os.environ, {"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "test"}), \
             patch("urllib.request.urlopen", return_value=io.BytesIO(b"[]")) as request:
            self.assertFalse(_screening._patch_application("test", {"screening": {}}, "previous-version"))
        self.assertIn("updated_at=eq.previous-version", request.call_args.args[0].full_url)

    def test_completed_application_is_not_reprocessed_from_a_stale_queue(self):
        row = {"id": "test", "updated_at": "2026-11-15T01:00:00+00:00", "screening": {"state": "completed"}}
        with patch.object(_screening, "_fetch_application", return_value=row), \
             patch.object(_screening, "run_application_screening") as check:
            self.assertTrue(_screening.run_automatic_screening("test")["screened"])
        check.assert_not_called()


if __name__ == "__main__":
    unittest.main()
