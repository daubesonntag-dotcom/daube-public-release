"""Regression tests for the EXISTING sovereign-runtime planner (no new runner)."""
import importlib.util
import pathlib
import sqlite3
import time
import unittest

PLANNER = pathlib.Path(__file__).resolve().parents[1] / 'planner-v2.py'
spec = importlib.util.spec_from_file_location('daube_planner_v2', PLANNER)
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)


def fixture():
    db = sqlite3.connect(':memory:', isolation_level=None)
    db.row_factory = sqlite3.Row
    db.executescript("""
        CREATE TABLE tasks (id TEXT PRIMARY KEY,kind TEXT,state TEXT,updated_at REAL,attempts INTEGER DEFAULT 0);
        CREATE TABLE events (entity_type TEXT,entity_id TEXT,event TEXT,detail TEXT,created_at REAL);
        CREATE TABLE capabilities (kind TEXT,id TEXT,enabled INTEGER,last_health TEXT,priority INTEGER);
        CREATE TABLE objectives (id TEXT,title TEXT,intent TEXT,priority INTEGER,state TEXT,created_at REAL);
    """)
    return db


class StaleRunTests(unittest.TestCase):
    def test_quarantines_only_stale_running_without_replay(self):
        db = fixture()
        db.executemany("INSERT INTO tasks(id,kind,state,updated_at) VALUES(?,?,?,?)", [
            ('stale', 'host', 'RUNNING', 1000),
            ('fresh', 'host', 'RUNNING', 9900),
            ('finished', 'host', 'DONE_VERIFIED', 1000),
        ])
        result = planner.quarantine_stale_runs(db, 1800, 10000)
        self.assertEqual(result, ['stale'])
        self.assertEqual({r['id']: r['state'] for r in db.execute('SELECT id,state FROM tasks')}, {
            'stale': 'REVIEW_REQUIRED', 'fresh': 'RUNNING', 'finished': 'DONE_VERIFIED',
        })
        self.assertEqual(db.execute("SELECT attempts FROM tasks WHERE id='stale'").fetchone()[0],0)
        event = db.execute("SELECT event,detail FROM events").fetchone()
        self.assertEqual(event[0],'STALE_RUNNING_REVIEW_REQUIRED')
        self.assertIn('"replay_authorized":false',event[1])

    def test_repeated_checks_are_idempotent(self):
        db = fixture()
        db.execute("INSERT INTO tasks(id,kind,state,updated_at) VALUES('one','host','RUNNING',1000)")
        self.assertEqual(planner.quarantine_stale_runs(db, 1800, 10000), ['one'])
        self.assertEqual(planner.quarantine_stale_runs(db, 1800, 11000), [])
        self.assertEqual(db.execute("SELECT COUNT(*) FROM events").fetchone()[0],1)

    def test_error_rolls_back_entire_transition(self):
        db = fixture()
        db.execute("INSERT INTO tasks(id,kind,state,updated_at) VALUES('one','host','RUNNING',1000)")
        db.execute("CREATE TRIGGER deny_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'forced_failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            planner.quarantine_stale_runs(db,1800,10000)
        self.assertEqual(db.execute("SELECT state FROM tasks WHERE id='one'").fetchone()[0],'RUNNING')

    def test_existing_planner_tick_runs_stale_quarantine(self):
        db = fixture()
        db.execute("INSERT INTO tasks(id,kind,state,updated_at) VALUES(?,?,?,?)",('old','host','RUNNING',time.time()-5000))
        status=planner.tick(db)
        self.assertEqual(status['stale_running_review_required'],1)
        self.assertEqual(status['planned'],[])
        self.assertEqual(db.execute("SELECT state FROM tasks WHERE id='old'").fetchone()[0],'REVIEW_REQUIRED')

    def test_invalid_threshold_or_batch_limit_fails_closed(self):
        db=fixture()
        with self.assertRaises(ValueError):
            planner.quarantine_stale_runs(db,0,10000)
        with self.assertRaises(ValueError):
            planner.quarantine_stale_runs(db,1800,10000,1000)


if __name__ == '__main__':
    unittest.main()
