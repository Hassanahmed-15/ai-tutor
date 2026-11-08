// Neural network forward pass: layers left to right, neurons stacked, weights as lines (accent =
// positive, warn = negative). Each step computes one layer for real and writes its values.
import { z } from "zod/v4";
import { defineTemplate, VisualError, type Result, type Step } from "../../contract";
import type { Board, Vec3 } from "../../board3d/board";
import { fmt } from "../../expr";
import { forward, makeNet, type Activation, type Net } from "./nnLogic";

const Args = z.object({
  layers: z.array(z.number().int().min(1).max(8)).min(2).max(6).describe("Neurons in each layer, input first (2 to 6 layers, at most 8 neurons each)."),
  input: z.array(z.number().min(-10).max(10)).max(8).optional().describe("Input values, one per input neuron (default: a fixed example)."),
  activation: z.enum(["relu", "sigmoid", "tanh"]).default("relu").describe("Activation in the hidden layers; the output layer uses softmax."),
  seed: z.number().int().min(0).max(1e6).default(7).describe("Seed for the example weights."),
  classes: z.array(z.string().max(16)).max(8).optional().describe("Names for the output neurons."),
});
type A = z.infer<typeof Args>;

const nid = (l: number, j: number) => `n${l}_${j}`;
const pos = (layers: number[], l: number, j: number): Vec3 => [(l - (layers.length - 1) / 2) * 2.6, 0, ((layers[l] - 1) / 2 - j) * 1.05];

function build(b: Board, a: A): Result {
  const input = a.input ?? Array.from({ length: a.layers[0] }, (_, i) => fmt(Math.sin(i * 1.7 + 0.5) * 0.9, 2));
  if (input.length !== a.layers[0]) throw new VisualError(`The input layer has ${a.layers[0]} neurons, so give ${a.layers[0]} input values (got ${input.length}).`);
  const net: Net = makeNet(a.layers, a.seed);
  const acts = forward(net, input, a.activation as Activation);
  b.clear();
  b.state.nn = { ...a, input };
  const L = a.layers.length;
  // Weights first, so the neurons sit on top of their lines.
  for (let l = 1; l < L; l++) for (let j = 0; j < a.layers[l]; j++) for (let i = 0; i < a.layers[l - 1]; i++) {
    const w = net.weights[l - 1][j][i];
    b.line(`w${l}_${i}_${j}`, { points: [pos(a.layers, l - 1, i), pos(a.layers, l, j)], color: w >= 0 ? "accent" : "warn", width: 0.006 + Math.min(0.03, Math.abs(w) * 0.025) });
  }
  a.layers.forEach((n, l) => {
    for (let j = 0; j < n; j++) b.node(nid(l, j), { at: pos(a.layers, l, j), color: l === 0 ? "active" : "idle", size: 0.28, label: l === 0 ? String(input[j]) : "" });
    const top = pos(a.layers, l, 0);
    b.label(`L${l}`, { at: [top[0], 0, top[2] + 0.9], text: l === 0 ? "input" : l === L - 1 ? "output" : `hidden ${l}`, color: "muted", small: true });
  });
  const probs = acts[L - 1];
  const best = probs.indexOf(Math.max(...probs));
  const names = a.classes ?? probs.map((_, k) => `class ${k + 1}`);
  const steps: Step[] = [];
  for (let l = 1; l < L; l++) {
    const last = l === L - 1;
    steps.push({
      caption: last ? `Output layer: softmax turns the sums into probabilities` : `Hidden layer ${l}: weighted sum plus bias, then ${a.activation}`,
      apply: async (bb, o) => {
        for (let j = 0; j < a.layers[l]; j++) {
          const v = acts[l][j];
          bb.setLabel(nid(l, j), last ? `${names[j]}: ${fmt(v, 2)}` : String(fmt(v, 2)));
          await bb.setColor(nid(l, j), last ? (j === best ? "done" : "idle") : v > 0.5 ? "active" : "muted", { ...o, ms: 160 });
        }
      },
    });
  }
  b.fit(a.layers.flatMap((n, l) => [pos(a.layers, l, 0), pos(a.layers, l, n - 1)]).concat([[0, 0, 2]]), "front");
  return {
    facts: { layers: a.layers, activation: a.activation, input, output: probs.map((p) => fmt(p, 3)), predicted: names[best], confidence: fmt(probs[best], 3), parameters: net.weights.flat(2).length + net.biases.flat().length },
    steps,
    summary: `A ${a.layers.join("–")} network: for input ${input.join(", ")} it predicts ${names[best]} with probability ${fmt(probs[best], 2)}.`,
  };
}

export const neuralNetworkTemplate = defineTemplate({
  id: "neural_network",
  domain: "cs",
  family: "machine_learning",
  title: "Neural network forward pass",
  topics: ["neural network", "neural net", "forward pass", "forward propagation", "perceptron", "neurons", "hidden layer", "softmax", "activation function", "deep learning", "mlp"],
  schema: Args,
  defaults: { layers: [3, 4, 4, 2], activation: "relu", seed: 7 },
  narrationHints: ["Each neuron adds up its inputs times their weights, plus a bias.", "The activation keeps the network from being just one big linear function.", "Softmax makes the outputs add up to 1."],
  run(b, args) { return build(b, args); },
  actions: {
    set_input: {
      description: "Feed in new input values and run the forward pass again.",
      schema: z.object({ input: z.array(z.number().min(-10).max(10)).min(1).max(8) }),
      run(b, { input }) { return build(b, { ...(b.state.nn as A), input }); },
    },
    set_activation: {
      description: "Use a different hidden-layer activation.",
      schema: z.object({ activation: z.enum(["relu", "sigmoid", "tanh"]) }),
      run(b, { activation }) { return build(b, { ...(b.state.nn as A), activation }); },
    },
  },
});
