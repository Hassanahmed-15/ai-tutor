// A real feed-forward pass: seeded weights (so a lesson replays the same), chosen activation in the
// hidden layers, softmax at the output. The visual shows exactly these numbers.
export type Activation = "relu" | "sigmoid" | "tanh";

export function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Net { layers: number[]; weights: number[][][]; biases: number[][] }

export function makeNet(layers: number[], seed: number): Net {
  const r = mulberry32(seed);
  const weights: number[][][] = [], biases: number[][] = [];
  for (let l = 1; l < layers.length; l++) {
    weights.push(Array.from({ length: layers[l] }, () => Array.from({ length: layers[l - 1] }, () => Math.round((r() * 2 - 1) * 100) / 100)));
    biases.push(Array.from({ length: layers[l] }, () => Math.round((r() * 0.4 - 0.2) * 100) / 100));
  }
  return { layers, weights, biases };
}

const act = { relu: (v: number) => Math.max(0, v), sigmoid: (v: number) => 1 / (1 + Math.exp(-v)), tanh: Math.tanh };

export function softmax(v: number[]): number[] {
  const m = Math.max(...v);
  const e = v.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

/** Activations of every layer; the last layer is softmax probabilities. */
export function forward(net: Net, input: number[], activation: Activation): number[][] {
  const out = [input];
  for (let l = 0; l < net.weights.length; l++) {
    const z = net.weights[l].map((row, j) => row.reduce((s, w, i) => s + w * out[l][i], net.biases[l][j]));
    out.push(l === net.weights.length - 1 ? softmax(z) : z.map(act[activation]));
  }
  return out;
}
