"use client";
import type { Scene, SceneComponent } from "./types";
import { IconBlock, SketchFilterDefs } from "./components/IconBlock";
import { Formula } from "./components/Formula";
import { Flowchart } from "./components/Flowchart";
import { BulletList } from "./components/BulletList";
import { Diagram } from "./components/Diagram";
import { DiagramRough } from "./components/DiagramRough";

function ComponentRenderer({ c }: { c: SceneComponent }) {
  switch (c.type) {
    case "icon":
      return <IconBlock icon={c.icon} size={c.size} color={c.color} wobble={c.wobble} />;
    case "text":
      return (
        <p style={{ fontFamily: "var(--font-sketch)", fontSize: c.size === "lg" ? 32 : c.size === "sm" ? 16 : 22, color: c.color ?? "#20180a" }}>
          {c.text}
        </p>
      );
    case "bullet-list":
      return <BulletList items={c.items} />;
    case "formula":
      return <Formula latex={c.latex} />;
    case "flowchart":
    case "timeline":
      return <Flowchart chart={c.mermaid} />;
    case "diagram":
      return <Diagram spec={c.spec} />;
    case "diagram-rough":
      return <DiagramRough spec={c.spec} />;
    default:
      return null;
  }
}

export function SceneRenderer({ scene }: { scene: Scene }) {
  return (
    <div
      style={{
        background: "#fdfbf6",
        border: "2px solid #e2ddd0",
        borderRadius: 20,
        padding: 40,
        minHeight: 420,
      }}
    >
      <SketchFilterDefs />
      <h1 style={{ fontFamily: "var(--font-sketch)", fontSize: 40, color: "#20180a", marginBottom: 24 }}>
        {scene.title}
      </h1>
      <div
        style={{
          display: scene.layout === "two-column" ? "grid" : "block",
          gridTemplateColumns: scene.layout === "two-column" ? "1fr 1fr" : undefined,
          gap: 32,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {scene.components.map((c, i) => (
            <ComponentRenderer key={i} c={c} />
          ))}
        </div>
        {scene.bullets && <BulletList items={scene.bullets} />}
      </div>
    </div>
  );
}
