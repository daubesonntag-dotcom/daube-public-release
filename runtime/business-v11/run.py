import argparse, json
from pathlib import Path
from controller import BusinessOperator
from priority import RISKY_ACTIONS

VERSION='v11-autonomous-business-operator'


def verify():
    assert 'SPEND' in RISKY_ACTIONS and 'KYC' in RISKY_ACTIONS and 'CHANGE_PAYOUT' in RISKY_ACTIONS
    print(f'VERSION={VERSION} IMPORTS=OK')


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--verify',action='store_true'); args=ap.parse_args()
    if args.verify: verify(); return
    result=BusinessOperator(Path.home()).run_once()
    print(json.dumps(result,ensure_ascii=False,sort_keys=True))

if __name__=='__main__': main()
