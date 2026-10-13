import json,os,shutil,sys,copy
S=sys.argv[1]; CL=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); TT=S+'/tt'
base=json.load(open(TT+'/whoop_data.json')); gym=json.load(open(TT+'/gym_data.json'))
def slim(d,n):
    d=copy.deepcopy(d)
    for k in('recovery','cycles','sleep','workouts'): d[k]=d[k][:n]
    return d
def pend(d):
    d=copy.deepcopy(d)
    for k in('recovery','sleep','cycles','workouts'):
        for r in d[k][:3]: r['score_state']='PENDING_SCORE'; r['score']=None
    return d
sc={}
sc['empty']=(dict(profile={},body={},recovery=[],cycles=[],sleep=[],workouts=[],meta={}),None)
sc['tiny10']=(slim(base,10),None)
sc['d50_nogym']=(slim(base,50),None)
sc['full_nogym_nowl']=({k:v for k,v in base.items() if k!='weight_log'},None)
sc['nobody']=({**{k:v for k,v in base.items() if k not in('weight_log','body')},'body':{}},gym)
sc['pending']=(pend(base),gym)
g2=copy.deepcopy(gym); g2['history']={}; g2['program']={}; g2['body']={}
sc['gym_min']=(base,g2)
g3=copy.deepcopy(gym); g3['sessions']=g3['sessions'][:2]
sc['gym_2sess']=(base,g3)
sc['full']=(base,gym)
for n,(d,g) in sc.items():
    p=f'{S}/edge/{n}'; shutil.rmtree(p,ignore_errors=True); os.makedirs(p)
    for f in os.listdir(CL):
        if f.endswith(('.py','.txt','.json')) and f not in('manifest.json',): shutil.copy(f'{CL}/{f}',p)
    for dd in('dashboard_src','dashboard_v3'): shutil.copytree(f'{CL}/{dd}',f'{p}/{dd}')
    open(p+'/update_source.txt','w').write('')
    json.dump(d,open(p+'/whoop_data.json','w'))
    if g: json.dump(g,open(p+'/gym_data.json','w'))
    elif os.path.exists(p+'/gym_data.json'): os.remove(p+'/gym_data.json')
print(list(sc))
