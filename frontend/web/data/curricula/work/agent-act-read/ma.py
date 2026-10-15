import json
G=["PK","K","1","2","3","4","5","6","7","8","HS Proficient","HS Accomplished","HS Advanced"]
def code(base,i):
    suf=["PK","K","1","2","3","4","5","6","7","8","I","II","III"][i]
    if base.startswith("MA:Re9"): 
        suf=["PK","K","1","2","3","4","5","6","7","8","HS.I","HS.II","HS.III"][i]
    return base+"."+suf
P=[]  # (unit, topic, subtopic, basecode, first?, [13 outcomes])
def add(unit,topic,sub,base,outs,coded=True):
    assert len(outs)==13,(base,sub,len(outs))
    P.append((unit,topic,sub,base,coded,outs))
CR="Creating";PR="Presenting and Producing";RE="Responding";CN="Connecting"
add(CR,"Anchor 1: Generate and conceptualize artistic ideas","Conceiving ideas for media artworks","MA:Cr1.1",[
"Share ideas for media artworks by exploring tools and imagining, with guidance.",
"Find and share media artwork ideas through play and experiments.",
"Express and share media ideas by sketching and modeling.",
"Find several media ideas by brainstorming and improvising.",
"Develop several media ideas using varied tools, methods and materials.",
"Conceive original artistic goals using creative methods like brainstorming and modeling.",
"Envision original ideas using personal experience and others' work.",
"Make variations of goals and solutions by practicing creative processes such as sketching and improvising.",
"Produce varied ideas and solutions with inventive processes like concept modeling and prototyping.",
"Generate ideas, goals and solutions for original works using focused processes like divergent thinking.",
"Use identified generative methods to form ideas, set goals and solve creative problems.",
"Use generative methods strategically to refine goals and make approaches more original.",
"Combine aesthetic principles with generative methods to form original ideas fluently."])
add(CR,"Anchor 2: Organize and develop artistic ideas and work","Developing ideas into plans and models","MA:Cr2.1",[
"With guidance, form ideas into plans or models for media productions.",
"With guidance, use ideas to form plans or models.",
"With guidance, use chosen ideas to form plans and models.",
"Choose ideas to create plans and models for media productions.",
"Form, share and test ideas, plans and models to prepare for production.",
"Discuss, test and assemble ideas, plans and models with artistic goals and presentation in mind.",
"Develop, present and test ideas, plans, models and proposals with goals and audience in mind.",
"Organize, propose and evaluate ideas, plans, prototypes and production processes with purposeful intent.",
"Design, propose and evaluate ideas, plans and prototypes, considering expressive intent and resources.",
"Structure and critique ideas, plans and prototypes, considering intent, resources and presentation context.",
"Apply aesthetic criteria to develop, propose and refine ideas, plans and prototypes.",
"Apply a personal aesthetic to design, test and refine original ideas and production strategies.",
"Integrate a sophisticated personal aesthetic and systems knowledge in forming, testing and proposing original ideas and production frameworks."])
add(CR,"Anchor 3: Refine and complete artistic work","Making and assembling content","MA:Cr3.1",[
"Make and capture media content freely and with guidance.",
"Form and capture media content for expression and meaning.",
"Create, capture and assemble content, noticing basic principles like pattern and repetition.",
"Construct and assemble content for unified productions, applying principles like positioning and attention.",
"Construct and order varied content into purposeful productions, applying principles like movement and force.",
"Structure and arrange content to convey purpose and meaning, applying principles like balance and contrast.",
"Create content and combine components to convey expression and meaning, using principles like emphasis and exaggeration.",
"Try several approaches to produce content for purpose and meaning, using principles like point of view and perspective.",
"Coordinate production processes to integrate content and components, understanding principles like narrative structure and composition.",
"Carry out production processes that integrate content and stylistic conventions, understanding principles like theme and unity.",
"Consolidate production processes with deliberate choices in organizing content and style, understanding principles like emphasis and tone.",
"Consolidate production processes with deliberate choices, understanding principles like continuity and juxtaposition.",
"Synthesize content, processes and components to express compelling purpose, story or emotion, showing mastery of principles like hybridization."])
add(CR,"Anchor 3: Refine and complete artistic work","Refining and finishing media artworks","MA:Cr3.1",[
"Try expressive effects freely and with guidance when making media artworks.",
"Change the content, form or presentation of a media artwork and share the results.",
"Practice and identify the effects of changes made to refine and finish media artworks.",
"Test and describe expressive effects when altering and completing media artworks.",
"Analyze how emphasizing elements changes effect and purpose when refining a work.",
"Show intentional effect when refining a work by emphasizing elements for a purpose.",
"Decide how elements can be altered for clear communication and refine work for clarity and purpose.",
"Appraise how elements can be altered for effect and audience, and refine work accordingly.",
"Refine work by emphasizing expressive elements that reflect purpose, audience or place.",
"Refine work, improving technical quality and accentuating expressive and stylistic elements for purpose, audience and place.",
"Refine work, honing aesthetic quality and accentuating stylistic elements for personal goals.",
"Refine aesthetic and technical components to form impactful expressions for specific purposes and audiences.",
"Consistently refine and elaborate elements to form impactful expressions for specific purposes, audiences and contexts."],coded=False)
add(PR,"Anchor 4: Select, analyze, and interpret artistic work for presentation","Integrating forms and content","MA:Pr4.1",[
"With guidance, combine forms and content, such as image and sound, into media artworks.",
"With guidance, combine arts forms and media content, such as dance and video.",
"Combine academic, arts and media content in media artworks, such as an illustrated story.",
"Practice combining academic, arts and media content into unified works, such as a narrated science animation.",
"Practice combining academic, arts and media forms into unified works, such as animation, music and dance.",
"Show how varied forms and content can be mixed and coordinated, such as narrative, dance and media.",
"Create media artworks by integrating multiple contents and forms, such as a broadcast.",
"Show how integrating contents and forms can support a central idea.",
"Integrate contents and forms into productions with consistent perspectives and narratives, such as an interactive game.",
"Integrate contents and forms into productions that convey specific themes, such as multimedia theatre.",
"Integrate arts and media forms into productions that consider audience reaction and interaction, such as experiential design.",
"Integrate forms and academic content into productions with thematic integrity and stylistic continuity, such as transmedia work.",
"Synthesize forms and academic content into productions that keep artistic fidelity across platforms."])
add(PR,"Anchor 5: Develop and refine artistic techniques and work for presentation","Skills and roles in production","MA:Pr5.1",[
"Use identified skills, such as handling tools and sharing, when making media artworks.",
"Identify and show basic skills, such as handling tools, making choices and cooperating.",
"Describe and show artistic skills and roles, such as technical steps, planning and collaborating.",
"Take on roles to show basic artistic, design, technical and soft skills, such as tool use and collaboration.",
"Show developing ability in artistic, design, technical and organizational roles, such as composition choices and group planning.",
"Take on identified roles to practice foundational technique, equipment use, production and collaboration.",
"Take on various roles to practice fundamental artistic, design, technical and soft skills.",
"Develop skills through assigned production roles, such as invention, technique, self-initiative and problem-solving.",
"Show an increasing set of skills through production roles, such as creative problem-solving and organizing.",
"Show a defined range of skills in specified roles, such as strategizing and collaborative communication.",
"Show progression in skills by selecting and fulfilling specified production roles.",
"Show effective command of artistic, design, technical and soft skills in managing and producing media artworks.",
"Use mastered skills in managing and producing media artworks."])
add(PR,"Anchor 5: Develop and refine artistic techniques and work for presentation","Creativity and innovation in production","MA:Pr5.1",[
"Use identified creative skills, such as imagining freely, within media productions.",
"Identify and show creative skills, such as performing, within productions.",
"Describe and show basic creative skills, such as varying techniques.",
"Experiment through playful practice and trial and error within productions.",
"Use basic creative skills to invent new content and solutions.",
"Practice foundational innovation, such as design thinking, on production problems.",
"Practice creative and innovative abilities, such as expanding conventions, on production problems.",
"Develop creative and adaptive innovation, such as testing constraints, to build solutions.",
"Show growing creative and adaptive innovation, such as exploratory processes.",
"Show a defined range of innovation abilities, such as divergent solutions and bending conventions.",
"Develop innovation abilities, such as design thinking and risk taking, for identified challenges.",
"Show effective innovation, such as resisting closure and using failure responsively, on sophisticated challenges.",
"Fluently use creative adaptability to form lines of inquiry and solutions for complex challenges."],coded=False)
add(PR,"Anchor 5: Develop and refine artistic techniques and work for presentation","Tools and techniques","MA:Pr5.1",[
"Use media arts creation tools freely and with guidance.",
"Practice, discover and share how creation tools work.",
"Try and share different ways to use tools and techniques to construct media artworks.",
"Show and explore methods for using tools to capture and form media artworks.",
"Use tools and techniques in standard ways to construct media artworks.",
"Use tools and techniques in standard and novel ways.",
"Examine how tools and techniques can be used in standard and experimental ways.",
"Show adaptability using tools and techniques in standard and experimental ways.",
"Show adaptable tool use in standard and experimental ways to achieve an assigned purpose.",
"Show adaptable use of tools, techniques and content to communicate intent.",
"Combine tools, techniques and content in standard and innovative ways to communicate intent.",
"Skillfully adapt and combine tools, styles, techniques and interactivity to reach expressive goals.",
"Independently use and adapt tools, styles and systems in standard, innovative and experimental ways for complex works."],coded=False)
add(PR,"Anchor 6: Convey meaning through the presentation of artistic work","Presenting and distributing media artworks","MA:Pr6.1",[
"With guidance, share roles and discuss the situation for presenting media artworks.",
"With guidance, identify and share roles and the presenting situation.",
"With guidance, discuss presentation conditions and perform a task in presenting.",
"Identify and describe presentation conditions and perform tasks in presenting.",
"Describe presentation conditions and take on roles and processes in presenting or distributing.",
"Explain presentation conditions and fulfill a role in presenting or distributing.",
"Compare qualities and purposes of presentation formats and fulfill a role in presenting or distributing.",
"Analyze presentation formats and fulfill tasks and defined processes in presenting or distributing.",
"Evaluate presentation formats to fulfill tasks and processes in presenting or distributing.",
"Design presentation and distribution of media artworks through multiple formats or contexts.",
"Design presentation and distribution of collections, considering combinations of works, formats and audiences.",
"Curate and design presentation of collections for varied contexts, such as mass audiences and physical or virtual channels.",
"Curate, design and promote presentation for intentional impact in contexts such as markets and venues."])
add(PR,"Anchor 6: Convey meaning through the presentation of artistic work","Reflecting on presentations","MA:Pr6.1",[
"With guidance, share reactions to the presentation of media artworks.",
"With guidance, identify and share reactions to a presentation.",
"With guidance, discuss the experience of a presentation.",
"Describe the experience of presenting and share the results.",
"Describe the experience and share results of and improvements for presenting.",
"Explain results of and improvements for presenting media artworks.",
"Compare results of and improvements for presenting.",
"Analyze results of and improvements for presenting.",
"Evaluate results of and improvements for presenting, considering personal growth.",
"Evaluate results and carry out improvements, considering personal growth and external effects.",
"Evaluate and implement improvements, considering personal and local impacts.",
"Evaluate and implement improvements, considering personal, local and social impacts.",
"Independently evaluate, compare and integrate improvements, considering personal to global impacts."],coded=False)
add(RE,"Anchor 7: Perceive and analyze artistic work","Components and messages in media artworks","MA:Re7.1",[
"With guidance, explore and discuss components and messages in media artworks.",
"Recognize and share components and messages in media artworks.",
"Identify components and messages in media artworks.",
"Identify and describe components and messages in media artworks.",
"Identify and describe how components create messages.",
"Identify, describe and explain how components create messages.",
"Identify, describe and differentiate how components create message and meaning.",
"Identify, describe and analyze how components create message and meaning.",
"Describe, compare and analyze qualities of and relationships between components.",
"Compare, contrast and analyze qualities of components and style.",
"Analyze qualities of components, style and preferences communicated by works and artists.",
"Analyze and synthesize qualities of components in many works, and how they affect audiences.",
"Analyze and synthesize components and audience impact in a variety of works."])
add(RE,"Anchor 7: Perceive and analyze artistic work","How media artworks shape audience experience","MA:Re7.1",[
"With guidance, explore media artworks and discuss experiences.",
"Recognize and share how media artworks create different experiences.",
"With guidance, identify how media artworks create different experiences.",
"Identify and describe how media artworks create different experiences.",
"Identify and describe how forms, methods and styles manage audience experience.",
"Identify, describe and explain how forms, methods and styles manage audience experience.",
"Identify, describe and differentiate how forms, methods and styles manage audience experience.",
"Identify, describe and analyze how forms, methods and styles manage audience experience.",
"Compare and analyze how forms, methods and styles interact with personal preferences in shaping audience experience.",
"Compare and analyze how forms, methods and styles manage audience experience and create intention.",
"Analyze how media artworks manage audience experience and create intention through multimodal perception.",
"Analyze how a broad range of works manage experience and create intention and persuasion through multimodal perception.",
"Survey an exemplary range of works, analyzing methods for managing audience experience, intention, persuasion and systemic communication."],coded=False)
add(RE,"Anchor 8: Interpret intent and meaning in artistic work","Interpreting intent and meaning","MA:Re8.1",[
"With guidance, share reactions to media artworks.",
"With guidance, share observations about media artworks.",
"With guidance, identify the meanings of media artworks.",
"Determine the purposes and meanings of media artworks, considering context.",
"Determine purposes and meanings while describing their context.",
"Determine and explain reactions and interpretations, considering purpose and context.",
"Determine and compare personal and group interpretations, considering intention and context.",
"Analyze the intent of media artworks using given criteria.",
"Analyze intent and meaning using self-developed criteria.",
"Analyze intent and meanings, focusing on intentions, forms and contexts.",
"Analyze intent, meanings and reception, focusing on personal and cultural contexts.",
"Analyze intent, meanings and influence, based on personal, societal, historical and cultural contexts.",
"Analyze intent, meanings and impacts of diverse works, considering complex context and bias."])
add(RE,"Anchor 9: Apply criteria to evaluate artistic work","Evaluating media artworks","MA:Re9.1",[
"With guidance, examine and share appealing qualities in media artworks.",
"Share appealing qualities and possible changes in media artworks.",
"Identify effective parts of and possible changes to media artworks, considering viewers.",
"Discuss the effectiveness of and improvements for media artworks, considering context.",
"Identify basic criteria and evaluate media artworks, considering improvements and context.",
"Identify and apply basic criteria to evaluate and improve works and production processes.",
"Determine and apply criteria to evaluate works and processes, giving constructive feedback.",
"Determine and apply specific criteria to evaluate works and processes, giving constructive feedback.",
"Develop and apply criteria to evaluate works and processes, giving constructive feedback.",
"Evaluate works and processes with developed criteria, considering context and artistic goals.",
"Evaluate works and processes at decisive stages with identified criteria.",
"Form and apply defensible evaluations in constructive, systematic critique.",
"Independently develop rigorous evaluations and strategically seek feedback on complex goals."])
add(CN,"Anchor 10: Relate artistic ideas and works to societal, cultural and historical context","Media artworks and everyday life","MA:Cn10.1",[
"With guidance, relate media artworks and everyday life.",
"With guidance, share ideas relating media artworks to daily activities.",
"Discuss media artworks in everyday life, such as popular media and connections with family and friends.",
"Discuss how media artworks relate to everyday and cultural life, such as media messages and environments.",
"Identify how media artworks relate to everyday and cultural life and can influence values and online behavior.",
"Explain how media artworks relate to everyday and cultural life, such as fantasy versus reality and technology use.",
"Research and show how media artworks relate to personal, social and community life, including ethics and history.",
"Research and show how media artworks relate to personal identity, history and entertainment.",
"Research and show how media artworks relate to situations, purposes and values such as community and social media.",
"Explain how media artworks relate to contexts, purposes and values such as democracy and the environment.",
"Explain how media artworks relate to social trends, power, equality and identity.",
"Examine in depth how media works relate to contexts such as markets, systems, propaganda and truth.",
"Show relationships of media works to personal and global contexts through impactful media artworks."])
add(CN,"Anchor 10: Relate artistic ideas and works to societal, cultural and historical context","Responsible use of media arts tools and environments","MA:Cn10.1",[
"With guidance, interact safely and appropriately with media arts tools and environments.",
"Interact appropriately with tools and environments, considering safety, rules and fairness.",
"Interact appropriately with tools and environments, considering safety, rules and fairness.",
"Examine and interact appropriately with tools and environments, considering safety, rules and fairness.",
"Examine and interact appropriately, considering ethics, rules and fairness.",
"Examine, discuss and interact appropriately, considering ethics, rules and media literacy.",
"Analyze and interact appropriately, considering fair use, copyright, ethics and media literacy.",
"Analyze and interact responsibly, considering copyright, ethics, media literacy and social media.",
"Analyze legal and technological contexts, considering ethics, media literacy, social media and virtual worlds.",
"Evaluate legal, technological, systemic and vocational contexts, considering digital identity.",
"Investigate legal, technological, systemic and vocational contexts, considering artist and audience interactivity.",
"Critically investigate and strategically interact with legal, technological, systemic and vocational contexts of media arts.",
"Critically investigate and strategically interact with legal, technological, systemic and vocational contexts of media arts."],coded=False)
add(CN,"Anchor 11: Synthesize and relate knowledge and personal experiences to make art","Using resources to make media artworks","MA:Cn11.1",[
"Use personal experiences in making media artworks.",
"Use personal experiences and choices in making media artworks.",
"Use personal experiences, interests and models in creating media artworks.",
"Use experiences, interests, information and models in creating media artworks.",
"Use personal and external resources, such as interests, information and models.",
"Examine and use personal and external resources, such as research and cultural understanding.",
"Access and use internal and external resources, such as interests, knowledge and experiences.",
"Access, evaluate and use resources, such as knowledge, interests and research.",
"Access, evaluate and use resources to inform media artworks, such as exemplary works.",
"Access, evaluate and use cultural and societal knowledge, research and exemplary works.",
"Access, evaluate and integrate personal and external resources to inform original works.",
"Synthesize internal and external resources to make persuasive media artworks.",
"Independently and proactively access qualitative resources to inform cogent media artworks."])
add(CN,"Anchor 11: Synthesize and relate knowledge and personal experiences to make art","How media artworks form meaning and culture","MA:Cn11.1",[
"With guidance, share experiences of media artworks.",
"Share memorable experiences of media artworks.",
"Share meaningful experiences of media artworks.",
"Discuss experiences of media artworks, describing meaning and purpose.",
"Identify and show how media artworks form meanings, situations and culture, such as popular media.",
"Examine and show how media artworks form meanings and cultural experiences, such as online spaces.",
"Examine how media artworks form meanings and cultural experiences, such as news and cultural events.",
"Explain how media artworks form new meanings and cultural experiences, such as historical events.",
"Explain how media artworks form new meanings and knowledge, such as in learning.",
"Explain how media artworks expand meaning and knowledge and create cultural experiences, local and global.",
"Explain the use of media artworks to expand meaning and create cultural experiences online.",
"Explain the use of media artworks to synthesize meaning and reflect and form cultural experiences.",
"Show how media artworks consummate new meaning, knowledge and impactful cultural experiences."],coded=False)
rows=[]
for u,t,s,base,coded,outs in P:
    for i,o in enumerate(outs):
        c=code(base,i) if coded else None
        rows.append({"grade":G[i],"unit":u,"topic":t,"subtopic":s,"code":c,"outcome":o})
json.dump(rows,open('/Users/hassanahmed/ai-tutor/frontend/web/data/curricula/rows/us-ncas-media-arts-pk-12.json','w'),indent=1)
print(len(rows))
