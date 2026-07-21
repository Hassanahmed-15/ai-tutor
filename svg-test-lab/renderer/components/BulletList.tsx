export function BulletList({ items }: { items: string[] }) {
  return (
    <ul style={{ fontFamily: "var(--font-sketch, sans-serif)", fontSize: 22, lineHeight: 1.7, color: "#20180a" }}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
