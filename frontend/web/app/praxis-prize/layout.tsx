import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Praxis Prize - Essay Competition",
  description:
    "A prestigious international essay competition for high-school students exploring the intersection of social science and innovation.",
};

export default function PraxisPrizeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
