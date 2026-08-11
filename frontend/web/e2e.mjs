const BK = ["reactAnimation","manimScene","structureScene","plotBoard","equationBoard","chalkBoard"];
for (const topic of ["Mechanics of Breathing", "How the Heart Pumps Blood"]) {
  const t0 = Date.now();
  const r = await fetch("http://localhost:3000/api/generate-lecture", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic }), signal: AbortSignal.timeout(1_500_000),
  });
  const d = await r.json();
  if (d.error) { console.log(`FAIL  ${topic}: ${d.error}`); continue; }
  const teach = (d.beats ?? []).filter(b => b.slideKind !== "checkpoint");
  const words = teach.reduce((s,b)=>s+String(b.script??"").split(/\s+/).filter(Boolean).length,0);
  const kinds = {}; let manim = 0, empty = 0;
  for (const b of d.beats ?? []) {
    const bos = (b.draw?.ops ?? []).filter(o => BK.includes(o.kind));
    if (!bos.length) continue;
    kinds[bos[0].kind] = (kinds[bos[0].kind]||0)+1;
    if (bos.some(o=>o.kind==="manimScene")) manim++;
    const filled = bos.some(o => o.kind==="reactAnimation" ? !!o.code : o.kind==="chalkBoard" ? (o.ops||[]).length>0 : o.spec!=null);
    if (!filled) { empty++; console.log(`   UNFILLED ${b.id}: ${bos.map(o=>o.kind).join(",")}`); }
  }
  console.log(`${manim===0 && empty===0 ? "PASS" : "FAIL"}  ${topic}`);
  console.log(`      ${teach.length} beats, ${Math.round(words/teach.length)} w/beat, ${((Date.now()-t0)/1000).toFixed(0)}s, $${(d.costUsd??0).toFixed(2)}`);
  console.log(`      ${JSON.stringify(kinds)}  manim=${manim} unfilled=${empty}`);
}
