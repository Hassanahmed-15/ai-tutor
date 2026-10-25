import json,sys
d=json.load(open(sys.argv[1]))
sizes={s:t for s,t in d["sizes"]}
ev=[]
for e in d["sync"]:
    if e["ev"]=="trace":
        m=e["msg"]
        if any(k in m for k in ("] sentence","voice-start","voice-end","heard","pen-wait")): ev.append((e["t"], "TRACE "+m[11:110]))
    elif e["ev"] in ("audio-playing","audio-ended"):
        ev.append((e["t"], f"{e['ev']:14} {sizes.get(e.get('size'),'?')[:50]}"))
for m in d["marker"]:
    if m["ev"]=="ink": ev.append((m["t"], f"   INK {m['board'][-2:]} b{m['batch']} s={m.get('sentence')} n={m['n']} ms={round(m['ms'])}"))
    elif m["ev"]=="stroke": ev.append((m["t0"], f"      stroke {m['board'][-2:]} b{m['batch']} {m['kind']} {round(m['t1']-m['t0'])}ms → {(m['t1']-ev[0][0] if ev else 0)/1000:.2f}"))
    else: ev.append((m["t"], f"   {m['ev']} {m.get('n')}"))
ev.sort()
t0=ev[0][0]
lo=float(sys.argv[2]) if len(sys.argv)>2 else 0; hi=float(sys.argv[3]) if len(sys.argv)>3 else 1e9
for t,s in ev:
    if lo <= (t-t0)/1000 <= hi: print(f"{(t-t0)/1000:7.2f} {s}")
