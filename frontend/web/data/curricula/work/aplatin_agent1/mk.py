import json
rows=[];unit=topic=None
for l in open('rows.txt'):
    l=l.strip()
    if l.startswith('#'): unit=l[1:];continue
    if l.startswith('='): topic=l[1:];continue
    c,s,o=l.split('|')
    rows.append(dict(grade="all",unit=unit,topic=topic,subtopic=s,code=None if c=='-' else c,outcome=o))
json.dump(rows,open('../../rows/us-ap-latin.json','w'),indent=1)
print(len(rows))
