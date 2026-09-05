import tempfile, unittest
from pathlib import Path
from types import SimpleNamespace

from controller import BusinessOperator

class RuntimeTests(unittest.TestCase):
    def test_business_operator_emits_ready_receipt_and_queue(self):
        with tempfile.TemporaryDirectory() as d:
            home=Path(d)
            base=home/'daube-revenue-worker'
            (base/'watchdog').mkdir(parents=True)
            (base/'watchdog'/'health.json').write_text('{"overall":"HEALTHY"}\n')
            seen=[]
            def runner(argv): seen.append(argv); return SimpleNamespace(returncode=0)
            out=BusinessOperator(home,runner).run_once()
            self.assertEqual(out['classification'],'BUSINESS_OPERATOR_READY')
            self.assertTrue((base/'business-v11'/'BUSINESS_OPERATOR_READY.json').is_file())
            self.assertTrue((base/'business-v11'/'daily-queue.json').is_file())
            self.assertEqual(seen[0][-1],'daube-revenue-worker.service')

if __name__=='__main__': unittest.main()
