"""Assign a neutral PDF pool by content. Input paths and output paths are absolute.

The plan has papers [{key, doi?, title?}], candidates [{candidate_path, sha256?,
completion_evidence?, trigger_key?}], and optional visual_checks
[{paper_key, sha256, passed:true}]. Copy individually verified or auto-verified papers.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys

try:
    from .verify_pdf import match_document, read_document
except ImportError:
    from verify_pdf import match_document, read_document


EVIDENCE = {'native_event_and_ui', 'completed_ui_ephemeral_plos_tab',
            'current_download_ui_completed'}


def has_provenance(copy, byte_count):
    # Preserve failed/late captures as evidence, never promote them by a label.
    if (copy.get('capture_status') == 'capture_failed'
            or copy.get('round_exit_required') is True
            or copy.get('cli_exit_confirmed') is False
            or copy.get('failure_reason')):
        return False
    if copy.get('completion_evidence') in {'sdk_saveAs', 'serialized_sdk_saveAs'}:
        return (copy.get('capture_status') == 'saved_candidate'
                and copy.get('round_exit_required') is False
                and copy.get('cli_exit_confirmed') is True)
    if copy.get('completion_evidence') in EVIDENCE:
        return True
    if copy.get('completion_evidence') not in {'audited_batch_ui_completed', 'shared_pool_ui_completed'}:
        return False
    audit = copy.get('audit')
    if not isinstance(audit, dict) or audit.get('cli_exit_confirmed') is not True:
        return False
    if (copy.get('completion_evidence') == 'shared_pool_ui_completed'
            and (not isinstance(audit.get('pool_id'), str) or not audit['pool_id']
                 or audit['pool_id'] != audit.get('source_attempt'))):
        return False
    record = audit.get('record')
    if not isinstance(record, dict):
        return False
    start, end, recorded = (audit.get('attempt_started_ms'), audit.get('attempt_ended_ms'),
                            record.get('started_ms'))
    if any(type(value) not in (int, float) or not math.isfinite(value) for value in (start, end, recorded)):
        return False
    new_ids = audit.get('new_record_ids')
    return (isinstance(new_ids, list) and isinstance(audit.get('source_attempt'), str)
            and bool(audit['source_attempt']) and isinstance(copy.get('receipt_id'), str)
            and bool(copy['receipt_id'])
            and copy.get('receipt_id') in new_ids
            and record.get('id') == copy.get('receipt_id')
            and record.get('state') == 'completed' and record.get('removed') is False
            and record.get('total_bytes') == byte_count
            and bool(copy.get('source_path')) and record.get('file_path') == copy['source_path']
            and 0 < start <= end and start - 2000 <= recorded <= end + 2000)


def validate_papers(papers):
    if not isinstance(papers, list) or not papers:
        raise ValueError('papers must be a nonempty list')
    keys = set()
    for paper in papers:
        if not isinstance(paper, dict):
            raise ValueError('papers must contain objects')
        key = paper.get('key', '')
        if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,99}', key) or key.endswith('.'):
            raise ValueError('paper keys must be portable file names')
        if key.split('.')[0].upper() in {'CON','PRN','AUX','NUL', *(f'COM{i}' for i in range(1,10)), *(f'LPT{i}' for i in range(1,10))}:
            raise ValueError('reserved paper key')
        if key.casefold() in keys:
            raise ValueError('paper keys must be unique')
        keys.add(key.casefold())
        doi, title = paper.get('doi'), paper.get('title')
        if any(value is not None and not isinstance(value, str) for value in (doi, title)):
            raise ValueError('DOI and title must be strings')
        if not (isinstance(doi, str) and doi.strip() or isinstance(title, str) and title.strip()):
            raise ValueError('every paper requires a DOI or title')
        if doi and not re.fullmatch(r'(?:https?://(?:dx\.)?doi\.org/)?10\.\d{4,9}/\S+', doi.strip(), re.I):
            raise ValueError('invalid expected DOI')


def assign_candidates(plan, *, output_dir=None):
    if not isinstance(plan, dict):
        raise ValueError('plan must be an object')
    papers = plan.get('papers')
    validate_papers(papers)
    if output_dir is not None:
        output_dir = Path(output_dir)
        if not output_dir.is_absolute():
            raise ValueError('output_dir must be absolute')
    checks = plan.get('visual_checks', [])
    candidates = plan.get('candidates', [])
    if not isinstance(candidates, list) or not isinstance(checks, list):
        raise ValueError('candidates and visual_checks must be lists')
    if any(not isinstance(check, dict) for check in checks):
        raise ValueError('visual_checks must contain objects')
    reviews = {(c.get('paper_key'), c.get('sha256')):c.get('passed') is True for c in checks}
    rows, errors, seen = [], [], {}
    for candidate in candidates:
        if not isinstance(candidate, dict) or not isinstance(candidate.get('candidate_path'), str):
            errors.append({'reason':'invalid_candidate_record'})
            continue
        path = Path(candidate.get('candidate_path', ''))
        if not path.is_absolute():
            errors.append({'path':str(path), 'reason':'absolute_candidate_path_required'})
            continue
        try:
            data = path.read_bytes()
            sha = hashlib.sha256(data).hexdigest()
            if candidate.get('sha256') and candidate['sha256'] != sha:
                raise ValueError('candidate_hash_changed')
            copy = {k:candidate[k] for k in ['candidate_path','trigger_key','completion_evidence',
                    'receipt_id','event_guid','source_path','audit','capture_status',
                    'round_exit_required','cli_exit_confirmed','failure_reason',
                    'cancel_status','cancel_error_kind'] if k in candidate}
            if sha in seen:
                seen[sha]['copies'].append(copy)
                continue
            document = read_document(path)
            if document['sha256'] != sha:
                raise ValueError('candidate_changed_during_read')
            if not document['valid_pdf']:
                raise ValueError('invalid_pdf')
            matches = []
            evidence = []
            for paper in papers:
                check = match_document(document, paper.get('doi'), paper.get('title'))
                evidence.append({'paper_key':paper['key'], 'identity_status':check['identity_status'],
                                 'identity_match':check['identity_match'], 'doi_match':check['doi_match'],
                                 'title_match':check['title_match']})
                if check['identity_match'] is True:
                    matches.append(paper['key'])
            row = {'sha256':sha, 'bytes':document['bytes'], 'pages':document['pages'],
                   'copies':[copy], 'matches':matches, 'checks':evidence}
            rows.append(row)
            seen[sha] = row
        except (OSError, ValueError, TypeError):
            errors.append({'path':str(path), 'reason':'candidate_unreadable_or_invalid'})
    assigned, mismatches = [], []
    for paper in papers:
        key = paper['key']
        possible = [row for row in rows if key in row['matches']]
        result = {**paper, 'status':'missing', 'distinct_matching_files':len(possible)}
        if possible:
            result['status'] = 'ambiguous'
        if len(possible) == 1 and possible[0]['matches'] == [key]:
            row = possible[0]
            provenance = [c for c in row['copies'] if has_provenance(c, row['bytes'])]
            review_key = (key, row['sha256'])
            visual_review = reviews.get(review_key)
            visual_pass = visual_review is True
            result.update(sha256=row['sha256'], bytes=row['bytes'], pages=row['pages'],
                          provenance=row['copies'],
                          visual_status='passed' if visual_pass else 'failed' if review_key in reviews else 'not_required',
                          status='provenance_pending' if not provenance else
                          'verified' if visual_pass else 'visual_review_failed' if review_key in reviews else 'auto_verified')
            if any(c.get('trigger_key') is not None and c['trigger_key'] != key for c in row['copies']):
                mismatches.append(key)
            if result['status'] in {'verified', 'auto_verified'} and output_dir is not None:
                destination = output_dir / (key + '.pdf')
                try:
                    data = Path(provenance[0]['candidate_path']).read_bytes()
                    if hashlib.sha256(data).hexdigest() != row['sha256']:
                        raise ValueError('source_changed_before_assignment')
                    output_dir.mkdir(parents=True, exist_ok=True)
                    if destination.exists():
                        if hashlib.sha256(destination.read_bytes()).hexdigest() != row['sha256']:
                            raise ValueError('destination_conflict')
                    else:
                        with destination.open('xb') as target:
                            target.write(data)
                    result['assigned_path'] = str(destination)
                except (OSError, ValueError):
                    result['status'] = 'assignment_failed'
        assigned.append(result)
    verified = sum(p['status'] == 'verified' for p in assigned)
    extra = [r['sha256'] for r in rows if not r['matches']]
    auto_verified = sum(p['status'] == 'auto_verified' for p in assigned)
    accepted = verified + auto_verified
    return {'requested':len(papers), 'distinct_candidates':len(rows), 'verified':verified,
            'auto_verified':auto_verified,
            'batch_status':'complete' if accepted == len(papers) and not extra and not errors else 'partial',
            'missing':[p['key'] for p in assigned if p['status'] == 'missing'],
            'ambiguous':[p['key'] for p in assigned if p['status'] == 'ambiguous'],
            'unmatched_candidates':extra, 'candidate_errors':errors, 'trigger_mismatches':mismatches,
            'papers':assigned, 'candidate_checks':rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('plan', type=Path)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path)
    args = parser.parse_args()
    if not args.plan.is_absolute() or not args.report.is_absolute():
        parser.error('plan and report must be absolute paths')
    try:
        if args.report.exists():
            raise ValueError('use a new report path')
        plan = json.loads(args.plan.read_text(encoding='utf-8-sig'))
        result = assign_candidates(plan, output_dir=args.output_dir)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        with args.report.open('x', encoding='utf-8') as report:
            json.dump(result, report, ensure_ascii=False, indent=2)
        print(json.dumps({k:v for k,v in result.items() if k not in {'papers','candidate_checks'}}, ensure_ascii=False))
        return 0 if result['batch_status'] == 'complete' else 2
    except (OSError, ValueError, TypeError):
        print(json.dumps({'error':'assignment_input_or_output_failed'}))
        return 2


if __name__ == '__main__':
    sys.exit(main())
