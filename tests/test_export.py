import copy
import json
import unittest
from export_snapshot import export


def fixture():
    return dict(schema=1,generated_at=1000,gate=dict(state='正常',updated=999),mt5=dict(state='正常',updated=999),
                positions=['SECRET_POSITION'],account='SECRET_ACCOUNT',server='SECRET_SERVER',path='/Users/SECRET_PATH',
                screening=dict(gate=dict(evaluated=22,ready=1,candidates=['SECRET_CANDIDATE'])),
                rows=[dict(source='Gate',symbol='UNI_USDT',price='6.8',periods=['↑多']*3,direction=1,
                           opportunity='条件满足·请核对',entry='6.7~6.8',stop='6.6',take='7/7.1',updated=999,valid_until=1100,
                           reason='SECRET_POSITION',momentum=dict(state='valid',signed_score=70,secret='SECRET_MOMENTUM'),
                           volume=dict(latest_ratio=1.5),account='SECRET_ACCOUNT')])


class ExportTests(unittest.TestCase):
    def test_only_allowlisted_market_fields_are_exported(self):
        result=export(fixture());text=json.dumps(result)
        self.assertNotIn('SECRET',text)
        self.assertNotIn('/Users',text)
        self.assertEqual(set(result),{'schema','generated_at','sources','screening','rows'})
        self.assertNotIn('candidates',result['screening']['Gate'])

    def test_prices_direction_and_validity_are_preserved(self):
        r=export(fixture())['rows'][0]
        self.assertEqual((r['price'],r['entry'],r['stop'],r['take']),('6.8','6.7~6.8','6.6','7/7.1'))
        self.assertEqual((r['updated'],r['valid_until'],r['direction'],r['state']),(999,1100,1,'ready'))

    def test_prices_cannot_carry_account_notes(self):
        data=fixture();data['rows'][0]['price']='SECRET_ACCOUNT'
        self.assertEqual(export(data)['rows'][0]['price'],'—')

    def test_only_valid_crossover_frames_and_directions_are_public(self):
        data=fixture()
        data['rows'][0]['crosses']={'15m':1,'1h':-1,'4h':True,'private':'SECRET'}
        self.assertEqual(export(data)['rows'][0]['crosses'],{'15m':1,'1h':-1})

    def test_arbitrary_reason_is_not_forwarded(self):
        data=fixture();data['rows'][0].update(direction=0,reason='/Users/private/account=123 SECRET')
        self.assertNotIn('SECRET',json.dumps(export(data)))

    def test_invalid_symbols_are_dropped(self):
        data=fixture();data['rows'][0]['symbol']='<script>SECRET</script>'
        self.assertEqual(export(data)['rows'],[])

    def test_invalid_scores_and_ratios_cannot_leak_nan(self):
        data=fixture();data['rows'][0]['momentum']['signed_score']=float('nan')
        data['rows'][0]['volume']['latest_ratio']=float('inf')
        result=export(data);self.assertIsNone(result['rows'][0]['momentum']);self.assertIsNone(result['rows'][0]['ratio'])
        json.dumps(result,allow_nan=False)

    def test_ic_cannot_be_promoted_to_ready(self):
        data=fixture();data['rows'][0].update(source='IC',symbol='UNIUSD',opportunity_state='structure')
        r=export(data)['rows'][0];self.assertEqual(r['state'],'structure')

    def test_closed_position_data_never_affects_feed(self):
        data=fixture();before=export(data);data['positions']=[dict(enabled=True,entry=1234,quantity=999)]
        self.assertEqual(export(data),before)

    def test_input_is_not_mutated(self):
        data=fixture();before=copy.deepcopy(data);export(data);self.assertEqual(data,before)


if __name__=='__main__':unittest.main()
