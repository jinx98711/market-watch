"""Public source pack tests: settings must never change positions or enable orders."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('monitor_settings',Path(__file__).resolve().parents[1]/'desktop/monitor_settings.py')
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)


class PreferencesTests(unittest.TestCase):
    def test_palette_and_custom_grades(self):
        value=copy.deepcopy(s.SCHEMA['defaults']);value['display']['grades']['strong']=80
        result=s.classify(dict(state='valid',signed_score=-70),s.validate(value)['display'])
        self.assertEqual((result['direction'],result['strength']),(-1,'中'))
        self.assertEqual(s.ansi('#ff6b78'),'38;2;255;107;120')

    def test_reject_bad_ranges_and_keep_private_fields(self):
        value=copy.deepcopy(s.SCHEMA['defaults']);value['display']['grades']['strong']=30
        with self.assertRaises(ValueError):s.validate(value)
        value=copy.deepcopy(s.SCHEMA['defaults']);value['gate']['positions']=[dict(enabled=True)]
        self.assertNotIn('positions',s.validate(value)['gate'])
        cfg=dict(filters={},strategy={},positions=[dict(enabled=False)])
        with tempfile.NamedTemporaryFile() as f,patch.object(s,'PATH',Path(f.name)):
            result=s.apply_gate(cfg,s.validate(value))
        self.assertEqual(result['positions'],[dict(enabled=False)])
        self.assertEqual(cfg['filters'],{})
