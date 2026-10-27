"""Inspect a local PDF; browser provenance and visual review remain separate."""

import argparse
import hashlib
from io import BytesIO
import json
import re
import sys
import unicodedata
from pathlib import Path


def normalized(text):
    return re.sub(r"[^\w]+", "", unicodedata.normalize("NFKC", text).casefold())


DOI = re.compile(r'10\.\d{4,9}/[^\s<>"\u201c\u201d]+', re.I)
REFERENCES = re.compile(r'^\s*(?:\d+[.\s]+)?(?:references(?:\s+and\s+notes)?|bibliography|literature cited|参考文献)\s*[:：]?\s*$', re.I)
DOI_PREFIX = re.compile(r'^\s*(?:doi\s*[:：]?\s*)?(?:https?://(?:dx\.)?doi\.org/)?\s*$', re.I)
RESOLVER = re.compile(r'https?://(?:dx\.)?doi\.org/\s*$', re.I)


def join_wrapped_doi_urls(text):
    """Join publisher DOI URLs split after a punctuation-delimited path segment.

    PLOS extracts citation metadata as ``...doi.org/10.1371/journal.`` followed
    by ``pone.xxxxxxx`` on the next line.  Joining only a resolver URL ending in
    a period avoids merging ordinary paragraph line wraps.
    """
    return re.sub(
        r"(https?://(?:dx\.)?doi\.org/10\.\d{4,9}/[^\s<>\"\u201c\u201d]*\.)\s*\n\s*([A-Za-z0-9][^\s<>\"\u201c\u201d]*)",
        r"\1\2",
        text,
        flags=re.I,
    )


def clean_doi(value):
    """Keep DOI punctuation significant, trimming only surrounding citation punctuation."""
    value = value.rstrip('.,;:]}')
    while value.endswith(')') and value.count(')') > value.count('('):
        value = value[:-1]
    return value.casefold()


def identity_evidence(page_texts):
    """Report conservative article-DOI candidates separately from inline citations."""
    body, evidence = [], []
    in_references = False
    for page_number, text in enumerate(page_texts, 1):
        text = unicodedata.normalize('NFKC', text).translate(dict.fromkeys(map(ord, '\u200b\u00ad\ufeff')))
        # A publisher may wrap the DOI immediately after its slash.
        text = re.sub(r'(10\.\d{4,9}/)\s*\n\s*(\S+)', r'\1\2', text)
        text = join_wrapped_doi_urls(text)
        lines = text.splitlines()
        for index, line in enumerate(lines):
            if REFERENCES.fullmatch(line):
                in_references = True
            if not in_references:
                body.append(line)
            for match in DOI.finditer(line):
                prefix = line[:match.start()]
                # Explicit standalone DOI labels/URLs, or resolver URLs in page margins.
                # Body citations and reference sections are observations, not proof of identity.
                margin = index < 6 or index >= len(lines) - 4
                resolver = RESOLVER.search(prefix) is not None
                # Publisher citation metadata can sit below the first six
                # lines (PLOS places its DOI around the article citation).
                # Accept an explicit publisher/article metadata marker while
                # keeping ordinary inline body URLs non-primary.
                metadata_marker = any(marker in line.casefold()
                                      for marker in ('plos one |', 'citation:', 'article doi'))
                primary = not in_references and (
                    DOI_PREFIX.fullmatch(prefix) is not None
                    or (margin and resolver)
                    or (resolver and metadata_marker)
                )
                evidence.append({'doi': clean_doi(match.group()), 'page': page_number,
                                 'primary_candidate': primary, 'in_references': in_references})
    primary = {item['doi'] for item in evidence if item['primary_candidate']}
    # PeerJ assigns child DOIs to figures and tables. They identify parts of
    # the same article only when its independently observed primary DOI exists.
    for item in evidence:
        child = re.fullmatch(r'(10\.7717/peerj\.\d+)/(?:fig|table)-\d+', item['doi'])
        if child and child.group(1) in primary:
            item['primary_candidate'] = False
            item['subresource_of'] = child.group(1)
    primary = sorted({item['doi'] for item in evidence if item['primary_candidate']})
    return '\n'.join(body), primary, evidence


def read_document(path):
    """Parse once for whole-pool matching; private text is omitted from reports."""
    from pypdf import PdfReader

    data = path.read_bytes()
    result = {
        "path": str(path.resolve()),
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "valid_pdf": False,
        "pages": None,
        "identity_match": None,
        "identity_status": "unresolved",
        "primary_dois": [],
        "doi_evidence": [],
        "doi_match": None,
        "title_match": None,
        "visual_check": "required",
    }
    if not data.startswith(b"%PDF-"):
        result["error"] = "Missing PDF header"
        return result
    try:
        reader = PdfReader(BytesIO(data))
        result["pages"] = len(reader.pages)
        if not reader.pages:
            raise ValueError("PDF has no pages")
        text, primary, evidence = identity_evidence([page.extract_text() or "" for page in reader.pages[:2]])
        result["valid_pdf"] = True
        result['primary_dois'] = primary
        result['doi_evidence'] = evidence
        result['_identity_text'] = normalized(text)
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    return result


def match_document(document, doi=None, title=None):
    result = {key:value for key,value in document.items() if not key.startswith('_')}
    doi = doi.strip() if doi and doi.strip() else None
    title = title.strip() if title and title.strip() else None
    if not result['valid_pdf']:
        return result
    primary = result['primary_dois']
    compact = document.get('_identity_text', '')
    expected = None
    try:
        if doi:
            expected = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", doi.strip(), flags=re.I)
            if not re.match(r"^10\.\d{4,9}/\S+$", expected):
                raise ValueError("Expected DOI must be a DOI or doi.org URL")
            expected = expected.casefold()
            result["doi_match"] = expected in primary
        if title:
            result["title_match"] = normalized(title) in compact
        matches = [result[k] for k in ("doi_match", "title_match") if result[k] is not None]
        if expected and primary and expected not in primary:
            result['identity_match'] = False
            result['identity_status'] = 'conflict'
        elif expected and any(value != expected for value in primary):
            result['identity_status'] = 'ambiguous'
        elif any(matches):
            result['identity_match'] = True
            result['identity_status'] = 'matched'
        # Missing text stays unresolved. Conflicting DOI candidates override a title match.
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    return result


def inspect(path, doi=None, title=None):
    return match_document(read_document(path), doi=doi, title=title)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--doi")
    parser.add_argument("--title")
    args = parser.parse_args()
    if not any(value and value.strip() for value in (args.doi, args.title)):
        parser.error("provide --doi or --title to establish expected identity")
    try:
        result = inspect(args.pdf, args.doi, args.title)
    except Exception as exc:
        result = {"valid_pdf": False, "identity_match": None, "error": f"{type(exc).__name__}: {exc}"}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["valid_pdf"] and result["identity_match"] is True else 2


if __name__ == "__main__":
    sys.exit(main())
