/**
 * A YouTube video as a lesson source: the link, the chapters, the adapter and the coverage gate.
 *
 * What these protect is the feature's one promise — the lecture is shorter than the video and
 * leaves nothing out. Each test below is a way that promise breaks without anything looking wrong:
 * a block the script writer silently truncates, a key point that is in no beat, two beats sharing
 * a title (the planner maps beats to blocks by title), a chapter list with a gap in it, or a script
 * that teaches four of seven points and passes every other gate.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { findYouTubeLink, formatTimestamp, parseTimestamp, parseYouTubeUrl } from "../youtube/videoUrl";
import {
  MAX_VIDEO_CONTEXT_CHARS,
  VIDEO_CHAT_RULES,
  isVideoTranscriptContext,
  videoTranscriptStretch,
  videoTranscriptFromDocument,
  buildLessonInputFromVideo,
  buildVideoTranscriptText,
  isVideoSource,
  planVideoWindows,
  windowsBetween,
  type VideoChapterNotes,
  type VideoWindow,
} from "../youtube/videoSource";
import { foldVisualSections, keepShownData, mergeGleaned, parseChapters, parseNotes } from "../youtube/videoNotes";
import { coverageRatio, uncoveredKeyPoints, videoKeyPoints } from "../youtube/videoCoverage";
import { buildDocumentContext, buildLessonContext } from "../lessonChatContext";
import { repeatsOpening } from "../beatPresentation";
import { isSuprnotesLessonInput } from "../suprnotes";
import { buildGeminiLiveInstructions } from "../geminiLiveContract";

const ID = "aircAruvnKk";

test("every shape of YouTube link resolves to the same video", () => {
  for (const link of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=120s&list=PLabc`,
    `https://youtu.be/${ID}?si=xyz`,
    `youtu.be/${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
  ]) {
    assert.deepEqual(parseYouTubeUrl(link), { videoId: ID, url: `https://www.youtube.com/watch?v=${ID}` }, link);
  }
});

test("things that are not a YouTube video are refused", () => {
  for (const link of ["", "photosynthesis", "https://vimeo.com/12345", "https://www.youtube.com/@3blue1brown", "https://www.youtube.com/watch?v=short", "https://evil.example/watch?v=aircAruvnKk"]) {
    assert.equal(parseYouTubeUrl(link), null, link);
  }
});

test("a link is found inside a typed brief, with the rest of what was typed", () => {
  const found = findYouTubeLink(`please teach me this https://youtu.be/${ID}, thanks`);
  assert.equal(found?.link.videoId, ID);
  assert.equal(found?.rest, "please teach me this thanks");
  assert.equal(findYouTubeLink("explain youtube's recommendation algorithm"), null);
});

test("timestamps round-trip, past the hour too", () => {
  assert.equal(formatTimestamp(760), "12:40");
  assert.equal(formatTimestamp(3725), "1:02:05");
  assert.equal(parseTimestamp("12:40"), 760);
  assert.equal(parseTimestamp("1:02:05"), 3725);
  // A model past the hour sometimes keeps counting minutes.
  assert.equal(parseTimestamp("75:20"), 4520);
  assert.equal(parseTimestamp("soon"), null);
});

test("the clips cover the whole video with no gap and no overlap", () => {
  const windows = planVideoWindows(1153);
  assert.deepEqual(windows, [{ startSec: 0, endSec: 600 }, { startSec: 600, endSec: 1153 }]);
  assert.deepEqual(planVideoWindows(600), [{ startSec: 0, endSec: 600 }]);
  assert.deepEqual(planVideoWindows(0), []);
});

test("chapters are made contiguous from 0 to the end, fragments joined, long ones split", () => {
  const { title, chapters } = parseChapters({
    title: "Neural networks",
    chapters: [
      { start: "0:20", title: "What a neuron is" },
      { start: "0:40", title: "A fragment" },
      { start: "5:00", title: "Layers" },
      { start: "35:00", title: "Why layers" },
      { start: "39:40", title: "Sign-off" },
    ],
  }, 2400);
  assert.equal(title, "Neural networks");
  assert.equal(chapters[0].startSec, 0, "the first chapter starts at the start of the video");
  assert.equal(chapters[chapters.length - 1].endSec, 2400, "the last chapter runs to the end");
  for (let i = 1; i < chapters.length; i++) assert.equal(chapters[i].startSec, chapters[i - 1].endSec, "no gap between chapters");
  assert.ok(!chapters.some((chapter) => chapter.title === "A fragment" || chapter.title === "Sign-off"));
  // 5:00-35:00 is thirty minutes: three chapters of ten, all still "Layers".
  assert.equal(chapters.filter((chapter) => chapter.title === "Layers").length, 3);
  assert.ok(chapters.every((chapter) => chapter.endSec - chapter.startSec <= 12 * 60));
});

test("a transcript the model could not divide still becomes chapters", () => {
  const { chapters } = parseChapters({ nonsense: true }, 1500);
  assert.equal(chapters[0].startSec, 0);
  assert.equal(chapters[chapters.length - 1].endSec, 1500);
  assert.ok(chapters.length >= 3);
});

const chapter = { title: "What a neuron is", startSec: 0, endSec: 300 };

test("the second look adds only what is missing, under the heading it names, in time order", () => {
  const notes = parseNotes({
    sections: [{ heading: "Neurons", points: [{ t: "0:10", text: "A neuron holds a number between 0 and 1." }, { t: "2:00", text: "That number is called its activation." }] }],
    leftOut: ["sponsor read"],
  }, chapter);
  const merged = mergeGleaned(notes, {
    missing: [
      { heading: "Neurons", t: "1:00", text: "The network has 784 input neurons, one per pixel." },
      { heading: "Neurons", t: "0:10", text: "A neuron holds a number between 0 and 1." },
      { heading: "Layers", t: "4:00", text: "The last layer has 10 neurons, one per digit." },
    ],
  });
  assert.equal(merged.added, 2, "a point the notes already hold is not added again");
  assert.deepEqual(merged.notes.sections[0].points.map((point) => point.startSec), [10, 60, 120]);
  assert.equal(merged.notes.sections[1].heading, "Layers");
  assert.deepEqual(merged.notes.leftOut, ["sponsor read"]);
});

test("a point about the video itself is not a key point; a point that only mentions video is", () => {
  const notes = parseNotes({
    sections: [{
      heading: "Neurons",
      points: [
        { t: "0:10", text: "The video aims to explain neural networks as mathematical structures, not buzzwords." },
        { t: "0:20", text: "A neuron holds a number between 0 and 1." },
        { t: "0:30", text: "How the network learns is covered in the next video." },
        { t: "0:40", text: "H.264 compresses a video stream by encoding only the difference between frames." },
        { t: "0:50", text: "The speaker cone of a loudspeaker moves air to make sound." },
      ],
    }],
  }, chapter);
  assert.deepEqual(notes.sections[0].points.map((point) => point.text), [
    "A neuron holds a number between 0 and 1.",
    "H.264 compresses a video stream by encoding only the difference between frames.",
    "The speaker cone of a loudspeaker moves air to make sound.",
  ]);
});

const sentence = (n: number) => `Point number ${n} states that quantity ${n} depends on factor ${n} in a fixed proportion.`;
const notesFor = (title: string, startSec: number, sections: Array<{ heading: string; count: number; from: number }>): VideoChapterNotes => ({
  chapter: { title, startSec, endSec: startSec + 300 },
  sections: sections.map((section) => ({
    heading: section.heading,
    points: Array.from({ length: section.count }, (_, i) => ({ text: sentence(section.from + i), startSec: startSec + i * 10 })),
  })),
  leftOut: startSec === 0 ? ["sponsor read"] : [],
});

const WINDOWS: VideoWindow[] = [
  { startSec: 0, endSec: 600, segments: [{ startSec: 4, text: "This is a three." }, { startSec: 700, text: "Out of order on purpose." }], onScreen: [{ startSec: 4, kind: "diagram", content: "A 28 by 28 pixel digit." }] },
  { startSec: 600, endSec: 1153, segments: [{ startSec: 640, text: "Each neuron holds a number." }], onScreen: [] },
];

test("the adapter keeps every key point, in exactly one beat, in blocks the script writer will not truncate", () => {
  const chapters = [
    notesFor("Neurons", 0, [{ heading: "What a neuron holds", count: 4, from: 1 }, { heading: "Activations", count: 3, from: 5 }]),
    // Forty points is far more than one board: it must become several, not one that rushes.
    notesFor("Layers", 300, [{ heading: "Layers", count: 40, from: 100 }]),
  ];
  const built = buildLessonInputFromVideo({ videoId: ID, url: `https://www.youtube.com/watch?v=${ID}`, title: "Neural networks", durationSec: 1153, chapters, windows: WINDOWS });
  const blocks = built.document.contentBlocks ?? [];
  const plan = built.document.lessonPlan as { beats: Array<{ title: string; sourceBlockIds: string[]; visualMode: string }>; contentBlockIds: string[] };

  assert.ok(isSuprnotesLessonInput(built.document));
  assert.ok(isVideoSource(built.document));
  assert.equal(built.pointCount, 47);

  // compactBeatSource cuts a non-PDF block's text at 1,400 characters.
  assert.ok(blocks.every((block) => (block.text ?? "").length <= 1400), "no block is long enough to be truncated");
  const taught = blocks.map((block) => block.text).join(" ");
  for (const n of [1, 4, 5, 7, 100, 120, 139]) assert.ok(taught.includes(sentence(n)), `point ${n} is in a block`);

  const used = plan.beats.flatMap((beat) => beat.sourceBlockIds);
  assert.deepEqual([...used].sort(), blocks.map((block) => block.id).sort(), "every block is in a beat");
  assert.equal(new Set(used).size, used.length, "no block is in two beats");
  assert.deepEqual(plan.contentBlockIds, blocks.map((block) => block.id));

  const titles = plan.beats.map((beat) => beat.title.toLowerCase());
  assert.equal(new Set(titles).size, titles.length, "beat titles are unique: the planner maps beats to blocks by title");
  assert.equal(plan.beats[0].title, "Neurons", "a chapter that fits one board is named for the chapter");
  assert.ok(plan.beats.length >= 4, "a forty-point chapter is several boards");
  assert.ok(plan.beats.every((beat) => beat.visualMode === "react-animation"), "every board is drawn by the animation engine");

  // No images anywhere: nothing for a page-image or figure-crop path to pick up.
  assert.deepEqual(built.document.assets, []);
  assert.ok(blocks.every((block) => block.pageNumber === undefined && block.assetIds === undefined));
  assert.deepEqual((built.document.source as { leftOut: string[] }).leftOut, ["0:00 sponsor read"]);
});

test("the transcript for the chat is in time order, labelled, and includes what was on screen", () => {
  const text = buildVideoTranscriptText("Neural networks", WINDOWS);
  const lines = text.split("\n");
  assert.match(lines[0], /Transcript of the video "Neural networks"/);
  assert.deepEqual(lines.slice(1), [
    "[0:04] (on screen, diagram) A 28 by 28 pixel digit.",
    "[0:04] This is a three.",
    "[10:40] Each neuron holds a number.",
    "[11:40] Out of order on purpose.",
  ]);
  assert.deepEqual(windowsBetween(WINDOWS, 600, 700).segments.map((segment) => segment.startSec), [640]);
});

test("the chat is given a video's whole transcript, where a document is still cut at 30,000 characters", () => {
  const long = Array.from({ length: 4000 }, (_, i) => `[${formatTimestamp(i * 3)}] line ${i} of the lecture transcript goes here`).join("\n");
  assert.ok(long.length > 150_000);
  const video = { source: { adapter: "youtube-video" }, contentBlocks: [{ id: "v1-s1-b1", text: "A key point." }] };
  const pdf = { source: { adapter: "pdf-upload" }, contentBlocks: [{ id: "p1-b1", text: "A paragraph." }] };

  const forVideo = buildDocumentContext(video, "", "", long);
  assert.ok(forVideo.includes("line 3999 of the lecture"), "the end of the video is in the chat's context");
  assert.ok(forVideo.length <= MAX_VIDEO_CONTEXT_CHARS);

  const forPdf = buildDocumentContext(pdf, "", "", long);
  assert.equal(forPdf.length, 30_000, "a document's cap is unchanged");
});

test("a script that skips key points is caught; one that paraphrases them is not", () => {
  const blocks = [
    { id: "a", text: "A neuron holds a number between 0 and 1, called its activation. The network has 784 input neurons, one for each pixel of the image." },
    { id: "b", text: "The last layer has 10 neurons, one for each digit." },
    { id: "other", text: "Gradient descent lowers the cost." },
  ];
  const points = videoKeyPoints(blocks, ["a", "b"]);
  assert.equal(points.length, 3, "only this beat's blocks, one point per sentence");

  const full = "Think of each neuron as storing a number from 0 to 1. We call that number the activation of the neuron. The input layer has 784 neurons because the image has 784 pixels, one neuron per pixel. At the far end, the last layer has just 10 neurons, and each one stands for a digit.";
  assert.deepEqual(uncoveredKeyPoints(full, points), []);
  assert.equal(coverageRatio(full, points), 1);

  const partial = "Think of each neuron as storing a number from 0 to 1. We call that number the activation of the neuron.";
  const missed = uncoveredKeyPoints(partial, points);
  assert.equal(missed.length, 2);
  assert.match(missed[0], /784 input neurons/);
  assert.match(missed[1], /10 neurons/);
});

test("the voice tutor is given a video's transcript under video rules, and a document under document rules", () => {
  const transcript = buildVideoTranscriptText("Neural networks", WINDOWS);
  const base = { topic: "Neural networks", beatContext: "", lessonContext: "", lessonQuestion: "", mood: "", adhdMode: false, checkinMode: false, examQuestions: [] };

  const forVideo = buildGeminiLiveInstructions({ ...base, documentContext: transcript });
  assert.ok(forVideo.includes(VIDEO_CHAT_RULES));
  assert.ok(forVideo.includes("[10:40] Each neuron holds a number."), "the transcript itself is in the instruction");
  assert.ok(!forVideo.includes("uploaded document"), "a video is never called an uploaded document");

  const forPdf = buildGeminiLiveInstructions({ ...base, documentContext: "[page 1] Photosynthesis makes glucose." });
  assert.ok(forPdf.includes("The student's own uploaded document."), "a document's wording is unchanged");
  assert.ok(!forPdf.includes(VIDEO_CHAT_RULES));
  assert.equal(isVideoTranscriptContext("[page 1] A paragraph about a video codec."), false);
});

test("a video board is checked against its own stretch of the video, not the whole video", () => {
  const chapters = [
    notesFor("Neurons", 0, [{ heading: "What a neuron holds", count: 3, from: 1 }]),
    notesFor("Layers", 600, [{ heading: "Layers", count: 3, from: 50 }]),
  ];
  const built = buildLessonInputFromVideo({ videoId: ID, url: `https://www.youtube.com/watch?v=${ID}`, title: "Neural networks", durationSec: 1153, chapters, windows: WINDOWS });
  const plan = built.document.lessonPlan as { beats: Array<{ sourceBlockIds: string[] }> };
  const first = videoTranscriptStretch(built.document, plan.beats[0].sourceBlockIds);
  const second = videoTranscriptStretch(built.document, plan.beats[1].sourceBlockIds);
  assert.match(first, /\(on screen, diagram\) A 28 by 28 pixel digit\. This is a three\./, "what was shown, then what was said at the same moment");
  assert.ok(!first.includes("Each neuron holds a number"), "the first board's stretch stops where its chapter ends");
  assert.match(second, /Each neuron holds a number/);
  assert.equal(videoTranscriptStretch({ source: { adapter: "pdf-upload" }, contentBlocks: [{ id: "p1" }] }, ["p1"]), "");
});

test("a saved video lecture rebuilds exactly the transcript the live chat had", () => {
  const built = buildLessonInputFromVideo({ videoId: ID, url: `https://www.youtube.com/watch?v=${ID}`, title: "Neural networks", durationSec: 1153, chapters: [notesFor("Neurons", 0, [{ heading: "What a neuron holds", count: 3, from: 1 }])], windows: WINDOWS });
  const saved = JSON.parse(JSON.stringify(built.document));
  assert.equal(videoTranscriptFromDocument(saved), built.fullDocumentText);
  assert.equal(videoTranscriptFromDocument({ source: { adapter: "youtube-video" } }), "", "a source saved before the transcript was kept rebuilds nothing");
});

test("a video lesson's chat is given the whole short lecture, slides to come included", () => {
  const chapters = [
    notesFor("Neurons", 0, [{ heading: "What a neuron holds", count: 3, from: 1 }]),
    notesFor("Layers", 300, [{ heading: "Layers", count: 3, from: 50 }]),
    notesFor("Learning", 600, [{ heading: "Learning", count: 3, from: 90 }]),
  ];
  const built = buildLessonInputFromVideo({ videoId: ID, url: `https://www.youtube.com/watch?v=${ID}`, title: "Neural networks", durationSec: 1153, chapters, windows: WINDOWS });
  const written = [
    { id: "b1", title: "Neurons", script: "A neuron holds a number between zero and one, called its activation." },
    { id: "b2", title: "Layers", script: "Neurons are arranged in layers." },
  ] as unknown as Parameters<typeof buildLessonContext>[0];
  const context = buildLessonContext(written, 1, [], built.document);
  assert.ok(context.startsWith("THE SHORT LECTURE."));
  assert.match(context, /Slide 1: Neurons \(already taught\)\n {3}Said: A neuron holds a number between zero and one/);
  assert.match(context, /Slide 2: Layers ← PLAYING NOW/);
  assert.match(context, /Slide 3 \(the LAST slide\): Learning \(still to come\)\n {3}Will teach: Point number 90/, "the final slide's content is there before it is written");
  // A document lesson's outline is unchanged.
  assert.ok(!buildLessonContext(written, 1, []).startsWith("THE SHORT LECTURE."));
});

test("a title-card line that repeats the first sentence is recognised; a lead-in is not", () => {
  const script = "Humans recognize digits by piecing together components, such as loops and lines. Each loop is made of edges.";
  assert.equal(repeatsOpening("Humans recognize digits by piecing together components, like loops and lines.", script), true);
  assert.equal(repeatsOpening("Next, how the network finds those pieces.", script), false);
});

// The BST video (sXABdGalFNg), 7:41-11:22: the notes kept the rule and lost the traced example.
const inorderChapter = { title: "Inorder Traversal", startSec: 461, endSec: 682 };
const rulesOnly: VideoChapterNotes = {
  chapter: inorderChapter,
  sections: [
    { heading: "Inorder Traversal", points: [{ text: "Inorder traversal of a binary search tree always results in a sorted array.", startSec: 461 }, { text: "Write a node when you reach it for the second time.", startSec: 510 }] },
    { heading: "Height and Search", points: [{ text: "For seven elements the height is floor(log 7) = 2.", startSec: 644 }] },
  ],
  leftOut: [],
};
const bstScreen = [
  { startSec: 462, kind: "text", content: "Inorder" },
  { startSec: 485, kind: "diagram", content: "Two dummy child links added under each leaf node (1, 3, 5, 7) to trace tree traversal." },
  { startSec: 523, kind: "text", content: "1 2 3 4 5 6 7" },
  { startSec: 644, kind: "equation", content: "$\\lfloor \\log 7 \\rfloor = 2$" },
];

test("what the video showed with data in it is put back when the notes dropped it", () => {
  const { notes, added } = keepShownData(rulesOnly, bstScreen);
  assert.equal(added, 2, "the dummy-links diagram and the traced result; not the bare title, not the equation already said");
  const inorder = notes.sections[0].points.map((p) => p.text);
  assert.ok(inorder.includes("Two dummy child links added under each leaf node (1, 3, 5, 7) to trace tree traversal."));
  assert.ok(inorder.includes("Inorder Traversal: 1 2 3 4 5 6 7"), "a bare line of text is named by its topic");
  assert.deepEqual(notes.sections[0].points.map((p) => p.startSec), [461, 485, 510, 523], "each at its own moment, in time order");
  assert.equal(notes.sections[1].points.length, 1, "the equation's numbers are already in the notes");
});

test("nothing is added when the notes already carry what was shown", () => {
  const complete: VideoChapterNotes = {
    ...rulesOnly,
    sections: [{ heading: "Inorder Traversal", points: [{ text: "Example: dummy children under the leaves 1, 3, 5, 7; writing each node on its second visit gives 1, 2, 3, 4, 5, 6, 7.", startSec: 480 }, { text: "Height is floor(log 7) = 2.", startSec: 644 }] }],
  };
  const { notes, added } = keepShownData(complete, bstScreen);
  assert.equal(added, 0);
  assert.strictEqual(notes.sections, complete.sections, "untouched notes are returned as they were");
  // An equation's single number counts; an item outside the chapter does not.
  assert.equal(keepShownData(complete, [{ startSec: 600, kind: "equation", content: "$h = 9$" }]).added, 1);
  assert.equal(keepShownData(complete, [{ startSec: 900, kind: "diagram", content: "Nodes 8 and 9." }]).added, 0);
});

test("numbers said in another context do not count: the traced result is still put back", () => {
  // Run 2 on 2026-10-10: the construction steps name every key 1-7, so a check on the SET of numbers
  // took "1 2 3 4 5 6 7" as said. The ORDER is what makes it the traversal's result.
  const construction: VideoChapterNotes = {
    ...rulesOnly,
    sections: [{ heading: "Constructing a Binary Search Tree", points: [{ text: "Insert the keys 4, 2, 3, 6, 5, 7, 1 in turn; 1 is the leftmost and 7 the rightmost.", startSec: 470 }, { text: "Inorder traversal gives a sorted array.", startSec: 500 }] }],
  };
  const { notes, added } = keepShownData(construction, bstScreen);
  const texts = notes.sections[0].points.map((p) => p.text);
  assert.ok(texts.includes("Constructing a Binary Search Tree: 1 2 3 4 5 6 7"));
  assert.ok(texts.some((t) => t.startsWith("Two dummy child links added under each leaf node (1, 3, 5, 7)")), "1, 3, 5, 7 in that order is not in the notes either");
  assert.equal(added, 3, "the dummy links, the result, and the floor(log 7) = 2 equation none of these points states");
});

test("at most six on-screen items are put back into one chapter", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ startSec: 470 + i, kind: "diagram", content: `Tree with nodes ${100 + i} and ${200 + i}.` }));
  assert.equal(keepShownData(rulesOnly, many).added, 6);
});

test("an 'Examples and Diagrams' section is folded into the topics nearest in time", () => {
  const withVisuals: VideoChapterNotes = {
    chapter: { title: "BST", startSec: 0, endSec: 461 },
    sections: [
      { heading: "Binary Search Tree Properties", points: [{ text: "Left is smaller, right is larger.", startSec: 150 }] },
      { heading: "Examples and Diagrams", points: [{ text: "Max heap: root 10 with children 8 and 7.", startSec: 230 }, { text: "Keys 4, 2, 3, 6, 5, 7, 1.", startSec: 360 }] },
      { heading: "Constructing a BST", points: [{ text: "Start with 4 as the root.", startSec: 343 }] },
    ],
    leftOut: [],
  };
  const folded = foldVisualSections(withVisuals);
  assert.deepEqual(folded.sections.map((s) => s.heading), ["Binary Search Tree Properties", "Constructing a BST"]);
  assert.deepEqual(folded.sections[0].points.map((p) => p.startSec), [150, 230]);
  assert.deepEqual(folded.sections[1].points.map((p) => p.startSec), [343, 360]);

  const onlyVisuals: VideoChapterNotes = { ...withVisuals, sections: [withVisuals.sections[1]] };
  assert.strictEqual(foldVisualSections(onlyVisuals), onlyVisuals, "with no topic to fold into, nothing moves");
});
