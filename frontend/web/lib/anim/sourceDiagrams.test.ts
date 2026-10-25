import test from "node:test";
import assert from "node:assert/strict";
import { findPageImages, isPublicHttpUrl, matchDiagramsToBeats, sanitizeSourceDiagram, sourceDiagramBrief } from "../canvas/sourceDiagrams";
import type { CanvasPlanBeat, CanvasStage } from "../canvas/types";

// A page laid out like the omnisecu TCP page the TCP lecture cited (2026-10-24).
const PAGE = `<html><body>
<img src="/images/omnisecu-logo.png" alt="OmniSecu logo" width="200" height="60">
<h1>TCP three way handshake</h1>
<p>Before data is sent, TCP opens a connection.</p>
<figure><img data-src="/tcpip/images/tcp-three-way-handshake.jpg" alt="TCP three-way handshake diagram"><figcaption>SYN, SYN-ACK and ACK between client and server</figcaption></figure>
<img src="https://cdn.example.com/ads/banner-728.jpg" alt="Advertisement">
<img src="/images/twitter-icon.png" alt="share" width="24" height="24">
<img src="/images/tcp-header.svg" alt="TCP header">
<h2>TCP segment header</h2>
<img src="/tcpip/images/tcp-header-format.gif" alt="TCP segment header fields">
</body></html>`;

test("a page's diagrams are found by the topic's words; logos, adverts, icons and SVGs are left out", () => {
  const found = findPageImages(PAGE, "https://www.omnisecu.com/tcpip/tcp-three-way-handshake.php", "TCP three way handshake");
  assert.equal(found[0].src, "https://www.omnisecu.com/tcpip/images/tcp-three-way-handshake.jpg");
  assert.match(found[0].caption, /SYN, SYN-ACK and ACK/);
  assert.ok(!found.some((f) => /logo|banner|twitter|\.svg/.test(f.src)));
  assert.ok(found.some((f) => /tcp-header-format/.test(f.src)), "the header figure is a candidate too");
});

test("only public web pages are fetched", () => {
  assert.equal(isPublicHttpUrl("https://www.omnisecu.com/tcpip/x.php"), true);
  for (const bad of ["http://localhost:3000/x", "http://127.0.0.1/", "http://10.0.0.5/a", "http://192.168.1.1/", "http://169.254.169.254/latest", "file:///etc/passwd", "http://[::1]/"]) assert.equal(isPublicHttpUrl(bad), false, bad);
});

test("what the vision model read is kept only when it is a usable diagram, and only what it drew", () => {
  const page = { url: "https://www.omnisecu.com/tcpip/tcp-three-way-handshake.php", site: "omnisecu.com" };
  const tcp = sanitizeSourceDiagram({
    teaches: true, kind: "sequence", title: "TCP three-way handshake", lanes: ["Client", "Server"],
    messages: [{ from: "Client", to: "Server", label: "SYN", detail: "seq=x" }, { from: "Server", to: "Client", label: "SYN-ACK", detail: "seq=y, ack=x+1" }, { from: "Client", to: "Server", label: "ACK", detail: "ack=y+1" }, { from: "Client", to: "Nobody", label: "?" }],
    states: [{ lane: "Server", label: "LISTEN", after: 0 }],
  }, page)!;
  assert.equal(tcp.messages!.length, 3, "a message to a party not in the picture is dropped");
  assert.equal(sanitizeSourceDiagram({ teaches: false, kind: "sequence" }, page), null);
  assert.equal(sanitizeSourceDiagram({ teaches: true, kind: "photo" }, page), null);
  assert.equal(sanitizeSourceDiagram({ teaches: true, kind: "layers", layers: ["Application"] }, page), null, "one layer is not a stack");
  assert.match(sourceDiagramBrief(tcp), /"sequence" board[\s\S]*Client → Server: SYN \(seq=x\)/);
});

function beat(id: string, title: string, stage: CanvasStage, script: string): CanvasPlanBeat {
  return { id, title, script, stage, brief: title, objects: [], inside: null, carry: [], interaction: "quiz", overview: false };
}

test("each diagram goes to the board it fits, which is drawn as that diagram; the opening map and code keep theirs", () => {
  const beats = [
    beat("b1", "The questions", "flow", "We will ask how a client and server start a TCP connection with SYN and ACK."),
    beat("b2", "The three messages", "structure", "The client sends SYN to the server, the server answers SYN-ACK, and the client sends ACK."),
    beat("b3", "Connection states", "sketch", "The server waits in LISTEN until a SYN arrives; then SYN-RECEIVED and ESTABLISHED."),
    beat("b4", "Opening a socket in Python", "code", "We write the client in Python: connect sends SYN and waits for SYN-ACK."),
  ];
  const tcp = sanitizeSourceDiagram({ teaches: true, kind: "sequence", title: "TCP three-way handshake", lanes: ["Client", "Server"], messages: [{ from: "Client", to: "Server", label: "SYN" }, { from: "Server", to: "Client", label: "SYN-ACK" }, { from: "Client", to: "Server", label: "ACK" }] }, { url: "u", site: "omnisecu.com" })!;
  const states = sanitizeSourceDiagram({ teaches: true, kind: "state-machine", title: "TCP connection states", transitions: [{ from: "LISTEN", to: "SYN-RECEIVED", label: "SYN" }, { from: "SYN-RECEIVED", to: "ESTABLISHED", label: "ACK" }] }, { url: "u", site: "omnisecu.com" })!;
  const log = matchDiagramsToBeats(beats, [tcp, states]);
  assert.equal(beats[1].stage, "sequence");
  assert.equal(beats[1].sourceDiagram?.title, "TCP three-way handshake");
  assert.equal(beats[2].stage, "structure");
  assert.equal(beats[0].stage, "flow");
  assert.equal(beats[3].stage, "code");
  assert.equal(log.length, 2);
});

test("a page 'flow' of messages back and forth between parties is redrawn as a sequence; a sequence board is never made a flow", () => {
  const page = { url: "https://en.wikipedia.org/wiki/DNS", site: "Wikipedia" };
  const iterative = sanitizeSourceDiagram({ teaches: true, kind: "flow", title: "Iterative DNS resolution", boxes: ["Resolver", "Root", "TLD", "Authoritative"], arrows: [{ from: "Resolver", to: "Root", label: "query" }, { from: "Root", to: "Resolver", label: "referral" }, { from: "Resolver", to: "TLD", label: "query" }, { from: "TLD", to: "Resolver", label: "referral" }] }, page)!;
  const layered = sanitizeSourceDiagram({ teaches: true, kind: "flow", title: "DNS hierarchy", boxes: ["Root", "TLD", "Authoritative"], arrows: [{ from: "Root", to: "TLD" }, { from: "TLD", to: "Authoritative" }] }, page)!;
  const beats = [
    beat("b1", "Map", "flow", "We will see how a resolver finds an address."),
    beat("b2", "Iterative resolution", "sequence", "The resolver sends a query to the root, which returns a referral to the TLD. The resolver queries the TLD, which returns a referral."),
    beat("b3", "The DNS hierarchy", "sequence", "The root sits above the TLD servers, which sit above each authoritative server."),
  ];
  matchDiagramsToBeats(beats, [iterative, layered]);
  assert.equal(beats[1].stage, "sequence");
  assert.equal(beats[1].sourceDiagram?.kind, "sequence");
  assert.deepEqual(beats[1].sourceDiagram?.lanes, ["Resolver", "Root", "TLD"]);
  assert.equal(beats[2].stage, "sequence", "not downgraded to a flow");
  assert.equal(beats[2].sourceDiagram, undefined);
});

test("the research pack keeps the pages found but not cited, for their diagrams only", async () => {
  const { sanitizeSourcePack } = await import("../webSources");
  const pack = sanitizeSourcePack({ query: "q", checklist: ["x"], points: [{ text: "NoSQL stores documents.", sources: ["S1"] }], sources: [{ id: "S1", url: "https://www.ibm.com/think/topics/sql-vs-nosql", title: "IBM" }], pages: [{ url: "https://www.mongodb.com/resources/basics/databases/nosql-explained", title: "MongoDB" }, { url: "https://www.ibm.com/think/topics/sql-vs-nosql" }] })!;
  assert.equal(pack.sources.length, 1);
  assert.deepEqual(pack.pages?.map((p) => p.url), ["https://www.mongodb.com/resources/basics/databases/nosql-explained"], "a cited page is not repeated");
});

test("a board that redraws a page's diagram keeps its stage through every visual-policy rule (the TLS lecture's handshake boards)", async () => {
  const { applyLessonVisualPolicy } = await import("../canvas/visualPolicy");
  const tls = sanitizeSourceDiagram({ teaches: true, kind: "sequence", title: "the TLS Handshake", lanes: ["Client", "Server"], messages: [{ from: "Client", to: "Server", label: "ClientHello" }, { from: "Server", to: "Client", label: "ServerHello" }] }, { url: "https://www.cloudflare.com/learning/ssl/what-happens-in-a-tls-handshake/", site: "cloudflare.com" })!;
  const b2 = { ...beat("b2", "Server Certificate and Authentication", "sequence", "The server sends its certificate, a signed document. The client checks the signature against a trusted authority."), sourceDiagram: tls };
  const out = applyLessonVisualPolicy([beat("b1", "ClientHello and ServerHello", "flow", "The client sends ClientHello."), b2], { mode: "prompt", topic: "TLS handshake in HTTPS", domain: "cs" });
  assert.equal(out.beats[1].stage, "sequence");
});
