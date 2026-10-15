import json
rows=[]
for f in ['pc1.txt','pc2.txt','pc3.txt','pc4.txt']:
    unit=topic=sub=None
    for l in open(f):
        l=l.rstrip('\n')
        if l.startswith('# '): unit=l[2:]
        elif l.startswith('## '): topic=l[3:]
        elif l.startswith('@ '): sub=l[2:]
        elif l.strip():
            c,o=l.split('|',1)
            rows.append({"grade":"all","unit":unit,"topic":topic,"subtopic":sub,"code":c,"outcome":o})
json.dump(rows,open('/Users/hassanahmed/ai-tutor/frontend/web/data/curricula/rows/us-ap-precalculus.json','w'),indent=1,ensure_ascii=False)
print(len(rows))
