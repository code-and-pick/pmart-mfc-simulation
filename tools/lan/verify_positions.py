# LAN 위치 대조 — 서버 GET /locations 와 docs/layout-export/<site>/location-positions.json 비교, 닫힘·재고 위치 점검(읽기만).
# 개발 서버(npm run dev, :5180)가 켜져 있어야 한다(/sim-auth/tokens 로 시험 계정 토큰). 실행: python -I tools/lan/verify_positions.py <계정> <센터ID> <site>
#   예) python -I tools/lan/verify_positions.py claude-mfc-sup MFC-BJG-01 busanjin
#       python -I tools/lan/verify_positions.py claude-mfc-sup-sj MFC-SEJ-01 sejong
import json,urllib.request,urllib.error,collections,time,sys
import os
D=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
S='http://localhost:5180'; g=S+'/api/v1'
def tok(a):
    r=urllib.request.Request(S+'/sim-auth/tokens',data=json.dumps({'account':a}).encode(),headers={'Content-Type':'application/json'},method='POST')
    return json.load(urllib.request.urlopen(r,timeout=30))['accessToken']
def get(t,q):
    for k in range(8):
        try: return json.load(urllib.request.urlopen(urllib.request.Request(g+q,headers={'Authorization':'Bearer '+t}),timeout=60))
        except urllib.error.HTTPError as e:
            if e.code==429: time.sleep(2+k*2); continue
            raise
def pages(t,q,key='items'):
    rows=[];cur=None
    for _ in range(400):
        d=get(t,q+(f'&cursor={cur}' if cur else '')); rows+=d.get(key,[]); cur=d.get('nextCursor') or (d.get('page') or {}).get('nextCursor')
        if not cur: break
    return rows
def cmp(acc,mfc,site,only=None):
    t=tok(acc)
    locs=pages(t,f'/locations?mfcId={mfc}&size=200')
    f=json.load(open(f'{D}/docs/layout-export/{site}/location-positions.json',encoding='utf-8'))
    srv={l['locationCode']:l for l in locs}
    want=[x for x in f if not only or x['locationCode'] in only]
    miss=[x['locationCode'] for x in want if x['locationCode'] not in srv]
    bad=[(x['locationCode'],x['xM'],x['zM'],srv[x['locationCode']].get('position')) for x in want if x['locationCode'] in srv and (lambda p:(not p) or abs(p['xM']-x['xM'])>0.006 or abs(p['zM']-x['zM'])>0.006)(srv[x['locationCode']].get('position'))]
    extra=[c for c in srv if c not in {x['locationCode'] for x in f}]
    print(mfc,'server',len(locs),'file',len(f),'checked',len(want),'missing',len(miss),miss[:5],'pos-diff',len(bad),bad[:5],'extra',len(extra))
    return t,locs
ACC,MFC,SITE=(sys.argv[1:4]+['claude-mfc-sup','MFC-BJG-01','busanjin'][len(sys.argv[1:4]):])
t,locs=cmp(ACC,MFC,SITE)
st=collections.Counter(l.get('state') for l in locs); print(' states',st.most_common(6))
f={x['locationCode'] for x in json.load(open(f'{D}/docs/layout-export/'+SITE+'/location-positions.json',encoding='utf-8'))}
notclosed=[l['locationCode'] for l in locs if l['locationCode'] not in f and l.get('state')!='CLOSED']
print(' not-in-file & not CLOSED',len(notclosed),notclosed[:8])
units=pages(t,'/mfcs/'+MFC+'/stock-units?size=200')
closed={l['locationCode'] for l in locs if l.get('state')=='CLOSED'}
print(' stock rows',len(units),'qty',sum(u.get('qty',0) for u in units),'in closed',sum(1 for u in units if u.get('locationCode') in closed),'outside file',sum(1 for u in units if u.get('locationCode') not in f and not str(u.get('locationCode','')).startswith(('RCV-','PAK-','DSP-','CRT-','QRT-','RTN-'))))
