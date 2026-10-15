import json
R=[]
def a(u,t,s,c,o): R.append({"grade":"all","unit":u,"topic":t,"subtopic":s,"code":c,"outcome":o})
U1="1 Interpretive Communication";U2="2 Interpersonal and Presentational Communication";U3="3 Cultural Understanding"
T="1.A Recognize explicit meaning"
a(U1,T,"Recognizing explicit meaning","1.A","Pick out meaning that is stated directly in Japanese texts, audio and data displays.")
a(U1,T,"Recognizing explicit meaning","1.A.1","Find supporting or relevant details in a source.")
a(U1,T,"Reading data displays","1.A.2","Find data points, patterns and trends in charts and graphs.")
T="1.B Interpret meaning"
a(U1,T,"Interpreting meaning","1.B","Interpret what a Japanese source means beyond the literal words.")
a(U1,T,"Interpreting meaning","1.B.1","Work out the main idea, theme or purpose of a source.")
a(U1,T,"Interpreting meaning","1.B.2","Work out who a source is meant for.")
a(U1,T,"Interpreting meaning","1.B.3","Work out the point of view, tone or attitude in a source.")
a(U1,T,"Structure and word meaning","1.B.4","Spot how a source is organized and the rhetorical strategies it uses.")
a(U1,T,"Structure and word meaning","1.B.5","Use clues in the text to work out the meaning of words and phrases.")
T="1.C Synthesize and infer meaning"
a(U1,T,"Synthesizing and inferring","1.C","Combine information and infer meaning from Japanese sources.")
a(U1,T,"Synthesizing and inferring","1.C.1","Connect information within one source or across several sources.")
a(U1,T,"Synthesizing and inferring","1.C.2","Combine information to reach logical conclusions.")
a(U1,T,"Synthesizing and inferring","1.C.3","Infer meaning that is only implied, using context.")
T="2.A Use language that fits purpose and context"
a(U2,T,"Language that fits the situation","2.A","Choose language that matches the purpose and context of speaking or writing.")
a(U2,T,"Language that fits the situation","2.A.1","Use a variety of grammatical structures.")
a(U2,T,"Language that fits the situation","2.A.2","Use a wide range of vocabulary.")
a(U2,T,"Idioms and register","2.A.3","Use idiomatic and culturally relevant expressions.")
a(U2,T,"Idioms and register","2.A.4","Choose a register suited to the audience and situation.")
T="2.B Make communication comprehensible"
a(U2,T,"Being understood","2.B","Make speech and writing understandable to the intended audience.")
a(U2,T,"Being understood","2.B.1","Use strategies such as circumlocution and paraphrasing when words fail.")
a(U2,T,"Being understood","2.B.2","Monitor your speech, notice errors and self-correct in conversation.")
a(U2,T,"Pronunciation and conventions","2.B.3","Pronounce Japanese clearly enough for varied listeners to follow.")
a(U2,T,"Pronunciation and conventions","2.B.4","Speak at a suitable pace with effective intonation.")
a(U2,T,"Pronunciation and conventions","2.B.5","Follow standard written conventions such as orthography and punctuation.")
T="2.C Share ideas, information and opinions"
a(U2,T,"Sharing ideas and opinions","2.C","Share ideas, information and opinions on familiar and researched topics.")
a(U2,T,"Sharing ideas and opinions","2.C.1","Express ideas, preferences and opinions.")
a(U2,T,"Sharing ideas and opinions","2.C.3","Use examples to give advice or information and to explain opinions or feelings.")
a(U2,T,"Researching and citing sources","2.C.2","Use research strategies to gather information and evidence.")
a(U2,T,"Researching and citing sources","2.C.4","Combine information from several sources to build and support a position.")
a(U2,T,"Researching and citing sources","2.C.5","Refer to and cite sources properly.")
T="2.D Apply organizational and rhetorical strategies"
a(U2,T,"Organizing and connecting ideas","2.D","Organize speech and writing with suitable rhetorical strategies.")
a(U2,T,"Organizing and connecting ideas","2.D.1","Apply an organizational structure that suits the task.")
a(U2,T,"Organizing and connecting ideas","2.D.2","Use cohesive devices such as relative pronouns, referents, conjunctions and transitions to link ideas.")
T="3.A Make connections within and across cultures"
a(U3,T,"Cultural products, practices, perspectives","3.A","Make connections within and across Japanese-speaking cultures and your own.")
a(U3,T,"Cultural products, practices, perspectives","3.A.1","Describe cultural products, practices and perspectives.")
a(U3,T,"Cultural products, practices, perspectives","3.A.2","Compare cultural products, practices and perspectives across different communities.")
a(U3,T,"Cultural products, practices, perspectives","3.A.3","Reflect on why cultural products, practices and perspectives matter.")
U4="Course Themes"
th=[("Unit 1: Families and Communities",[("Family life and values","Explore what makes a family in Japanese-speaking societies and how families shape values and traditions."),("Community and social life","Look at community activities, social relationships and urban versus rural communities."),("Customs and celebrations","Discuss customs, celebrations, and how families and communities experience today's world.")]),
("Unit 2: Language and Culture",[("Language and customs","Explore how language and culture shape each other, through customs, celebrations and the Japanese language in the world."),("Heritage, arts and media","Connect language to artistic heritage, literature, performing arts, entertainment and pop culture."),("Technology and language","Consider how technology influences language and culture, including personal technology and communication.")]),
("Unit 3: Art and Creativity",[("Art, architecture and design","Explore architecture, fashion and design, and what beauty and aesthetics mean to communities."),("Literature and performing arts","Study literature, visual and performing arts, and how art records history."),("Leisure and creative life","Link creativity to sports, leisure, travel and tourism.")]),
("Unit 4: Science and Technology",[("Emerging technologies","Explore innovations, personal technology and how technology supports global communication."),("Science in daily life","Look at science in everyday life, transportation, and food and health."),("Societal impact of science","Weigh the societal impact of scientific and technological advances and what drives innovation.")]),
("Unit 5: Contemporary Life",[("Changes in modern life","Investigate how contemporary life has changed over twenty years, in education, careers and entertainment."),("Values and traditions today","Consider how cultural values and traditions shape public and everyday life, including food, health and pop culture."),("Perceptions of what matters","Examine what shapes how people judge what is valued today, through media, sports, travel and fashion.")]),
("Unit 6: Global Contexts",[("Global phenomena and communities","Investigate how global events affect Japanese-speaking families, communities and the natural world."),("Individuals and global action","Explore the role individuals play in understanding and responding to world events and proposing solutions."),("Complex societal issues","Examine how complex issues, policy and history affect a society's culture.")])]
for t,ls in th:
    for s,o in ls: a(U4,t,s,None,o)
json.dump(R,open('/Users/hassanahmed/ai-tutor/frontend/web/data/curricula/rows/us-ap-japanese-language-and-culture.json','w'),indent=1,ensure_ascii=False)
