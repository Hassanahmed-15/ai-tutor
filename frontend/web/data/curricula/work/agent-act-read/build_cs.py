import json
U={"CS":"Computing Systems","NI":"Networks and the Internet","DA":"Data and Analysis","AP":"Algorithms and Programming","IC":"Impacts of Computing"}
rows=[];g=None;cnt={}
for l in open('cs.txt'):
    l=l.rstrip('\n')
    if '|' not in l: g=l;continue
    c,sub,n,o=l.split('|')
    code=g.split()[0]+"-"+c+"-"+n
    k=(g,c,sub)
    cnt[k]=cnt.get(k,0)+1
    s=sub
    if sub=="Program Development":
        s="Program Development: "+("planning and teamwork" if cnt[k]<=4 else "testing and review")
    rows.append({"grade":g,"unit":U[c],"topic":sub,"subtopic":s,"code":code,"outcome":o})
json.dump(rows,open('/Users/hassanahmed/ai-tutor/frontend/web/data/curricula/rows/us-csta-computer-science-k-12.json','w'),indent=1)
print(len(rows))
