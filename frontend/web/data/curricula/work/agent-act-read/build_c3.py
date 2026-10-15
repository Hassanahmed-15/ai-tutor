import json
B=["K-2","3-5","6-8","9-12"]
rows=[];unit=topic=sub=None
for l in open('c3.txt'):
    l=l.rstrip('\n')
    if l.startswith('# '): unit=l[2:]
    elif l.startswith('## '): topic=l[3:]
    elif l.startswith('@ '): sub=l[2:]
    elif l.strip():
        p=l.split('|'); c=p[0]; outs=p[1:]
        assert len(outs)==4,(l[:30],len(outs))
        for b,o in zip(B,outs):
            if o: rows.append({"grade":b,"unit":unit,"topic":topic,"subtopic":sub,"code":c+"."+b,"outcome":o})
json.dump(rows,open('/Users/hassanahmed/ai-tutor/frontend/web/data/curricula/rows/us-c3-social-studies-k-12.json','w'),indent=1)
print(len(rows))
