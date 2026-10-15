import sys,re
skill=re.compile(r"^(Create |Calculate or|Compare physical|quantities|Derive a|expression|Apply an|Justify or|using evidence|Predict new|factors of|physical (quant|repr|prin|syst)|principles or|or more scen|at ?different|locations in|scenario\.?|and following|selecting|a logical|unknown quantit|from known|pathway|of graphs|features of|the behavior|system\.|with appropriate|and units|data\.|diagrams, tables|charts, or|situations\.|definition|relationship, or|make a claim|experimental|procedures|appropriate for|scientific ?question|functional dep|between variables|mathematical|representations,|pathway\.|qualitative sketches|schematics|to represent|a given|Required Course)")
for l in sys.stdin.read().split("\n"):
    s=l.strip()
    if not s: continue
    if re.search(r"Return to Table|© 20|Course Framework V|^UNIT$|^continued on next|^LEARNING ?OBJECTIVE|^ESSENTIAL ?KNOWLEDGE|^SUGGESTED ?SKILLS|^[123]\.[ABCD]$",s): continue
    if skill.match(s): continue
    print(s)
