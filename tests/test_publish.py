import base64
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from publish import publish


class PublishTests(unittest.TestCase):
    def fixture(self,folder):
        p=Path(folder)/'source.json';p.write_text(json.dumps(dict(schema=1,generated_at=1000,rows=[],positions=['PRIVATE'])))
        return dict(repository='owner/market-watch',source=str(p))

    def test_time_snapshot_has_only_public_data_and_public_commit_identity(self):
        calls=[]
        def api(path,payload,method='PUT'):
            calls.append((path,payload,method));return {'content':{'sha':'new'}}
        with tempfile.TemporaryDirectory() as tmp,patch('publish.time.time',return_value=1001),patch('publish.api',side_effect=api):
            state=publish(self.fixture(tmp),{})
        path,payload,method=calls[0]
        self.assertTrue(path.endswith('/snapshots/50.json'))
        self.assertEqual(payload['branch'],'feed')
        self.assertEqual(payload['committer']['email'],'owner@users.noreply.github.com')
        self.assertNotIn('PRIVATE',base64.b64decode(payload['content']).decode())
        self.assertEqual(state['bucket'],50)

    def test_public_intraday_feed_keeps_only_fresh_ic_market_fields(self):
        with tempfile.TemporaryDirectory() as tmp, patch('publish.time.time', return_value=1001), patch('publish.api') as api:
            api.return_value = {'content': {'sha': 'new'}}
            config = self.fixture(tmp)
            rows = [dict(source='IC',symbol='USDJPY',crosses={'5m':1,'4h':-1}, account='PRIVATE'),
                    dict(source='Gate',symbol='UNI_USDT')]
            short = Path(tmp)/'snapshot_intraday.json'
            short.write_text(json.dumps(dict(intraday=True,generated_at=1000,rows=rows,positions=['PRIVATE'])))
            publish(config,{})
            data = json.loads(base64.b64decode(api.call_args.args[1]['content']))
            self.assertEqual([row['symbol'] for row in data['intraday']['rows']], ['USDJPY'])
            self.assertEqual(data['intraday']['rows'][0]['crosses'], {'5m':1})
            self.assertNotIn('PRIVATE',json.dumps(data))
            short.write_text(json.dumps(dict(intraday=True,generated_at=900,rows=rows)))
            publish(config,{})
            data = json.loads(base64.b64decode(api.call_args.args[1]['content']))
            self.assertNotIn('intraday',data)

    def test_one_publish_per_bucket(self):
        with tempfile.TemporaryDirectory() as tmp,patch('publish.time.time',return_value=1001),patch('publish.api') as api:
            state={'bucket':50};self.assertEqual(publish(self.fixture(tmp),state),state);api.assert_not_called()

    def test_feed_keeps_twenty_current_files(self):
        calls=[]
        def api(path,payload,method='PUT'):
            calls.append((path,method));return {'content':{'sha':'new'}}
        files=[dict(path=f'snapshots/{i}.json',sha=str(i)) for i in range(20)]
        with tempfile.TemporaryDirectory() as tmp,patch('publish.time.time',return_value=1001),patch('publish.api',side_effect=api):
            state=publish(self.fixture(tmp),dict(files=files))
        self.assertEqual(len(state['files']),20)
        self.assertEqual(calls[-1],('repos/owner/market-watch/contents/snapshots/0.json','DELETE'))

    def test_cleanup_failure_does_not_discard_successful_new_snapshot(self):
        def api(path,payload,method='PUT'):
            if method=='DELETE':raise RuntimeError('temporary error')
            return {'content':{'sha':'new'}}
        files=[dict(path=f'snapshots/{i}.json',sha=str(i)) for i in range(20)]
        with tempfile.TemporaryDirectory() as tmp,patch('publish.time.time',return_value=1001),patch('publish.api',side_effect=api):
            state=publish(self.fixture(tmp),dict(files=files))
        self.assertEqual(state['files'][-1]['sha'],'new')


if __name__=='__main__':unittest.main()
