import json
band={'2':'13-15','3':'16-19','4':'20-23','5':'24-27','6':'28-32','7':'33-36'}
gr={'2':'8','3':'9','4':'10','5':'11','6':'12','7':'12'}
rows=[];unit=None
for l in open('rows.txt'):
    l=l.strip()
    if l.startswith('#'): unit=l[1:];continue
    c,s,o=l.split('|');d=c.split()[1][0]
    rows.append(dict(grade=gr[d],unit=unit,topic="Score range "+band[d],subtopic=s,code=c,outcome=o))
json.dump(rows,open('../../rows/us-act-ccrs-math.json','w'),indent=1)
print(len(rows))
