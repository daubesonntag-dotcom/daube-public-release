import json, tempfile, unittest
from pathlib import Path
from types import SimpleNamespace

from crm import merge_client_records
from dispatch import dispatch_action
from evidence import collect_business_evidence, revenue_truth
from learning import summarize_conversion
from models import scrub
from priority import build_queue, score_action

class V11Tests(unittest.TestCase):
    def test_scrub_key_and_value_secrets(self):
        x=scrub({'api_key':'abc','note':'Bearer abcdefghijklmnopqrstuvwxyz123456'})
        self.assertEqual(x['api_key'],'[REDACTED]'); self.assertNotIn('abcdefghijklmnopqrstuvwxyz',x['note'])

    def test_settlement_truth_only_authoritative(self):
        e={'settlements':[{'authoritative_external_settlement':True}]}
        self.assertTrue(revenue_truth(e)['has_real_revenue'])
        self.assertFalse(revenue_truth({'settlements':[]})['has_real_revenue'])

    def test_collect_evidence_ignores_synthetic_paid(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'daube-revenue-worker/full-loop/money-closure'; p.mkdir(parents=True)
            (p/'revenue-ledger.jsonl').write_text(json.dumps({'authoritative_external_settlement':False})+'\n')
            self.assertEqual(collect_business_evidence(Path(d))['settled_count'],0)

    def test_crm_merge(self):
        got=merge_client_records({}, {'bids':[{'client_id':7,'project_id':9,'bid_id':11}],'jobs':[]})
        self.assertEqual(got['freelancer:7']['projects'],['9'])

    def test_priority_rejects_spend(self):
        self.assertLess(score_action({'type':'SPEND','expected_net_value':9999}),0)

    def test_over_72h_founder_gate(self):
        q=build_queue({'jobs':[{'job_id':'1','job.json':{'estimated_hours':73,'status':'AWARDED_ACCEPTED'}}]}, {})
        self.assertEqual(q[0]['type'],'FOUNDER_GATE')

    def test_idle_queue_scout(self):
        q=build_queue({'jobs':[],'watchdog':{}}, {})
        self.assertEqual(q[0]['type'],'SCOUT')

    def test_dispatch_allowlist(self):
        seen=[]
        def run(argv): seen.append(argv); return SimpleNamespace(returncode=0)
        got=dispatch_action({'type':'SCOUT'},run)
        self.assertEqual(got['classification'],'DISPATCHED')
        self.assertEqual(seen[0][-1],'daube-revenue-worker.service')

    def test_dispatch_blocks_kyc(self):
        got=dispatch_action({'type':'KYC'},lambda argv: self.fail('must not run'))
        self.assertEqual(got['classification'],'FOUNDER_GATE')

    def test_conversion_paid_needs_authoritative_count(self):
        x=summarize_conversion([{'stage':'paid'},{'stage':'paid','authoritative_external_settlement':True}])
        self.assertEqual(x['counts']['paid'],2); self.assertEqual(x['authoritative_paid'],1)

if __name__=='__main__': unittest.main()
