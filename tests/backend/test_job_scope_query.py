import tempfile
from pathlib import Path
import unittest
from backend.jobs import JobLedger
from backend.contracts.errors import InvalidInput


class ScopeQueries(unittest.TestCase):
    def test_filter_precedes_paging_and_combines_scope_without_mutating_tasks(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = JobLedger(Path(directory) / 'jobs.sqlite')
            for index in range(25):
                ledger.create_or_get(f'request-{index:02}', provider='test-local', execution_kind='local',
                                     snapshot={'value': index}, source={'batchId': 'A' if index < 20 else 'B',
                                                                      'tableId': 'table-1', 'operation': 'optimize'})
            first = ledger.list_jobs(source_filter={'batchId': 'B', 'tableId': 'table-1'}, limit=3)
            second = ledger.list_jobs(source_filter={'batchId': 'B'}, limit=3, offset=3)
            self.assertEqual([job['request_id'] for job in first + second], [f'request-{i:02}' for i in range(20, 25)])
            self.assertTrue(all(job['state'] == 'pending' and job['version'] == 0 for job in first + second))
            self.assertEqual(ledger.list_jobs(source_filter={'batchId': 'B', 'tableId': 'table-2'}), [])
            self.assertEqual(ledger.list_jobs(source_filter={'operation': 'optimize'}, state='succeeded'), [])
            self.assertEqual(ledger.attempts('request-24'), [])

    def test_invalid_keys_and_unbounded_pagination_never_form_a_query(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = JobLedger(Path(directory) / 'jobs.sqlite')
            for options in ({'source_filter': {'unknown': 'B'}}, {'source_filter': {'batchId': None}},
                            {'source_filter': []}, {'limit': True}, {'offset': True},
                            {'offset': -1}, {'limit': 1001}):
                with self.subTest(options=options), self.assertRaises(InvalidInput):
                    ledger.list_jobs(**options)


if __name__ == '__main__':
    unittest.main()
