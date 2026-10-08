/**
 * THE ROOM BEHIND THE BOARD: a lit classroom wall and a strip of floor for the teacher to stand on.
 * Pure CSS, drawn behind everything, so the board in front of it is exactly the board as it is. Light
 * on purpose: a teacher filmed in a classroom stands in a lit room, and the white board reads as a
 * board on a wall rather than a window into the dark app.
 */
export function ClassroomRoom() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* The board hangs in a light frame on this wall, so its letterbox and stage edge take the board's
          own paper colour instead of the dark app's. Scoped to the classroom; nothing inside the board
          changes, and the section card keeps its own dark backdrop. */}
      <style>{`.classroom-board .bg-slate-950, .classroom-board section[aria-label="Teaching board"] { background-color: #fbf8ee !important; border-color: transparent !important; border-radius: 2px !important; }`}</style>
      {/* The wall: warm light plaster, brighter toward the ceiling lights. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 70% at 45% -10%, rgba(255,251,240,0.95) 0%, rgba(255,251,240,0) 60%), linear-gradient(180deg, #e9e4da 0%, #ddd6ca 72%, #cfc6b8 100%)",
        }}
      />
      {/* A dado rail at the height of her hands, as in most classrooms. */}
      <div className="absolute inset-x-0 top-[62%] h-[3px] bg-[#c4baa9] shadow-[0_1px_0_rgba(255,255,255,0.5)]" />
      <div className="absolute inset-x-0 bottom-[7%] top-[62.4%]" style={{ background: "linear-gradient(180deg, #d3cab9 0%, #c9bfac 100%)" }} />
      {/* The floor, with its skirting board. */}
      <div className="absolute inset-x-0 bottom-[7%] h-[6px] bg-[#8d7f6a]" />
      <div
        className="absolute inset-x-0 bottom-0 h-[7%]"
        style={{ background: "linear-gradient(180deg, #a8946f 0%, #8f7b58 100%)", boxShadow: "inset 0 6px 10px -6px rgba(0,0,0,0.35)" }}
      />
      {/* Light falling off toward the corners, as a camera sees a room. */}
      <div className="absolute inset-0" style={{ background: "radial-gradient(140% 110% at 50% 40%, rgba(0,0,0,0) 55%, rgba(30,24,16,0.22) 100%)" }} />
    </div>
  );
}
