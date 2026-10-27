"""Whole-pool identity decisions, independent of browser scheduling and filenames."""
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.assign_candidates import assign_candidates
from test_verify_pdf import write_pdf


class AssignmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.papers = [{'key':'a', 'doi':'10.1234/a', 'title':'Article alpha'},
                       {'key':'b', 'doi':'10.1234/b', 'title':'Article beta'}]

    def candidate(self, name, text, trigger=None):
        file = self.root / name
        write_pdf(file, [text])
        return {'candidate_path':str(file), 'trigger_key':trigger,
                'capture_status':'saved_candidate', 'completion_evidence':'native_event_and_ui',
                'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}

    def run_plan(self, candidates, visual_checks=(), **options):
        return assign_candidates({'papers':self.papers, 'candidates':candidates,
                                  'visual_checks':list(visual_checks)}, **options)

    def test_reversed_files_are_auto_verified_by_unique_content_identity(self):
        a = self.candidate('random-b.pdf', 'Article alpha\nDOI: 10.1234/a', 'b')
        b = self.candidate('random-a.pdf', 'Article beta\nDOI: 10.1234/b', 'a')
        result = self.run_plan([b,a])
        self.assertEqual([p['sha256'] for p in result['papers']], [a['sha256'],b['sha256']])
        self.assertEqual(result['auto_verified'], 2)
        self.assertEqual([p['status'] for p in result['papers']], ['auto_verified','auto_verified'])
        self.assertEqual(result['trigger_mismatches'], ['a','b'])

    def test_b_plus_b_cannot_fill_a_plus_b(self):
        b = self.candidate('b.pdf', 'Article beta\nDOI: 10.1234/b')
        copy = self.root / 'duplicate.pdf'
        copy.write_bytes(Path(b['candidate_path']).read_bytes())
        result = self.run_plan([b, {**b, 'candidate_path':str(copy)}])
        self.assertEqual(result['distinct_candidates'], 1)
        self.assertEqual(result['papers'][0]['status'], 'missing')
        self.assertEqual(result['papers'][1]['status'], 'auto_verified')

    def test_different_versions_matching_one_paper_are_ambiguous(self):
        a = self.candidate('a1.pdf','Article alpha\nDOI: 10.1234/a')
        a2 = self.candidate('a2.pdf','Article alpha\nDOI: 10.1234/a\nNew version')
        result = self.run_plan([a,a2])
        self.assertEqual(result['papers'][0]['status'], 'ambiguous')

    def test_corrupt_missing_and_extra_candidates_do_not_break_good_matches(self):
        a = self.candidate('a.pdf','Article alpha\nDOI: 10.1234/a')
        extra = self.candidate('extra.pdf','Foreign article\nDOI: 10.1234/extra')
        corrupt = self.root / 'bad.pdf'
        corrupt.write_bytes(b'%PDF-not parseable')
        result = self.run_plan([a,extra,{'candidate_path':str(corrupt)},
                               {'candidate_path':str(self.root/'missing.pdf')}])
        self.assertEqual(result['papers'][0]['status'], 'auto_verified')
        self.assertEqual(len(result['candidate_errors']), 2)
        self.assertEqual(len(result['unmatched_candidates']), 1)
        self.assertEqual(result['batch_status'], 'partial')

    def test_visual_evidence_is_bound_to_hash_and_paper_before_copy(self):
        a = self.candidate('a.pdf','Article alpha\nDOI: 10.1234/a')
        output = self.root / 'assigned'
        result = self.run_plan([a], [{'paper_key':'a','sha256':a['sha256'],'passed':True}], output_dir=output)
        self.assertEqual(result['verified'], 1)
        self.assertEqual((output/'a.pdf').read_bytes(), Path(a['candidate_path']).read_bytes())
        self.assertFalse((output/'b.pdf').exists())
        result = self.run_plan([a], [{'paper_key':'a','sha256':'0'*64,'passed':True}])
        self.assertEqual(result['verified'], 0)

    def test_visual_pass_alone_cannot_invent_browser_provenance_or_overwrite(self):
        a = self.candidate('a.pdf','Article alpha\nDOI: 10.1234/a')
        visual = [{'paper_key':'a','sha256':a['sha256'],'passed':True}]
        result = self.run_plan([{**a,'completion_evidence':None}], visual)
        self.assertEqual(result['papers'][0]['status'], 'provenance_pending')
        output = self.root/'assigned'
        output.mkdir()
        (output/'a.pdf').write_bytes(b'preserve rejected evidence')
        result = self.run_plan([a], visual, output_dir=output)
        self.assertEqual(result['papers'][0]['status'], 'assignment_failed')
        self.assertEqual((output/'a.pdf').read_bytes(), b'preserve rejected evidence')

    def test_audited_ui_pool_needs_current_completed_record_and_exit(self):
        a = self.candidate('a.pdf', 'Article alpha\nDOI: 10.1234/a')
        a.update(completion_evidence='audited_batch_ui_completed', source_path='observed-browser-path',
                 receipt_id='new', audit={'source_attempt':'attempt-1', 'new_record_ids':['new'],
                 'cli_exit_confirmed':True, 'attempt_started_ms':10000, 'attempt_ended_ms':20000,
                 'record':{'id':'new','state':'completed','removed':False,'started_ms':11000,
                           'file_path':'observed-browser-path','total_bytes':Path(a['candidate_path']).stat().st_size}})
        self.assertEqual(self.run_plan([a])['papers'][0]['status'], 'auto_verified')
        import copy
        for field, value in [('cli_exit_confirmed',False), ('new_record_ids',[]),
                             ('attempt_started_ms',30000), ('record',{'state':'pending'})]:
            broken = copy.deepcopy(a)
            broken['audit'][field] = value
            self.assertEqual(self.run_plan([broken])['papers'][0]['status'], 'provenance_pending')
        broken = copy.deepcopy(a)
        broken['audit']['record']['total_bytes'] += 1
        self.assertEqual(self.run_plan([broken])['papers'][0]['status'], 'provenance_pending')
        a['audit']['record']['started_ms'] = 100
        self.assertEqual(self.run_plan([a])['papers'][0]['status'], 'provenance_pending')

    def test_invalid_plan_is_rejected_before_creating_output(self):
        with self.assertRaises(ValueError):
            assign_candidates([])
        for key in ['../escape','CON','a/b',None,12]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                assign_candidates({'papers':[{'key':key,'doi':'10.1234/a'}],'candidates':[]})
        with self.assertRaises(ValueError):
            assign_candidates({'papers':[{'key':'a'}], 'candidates':[]})

    def test_shared_pool_requires_sealed_provenance_but_assigns_by_content(self):
        a = self.candidate('pooled.pdf', 'Article alpha\nDOI: 10.1234/a')
        a.update(completion_evidence='shared_pool_ui_completed', source_path='browser-path',
                 receipt_id='r1', audit={'pool_id':'pool-1', 'source_attempt':'pool-1',
                 'new_record_ids':['r1'], 'cli_exit_confirmed':False,
                 'attempt_started_ms':10000, 'attempt_ended_ms':20000,
                 'record':{'id':'r1','state':'completed','removed':False,'started_ms':11000,
                           'file_path':'browser-path','total_bytes':Path(a['candidate_path']).stat().st_size}})
        self.assertEqual(self.run_plan([a])['papers'][0]['status'], 'provenance_pending')
        a['audit']['cli_exit_confirmed'] = True
        self.assertEqual(self.run_plan([a])['papers'][0]['status'], 'auto_verified')
        a['audit']['pool_id'] = 'another-pool'
        self.assertEqual(self.run_plan([a])['papers'][0]['status'], 'provenance_pending')

    def test_later_failed_visual_review_withdraws_an_earlier_pass(self):
        a = self.candidate('a.pdf', 'Article alpha\nDOI: 10.1234/a')
        check = {'paper_key':'a', 'sha256':a['sha256'], 'passed':True}
        result = self.run_plan([a], [check, {**check, 'passed':False}])
        self.assertEqual(result['papers'][0]['status'], 'visual_review_failed')

    def test_failed_or_unexited_capture_never_delivers_even_with_visual_pass(self):
        a = self.candidate('late.pdf', 'Article alpha\nDOI: 10.1234/a')
        visual = [{'paper_key':'a', 'sha256':a['sha256'], 'passed':True}]
        for evidence in ['sdk_saveAs', 'serialized_sdk_saveAs', 'native_event_and_ui']:
            for flags in [dict(capture_status='capture_failed', round_exit_required=True,
                               failure_reason='save_timeout', cli_exit_confirmed=True),
                          dict(round_exit_required=True), dict(cli_exit_confirmed=False)]:
                with self.subTest(evidence=evidence, flags=flags):
                    candidate = {**a, 'completion_evidence':evidence, **flags}
                    result = self.run_plan([candidate], visual, output_dir=self.root/'assigned')
                    self.assertEqual(result['papers'][0]['status'], 'provenance_pending')
                    self.assertFalse((self.root/'assigned'/'a.pdf').exists())
                    for key, value in flags.items():
                        self.assertEqual(result['papers'][0]['provenance'][0][key], value)

    def test_sdk_success_requires_explicit_actual_cli_exit_confirmation(self):
        a = self.candidate('sdk.pdf', 'Article alpha\nDOI: 10.1234/a')
        a.update(completion_evidence='sdk_saveAs', round_exit_required=False)
        visual = [{'paper_key':'a', 'sha256':a['sha256'], 'passed':True}]
        self.assertEqual(self.run_plan([a], visual)['papers'][0]['status'], 'provenance_pending')
        a['cli_exit_confirmed'] = True
        self.assertEqual(self.run_plan([a], visual)['papers'][0]['status'], 'verified')

    def test_independent_valid_copy_can_supply_provenance_for_same_hash(self):
        a = self.candidate('good.pdf', 'Article alpha\nDOI: 10.1234/a')
        late_path = self.root/'late.pdf'
        late_path.write_bytes(Path(a['candidate_path']).read_bytes())
        failed = {**a, 'candidate_path':str(late_path), 'capture_status':'capture_failed',
                  'round_exit_required':True, 'failure_reason':'save_timeout'}
        result = self.run_plan([failed, a], [{'paper_key':'a', 'sha256':a['sha256'], 'passed':True}],
                               output_dir=self.root/'assigned')
        self.assertEqual(result['verified'], 1)
        self.assertEqual(result['papers'][0]['provenance'][0]['capture_status'], 'capture_failed')
        self.assertEqual(len(result['papers'][0]['provenance']), 2)

    def test_auto_verified_candidate_can_be_assigned_without_visual_review(self):
        a = self.candidate('a.pdf', 'Article alpha\nDOI: 10.1234/a')
        output = self.root/'assigned'
        result = self.run_plan([a], output_dir=output)
        self.assertEqual(result['papers'][0]['status'], 'auto_verified')
        self.assertEqual(result['auto_verified'], 1)
        self.assertEqual((output/'a.pdf').read_bytes(), Path(a['candidate_path']).read_bytes())


if __name__ == '__main__':
    unittest.main()
