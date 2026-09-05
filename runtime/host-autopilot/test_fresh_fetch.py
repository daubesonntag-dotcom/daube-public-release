import unittest
from unittest import mock
import controller

class FreshFetchTests(unittest.TestCase):
    def test_raw_main_is_resolved_then_fetched_by_exact_sha(self):
        sha='a'*40
        with mock.patch.object(controller,'_fetch_json',side_effect=[{'commit':{'sha':sha}},{'ok':True}]) as fetch:
            result=controller.fetch_manifest_url('https://raw.githubusercontent.com/o/r/main/.daube/autopilot/host-desired-state.json')
        self.assertEqual(result,{'ok':True})
        self.assertEqual(fetch.call_args_list[0].args[0],'https://api.github.com/repos/o/r/branches/main')
        self.assertIn(f'/o/r/{sha}/.daube/autopilot/host-desired-state.json',fetch.call_args_list[1].args[0])

    def test_invalid_main_sha_fails_closed(self):
        with mock.patch.object(controller,'_fetch_json',return_value={'commit':{'sha':'main'}}):
            with self.assertRaisesRegex(ValueError,'github_main_revision_invalid'):
                controller.fetch_manifest_url('https://raw.githubusercontent.com/o/r/main/x.json')

if __name__=='__main__': unittest.main()
