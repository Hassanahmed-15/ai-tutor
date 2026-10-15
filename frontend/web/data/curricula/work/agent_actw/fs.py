import sys,re
skip=False
for l in sys.stdin.read().split("\n"):
    s=l.strip()
    if not s: continue
    if s=="SKILLS": skip=True; continue
    if re.match(r"^\d+\.\d+\.[A-Z](\.\d+)?$",s) or s.startswith("TOPIC") or s.startswith("[page") or s.startswith("LEARNING OBJ"): skip=False
    if skip: continue
    if re.search(r"Course Framework|^UNIT$|^continued on|^\d+$|^ESSENTIAL KNOW|^LEARNING OBJ|^Return To|Required Course Content",s): continue
    print(s)
