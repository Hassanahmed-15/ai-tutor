import sys,re
t=sys.stdin.read()
pages=re.split(r"(?=\[page \d+\])",t)
for p in pages:
    if "instructional time should focus" in p or "Overview" in p[:400] or "Mathematical Practices" in p[:600] and "Grade" in p[:200] and "Standards" not in p[:100]: continue
    if re.search(r"^Mathematics \| Grade",p,re.M): continue
    print("\n".join(l for l in p.split("\n") if l.strip() and not re.match(r"^(Common Core State|grade \d \|)",l)))
