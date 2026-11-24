# 입고칸(RCV-) 재고와 입고 작업 상태 보기(읽기만). 개발 서버(:5180) 필요.
# 실행: python -I tools/lan/receiving_check.py <계정> <센터ID>   예) claude-mfc-sup-sj MFC-SEJ-01
import json,urllib.request,urllib.error,collections,time,sys
S='http://localhost:5180'; g=S+'/api/v1'
def tok(a):
    r=urllib.request.Request(S+'/sim-auth/tokens',data=json.dumps({'account':a}).encode(),headers={'Content-Type':'application/json'},method='POST')
    return json.load(urllib.request.urlopen(r,timeout=30))['accessToken']
def get(t,q):
    return json.load(urllib.request.urlopen(urllib.request.Request(g+q,headers={'Authorization':'Bearer '+t}),timeout=60))
def pages(t,q):
    rows=[];cur=None
    for _ in range(200):
        d=get(t,q+(f'&cursor={cur}' if cur else '')); rows+=d.get('items',[]); cur=d.get('nextCursor') or (d.get('page') or {}).get('nextCursor')
        if not cur: break
    return rows
acc,mfc=sys.argv[1],sys.argv[2]
t=tok(acc)
u=pages(t,f'/mfcs/{mfc}/stock-units?size=200')
rc=[x for x in u if str(x.get('locationCode','')).startswith('RCV-')]
c=collections.Counter((x['locationCode'],x.get('qualityState'),x.get('workState')) for x in rc)
q=collections.Counter()
for x in rc: q[(x['locationCode'],x.get('qualityState'),x.get('workState'))]+=x.get('qty',0)
for k,v in sorted(q.items()): print(k,'rows',c[k],'qty',v)
tasks=pages(t,f'/inbound-tasks?mfcId={mfc}&size=200')
print('tasks',collections.Counter((x.get('taskType'),x.get('state')) for x in tasks).most_common(12))
