import io
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from server.jobs import Job, JobEditError, JobManager


class EmailDraftTests(unittest.TestCase):
    def setUp(self):
        self.manager = JobManager(max_workers=1)
        self.job = Job(
            id="email-test",
            status="done",
            output_path="specification_sheet.docx",
            files=["tender.pdf"],
            data={
                "meta": {
                    "project_ref": "RFQ-42",
                    "project_title": "Pump replacement",
                    "buyer": "Example Client",
                },
                "line_items": [
                    {
                        "item_name": "Pump",
                        "item_number": "P-42",
                        "qty": "2",
                        "uom": "pcs",
                        "specs": [{"parameter": "Power", "value": "5 kW"}],
                    }
                ],
                "source_files": ["tender.pdf"],
                "suppliers": [{
                    "suppliers": [{
                        "company_name": "Example Supplier",
                        "email": "sales@example.test",
                    }]
                }],
            },
            versions=[{"id": 2, "tag": "v02"}],
        )
        self.manager._jobs[self.job.id] = self.job

    def test_generates_from_existing_data_and_records_draft_events(self):
        with patch("server.jobs.history_store.save"):
            created = self.manager.generate_email_draft(
                self.job.id, actor="buyer"
            )
            draft = created.email_draft

            self.assertEqual(draft["subject"], "RFQ RFQ-42 - Request for Quotation")
            self.assertEqual(draft["to"], "sales@example.test")
            self.assertIn("Pump", draft["body"])
            self.assertIn("5 kW", draft["body"])
            self.assertNotIn("tender_dates", draft["summary"])
            self.assertEqual(draft["selected_attachments"], [])
            self.assertEqual([version["id"] for version in created.versions], [2])

            saved = self.manager.save_email_draft(
                self.job.id,
                {
                    "to": "buyer@example.test",
                    "cc": "",
                    "subject": draft["subject"],
                    "body": draft["body"],
                    "selected_attachments": ["specification_sheet"],
                },
                actor="buyer",
            )
            saved_recipient = saved.email_draft["to"]
            saved_draft_id = saved.email_draft["id"]
            regenerated = self.manager.generate_email_draft(
                self.job.id, regenerate=True, actor="buyer"
            )

        self.assertEqual(saved_recipient, "buyer@example.test")
        self.assertEqual(
            [event["action"] for event in regenerated.audit],
            [
                "email_draft_created",
                "email_draft_edited",
                "email_draft_saved",
                "email_draft_regenerated",
            ],
        )
        self.assertTrue(all(event.get("version") == 2 for event in regenerated.audit))
        self.assertEqual(regenerated.audit[-1].get("object_id"), regenerated.email_draft["id"])
        self.assertNotEqual(regenerated.email_draft["id"], saved_draft_id)
        self.assertEqual([version["id"] for version in regenerated.versions], [2])

    def test_rejects_unavailable_attachment_ids(self):
        with patch("server.jobs.history_store.save"):
            self.manager.generate_email_draft(self.job.id)
            with self.assertRaises(JobEditError):
                self.manager.save_email_draft(
                    self.job.id,
                    {
                        "to": "",
                        "cc": "",
                        "subject": "",
                        "body": "",
                        "selected_attachments": ["../private-file"],
                    },
                )

    def test_scratch_draft_is_blank_and_bcc_is_saved(self):
        with patch("server.jobs.history_store.save"):
            created = self.manager.generate_email_draft(
                self.job.id, mode="scratch", actor="buyer"
            )
            draft = created.email_draft
            self.assertEqual(draft["mode"], "scratch")
            self.assertEqual(draft["to"], "")
            self.assertEqual(draft["subject"], "")
            self.assertEqual(draft["body"], "")
            self.assertEqual(draft["bcc"], "")

            saved = self.manager.save_email_draft(
                self.job.id,
                {
                    "mode": "scratch",
                    "to": "to@example.test",
                    "cc": "cc@example.test",
                    "bcc": "private@example.test",
                    "subject": "Independent email",
                    "body": "Hello",
                    "selected_attachments": [],
                },
                actor="buyer",
            )

        self.assertEqual(saved.email_draft["bcc"], "private@example.test")
        self.assertEqual(saved.email_draft["mode"], "scratch")

    def test_uploaded_attachment_is_persisted_and_audited(self):
        with TemporaryDirectory() as temp_dir, patch(
            "server.jobs.WORKSPACE_ROOT", Path(temp_dir)
        ), patch("server.jobs.history_store.save"):
            self.manager.generate_email_draft(
                self.job.id, mode="scratch", actor="buyer"
            )
            added = self.manager.add_email_attachments(
                self.job.id,
                [SimpleNamespace(filename="notes.txt", file=io.BytesIO(b"Quote details"))],
                actor="buyer",
            )
            attachment_id = next(
                item["id"] for item in added.email_draft["available_attachments"]
                if item["kind"] == "uploaded"
            )
            updated = self.manager.save_email_draft(
                self.job.id,
                {
                    "mode": "scratch",
                    "to": "",
                    "cc": "",
                    "bcc": "",
                    "subject": "",
                    "body": "",
                    "selected_attachments": [attachment_id],
                },
                actor="buyer",
            )
            attachment_exists = (
                Path(temp_dir) / self.job.id / "email_attachments" / "notes.txt"
            ).is_file()

        draft = updated.email_draft
        attachment = next(
            item for item in draft["available_attachments"]
            if item["kind"] == "uploaded"
        )
        self.assertEqual(attachment["name"], "notes.txt")
        self.assertEqual(draft["selected_attachments"], [attachment_id])
        self.assertTrue(attachment_exists)
        self.assertIn(
            "email_draft_attachment_added",
            [event["action"] for event in updated.audit],
        )


if __name__ == "__main__":
    unittest.main()
