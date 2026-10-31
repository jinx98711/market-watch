"""Public source pack tests: settings must never change positions or enable orders."""
import copy
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('monitor_settings',Path(__file__).resolve().parents[1]/'desktop/monitor_settings.py')
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)


class PreferencesTests(unittest.TestCase):
    def edit(self, answers, before=None):
        before=before or copy.deepcopy(s.SCHEMA['defaults'])
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'monitor_settings.json'
            path.write_text(s.json.dumps(before))
            with patch.object(s,'PATH',path),patch('builtins.input',side_effect=answers),patch('sys.stdout',new=io.StringIO()):
                s.edit()
            return s.json.loads(path.read_text())

    def test_color_presets_need_only_two_menu_choices_and_preserve_rules(self):
        for preset,rise,fall in [('1','#ff6b78','#4ed69a'),('2','#4ed69a','#ff6b78')]:
            before=copy.deepcopy(s.SCHEMA['defaults']);before['gate']['strategy']['confirmation_volume_ratio']=1.7
            result=self.edit([preset,'0'],before)
            self.assertEqual((result['display']['rise'],result['display']['fall']),(rise,fall))
            self.assertEqual(result['gate'],before['gate'])
            self.assertEqual(result['display']['grades'],before['display']['grades'])

    def test_named_colors_invalid_selection_retry_and_optional_custom(self):
        result=self.edit(['3','99','4','5','0'])
        self.assertEqual((result['display']['rise'],result['display']['fall']),('#dfb569','#ffad66'))
        result=self.edit(['3','8','#123456','','0'])
        self.assertEqual(result['display']['rise'],'#123456')
        self.assertEqual(result['display']['fall'],'#4ed69a')

    def test_cancel_never_saves_partial_color_changes(self):
        before=copy.deepcopy(s.SCHEMA['defaults'])
        self.assertEqual(self.edit(['2','q'],before),before)
        self.assertEqual(self.edit(['3','1','q'],before),before)

    def test_grade_menu_preserves_colors_and_gate_rules(self):
        result=self.edit(['4','','','80','0'])
        self.assertEqual(result['display']['grades']['strong'],80)
        self.assertEqual(result['display']['rise'],'#ff6b78')
        self.assertEqual(result['gate'],s.SCHEMA['defaults']['gate'])

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
