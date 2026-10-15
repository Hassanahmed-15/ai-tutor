import test from "node:test";
import assert from "node:assert/strict";
import { hasMath, speakableMath, splitMath } from "../mathText";

test("LaTeX in an answer is found and split from the words around it", () => {
  const text = "The component is \\(mg\\sin 30^\\circ\\), so a = 4.9 m/s².";
  const parts = splitMath(text);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts[1], { kind: "math", value: "mg\\sin 30^\\circ", display: false });
  assert.equal(hasMath("It costs $5 and $10."), false, "money is not maths");
  assert.equal(hasMath("h'(x)=f'(g(x))\\,g'(x)"), false, "undelimited text is left alone");
});

test("maths is spoken as words, never as LaTeX", () => {
  assert.equal(speakableMath("so \\(a = g\\sin 30^\\circ\\)."), "so a equals g sin 30 degrees.");
  assert.equal(speakableMath("\\(v^2 = \\frac{F}{m}\\)"), "v squared equals F over m");
  assert.ok(!/[\\{}]/.test(speakableMath("\\[\\omega = \\sqrt{\\frac{k}{m}}\\]")));
});
