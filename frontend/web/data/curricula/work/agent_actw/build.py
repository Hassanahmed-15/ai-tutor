import json,sys,glob
rows=[];u=t=s=None;g="all"
for f in sorted(glob.glob(sys.argv[2]+"/"+sys.argv[3]+"*.txt")):
    for l in open(f):
        l=l.rstrip("\n")
        if not l.strip(): continue
        k,_,v=l.partition("|")
        if k=="U":u=v
        elif k=="T":t=v
        elif k=="S":s=v
        elif k=="G":g=v
        else: rows.append({"grade":g,"unit":u,"topic":t,"subtopic":s,"code":k if k!="-" else None,"outcome":v})
json.dump(rows,open(sys.argv[1],"w"),indent=1,ensure_ascii=False);print(len(rows))
