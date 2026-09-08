#!/usr/bin/env python3
import argparse, datetime, hashlib, html.parser, json, pathlib, re, urllib.parse, urllib.request
STATE=pathlib.Path('/var/lib/daube/remote-commander/market')
UA='D-AUBE-Market-Scout/1.0 (+https://daubesonntag.com)'
KEYWORDS={'automation':18,'ai':12,'python':12,'api':12,'workflow':14,'n8n':20,'rag':16,'crm':10,'agent':12,'integration':12,'bounty':20,'reward':20,'contest':14}

def get(url,limit=1500000):
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'text/html,application/json;q=0.9,*/*;q=0.5'})
    with urllib.request.urlopen(req,timeout=25) as r:
        return r.status,r.read(limit),dict(r.headers.items())

def score(text):
    s=10; low=text.lower()
    for k,w in KEYWORDS.items():
        if k in low: s+=w
    if '$' in text: s+=10
    return min(s,100)

class Links(html.parser.HTMLParser):
    def __init__(self,base): super().__init__(); self.base=base; self.href=None; self.buf=[]; self.items=[]
    def handle_starttag(self,tag,attrs):
        if tag=='a': self.href=dict(attrs).get('href'); self.buf=[]
    def handle_data(self,data):
        if self.href is not None: self.buf.append(data)
    def handle_endtag(self,tag):
        if tag=='a' and self.href is not None:
            title=' '.join(' '.join(self.buf).split()); href=self.href; self.href=None; self.buf=[]
            if len(title)>=8 and (href.startswith('/projects/') or href.startswith('/contest/') or '/marketplace/requests/' in href):
                self.items.append((title,urllib.parse.urljoin(self.base,href)))

def freelancer(candidates,health):
    urls=['https://www.freelancer.com/job-search/ai-automation/','https://www.freelancer.com/job-search/n8n/']
    for url in urls:
        try:
            st,b,_=get(url); p=Links(url); p.feed(b.decode('utf-8','replace')); health.append({'source':url,'status':st,'items':len(p.items)})
            for title,href in p.items[:40]: candidates.append({'source':'freelancer-public','title':title[:300],'url':href,'score':score(title),'external_action':'BID_OR_CONTEST_ENTRY'})
        except Exception as e: health.append({'source':url,'error':str(e)[:300]})

def github(candidates,health):
    for q in ['is:issue is:open bounty automation','is:issue is:open reward workflow automation']:
        url='https://api.github.com/search/issues?'+urllib.parse.urlencode({'q':q,'sort':'updated','order':'desc','per_page':20})
        try:
            st,b,_=get(url); data=json.loads(b); items=data.get('items',[]); health.append({'source':'github-search','query':q,'status':st,'items':len(items)})
            for x in items:
                title=str(x.get('title','')).strip(); href=str(x.get('html_url','')).strip()
                if title and href: candidates.append({'source':'github-public','title':title[:300],'url':href,'score':score(title+' '+str(x.get('body') or '')[:1000]),'external_action':'ISSUE_CONTACT_OR_PROPOSAL'})
        except Exception as e: health.append({'source':'github-search','query':q,'error':str(e)[:300]})

def railcall(candidates,health):
    url='https://railcall.ai/marketplace/requests/'
    try:
        st,b,_=get(url); text=b.decode('utf-8','replace'); p=Links(url); p.feed(text); health.append({'source':'railcall-requests','status':st,'items':len(p.items)})
        for title,href in p.items[:30]: candidates.append({'source':'railcall-requests','title':title[:300],'url':href,'score':score(title+' automation module workflow'),'external_action':'MARKETPLACE_PITCH'})
    except Exception as e: health.append({'source':'railcall-requests','error':str(e)[:300]})

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('payload',nargs='?',default='{}'); a=ap.parse_args()
    try: envelope=json.loads(a.payload); payload=envelope.get('payload',envelope) if isinstance(envelope,dict) else {}
    except Exception: payload={}
    candidates=[]; health=[]; freelancer(candidates,health); github(candidates,health); railcall(candidates,health)
    dedup={}
    for c in candidates:
        if c['url'] not in dedup or c['score']>dedup[c['url']]['score']: dedup[c['url']]=c
    items=sorted(dedup.values(),key=lambda x:(-x['score'],x['url']))[:100]
    now=datetime.datetime.now(datetime.timezone.utc).isoformat(); snap={'generated_at':now,'count':len(items),'health':health,'opportunities':items}
    canonical=json.dumps(snap,sort_keys=True,separators=(',',':'),ensure_ascii=False); sha=hashlib.sha256(canonical.encode()).hexdigest(); snap['sha256']=sha
    STATE.mkdir(parents=True,exist_ok=True); (STATE/'opportunities.json').write_text(json.dumps(snap,indent=2,ensure_ascii=False),encoding='utf-8')
    print(json.dumps({'status':'VERIFIED' if items else 'NO_DATA','count':len(items),'top':items[:5],'sha256':sha,'requested_op':payload.get('op','discover')},sort_keys=True,ensure_ascii=False))
if __name__=='__main__': main()
