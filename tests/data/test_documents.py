"""Tests for the assistant document ingester. Fixtures are small synthetic documents used only in these tests."""
import io
import json
import sys
import tempfile
import unittest
import unittest.mock
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "data-platform"))
from documents import ingest  # noqa: E402
from documents.ingest import (  # noqa: E402
    extract_mamcos,
    Chunk, IngestError, Page, build_payload, chunk_pages, download, extract, extract_pib, ingest_document, load_manifest,
    post_document, quantize_embedding, stated_pib_date, validate_entry,
)

TOKEN = "admin-token-should-never-appear"


def minimal_pdf(pages: list[str]) -> bytes:
    """A valid PDF with one Helvetica text line per page (built by hand so tests need no PDF writer)."""
    objects = ["<< /Type /Catalog /Pages 2 0 R >>", ""]
    kids = []
    for text in pages:
        content = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("latin-1")
        page_id, content_id = len(objects) + 1, len(objects) + 2
        kids.append(f"{page_id} 0 R")
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_id} 0 R "
                       f"/Resources << /Font << /F1 {len(pages) * 2 + 3} 0 R >> >> >>")
        objects.append(f"<< /Length {len(content)} >>\nstream\n{content.decode('latin-1')}\nendstream")
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(pages)} >>"
    objects.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{offset:010d} 00000 n \n" for offset in offsets).encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def entry(**overrides):
    base = {"key": "test-booklet", "title": "Test booklet", "publisher": "ICAR-CPCRI", "document_type": "cpcri_publication",
            "language": "en", "source_url": "https://example.org/booklet.pdf", "mime_type": "application/pdf",
            "publication_date": "1999-12", "publication_date_basis": "stated", "reuse_note": "test"}
    base.update(overrides)
    return base


PIB_HTML = """<html><body><nav>Home | Login | Visitor counter 12345</nav>
<div class="innner-page-main-about-us-content-right-part"><h2>Tariff Notification No. 50/2025-Customs</h2>
<p>Posted On: 14 AUG 2025 6:30PM by PIB Delhi</p><p>Tariff value of Areca Nut is fixed as per the table.</p>
<script>var tracking = 1;</script><p>(Release ID: 2156666)</p><p>Footer links</p></div></body></html>"""


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class ManifestTests(unittest.TestCase):
    def test_repository_manifest_is_valid(self):
        entries = load_manifest()
        self.assertGreaterEqual(len(entries), 6)
        for item in entries:
            if item["publication_date"] is not None:
                self.assertTrue(item["publication_date_evidence"], item["key"])

    def test_rejects_invalid_entries(self):
        for bad in (entry(key="Bad Key"), entry(document_type="blog"), entry(source_url="http://example.org/x.pdf"),
                    entry(publication_date="14-08-2025"), entry(publication_date_basis=None),
                    entry(publication_date=None, publication_date_basis="stated"), entry(title="")):
            with self.subTest(bad=bad), self.assertRaises(IngestError):
                validate_entry(bad)
        validate_entry(entry(publication_date=None, publication_date_basis=None))

    def test_rejects_duplicate_keys(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "manifest.json"
            path.write_text(json.dumps({"documents": [entry(), entry()]}), encoding="utf-8")
            with self.assertRaisesRegex(IngestError, "Duplicate"):
                load_manifest(path)


class QuantizationTests(unittest.TestCase):
    def test_matches_the_api_encoding_byte_for_byte(self):
        # Same vector and expected value as api/src/assistant/assistant.test.ts.
        self.assertEqual(quantize_embedding([0.1, -0.2, 0.3, -0.4, 0.5, -0.6, 0.7, -0.05]), "C+sg1TbAS/s=")

    def test_normalises_and_clamps(self):
        import base64
        self.assertEqual(list(base64.b64decode(quantize_embedding([3, 4]))), [76, 102])
        self.assertEqual(quantize_embedding([0.0, 0.0]), "AAA=")


class ExtractionTests(unittest.TestCase):
    def test_pdf_pages_keep_their_numbers(self):
        pages, warnings = extract(entry(), minimal_pdf(["Mahali fruit rot appears on arecanut bunches in the monsoon", "Bordeaux mixture spray protects the bunches before the rains"]))
        self.assertEqual([page.number for page in pages], [1, 2])
        self.assertIn("Bordeaux", pages[1].text)
        self.assertEqual(warnings, [])

    def test_rejects_non_pdf_and_image_only_pdf(self):
        with self.assertRaisesRegex(IngestError, "not a PDF"):
            extract(entry(), b"<html>login</html>")
        with unittest.mock.patch.object(ingest.shutil, "which", return_value=None):
            with self.assertRaisesRegex(IngestError, "no extractable text and ocrmypdf is not installed"):
                extract(entry(), minimal_pdf([""]))

    def test_image_only_pdf_is_read_by_ocr_and_keeps_page_numbers(self):
        read = [ingest.Page(1, "Spray Bordeaux mixture before the monsoon on the bunches."), ingest.Page(2, "Repeat the spray after forty days.")]
        with unittest.mock.patch.object(ingest, "run_ocr", return_value=read) as ocr:
            pages, warnings = extract(entry(), minimal_pdf(["", ""]))
        self.assertEqual(ocr.call_args.args[1], "eng")
        self.assertEqual([page.number for page in pages], [1, 2])
        self.assertTrue(warnings[0].startswith(ingest.OCR_WARNING))

    def test_garbled_kannada_text_layer_goes_to_ocr_in_kannada(self):
        garbage = "p~eap~ eJJcpj' 8~rm<;e ~~~ mcp,2 '8~rpa ~~ ~eot->c> rpo,2-yeqoQM rpoer rpM " * 3
        read = [ingest.Page(1, "ಅಡಿಕೆ ಕಾಯಿ ಕೊಳೆಯುವ ರೋಗದ ನಿರ್ವಹಣೆ ಮತ್ತು ಬೋರ್ಡೋ ಮಿಶ್ರಣ")]
        with unittest.mock.patch.object(ingest, "run_ocr", return_value=read) as ocr:
            pages, warnings = extract(entry(language="kn"), minimal_pdf([garbage]))
        self.assertEqual(ocr.call_args.args[1], "kan+eng")
        self.assertIn("ಅಡಿಕೆ", pages[0].text)
        self.assertIn("not Unicode Kannada", warnings[0])

    def test_ocr_output_that_is_not_kannada_is_refused(self):
        with unittest.mock.patch.object(ingest, "run_ocr", return_value=[ingest.Page(1, "plain latin words only here " * 4)]):
            with self.assertRaisesRegex(IngestError, "not Kannada"):
                extract(entry(language="kn"), minimal_pdf([""]))

    def test_trustworthy_text_layer_is_not_sent_to_ocr(self):
        text = "Arecanut palms need well drained soil and regular irrigation during summer months."
        with unittest.mock.patch.object(ingest, "run_ocr") as ocr:
            pages, warnings = extract(entry(), minimal_pdf([text]))
        ocr.assert_not_called()
        self.assertEqual(warnings, [])
        self.assertIn("Arecanut", pages[0].text)

    def test_manifest_can_force_or_forbid_ocr(self):
        read = [ingest.Page(1, "Readable words from the scanned image of the page.")]
        with unittest.mock.patch.object(ingest, "run_ocr", return_value=read) as ocr:
            extract(entry(ocr="force"), minimal_pdf(["Arecanut palms need well drained soil and regular irrigation."]))
        ocr.assert_called_once()
        with self.assertRaisesRegex(IngestError, "OCR is switched off"):
            extract(entry(ocr="never"), minimal_pdf([""]))

    def test_run_ocr_splits_pages_reports_failures_and_uses_the_cache(self):
        def finished(command, **_):
            Path(command[command.index("--sidecar") + 1]).write_text("page one\f\fpage three\f", encoding="utf-8")
            return unittest.mock.Mock(returncode=0, stderr="")
        with tempfile.TemporaryDirectory() as folder, unittest.mock.patch.object(ingest.shutil, "which", return_value="/bin/ocrmypdf"):
            pages = ingest.run_ocr(b"%PDF", "eng", cache_dir=Path(folder), runner=finished)
            self.assertEqual([(page.number, page.text) for page in pages], [(1, "page one"), (2, ""), (3, "page three")])
            never = unittest.mock.Mock(side_effect=AssertionError("cache not used"))
            self.assertEqual(len(ingest.run_ocr(b"%PDF", "eng", cache_dir=Path(folder), runner=never)), 3)
            failing = unittest.mock.Mock(return_value=unittest.mock.Mock(returncode=7, stderr="missing language"))
            with self.assertRaisesRegex(IngestError, "exit 7.*missing language"):
                ingest.run_ocr(b"%PDF2", "kan", runner=failing)

    def test_ocr_noise_lines_are_removed_but_words_and_table_figures_stay(self):
        text = "> a << ot, ಕ - 7 . ee ce as | b& ಗ) fo la o.4\nಸಾರಜನಕ (N) 33 66 100\nಶೇಕಡಾ 1ರ ಬೋರ್ಡೋ ಮಿಶ್ರಣ ಸಿಂಪಡಣೆ\nSpray in June."
        self.assertEqual(ingest.drop_ocr_noise(text), "ಸಾರಜನಕ (N) 33 66 100\nಶೇಕಡಾ 1ರ ಬೋರ್ಡೋ ಮಿಶ್ರಣ ಸಿಂಪಡಣೆ\nSpray in June.")

    def test_ocr_is_recorded_in_the_reuse_note(self):
        payload = ingest.build_payload(entry(reuse_note="Public."), b"x", [], page_count=1, fetched_at="t", job_id="j", used_ocr=True)
        self.assertEqual(payload["document"]["reuse_note"], f"Public. {ingest.OCR_NOTE}")

    def test_pib_release_body_only(self):
        [page] = extract_pib(PIB_HTML)
        self.assertTrue(page.text.startswith("Tariff Notification"))
        self.assertTrue(page.text.endswith("(Release ID: 2156666)"))
        self.assertNotIn("Visitor counter", page.text)
        self.assertNotIn("tracking", page.text)
        self.assertNotIn("Footer", page.text)
        self.assertEqual(stated_pib_date(page.text), "2025-08-14")

    def test_pib_date_must_match_the_manifest(self):
        pib = entry(source_url="https://pib.gov.in/PressReleasePage.aspx?PRID=1", mime_type="text/html",
                    document_type="government_notification", publication_date="2025-08-14")
        pages, warnings = extract(pib, PIB_HTML.encode())
        self.assertEqual((len(pages), warnings), (1, []))
        with self.assertRaisesRegex(IngestError, "differs"):
            extract({**pib, "publication_date": "2025-08-21"}, PIB_HTML.encode())

    def test_pib_layout_change_is_an_error(self):
        with self.assertRaisesRegex(IngestError, "layout"):
            extract_pib("<html><body>Changed</body></html>")

    def test_mamcos_page_body_only(self):
        body = "ಹಳದಿ ಎಲೆ ರೋಗ ಅಡಿಕೆಯಲ್ಲಿ ಬರುವ ಪ್ರಮುಖ ರೋಗವಾಗಿದ್ದು, ಎಲೆಗಳು ಹಳದಿಯಾಗುತ್ತವೆ. " * 8
        markup = ("<html><nav>ಮುಖಪುಟ ಮಾಮ್‌ಕೋಸ್ ಬಗ್ಗೆ Menu</nav><div class=\"ticker\">ಇತ್ತೀಚಿನ ಸುದ್ದಿಗಳು</div>"
                  f"<div class=\"text-slate-900\"><h1>ಹಳದಿ ಎಲೆ ರೋಗ</h1><p>{body}</p></div><footer>ಸಂಪರ್ಕಿಸಿ 08182-250513</footer></html>")
        mamcos = entry(source_url="https://mamcos.info/public/areca/yellow-leaf-disease", mime_type="text/html",
                       document_type="agricultural_research", language="kn")
        [page], warnings = extract(mamcos, markup.encode())
        self.assertEqual(warnings, [])
        self.assertTrue(page.text.startswith("ಹಳದಿ ಎಲೆ ರೋಗ"))
        for chrome in ("Menu", "ಇತ್ತೀಚಿನ ಸುದ್ದಿಗಳು", "08182"):
            self.assertNotIn(chrome, page.text)

    def test_mamcos_layout_change_is_an_error(self):
        with self.assertRaisesRegex(IngestError, "layout"):
            extract_mamcos("<html><body>Changed</body></html>")
        with self.assertRaisesRegex(IngestError, "only"):
            extract_mamcos('<div class="text-slate-900">short</div><footer></footer>')


class ChunkingTests(unittest.TestCase):
    def test_short_document_is_one_chunk_with_heading_and_page(self):
        [chunk] = chunk_pages([Page(3, "DISEASES OF ARECANUT\nFruit rot is controlled by Bordeaux mixture.")])
        self.assertEqual((chunk.page_from, chunk.page_to, chunk.heading), (3, 3, "DISEASES OF ARECANUT"))

    def test_long_text_splits_with_overlap_and_page_spans(self):
        sentences = [f"Sentence {index} about arecanut nursery practice and irrigation." for index in range(120)]
        pages = [Page(1, "\n\n".join(sentences[:60])), Page(2, "\n\n".join(sentences[60:]))]
        chunks = chunk_pages(pages, target=600, overlap=120)
        self.assertGreater(len(chunks), 5)
        self.assertTrue(all(len(chunk.text) <= 700 for chunk in chunks))
        self.assertEqual([chunk.chunk_index for chunk in chunks], list(range(len(chunks))))
        self.assertTrue(any(chunk.page_from == 1 and chunk.page_to == 2 for chunk in chunks))
        # Consecutive chunks share the overlap carried from the previous chunk's tail.
        last_sentence = next(sentence for sentence in reversed(sentences) if sentence in chunks[0].text)
        self.assertIn(last_sentence, chunks[1].text)
        joined = " ".join(chunk.text for chunk in chunks)
        for sentence in sentences:
            self.assertIn(sentence, joined)

    def test_too_many_chunks_is_refused(self):
        with self.assertRaisesRegex(IngestError, "at most"):
            chunk_pages([Page(1, ("word " * 50 + ". ") * 500)], target=50, overlap=0)


class NetworkTests(unittest.TestCase):
    def test_refuses_to_work_around_access_restrictions(self):
        calls = []

        def forbidden(request, timeout):
            calls.append(request.get_header("User-agent"))
            raise urllib.error.HTTPError(request.full_url, 403, "Forbidden", {}, None)

        with self.assertRaisesRegex(IngestError, "--local-dir"):
            download("https://pib.gov.in/x", opener=forbidden, sleep=lambda _: None)
        self.assertEqual(calls, [ingest.USER_AGENT])

    def test_retries_server_errors(self):
        attempts = []

        def flaky(request, timeout):
            attempts.append(1)
            if len(attempts) < 3:
                raise urllib.error.HTTPError(request.full_url, 503, "Unavailable", {}, None)
            return FakeResponse(b"%PDF-data")

        self.assertEqual(download("https://example.org/x.pdf", opener=flaky, sleep=lambda _: None), b"%PDF-data")
        self.assertEqual(len(attempts), 3)

    def test_api_errors_never_contain_the_token(self):
        def rejecting(request, timeout):
            self.assertEqual(request.get_header("Authorization"), f"Bearer {TOKEN}")
            raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, io.BytesIO(f"bad token {TOKEN}".encode()))

        with self.assertRaises(IngestError) as caught:
            post_document({}, api_url="http://127.0.0.1:1/api/v1", token=TOKEN, opener=rejecting)
        self.assertNotIn(TOKEN, str(caught.exception))
        self.assertIn("[redacted]", str(caught.exception))
        with self.assertRaisesRegex(IngestError, "ANI_ADMIN_TOKEN"):
            post_document({}, api_url="http://x", token="")


class OrchestrationTests(unittest.TestCase):
    def test_payload_identity_follows_content(self):
        data = minimal_pdf(["Mahali"])
        payload = build_payload(entry(), data, [Chunk(0, 1, 1, None, "Mahali")], page_count=1, fetched_at="2026-11-05T00:00:00+00:00", job_id="job-1")
        self.assertEqual(payload["document"]["id"], f"test-booklet-{payload['document']['content_sha256'][:12]}")
        self.assertEqual(payload["chunks"], [{"chunk_index": 0, "page_from": 1, "page_to": 1, "heading": None, "text": "Mahali"}])

    def test_dry_run_from_local_copy_posts_nothing(self):
        def never(*args, **kwargs):
            raise AssertionError("must not be called")

        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "test-booklet.pdf").write_bytes(minimal_pdf(["Mahali fruit rot appears on arecanut bunches in the monsoon"]))
            result = ingest_document(entry(), job_id="job", dry_run=True, local_dir=Path(folder), api_url="", token="",
                                     embedder=lambda texts: [[1.0, 0.0] for _ in texts], fetcher=never, poster=never)
        self.assertEqual((result.status, result.chunks, result.embedded, result.error), ("dry_run", 1, 1, None))

    def test_missing_local_copy_is_reported(self):
        with tempfile.TemporaryDirectory() as folder:
            result = ingest_document(entry(), job_id="job", dry_run=True, local_dir=Path(folder), api_url="", token="", embedder=None)
        self.assertEqual(result.status, "failed")
        self.assertIn("No local file", result.error)

    def test_stores_and_reports_withdrawn_versions(self):
        posted = []

        def poster(payload, api_url, token):
            posted.append(payload)
            return {"status": "ingested", "document_id": payload["document"]["id"], "withdrawn_versions": ["old-id"]}

        result = ingest_document(entry(), job_id="job", dry_run=False, local_dir=None, api_url="http://api", token=TOKEN, embedder=None,
                                 fetcher=lambda url: minimal_pdf(["Mahali fruit rot appears on arecanut bunches in the monsoon"]), poster=poster)
        self.assertEqual(result.status, "ingested")
        self.assertEqual(len(posted), 1)
        self.assertIn("old-id", result.warnings[0])

    def test_cli_requires_credentials_unless_dry_run(self):
        with unittest.mock.patch.dict("os.environ", {"ANI_API_URL": "", "ANI_ADMIN_TOKEN": ""}), \
                unittest.mock.patch("sys.stderr", new=io.StringIO()):
            self.assertEqual(ingest.main(["--only", "cpcri-disease-management-arecanut-cocoa"]), 2)


if __name__ == "__main__":
    unittest.main()
