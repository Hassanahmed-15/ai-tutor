import json
G={'2':'8','3':'9','4':'10','5':'11','6':'12','7':'12'}
B={'2':'13-15','3':'16-19','4':'20-23','5':'24-27','6':'28-32','7':'33-36'}
U={'CLR':'Close Reading','IDT':'Central Ideas, Themes, and Summaries','REL':'Relationships','WME':'Word Meanings and Word Choice','TST':'Text Structure','PPV':'Purpose and Point of View','ARG':'Arguments','SYN':'Multiple Texts'}
R=[]
def a(code,sub,out):
    s=code[:3];d=code[4]
    R.append({"grade":G[d],"unit":U[s]+" ("+s+")","topic":"Score range "+B[d],"subtopic":sub,"code":code,"outcome":out})
# CLR
a("CLR 201","Finding facts and simple conclusions","Find basic facts stated plainly in a passage, such as names, dates and events.")
a("CLR 202","Finding facts and simple conclusions","Draw simple conclusions about main characters in fairly demanding stories.")
a("CLR 301","Finding facts and simple conclusions","Find simple details within a sentence or paragraph of a fairly demanding passage.")
a("CLR 302","Finding facts and simple conclusions","Draw simple conclusions from fairly demanding passages.")
a("CLR 401","Details, conclusions and paraphrase","Find important details in fairly demanding passages.")
a("CLR 402","Details, conclusions and paraphrase","Draw logical conclusions from fairly demanding passages.")
a("CLR 403","Details, conclusions and paraphrase","Draw simple conclusions from more demanding passages.")
a("CLR 404","Details, conclusions and paraphrase","Restate some statements in your own words in fairly demanding passages.")
a("CLR 501","Details, conclusions and paraphrase","Find and interpret minor or subtly stated details in fairly demanding passages.")
a("CLR 502","Details, conclusions and paraphrase","Find important details in more demanding passages.")
a("CLR 503","Details, conclusions and paraphrase","Draw subtle conclusions from fairly demanding passages.")
a("CLR 504","Details, conclusions and paraphrase","Draw logical conclusions from more demanding passages.")
a("CLR 505","Details, conclusions and paraphrase","Paraphrase almost any statement in fairly demanding passages.")
a("CLR 506","Details, conclusions and paraphrase","Paraphrase some statements in more demanding passages.")
a("CLR 601","Details, conclusions and paraphrase","Find and interpret minor or subtle details in more demanding passages.")
a("CLR 602","Details, conclusions and paraphrase","Find important details in complex passages.")
a("CLR 603","Details, conclusions and paraphrase","Draw subtle conclusions from more demanding passages.")
a("CLR 604","Details, conclusions and paraphrase","Draw simple conclusions from complex passages.")
a("CLR 605","Details, conclusions and paraphrase","Paraphrase almost any statement in more demanding passages.")
a("CLR 701","Details, conclusions and paraphrase","Find and interpret minor or subtle details in complex passages.")
a("CLR 702","Details, conclusions and paraphrase","Find important details in highly complex passages.")
a("CLR 703","Details, conclusions and paraphrase","Draw logical conclusions from complex passages.")
a("CLR 704","Details, conclusions and paraphrase","Draw simple conclusions from highly complex passages.")
a("CLR 705","Details, conclusions and paraphrase","Draw complex or subtle conclusions by combining information from different parts of a passage.")
a("CLR 706","Details, conclusions and paraphrase","Paraphrase statements in complex passages.")
# IDT
a("IDT 201","Topic, central idea and theme","Identify a passage's topic and tell it apart from its central idea or theme.")
a("IDT 301","Topic, central idea and theme","Identify a clear central idea in straightforward paragraphs of fairly demanding stories.")
a("IDT 401","Topic, central idea and theme","Infer a central idea in straightforward paragraphs of fairly demanding stories.")
a("IDT 402","Topic, central idea and theme","Identify a clear central idea or theme in fairly demanding passages or paragraphs.")
a("IDT 403","Summarizing supporting ideas","Summarize key supporting ideas and details in fairly demanding passages.")
a("IDT 501","Topic, central idea and theme","Infer a central idea or theme in fairly demanding passages or paragraphs.")
a("IDT 502","Topic, central idea and theme","Identify a clear central idea or theme in more demanding passages or paragraphs.")
a("IDT 503","Summarizing supporting ideas","Summarize key supporting ideas and details in more demanding passages.")
a("IDT 601","Topic, central idea and theme","Infer a central idea or theme in more demanding passages or paragraphs.")
a("IDT 602","Summarizing supporting ideas","Summarize key supporting ideas and details in complex passages.")
a("IDT 701","Topic, central idea and theme","Identify or infer a central idea or theme in complex passages or paragraphs.")
a("IDT 702","Summarizing supporting ideas","Summarize key supporting ideas and details in highly complex passages.")
# REL
rel=[("201","Sequence and simple cause-effect","Say when an event happens (first, last, before, after) in fairly demanding passages."),
("202","Sequence and simple cause-effect","Spot a simple cause-effect link within one sentence."),
("301","Comparisons and cause-effect","Identify clear comparisons between main characters in fairly demanding stories."),
("302","Sequence and simple cause-effect","Spot simple cause-effect links within a paragraph of a fairly demanding story."),
("401","Sequence and simple cause-effect","Put simple sequences of events in order in fairly demanding stories."),
("402","Comparisons and cause-effect","Identify clear comparisons in fairly demanding passages."),
("403","Comparisons and cause-effect","Identify clear cause-effect relationships in fairly demanding passages."),
("501","Sequence and simple cause-effect","Order sequences of events in fairly demanding passages."),
("502","Comparisons and cause-effect","Understand implied or subtle comparisons in fairly demanding passages."),
("503","Comparisons and cause-effect","Identify clear comparisons in more demanding passages."),
("504","Comparisons and cause-effect","Understand implied or subtle cause-effect links in fairly demanding passages."),
("505","Comparisons and cause-effect","Identify clear cause-effect links in more demanding passages."),
("601","Sequence and simple cause-effect","Order sequences of events in more demanding passages."),
("602","Comparisons and cause-effect","Understand implied or subtle comparisons in more demanding passages."),
("603","Comparisons and cause-effect","Identify clear comparisons in complex passages."),
("604","Comparisons and cause-effect","Understand implied or subtle cause-effect links in more demanding passages."),
("605","Comparisons and cause-effect","Identify clear cause-effect links in complex passages."),
("701","Sequence and simple cause-effect","Order sequences of events in complex passages."),
("702","Comparisons and cause-effect","Understand implied or subtle comparisons in complex passages."),
("703","Comparisons and cause-effect","Identify clear comparisons in highly complex passages."),
("704","Comparisons and cause-effect","Understand implied or subtle cause-effect links in complex passages."),
("705","Comparisons and cause-effect","Identify clear cause-effect links in highly complex passages.")]
for n,s,o in rel: a("REL "+n,s,o)
wme=[("201","Word choice and tone","Understand what a familiar word, phrase or simple description implies."),
("301","Word choice and tone","Explain how a specific word or phrase shapes meaning or tone when the effect is simple."),
("302","Figurative and technical meaning","Interpret basic figurative language in a passage."),
("401","Word choice and tone","Analyze how word choice shapes meaning or tone in fairly demanding passages."),
("402","Figurative and technical meaning","Interpret most words and phrases, including technical, connotative and figurative meanings, in fairly demanding passages."),
("501","Word choice and tone","Analyze how word choice shapes meaning or tone when the effect is subtle."),
("502","Word choice and tone","Analyze how word choice shapes meaning or tone in more demanding passages."),
("503","Figurative and technical meaning","Interpret almost any word or phrase, including technical, connotative and figurative meanings, in fairly demanding passages."),
("504","Figurative and technical meaning","Interpret most words and phrases, including technical, connotative and figurative meanings, in more demanding passages."),
("601","Word choice and tone","Analyze how word choice shapes meaning or tone in complex passages."),
("602","Figurative and technical meaning","Interpret almost any word or phrase in more demanding passages, including technical, connotative and figurative uses."),
("603","Figurative and technical meaning","Interpret words in passages that consistently use figurative, academic, domain-specific or difficult language."),
("701","Word choice and tone","Analyze how word choice shapes meaning or tone when the effect is subtle or complex."),
("702","Figurative and technical meaning","Interpret words and phrases in complex passages, including technical, connotative and figurative meanings."),
("703","Figurative and technical meaning","Interpret words in passages that make extensive use of figurative, academic, domain-specific or difficult language.")]
for n,s,o in wme: a("WME "+n,s,o)
tst=[("201","Sentence and paragraph functions","Explain how sentences relate to the whole passage when their function is stated or obvious."),
("301","Sentence and paragraph functions","Explain how sentences relate to the whole passage when their function is simple."),
("302","Sentence and paragraph functions","Identify a clear function of straightforward paragraphs in fairly demanding stories."),
("401","Sentence and paragraph functions","Analyze how sentences relate to the whole in fairly demanding passages."),
("402","Sentence and paragraph functions","Infer the function of straightforward paragraphs in fairly demanding stories."),
("403","Sentence and paragraph functions","Identify a clear function of paragraphs in fairly demanding passages."),
("404","Overall structure","Analyze the overall structure of fairly demanding passages."),
("501","Sentence and paragraph functions","Analyze how sentences relate to the whole when the function is subtle."),
("502","Sentence and paragraph functions","Analyze how sentences relate to the whole in more demanding passages."),
("503","Sentence and paragraph functions","Infer the function of paragraphs in fairly demanding passages."),
("504","Sentence and paragraph functions","Identify a clear function of paragraphs in more demanding passages."),
("505","Overall structure","Analyze the overall structure of more demanding passages."),
("601","Sentence and paragraph functions","Analyze how sentences relate to the whole in complex passages."),
("602","Sentence and paragraph functions","Infer the function of paragraphs in more demanding passages."),
("603","Overall structure","Analyze the overall structure of complex passages."),
("701","Sentence and paragraph functions","Analyze how sentences relate to the whole when the function is subtle or complex."),
("702","Sentence and paragraph functions","Identify or infer the function of paragraphs in complex passages."),
("703","Overall structure","Analyze the overall structure of highly complex passages.")]
for n,s,o in tst: a("TST "+n,s,o)
ppv=[("201","Author's purpose and viewpoint","Recognize a clear intent of an author or narrator in fairly demanding stories."),
("301","Author's purpose and viewpoint","Recognize a clear intent of an author or narrator in fairly demanding passages."),
("401","Author's purpose and viewpoint","Identify a clear purpose of a fairly demanding passage and how it shapes content and style."),
("402","Point of view","Understand point of view in fairly demanding passages."),
("501","Author's purpose and viewpoint","Infer a purpose in fairly demanding passages and how it shapes content and style."),
("502","Author's purpose and viewpoint","Identify a clear purpose in more demanding passages and how it shapes content and style."),
("503","Point of view","Understand point of view in more demanding passages."),
("601","Author's purpose and viewpoint","Infer a purpose in more demanding passages and how it shapes content and style."),
("602","Point of view","Understand point of view in complex passages."),
("701","Author's purpose and viewpoint","Identify or infer a purpose in complex passages and how it shapes content and style."),
("702","Point of view","Understand point of view in highly complex passages.")]
for n,s,o in ppv: a("PPV "+n,s,o)
arg=[("201","Reasons and support for claims","Analyze how sentences give reasons for or support a claim when the link is clearly shown."),
("301","Reasons and support for claims","Analyze how sentences support a claim in fairly demanding passages when the link is simple."),
("401","Reasons and support for claims","Analyze how sentences give reasons for or support a claim in fairly demanding passages."),
("402","Central claim","Identify a clear central claim in fairly demanding passages."),
("501","Reasons and support for claims","Analyze how sentences give reasons for or support a claim in more demanding passages."),
("502","Central claim","Infer a central claim in fairly demanding passages."),
("503","Central claim","Identify a clear central claim in more demanding passages."),
("601","Reasons and support for claims","Analyze how sentences give reasons for or support a claim in complex passages."),
("602","Central claim","Infer a central claim in more demanding passages."),
("701","Reasons and support for claims","Analyze how sentences support a claim when the relationship is subtle or complex."),
("702","Central claim","Identify or infer a central claim in complex passages."),
("703","Central claim","Identify a clear central claim in highly complex passages.")]
for n,s,o in arg: a("ARG "+n,s,o)
syn=[("201","Comparing and combining two texts","Make simple comparisons between two passages."),
("301","Comparing and combining two texts","Make straightforward comparisons between two passages."),
("401","Comparing and combining two texts","Draw conclusions using information from two literary narratives."),
("501","Comparing and combining two texts","Draw conclusions using information from two informational texts."),
("601","Comparing and combining two texts","Draw conclusions using information from multiple parts of two literary narratives."),
("701","Comparing and combining two texts","Draw conclusions using information from multiple parts of two informational texts.")]
for n,s,o in syn: a("SYN "+n,s,o)
json.dump(R,open('/Users/hassanahmed/ai-tutor/frontend/web/data/curricula/rows/us-act-ccrs-reading.json','w'),indent=1)
print(len(R))
