import json
rows=[];unit=topic=None
for f in ['u1','u2','u3','u4','u6']:
  for l in open(f+'.txt'):
    l=l.strip()
    if l.startswith('#'): unit=l[1:];continue
    if l.startswith('='): topic=l[1:];continue
    c,s,o=l.split('|')
    rows.append(dict(grade="all",unit=unit,topic=topic,subtopic=s,code=c,outcome=o))
json.dump(rows,open('../../rows/us-ap-microeconomics.json','w'),indent=1)
print(len(rows))
