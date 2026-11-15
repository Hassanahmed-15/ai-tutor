from aria_slide import *


class Slide(AriaSlide):
    def construct(self):
        # 1. heading  2. right triangle with its sides  3. the rule  4. a check with numbers
        self.heading("Pythagoras' theorem")
        tri = Polygon([-2, -1.3, 0], [2, -1.3, 0], [2, 1.5, 0], color=WHITE_INK, stroke_width=5)
        self.place(tri, "A2:C4", pad=0.7)
        self.play(Create(tri), run_time=1.2)
        p, q, r = tri.get_vertices()
        a = ink("a", 50, CYAN_INK).next_to(Line(q, r), RIGHT, buff=0.15)
        b = ink("b", 50, PINK_INK).next_to(Line(p, q), DOWN, buff=0.15)
        c = ink("c", 50, YELLOW_INK).next_to(Line(p, r).get_center(), UP + LEFT, buff=0.15)
        self.play(FadeIn(a), FadeIn(b), FadeIn(c))
        self.wait(0.6)
        rule = self.note("a² + b² = c²", "D2:F2", YELLOW_INK, size=72)
        self.wait(0.8)
        self.note("3² + 4² = 25 = 5²", "D3:F3", size=48)
        self.play(Circumscribe(rule, color=YELLOW_INK))
        self.wait(1.5)
