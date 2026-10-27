"""Exercise identity decisions on parseable PDFs without network or browser state."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.verify_pdf import inspect


def write_pdf(path, pages):
    writer = PdfWriter()
    for text in pages:
        page = writer.add_blank_page(width=612, height=792)
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'),
                                 NameObject('/Subtype'): NameObject('/Type1'),
                                 NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({
            NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        lines = []
        for line in text.splitlines():
            escaped = line.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
            lines.append(f'({escaped}) Tj T*')
        stream = DecodedStreamObject()
        stream.set_data(('BT /F1 10 Tf 12 TL 40 750 Td ' + '\n'.join(lines) + ' ET').encode('ascii'))
        page[NameObject('/Contents')] = writer._add_object(stream)
    with path.open('wb') as output:
        writer.write(output)


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.pdf = Path(self.directory.name) / 'candidate.pdf'

    def check(self, pages, doi='10.1234/requested', title='Expected paper title'):
        write_pdf(self.pdf, pages)
        return inspect(self.pdf, doi=doi, title=title)

    def test_explicit_other_doi_overrides_matching_title(self):
        result = self.check(['Expected paper title\nAuthors A and B\nDOI: 10.1234/other'])
        self.assertFalse(result['identity_match'])
        self.assertEqual(result['identity_status'], 'conflict')
        self.assertEqual(result['primary_dois'], ['10.1234/other'])

    def test_reference_doi_cannot_prove_identity(self):
        result = self.check(['Another paper title\nReferences\nExpected paper title. DOI: 10.1234/requested'])
        self.assertIsNone(result['identity_match'])
        self.assertFalse(result['doi_match'])
        self.assertFalse(result['title_match'])

    def test_reference_doi_does_not_create_false_conflict(self):
        result = self.check(['Expected paper title\nReferences\nDOI: 10.1234/other'])
        self.assertTrue(result['identity_match'])
        self.assertEqual(result['primary_dois'], [])

    def test_expected_doi_in_references_does_not_cancel_wrong_primary(self):
        result = self.check(['Wrong paper\nDOI: 10.1234/other\nReferences\nDOI: 10.1234/requested'])
        self.assertFalse(result['identity_match'])

    def test_doi_punctuation_is_significant(self):
        result = self.check(['Different paper\nDOI: 10.1234/a-b'], doi='10.1234/ab', title=None)
        self.assertFalse(result['identity_match'])
        self.assertFalse(result['doi_match'])

    def test_missing_doi_with_matching_title_is_not_conflict(self):
        result = self.check(['Expected paper title\nAuthors A and B\nA historical article.'])
        self.assertTrue(result['identity_match'])
        self.assertFalse(result['doi_match'])

    def test_cover_and_article_first_page(self):
        result = self.check(['Publisher cover', 'Expected paper title\nhttps://doi.org/10.1234/requested'])
        self.assertTrue(result['identity_match'])
        self.assertEqual(result['doi_evidence'][0]['page'], 2)

    def test_plos_metadata_doi_wrapped_after_journal_segment_is_primary(self):
        result = self.check([
            'PLOS ONE | https://doi.org/10.1371/journal.pone.0260000 November 18, 2021 1 / 13\n'
            'Citation: Author A et al.\n'
            '16(11):e0260000.https://doi.org/10.1371/journal.\n'
            'pone.0260000',
        ], doi='10.1371/journal.pone.0260000', title=None)
        self.assertTrue(result['identity_match'])
        self.assertEqual(result['identity_status'], 'matched')
        self.assertEqual(result['primary_dois'], ['10.1371/journal.pone.0260000'])

    def test_inline_body_citation_is_not_a_primary_doi(self):
        result = self.check(['Expected paper title\nEarlier work (DOI: 10.1234/other) supports this.'])
        self.assertTrue(result['identity_match'])
        self.assertEqual(result['primary_dois'], [])

    def test_case_url_and_trailing_full_stop(self):
        result = self.check(['Paper\nDOI: 10.1234/ABC.'], doi='https://doi.org/10.1234/abc', title=None)
        self.assertTrue(result['identity_match'])

    def test_absence_is_unresolved_not_conflict(self):
        result = self.check(['An unreadable identity'])
        self.assertIsNone(result['identity_match'])
        self.assertEqual(result['identity_status'], 'unresolved')

    def test_conflicting_primary_dois_require_review(self):
        result = self.check(['Expected paper title\nDOI: 10.1234/requested\nDOI: 10.1234/other'])
        self.assertIsNone(result['identity_match'])
        self.assertEqual(result['identity_status'], 'ambiguous')

    def test_peerj_figure_and_table_dois_do_not_conflict_with_observed_parent(self):
        result = self.check(['Expected paper title\nDOI: 10.7717/peerj.21817',
                             'https://doi.org/10.7717/peerj.21817/fig-1\nDOI: 10.7717/peerj.21817/table-2'],
                            doi='10.7717/peerj.21817')
        self.assertTrue(result['identity_match'])
        self.assertEqual(result['primary_dois'], ['10.7717/peerj.21817'])
        self.assertEqual(result['doi_evidence'][1]['subresource_of'], '10.7717/peerj.21817')

    def test_peerj_child_without_primary_parent_cannot_prove_article_identity(self):
        result = self.check(['Expected paper title\nDOI: 10.7717/peerj.21817/fig-1'],
                            doi='10.7717/peerj.21817')
        self.assertFalse(result['identity_match'])

    def test_foreign_peerj_child_still_requires_review(self):
        result = self.check(['Expected paper title\nDOI: 10.7717/peerj.21817\nDOI: 10.7717/peerj.99999/fig-1'],
                            doi='10.7717/peerj.21817')
        self.assertEqual(result['identity_status'], 'ambiguous')

    def test_other_publishers_doi_suffix_is_not_automatically_a_subresource(self):
        result = self.check(['Expected paper title\nDOI: 10.1234/requested\nDOI: 10.1234/requested/fig-1'])
        self.assertEqual(result['identity_status'], 'ambiguous')

    def test_title_only_request_can_use_title(self):
        result = self.check(['Expected paper title\nDOI: 10.1234/other'], doi=None)
        self.assertTrue(result['identity_match'])

    def test_invalid_pdf_stays_invalid(self):
        self.pdf.write_text('<html>Login</html>', encoding='utf-8')
        result = inspect(self.pdf, doi='10.1234/requested')
        self.assertFalse(result['valid_pdf'])

    def test_cli_refuses_conflict(self):
        write_pdf(self.pdf, ['Expected paper title\nDOI: 10.1234/other'])
        result = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'scripts/verify_pdf.py'),
                                 str(self.pdf), '--doi', '10.1234/requested', '--title', 'Expected paper title'],
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertFalse(json.loads(result.stdout)['identity_match'])


if __name__ == '__main__':
    unittest.main()
