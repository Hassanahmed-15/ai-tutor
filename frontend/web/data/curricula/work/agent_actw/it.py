import json
rows=[]
def sk(unit,topic,sub,items):
    for c,o in items: rows.append({"grade":"all","unit":unit,"topic":topic,"subtopic":sub,"code":c,"outcome":o})
U1="Skill Category 1: Interpretive Communication"
U2="Skill Category 2: Interpersonal and Presentational Communication"
U3="Skill Category 3: Cultural Understanding"
sk(U1,"1.A Recognize explicit meaning","Spotting explicit meaning",[("1.A","Recognise what a text, recording or data display says outright"),("1.A.1","Pick out the supporting or relevant details in a source"),("1.A.2","Find data points, patterns and trends in charts and graphs")])
sk(U1,"1.B Interpret meaning","Interpreting a source",[("1.B","Work out meaning beyond the surface of a source"),("1.B.1","Identify the main idea, theme or purpose"),("1.B.2","Work out who a source is meant for"),("1.B.3","Identify point of view, tone or attitude"),("1.B.4","Spot the organising and rhetorical structures or strategies used"),("1.B.5","Work out unknown words and phrases from textual cues")])
sk(U1,"1.C Synthesize and infer meaning","Synthesising and inferring",[("1.C","Combine and infer meaning across sources"),("1.C.1","Link information within or between sources"),("1.C.2","Combine ideas from sources to reach logical conclusions"),("1.C.3","Infer unstated meaning from context")])
sk(U2,"2.A Use language that fits purpose and context","Fitting language to purpose",[("2.A","Use language suited to the purpose and setting of the communication"),("2.A.1","Use a range of grammatical structures"),("2.A.2","Use a range of vocabulary"),("2.A.3","Use idiomatic, culturally appropriate expressions"),("2.A.4","Choose a register suited to audience and situation")])
sk(U2,"2.B Make communication comprehensible","Being understood",[("2.B","Make speech and writing easy for the intended audience to understand"),("2.B.1","Use circumlocution and paraphrase to get around gaps"),("2.B.2","Monitor own speech, spot mistakes and self-correct"),("2.B.3","Pronounce clearly enough for varied speakers to understand"),("2.B.4","Use suitable speed and intonation when speaking"),("2.B.5","Follow written conventions: capitals, spelling, accents, punctuation")])
sk(U2,"2.C Share ideas, information and opinions","Sharing ideas and opinions",[("2.C","Share ideas, information and opinions on familiar and researched topics"),("2.C.1","Express ideas, preferences and opinions"),("2.C.2","Use research strategies to gather information and evidence"),("2.C.3","Give examples to advise, inform and explain opinions or feelings"),("2.C.4","Combine several sources to build and support a position"),("2.C.5","Refer to and cite sources properly")])
sk(U2,"2.D Apply organizational and rhetorical strategies","Organising and connecting ideas",[("2.D","Organise and connect ideas with suitable strategies"),("2.D.1","Use an appropriate organisational structure"),("2.D.2","Use cohesive devices such as relative pronouns, referents, conjunctions and transitions")])
sk(U3,"3.A Make connections within and across cultures","Cultural products, practices, perspectives",[("3.A","Make connections within and across cultures"),("3.A.1","Describe cultural products, practices and perspectives"),("3.A.2","Compare products, practices and perspectives of different communities"),("3.A.3","Reflect on why cultural products, practices and perspectives matter")])
T="Course themes"
th=[("Unit 1: Families and Communities",["Community Activities","Family Relationships","Social Interactions and Relationships","Urban and Rural Communities"],"families and communities in Italian-speaking societies"),
("Unit 2: Language and Culture",["Customs and Celebrations","Linguistics","Italian in the World"],"how language and culture influence each other and change over time"),
("Unit 3: Art and Creativity",["Architecture","Artistic Heritage","Beauty and Aesthetics","Fashion and Design","Literature","Visual and Performing Arts"],"art and creativity in Italian-speaking cultures"),
("Unit 4: Science and Technology",["Innovations and Emerging Technologies","Personal Technology and Communication","Science in Everyday Life","Societal Impacts of Science and Technology"],"science and technology and their effect on society"),
("Unit 5: Contemporary Life",["Education and Career","Entertainment and Media","Food and Health","Pop Culture","Sports and Leisure","Travel and Tourism"],"contemporary life in Italian-speaking communities"),
("Unit 6: Global Contexts",["Global Communication","Natural World","History","Policy and Planning","Transportation"],"global issues and the role of individuals and communities")]
for t,ctx,d in th:
    for c in ctx:
        rows.append({"grade":"all","unit":T,"topic":t,"subtopic":c,"code":None,"outcome":f"Use Italian to read, listen, speak and write about {c.lower()} while exploring {d}"})
json.dump(rows,open("data/curricula/rows/us-ap-italian-language-and-culture.json","w"),indent=1,ensure_ascii=False)
print(len(rows))
