import json
D=[("Ideas and Analysis","I&A","A",[("Understanding the task and writing with purpose","1"),("Analyzing an issue and differing perspectives","2")]),
("Development and Support","D&S","S",[("Building and strengthening the argument","1")]),
("Organization","ORG","ORG",[("Grouping and connecting ideas","1"),("Employing an organizational strategy","2")]),
("Language Use and Conventions","L&C","C",[("Using language to enhance meaning","1"),("Applying standard written English conventions","2")])]
bands=["3-4","5-6","7-8","9-10","11-12"]
S={}
def a(k,band,*s): S[(k,band)]=list(s)
# I&A 1
a("A1",0,"Write a thesis that is unclear or only loosely tied to the issue","Respond only weakly to other perspectives")
a("A1",1,"Write a somewhat clear thesis taking a stance on a contemporary issue","Respond to other perspectives on the issue")
a("A1",2,"Write a clear thesis taking a stance on a contemporary issue","Engage with other perspectives on the issue")
a("A1",3,"Write a precise thesis taking a stance on a contemporary issue","Engage productively with other perspectives")
a("A1",4,"Write a nuanced, precise thesis taking a stance on a contemporary issue","Engage critically with other perspectives")
a("A2",0,"Give analysis that is incomplete or largely irrelevant")
a("A2",1,"Set up only a limited or tangential context for analysis","Give analysis that is simplistic or somewhat unclear")
a("A2",2,"Set up and use a relevant context for analysis","Recognise implications, complexities, tensions, and underlying values or assumptions")
a("A2",3,"Set up and use a thoughtful context for analysis","Address implications, complexities, tensions, and underlying values or assumptions")
a("A2",4,"Set up and use an insightful context for analysis","Examine implications, complexities, tensions, and underlying values or assumptions")
a("S1",0,"Reach only a weak understanding of the issue through inadequate reasoning and examples","Offer a rationale that fails to clarify the argument","Elaborate ideas in ways that are illogical, disjointed or circular")
a("S1",1,"Use mostly relevant reasoning and examples to support the thesis, reaching a simple understanding","Offer a rationale that largely clarifies the argument","Elaborate ideas, though somewhat repetitively or imprecisely")
a("S1",2,"Use clear reasoning and examples to understand the issue and other perspectives","Convey adequately why the argument is worth considering","Extend ideas by considering factors that complicate your own view","Anticipate objections by qualifying the argument")
a("S1",3,"Use reasoning and examples purposefully to support the thesis and deepen understanding","Convey capably why the argument is worth considering","Enrich ideas by considering factors that complicate your own view","Anticipate objections by qualifying the argument")
a("S1",4,"Use reasoning and examples skilfully to broaden the context and support the thesis","Convey effectively why the argument is worth considering","Enrich and strengthen ideas by considering complicating factors","Anticipate objections by qualifying the argument")
a("O1",0,"Group ideas with little consistency or clarity","Use transitions that mislead or are poorly formed")
a("O1",1,"Group most ideas logically","Use transitions within and between paragraphs to clarify some relationships")
a("O1",2,"Group and sequence ideas logically","Use transitions within and between paragraphs to clarify relationships")
a("O1",3,"Group and sequence ideas logically to make the argument more effective","Use transitions consistently to clarify relationships among ideas")
a("O1",4,"Group and sequence ideas into a progression that builds the argument","Use transitions to strengthen relationships among ideas")
a("O2",0,"Provide a minimal structure in which some ideas are grouped locally")
a("O2",1,"Provide a basic organisational structure")
a("O2",2,"Use an emerging controlling idea or purpose to shape the argument")
a("O2",3,"Use a controlling idea or purpose to unify the argument")
a("O2",4,"Use a controlling idea or purpose to unify and focus the argument")
a("C1",0,"Choose rudimentary words that are often imprecise","Make inconsistent style choices (voice, tone, diction) that do not fit the purpose")
a("C1",1,"Choose general words that are sometimes imprecise","Make style choices that do not always fit purpose and topic")
a("C1",2,"Choose adequate words that convey the argument clearly","Make style choices (voice, tone, diction) that fit purpose and topic")
a("C1",3,"Choose precise words that serve the argument","Make effective style choices for purpose and topic")
a("C1",4,"Choose skilful, precise words that strengthen the argument","Make strategic, effective style choices for purpose and topic")
a("C2",0,"Write sentences that only sometimes have clear structure","Write with distracting grammar, usage and mechanics errors that often obscure meaning")
a("C2",1,"Write sentences with usually clear but little varied structure","Write with distracting errors that mostly still convey meaning")
a("C2",2,"Write sentences with clear, occasionally varied structures","Write with some errors that still convey meaning clearly")
a("C2",3,"Write sentences with clear, often varied structures","Write with only minor grammar, usage and mechanics errors")
a("C2",4,"Write sentences with clear, consistently varied structures","Write free of all but a few minor errors")
rows=[]
for dn,pre,cp,strands in D:
    for sn,n in strands:
        key={"A":"A","S":"S","ORG":"O","C":"C"}[cp]+n
        for b in range(5):
            num=f"{b+2}0{n}"
            for i,s in enumerate(S[(key,b)]):
                rows.append({"grade":"all","unit":dn,"topic":sn,"subtopic":f"{sn}, score {bands[b]}",
                 "code":f"{cp} {num}" if i==0 else None,"outcome":s})
json.dump(rows,open("data/curricula/rows/us-act-ccrs-writing.json","w"),indent=1)
print(len(rows))
