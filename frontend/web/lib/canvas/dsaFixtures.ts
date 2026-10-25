/**
 * Hand-written DSA boards, as the board model would write them — for looking at the structure boards
 * in the canvas lab without generating a lecture (`/canvas-lab?scrub=1&fixture=dsa`, development
 * only), and for the tests (lib/anim/dsaBoards.test.ts), which check every one validates and runs.
 */
export const DSA_FIXTURES: Array<{ id: string; script: string; raw: Record<string, unknown> }> = [
  {
    id: "b1",
    script:
      "Here is our binary search tree, with three at the root. " +
      "To delete two, we start at the root and compare: two is smaller than three, so we go left. " +
      "Now we have found two, and it has exactly one child, the node one. " +
      "So three's left link skips over two and points straight at one, and two is gone. " +
      "The tree is still in order: one, three, four, five, six.",
    raw: {
      heading: "Delete a node with one child",
      notes: [],
      stage: {
        kind: "code",
        language: "pseudocode",
        reveal: "all",
        lines: [
          "function delete(root, key)",
          "  if root = null: return null",
          "  if key < root.value",
          "    root.left ← delete(root.left, key)",
          "  else if key > root.value",
          "    root.right ← delete(root.right, key)",
          "  else if root has one child",
          "    return that child",
          "  return root",
        ],
        structure: {
          kind: "tree",
          variant: "bst",
          nodes: [{ id: "n3", value: 3 }, { id: "n2", value: 2 }, { id: "n5", value: 5 }, { id: "n1", value: 1 }, { id: "n4", value: 4 }, { id: "n6", value: 6 }],
          edges: [{ from: "n3", to: "n2", side: "left" }, { from: "n3", to: "n5", side: "right" }, { from: "n2", to: "n1", side: "left" }, { from: "n5", to: "n4", side: "left" }, { from: "n5", to: "n6", side: "right" }],
          pointers: [{ name: "root", to: "n3" }],
        },
        steps: [
          { s: 0, lines: [1] },
          { s: 1, lines: [3, 4], note: "2 < 3: go left", ops: [{ op: "mark", id: "n3", as: "compare" }, { op: "point", name: "curr", to: "n2" }] },
          { s: 2, lines: [7, 8], note: "one child", ops: [{ op: "mark", id: "n2", as: "remove" }] },
          { s: 3, lines: [4], note: "3.left ← 1", ops: [{ op: "link", from: "n3", to: "n1", side: "left" }, { op: "remove", id: "n2" }] },
          { s: 4, lines: [9], ops: [{ op: "mark", id: "n1", as: "done" }, { op: "mark", id: "n3", as: "done" }, { op: "mark", id: "n4", as: "done" }, { op: "mark", id: "n5", as: "done" }, { op: "mark", id: "n6", as: "done" }] },
        ],
      },
      cues: [{ s: 1, action: "point", target: "ds-n3" }, { s: 2, action: "circle", target: "ds-n2" }, { s: 3, action: "point", target: "line-4" }],
    },
  },
  {
    id: "b2",
    script:
      "A linked list is a chain of boxes, each pointing to the next. " +
      "To reverse it, we walk along with curr, starting at the head. " +
      "First, one's link is cut, because one will be the new end. " +
      "Then two turns round to point back at one. " +
      "Finally three points back at two, and three becomes the new head.",
    raw: {
      heading: "Reversing a linked list",
      notes: [],
      stage: {
        kind: "code",
        language: "pseudocode",
        lines: ["prev ← null", "curr ← head", "while curr ≠ null", "  next ← curr.next", "  curr.next ← prev", "  prev ← curr", "  curr ← next", "head ← prev"],
        structure: { kind: "list", nodes: [{ id: "a", value: 1 }, { id: "b", value: 2 }, { id: "c", value: 3 }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }], pointers: [{ name: "head", to: "a" }] },
        steps: [
          { s: 0, lines: [1] },
          { s: 1, lines: [2], ops: [{ op: "point", name: "curr", to: "a" }] },
          { s: 2, lines: [4, 5], ops: [{ op: "unlink", from: "a", to: "b" }, { op: "point", name: "prev", to: "a" }, { op: "point", name: "curr", to: "b" }] },
          { s: 3, lines: [5, 6, 7], ops: [{ op: "link", from: "b", to: "a" }, { op: "point", name: "prev", to: "b" }, { op: "point", name: "curr", to: "c" }] },
          { s: 4, lines: [5, 8], ops: [{ op: "link", from: "c", to: "b" }, { op: "point", name: "curr", to: null }, { op: "point", name: "prev", to: null }, { op: "point", name: "head", to: "c" }] },
        ],
      },
      cues: [{ s: 3, action: "point", target: "ds-b" }],
    },
  },
  {
    id: "b3",
    script:
      "Breadth-first search explores a graph level by level, starting from A. " +
      "First A's neighbours, B and C, are visited. " +
      "Then the next level: D from B, and E from C. " +
      "Last of all F, the farthest from A.",
    raw: {
      heading: "Breadth-first search",
      notes: [{ text: "queue: visit by level", s: 0 }],
      stage: {
        kind: "structure",
        structure: { kind: "graph", nodes: ["A", "B", "C", "D", "E", "F"], edges: [{ from: "A", to: "B" }, { from: "A", to: "C" }, { from: "B", to: "D" }, { from: "C", to: "E" }, { from: "E", to: "F" }] },
        steps: [
          // The queue and the visited set drawn beside the graph (CS round, 2026-10-22).
          { s: 0, ops: [{ op: "mark", id: "a", as: "found" }], note: "start at A", state: { queue: "[A]", visited: "{A}" } },
          { s: 1, ops: [{ op: "mark", id: "b", as: "visit" }, { op: "mark", id: "c", as: "visit" }], note: "level 1: B, C", state: { queue: "[B, C]", visited: "{A, B, C}" } },
          { s: 2, ops: [{ op: "mark", id: "d", as: "visit" }, { op: "mark", id: "e", as: "visit" }], note: "level 2: D, E", state: { queue: "[D, E]", visited: "{A, B, C, D, E}" } },
          { s: 3, ops: [{ op: "mark", id: "f", as: "visit" }], note: "level 3: F", state: { queue: "[]", visited: "{A, B, C, D, E, F}" } },
        ],
      },
      cues: [{ s: 0, action: "circle", target: "ds-a" }],
    },
  },
];

/** Message sequences (lib/canvas/sequence.ts), and the two-machine graph whose messages now bend apart. */
export const SEQUENCE_FIXTURES: Array<{ id: string; script: string; raw: Record<string, unknown> }> = [
  {
    id: "tcp-handshake",
    script: "The server starts in LISTEN, waiting for a request. The client sends SYN with sequence number 1000 and moves to SYN-SENT. The server replies with SYN-ACK, carrying its own number 2000 and acknowledging 1001. The client sends ACK with 2001, and both sides are ESTABLISHED.",
    raw: {
      heading: "TCP three-way handshake",
      notes: [{ id: "n1", text: "SYN = synchronise", s: 1 }, { id: "n2", text: "ACK = 1000 + 1 = 1001", s: 2 }, { id: "n3", text: "Three messages open a connection", s: 3 }],
      cues: [],
      stage: {
        kind: "sequence",
        lanes: [{ id: "client", label: "Client" }, { id: "server", label: "Server" }],
        messages: [
          { id: "syn", from: "client", to: "server", label: "SYN", detail: "seq=1000", s: 1 },
          { id: "synack", from: "server", to: "client", label: "SYN-ACK", detail: "seq=2000, ack=1001", s: 2 },
          { id: "ack", from: "client", to: "server", label: "ACK", detail: "ack=2001", s: 3 },
        ],
        states: [
          { lane: "server", label: "LISTEN", at: -1, s: 0 },
          { lane: "client", label: "SYN-SENT", at: 0, s: 1 },
          { lane: "server", label: "SYN-RECEIVED", at: 1, s: 2 },
          { lane: "client", label: "ESTABLISHED", at: 2, s: 3 },
          { lane: "server", label: "ESTABLISHED", at: 2, s: 3 },
        ],
      },
    },
  },
  {
    id: "dns-lookup",
    script: "The browser asks the resolver for example.com. The resolver asks a root server. The root refers it to the .com server. The resolver asks the .com server. It refers it to example.com's own server. The resolver returns the address to the browser.",
    raw: {
      heading: "How DNS resolution works",
      notes: [],
      cues: [],
      stage: {
        kind: "sequence",
        lanes: [{ id: "browser", label: "Browser" }, { id: "resolver", label: "Resolver" }, { id: "root", label: "Root server" }, { id: "tld", label: ".com server" }],
        messages: [
          { id: "q1", from: "browser", to: "resolver", label: "query", detail: "example.com A?", s: 0 },
          { id: "q2", from: "resolver", to: "root", label: "query", detail: "example.com A?", s: 1 },
          { id: "r1", from: "root", to: "resolver", label: "referral", detail: "ask .com", s: 2 },
          { id: "q3", from: "resolver", to: "tld", label: "query", detail: "example.com A?", s: 3 },
          { id: "r2", from: "tld", to: "resolver", label: "referral", detail: "ask ns1.example", s: 4 },
          { id: "a1", from: "resolver", to: "browser", label: "answer", detail: "93.184.216.34", s: 5 },
        ],
      },
    },
  },
  {
    id: "two-machine-graph",
    script: "The phone and the server start apart. The phone sends SYN. The server answers SYN-ACK. The phone sends ACK.",
    raw: {
      heading: "Messages between two machines",
      notes: [],
      cues: [],
      stage: {
        kind: "structure",
        structure: { kind: "graph", variant: "directed", nodes: [{ id: "phone", value: "Phone" }, { id: "server", value: "Server" }], edges: [] },
        steps: [
          { s: 0 },
          { s: 1, ops: [{ op: "link", from: "phone", to: "server", label: "SYN" }] },
          { s: 2, ops: [{ op: "link", from: "server", to: "phone", label: "SYN-ACK" }] },
          { s: 3, ops: [{ op: "link", from: "phone", to: "server", label: "ACK" }] },
        ],
      },
    },
  },
];

/** Operating-systems pictures (lib/canvas/osDiagrams.ts): a lifecycle, an address space, threads, a schedule, a race. */
export const OS_FIXTURES: Array<{ id: string; script: string; raw: Record<string, unknown> }> = [
  {
    id: "process-states",
    script: "A new process P1 is created in the New state. The OS admits it, so P1 moves to Ready. The scheduler dispatches it, and P1 is Running on the CPU. P1 asks for the disk, so it moves to Waiting. When the I/O completes, P1 goes back to Ready. Finally it runs again and exits to Terminated.",
    raw: {
      heading: "The process lifecycle",
      notes: [{ id: "n1", text: "New → Ready: admitted", s: 1 }, { id: "n2", text: "Running → Waiting: I/O", s: 3 }, { id: "n3", text: "Only one process runs per CPU", s: 2 }],
      cues: [],
      stage: {
        kind: "states",
        states: [
          { id: "new", label: "New", col: 0, row: 0, s: 0 },
          { id: "ready", label: "Ready", col: 1, row: 1, s: 1 },
          { id: "running", label: "Running", col: 3, row: 1, s: 2 },
          { id: "waiting", label: "Waiting", col: 2, row: 2, s: 3 },
          { id: "terminated", label: "Terminated", col: 3, row: 0, s: 5 },
        ],
        transitions: [
          { from: "new", to: "ready", label: "admitted", s: 1 },
          { from: "ready", to: "running", label: "scheduler dispatch", s: 2 },
          { from: "running", to: "ready", label: "interrupt", s: 2 },
          { from: "running", to: "waiting", label: "I/O or event wait", s: 3 },
          { from: "waiting", to: "ready", label: "I/O done", s: 4 },
          { from: "running", to: "terminated", label: "exit", s: 5 },
        ],
        tokens: [{ label: "P1", path: [{ state: "new", s: 0 }, { state: "ready", s: 1 }, { state: "running", s: 2 }, { state: "waiting", s: 3 }, { state: "ready", s: 4 }, { state: "running", s: 5 }, { state: "terminated", s: 5 }] }],
      },
    },
  },
  {
    id: "address-space",
    script: "Every process gets its own address space. At the top is the stack, holding local variables and function calls, and it grows down. The heap holds memory the program asks for at run time, and it grows up. Below it, the data segment holds global variables, and the text segment holds the program's code.",
    raw: {
      heading: "A process in memory",
      notes: [{ id: "n1", text: "Stack grows down", s: 1 }, { id: "n2", text: "Heap grows up", s: 2 }, { id: "n3", text: "Text = the program's code", s: 3 }],
      cues: [],
      stage: {
        kind: "memory",
        columns: [{ id: "process", segments: [
          { id: "stack", label: "Stack", note: "local variables", s: 1 },
          { id: "free", label: "", free: true, size: 2, s: 1 },
          { id: "heap", label: "Heap", note: "run-time memory", s: 2 },
          { id: "data", label: "Data", note: "global variables", s: 3 },
          { id: "text", label: "Text", note: "program code", s: 3 },
        ] }],
        growth: [{ segment: "stack", dir: "down", label: "grows", s: 1 }, { segment: "heap", dir: "up", label: "grows", s: 2 }],
        addresses: { top: "high address", bottom: "low address" },
      },
    },
  },
  {
    id: "threads-share",
    script: "A browser process runs three threads. All of them share the process's code, its data and its open files. But each thread keeps its own registers, including its program counter. And each thread has its own stack, so their function calls never mix.",
    raw: {
      heading: "What threads share",
      notes: [{ id: "n1", text: "Shared: code, data, files", s: 1 }, { id: "n2", text: "Private: registers, stack", s: 2 }],
      cues: [],
      stage: {
        kind: "memory",
        shared: [{ id: "code", label: "Code", s: 1 }, { id: "data", label: "Data", s: 1 }, { id: "files", label: "Files", s: 1 }],
        sharedLabel: "Shared by every thread",
        columns: [
          { id: "t1", label: "Thread 1", segments: [{ id: "reg1", label: "Registers", s: 2 }, { id: "stack1", label: "Stack", size: 2, s: 3 }] },
          { id: "t2", label: "Thread 2", segments: [{ id: "reg2", label: "Registers", s: 2 }, { id: "stack2", label: "Stack", size: 2, s: 3 }] },
          { id: "t3", label: "Thread 3", segments: [{ id: "reg3", label: "Registers", s: 2 }, { id: "stack3", label: "Stack", size: 2, s: 3 }] },
        ],
      },
    },
  },
  {
    id: "round-robin",
    script: "Three processes arrive: P1 at time 0, P2 at 1 and P3 at 2, with a quantum of 2 milliseconds. P1 runs first, from 0 to 2. Its quantum ends, so P2 runs from 2 to 4. Then P3 runs from 4 to 6. P1 comes back for its last unit, from 6 to 7. P2 finishes from 7 to 8.",
    raw: {
      heading: "Round robin, quantum = 2 ms",
      notes: [{ id: "n1", text: "Quantum = 2 ms", s: 0 }, { id: "n2", text: "P1 waits 4 ms", s: 3 }],
      cues: [],
      stage: {
        kind: "gantt",
        unit: "ms",
        slots: [
          { label: "P1", start: 0, end: 2, s: 1 },
          { label: "P2", start: 2, end: 4, s: 2 },
          { label: "P3", start: 4, end: 6, s: 3 },
          { label: "P1", start: 6, end: 7, s: 4 },
          { label: "P2", start: 7, end: 8, s: 5 },
        ],
        arrivals: [{ label: "P1", at: 0, s: 0 }, { label: "P2", at: 1, s: 0 }, { label: "P3", at: 2, s: 0 }],
        queue: [{ s: 1, items: ["P2", "P3"] }, { s: 2, items: ["P3", "P1"] }, { s: 3, items: ["P1", "P2"] }, { s: 4, items: ["P2"] }, { s: 5, items: [] }],
      },
    },
  },
  {
    id: "race",
    script: "Two threads share a counter that holds 5. T1 reads the counter and gets 5. Before T1 writes, T2 also reads 5. T1 writes 6. T2 writes 6 too, so one increment is lost.",
    raw: {
      heading: "A race condition",
      notes: [{ id: "n1", text: "Expected 7, got 6", s: 4 }],
      cues: [],
      stage: {
        kind: "sequence",
        lanes: [{ id: "t1", label: "T1" }, { id: "counter", label: "counter" }, { id: "t2", label: "T2" }],
        messages: [
          { id: "r1", from: "counter", to: "t1", label: "read", detail: "5", s: 1 },
          { id: "r2", from: "counter", to: "t2", label: "read", detail: "5", s: 2 },
          { id: "w1", from: "t1", to: "counter", label: "write", detail: "6", s: 3 },
          { id: "w2", from: "t2", to: "counter", label: "write", detail: "6", s: 4 },
        ],
        states: [{ lane: "counter", label: "count=5", at: -1, s: 0 }, { lane: "counter", label: "count=6 (lost one)", at: 3, s: 4 }],
      },
    },
  },
  {
    id: "hardware-multithreading",
    script: "Two threads share one core, and T1 stalls on a cache miss at time 2. In interleaved multithreading the core switches thread every cycle. In blocked multithreading it runs T1 until the stall, then switches to T2. In simultaneous multithreading both threads issue in the same cycles.",
    raw: {
      heading: "Three ways threads share a core",
      notes: [{ id: "n1", text: "Stall at t = 2", s: 0 }],
      cues: [],
      stage: {
        kind: "gantt",
        unit: "cycles",
        rows: [
          { label: "Interleaved", slots: [{ label: "T1", start: 0, end: 1, s: 1 }, { label: "T2", start: 1, end: 2, s: 1 }, { label: "T1", start: 2, end: 3, s: 1 }, { label: "T2", start: 3, end: 4, s: 1 }, { label: "T1", start: 4, end: 5, s: 1 }, { label: "T2", start: 5, end: 6, s: 1 }] },
          { label: "Blocked", slots: [{ label: "T1", start: 0, end: 2, s: 2 }, { label: "T2", start: 2, end: 6, s: 2 }] },
          { label: "SMT", slots: [{ label: "T1+T2", start: 0, end: 6, s: 3 }] },
        ],
      },
    },
  },
  {
    id: "threading-models",
    script: "User threads must be mapped onto kernel threads. In many-to-one, three user threads share one kernel thread. In one-to-one, each user thread gets its own kernel thread. In many-to-many, three user threads are spread over two kernel threads.",
    raw: {
      heading: "Multithreading models",
      notes: [{ id: "n1", text: "One blocking call stops many-to-one", s: 1 }, { id: "n2", text: "One-to-one: true parallelism", s: 2 }],
      cues: [],
      stage: {
        kind: "mapping",
        topLabel: "user threads",
        bottomLabel: "kernel threads",
        groups: [
          { label: "Many-to-one", top: [{ id: "a1", label: "U1", s: 1 }, { id: "a2", label: "U2", s: 1 }, { id: "a3", label: "U3", s: 1 }], bottom: [{ id: "ak1", label: "K1", s: 1 }], links: [{ from: "a1", to: "ak1", s: 1 }, { from: "a2", to: "ak1", s: 1 }, { from: "a3", to: "ak1", s: 1 }] },
          { label: "One-to-one", top: [{ id: "b1", label: "U1", s: 2 }, { id: "b2", label: "U2", s: 2 }, { id: "b3", label: "U3", s: 2 }], bottom: [{ id: "bk1", label: "K1", s: 2 }, { id: "bk2", label: "K2", s: 2 }, { id: "bk3", label: "K3", s: 2 }], links: [{ from: "b1", to: "bk1", s: 2 }, { from: "b2", to: "bk2", s: 2 }, { from: "b3", to: "bk3", s: 2 }] },
          { label: "Many-to-many", top: [{ id: "c1", label: "U1", s: 3 }, { id: "c2", label: "U2", s: 3 }, { id: "c3", label: "U3", s: 3 }], bottom: [{ id: "ck1", label: "K1", s: 3 }, { id: "ck2", label: "K2", s: 3 }], links: [{ from: "c1", to: "ck1", s: 3 }, { from: "c2", to: "ck1", s: 3 }, { from: "c2", to: "ck2", s: 3 }, { from: "c3", to: "ck2", s: 3 }] },
        ],
      },
    },
  },
  {
    id: "thread-states",
    script: "A server thread T1 is created in the New state. Starting it makes it Runnable. The scheduler picks it, so T1 is Running. It blocks on input and moves to Waiting. A timed sleep would instead put it in Timed waiting, and the event or timeout returns it to Runnable. When its work ends, T1 is Terminated.",
    raw: {
      heading: "A thread's six states",
      notes: [{ id: "n1", text: "Waiting: until an event", s: 3 }, { id: "n2", text: "Timed waiting: until a timeout", s: 4 }],
      cues: [],
      stage: {
        kind: "states",
        states: [
          { id: "new", label: "New", col: 0, row: 0, s: 0 },
          { id: "runnable", label: "Runnable", col: 1, row: 1, s: 1 },
          { id: "running", label: "Running", col: 3, row: 1, s: 2 },
          { id: "waiting", label: "Waiting", col: 1, row: 2, s: 3 },
          { id: "timed", label: "Timed waiting", col: 3, row: 2, s: 4 },
          { id: "terminated", label: "Terminated", col: 3, row: 0, s: 6 },
        ],
        transitions: [
          { from: "new", to: "runnable", label: "start()", s: 1 },
          { from: "runnable", to: "running", label: "scheduler picks", s: 2 },
          { from: "running", to: "runnable", label: "time slice ends", s: 2 },
          { from: "running", to: "waiting", label: "blocks on input", s: 3 },
          { from: "running", to: "timed", label: "sleep(ms)", s: 4 },
          { from: "waiting", to: "runnable", label: "event occurs", s: 5 },
          { from: "timed", to: "runnable", label: "timeout", s: 5 },
          { from: "running", to: "terminated", label: "run() ends", s: 6 },
        ],
        tokens: [{ label: "T1", path: [{ state: "new", s: 0 }, { state: "runnable", s: 1 }, { state: "running", s: 2 }, { state: "waiting", s: 3 }, { state: "runnable", s: 5 }, { state: "running", s: 6 }, { state: "terminated", s: 6 }] }],
      },
    },
  },
];
