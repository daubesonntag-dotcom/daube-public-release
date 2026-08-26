#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, os, sys, urllib.parse, urllib.request
from pathlib import Path

API='https://api.polyhaven.com/files/{slug}'
UA='D-AUBE-SONNTAG-BIEN-ANH/1.0 (+https://daubesonntag.com)'
ALLOWED_HOSTS={'dl.polyhaven.org','dl.polyhaven.com'}


def fetch_json(url:str):
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'application/json'})
    with urllib.request.urlopen(req,timeout=60) as r:
        return json.load(r)


def pick_blend(files:dict):
    root=files.get('blend') or {}
    if not isinstance(root,dict) or not root:
        raise RuntimeError('missing_blend_package')
    if '1k' in root and isinstance(root['1k'],dict) and 'blend' in root['1k']:
        return '1k',root['1k']['blend']
    def score(k):
        s=str(k).lower().replace('k','000')
        try: return int(''.join(c for c in s if c.isdigit()) or '999999')
        except Exception: return 999999
    for res in sorted(root,key=score):
        block=root.get(res) or {}
        if isinstance(block,dict) and isinstance(block.get('blend'),dict):
            return res,block['blend']
    raise RuntimeError('no_blend_variant')


def safe_rel(rel:str)->Path:
    p=Path(rel)
    if p.is_absolute() or '..' in p.parts or rel.startswith(('~','/','\\')):
        raise RuntimeError(f'unsafe_include_path:{rel}')
    return p


def validated_url(url:str)->str:
    u=urllib.parse.urlparse(url)
    if u.scheme!='https' or u.hostname not in ALLOWED_HOSTS:
        raise RuntimeError(f'unapproved_asset_host:{url}')
    return url


def md5_file(path:Path)->str:
    h=hashlib.md5()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()


def download(url:str,dst:Path,expected_md5:str|None,expected_size:int|None):
    validated_url(url)
    dst.parent.mkdir(parents=True,exist_ok=True)
    req=urllib.request.Request(url,headers={'User-Agent':UA})
    with urllib.request.urlopen(req,timeout=120) as r, dst.open('wb') as f:
        while True:
            chunk=r.read(1024*1024)
            if not chunk: break
            f.write(chunk)
    if expected_size is not None and dst.stat().st_size!=int(expected_size):
        raise RuntimeError(f'size_mismatch:{dst}:{dst.stat().st_size}!={expected_size}')
    if expected_md5 and md5_file(dst).lower()!=str(expected_md5).lower():
        raise RuntimeError(f'md5_mismatch:{dst}')


def materialize(slug:str,out_root:Path,max_bytes:int):
    files=fetch_json(API.format(slug=urllib.parse.quote(slug,safe='')))
    res,node=pick_blend(files)
    if not isinstance(node,dict) or not node.get('url'):
        raise RuntimeError(f'invalid_blend_node:{slug}')
    bundle=[]
    root_url=validated_url(str(node['url']))
    root_name=Path(urllib.parse.urlparse(root_url).path).name or f'{slug}_{res}.blend'
    bundle.append((Path(root_name),node))
    inc=node.get('include') or {}
    if not isinstance(inc,dict): raise RuntimeError(f'invalid_include:{slug}')
    for rel,meta in inc.items():
        if not isinstance(meta,dict) or not meta.get('url'): continue
        bundle.append((safe_rel(str(rel)),meta))
    total=sum(int(meta.get('size') or 0) for _,meta in bundle)
    if total<=0 or total>max_bytes:
        raise RuntimeError(f'bundle_size_out_of_bounds:{slug}:{total}>{max_bytes}')
    root=(out_root/slug).resolve(); root.mkdir(parents=True,exist_ok=True)
    records=[]
    for rel,meta in bundle:
        dst=(root/rel).resolve()
        if root not in dst.parents and dst!=root:
            raise RuntimeError(f'containment_failure:{rel}')
        download(str(meta['url']),dst,meta.get('md5'),meta.get('size'))
        records.append({'path':str(rel).replace('\\','/'),'bytes':dst.stat().st_size,'md5':md5_file(dst),'urlHost':urllib.parse.urlparse(str(meta['url'])).hostname})
    manifest={'schema':'daube.polyhaven.bundle.v1','asset':slug,'resolution':res,'license':'CC0','provider':'Poly Haven','api':API.format(slug=slug),'totalBytes':sum(r['bytes'] for r in records),'files':records}
    (root/'DAUBE_ASSET_MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(manifest))


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('slugs',nargs='+'); ap.add_argument('--output',required=True); ap.add_argument('--max-bytes',type=int,default=120_000_000); args=ap.parse_args()
    out=Path(args.output).resolve(); out.mkdir(parents=True,exist_ok=True)
    for slug in args.slugs: materialize(slug,out,args.max_bytes)

if __name__=='__main__': main()
