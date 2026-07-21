"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

const deadline = new Date("2026-09-12T23:59:59-04:00");

const categories = [
  {
    name: "Business & Entrepreneurship",
    accent: "#8f2633",
    prompts: [
      "Does venture capital's pursuit of scale undermine the social value that entrepreneurship claims to create?",
      "Should governments treat gig-economy platforms as employers for the purposes of labor law?",
      "Is disruption a genuine mechanism of social progress, or a narrative that markets use to justify inequality?",
    ],
  },
  {
    name: "Finance & Economics",
    accent: "#245c4f",
    prompts: [
      "Do decentralized finance systems reduce or reproduce the inequalities of traditional banking?",
      "Should algorithmic trading be regulated as a systemic risk or accepted as a technical efficiency gain?",
      "Can microfinance innovation genuinely reduce poverty, or does it primarily shift financial risk onto the poor?",
    ],
  },
  {
    name: "Law & Policy",
    accent: "#343d73",
    prompts: [
      "Should intellectual property law be redesigned to account for AI-generated inventions?",
      "Is data privacy best understood as a human right or as a market commodity?",
      "Can antitrust law, built for industrial-era monopolies, meaningfully regulate digital platforms?",
    ],
  },
  {
    name: "Engineering & Technology",
    accent: "#7a4a1d",
    prompts: [
      "Should engineers bear personal ethical responsibility for downstream social consequences?",
      "Does smart-city technology increase civic trust in government, or erode it?",
      "Is renewable-energy innovation closing or widening the gap between wealthy and developing nations?",
    ],
  },
  {
    name: "Medicine & Bioethics",
    accent: "#6f2b58",
    prompts: [
      "Should gene-editing technologies like CRISPR be regulated as public health tools or private consumer choices?",
      "Does telemedicine improve healthcare equity, or primarily benefit those already well-served?",
      "Who bears ethical responsibility for algorithmic bias in medical diagnostic AI?",
    ],
  },
  {
    name: "Artificial Intelligence & Society",
    accent: "#243b53",
    prompts: [
      "Does generative AI transfer power from labor to capital, and is this new?",
      "Should AI used in criminal sentencing or hiring be explainable, even at a cost to accuracy?",
      "Is AI alignment primarily technical, or fundamentally governance and political?",
    ],
  },
];

const timeline = [
  ["Registration opens", "Now"],
  ["Regular deadline", "September 12, 2026"],
  ["Judging period", "Mid-September to mid-October"],
  ["Results released", "Late October / early November"],
  ["Certificates + anthology", "Within 2 weeks of results"],
];

const awards = [
  ["1st Place", "3 winners per region", "Certificate with First Place recognition and anthology inclusion"],
  ["2nd Place", "Top 3% per region", "Certificate with Second Place recognition and anthology inclusion"],
  ["3rd Place", "Top 5% per region", "Certificate with Third Place recognition and anthology inclusion"],
  ["Recognition Award", "Top 20% per region", "Certificate of Completion with recognition detail"],
  ["Participation Award", "All remaining entrants", "Certificate of Completion with participation detail"],
];

const faqs = [
  ["Who can enter?", "High-school students in grades 9-12, or international equivalents, who are under 19 by the deadline."],
  ["Can I submit to more than one category?", "Yes. Students may enter multiple categories, with one essay per category and a separate entry fee for each."],
  ["Is AI allowed?", "AI may be used as a research or editing aid, but the essay must reflect the student's own argument, judgment, and voice."],
  ["Are fee waivers available?", "Yes. A simple financial-need waiver form should be connected before launch so access is not limited by the entry fee."],
  ["When are results released?", "Results are planned for late October or early November, after a mid-September to mid-October judging period."],
];

function useCountdown() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000 * 60);
    return () => window.clearInterval(timer);
  }, []);
  return useMemo(() => {
    const diff = Math.max(0, deadline.getTime() - now.getTime());
    const days = Math.floor(diff / 86_400_000);
    const hours = Math.floor((diff % 86_400_000) / 3_600_000);
    return { days, hours };
  }, [now]);
}

export default function PraxisPrizePage() {
  const countdown = useCountdown();
  return (
    <main className="min-h-screen bg-[#f5f0e8] text-[#151923]">
      <PraxisHeader />
      <Hero countdown={countdown} />
      <Credibility />
      <Categories />
      <Rules />
      <Judges />
      <Prizes />
      <Registration />
      <Payments />
      <Faq />
      <Contact />
    </main>
  );
}

function PraxisHeader() {
  const links = [
    ["Prompts", "#prompts"],
    ["Rules", "#rules"],
    ["Prizes", "#prizes"],
    ["Register", "#register"],
  ];
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[#e4d9c8]/70 bg-[#f7f2ea]/88 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 lg:px-8">
        <a href="#top" className="flex items-center gap-3" aria-label="The Praxis Prize home">
          <PraxisLogo />
          <div>
            <p className="font-serif text-lg font-semibold tracking-tight text-[#121826]">The Praxis Prize</p>
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-[#8f2633]">Essay Competition</p>
          </div>
        </a>
        <nav className="hidden items-center gap-8 text-sm font-semibold text-[#596170] md:flex">
          {links.map(([label, href]) => (
            <a key={label} href={href} className="transition hover:text-[#8f2633]">
              {label}
            </a>
          ))}
        </nav>
        <a
          href="#register"
          className="rounded-full bg-[#121826] px-5 py-2.5 text-sm font-bold text-[#fffaf2] shadow-[0_12px_30px_rgba(18,24,38,0.18)] transition hover:bg-[#8f2633]"
        >
          Begin entry
        </a>
      </div>
    </header>
  );
}

function PraxisLogo() {
  return (
    <span className="grid size-11 place-items-center rounded-full border border-[#b99a62] bg-[#121826] shadow-[inset_0_0_0_4px_rgba(255,250,242,0.08)]">
      <span className="relative grid size-7 place-items-center rounded-full border border-[#d8bd82]">
        <span className="font-serif text-lg italic leading-none text-[#d8bd82]">P</span>
      </span>
    </span>
  );
}

function Hero({ countdown }: { countdown: { days: number; hours: number } }) {
  return (
    <section id="top" className="relative min-h-[88vh] overflow-hidden pt-24">
      <Image
        src="/praxis-prize/hero-library-desk.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(13,18,31,0.88)_0%,rgba(13,18,31,0.72)_42%,rgba(13,18,31,0.28)_72%,rgba(13,18,31,0.18)_100%)]" />
      <div className="relative mx-auto flex min-h-[calc(88vh-6rem)] max-w-7xl items-center px-5 py-16 lg:px-8">
        <div className="max-w-3xl">
          <p className="mb-6 inline-flex rounded-full border border-[#d8bd82]/40 bg-[#fffaf2]/8 px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-[#d8bd82]">
            Social science pressed into practice
          </p>
          <h1 className="font-serif text-[3.4rem] leading-[0.98] tracking-tight text-[#fffaf2] sm:text-[5.6rem] lg:text-[6.8rem]">
            The essay prize for innovation and society.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-[#efe6d8]/86">
            The Praxis Prize invites high-school students to examine how business, finance,
            law, engineering, medicine, and AI reshape institutions, incentives, and human behavior.
          </p>
          <div className="mt-10 flex flex-col gap-4 sm:flex-row">
            <a href="#register" className="rounded-full bg-[#d8bd82] px-8 py-4 text-center text-sm font-black uppercase tracking-[0.08em] text-[#111827] transition hover:bg-[#f1d99b]">
              Register for $30
            </a>
            <a href="#prompts" className="rounded-full border border-[#fffaf2]/28 bg-[#fffaf2]/8 px-8 py-4 text-center text-sm font-bold uppercase tracking-[0.08em] text-[#fffaf2] backdrop-blur transition hover:bg-[#fffaf2]/14">
              View prompts
            </a>
          </div>
        </div>
        <aside className="ml-auto hidden w-72 border-l border-[#d8bd82]/34 pl-8 text-[#fffaf2] lg:block">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#d8bd82]">Regular deadline</p>
          <p className="mt-3 font-serif text-4xl">September 12</p>
          <div className="mt-8 grid grid-cols-2 gap-3">
            <div className="border border-[#fffaf2]/18 bg-[#fffaf2]/8 p-4 backdrop-blur">
              <p className="font-serif text-4xl">{countdown.days}</p>
              <p className="text-xs uppercase tracking-[0.18em] text-[#d8bd82]">days</p>
            </div>
            <div className="border border-[#fffaf2]/18 bg-[#fffaf2]/8 p-4 backdrop-blur">
              <p className="font-serif text-4xl">{countdown.hours}</p>
              <p className="text-xs uppercase tracking-[0.18em] text-[#d8bd82]">hours</p>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

function Credibility() {
  return (
    <section className="border-y border-[#e0d4c2] bg-[#fffaf2]">
      <div className="mx-auto grid max-w-7xl gap-px px-5 lg:grid-cols-4 lg:px-8">
        {[
          ["18 prompts", "Six applied fields, three rigorous questions each."],
          ["1,800-2,000 words", "Argumentative, original, evidence-based essays."],
          ["Every entrant certified", "Completion certificate with recognition tier."],
          ["Anthology pathway", "Placed essays included in the published anthology."],
        ].map(([k, v]) => (
          <div key={k} className="py-8 lg:border-l lg:border-[#e0d4c2] lg:px-8 last:lg:border-r">
            <p className="font-serif text-3xl text-[#121826]">{k}</p>
            <p className="mt-2 text-sm leading-6 text-[#687080]">{v}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Categories() {
  return (
    <section id="prompts" className="mx-auto max-w-7xl px-5 py-24 lg:px-8">
      <SectionIntro
        eyebrow="Categories & prompts"
        title="Choose one question. Bring a social-science lens."
        body="Each track asks students to apply economics, sociology, psychology, political science, ethics, or history to a live innovation question."
      />
      <div className="mt-12 grid gap-5 md:grid-cols-2">
        {categories.map((category, index) => (
          <details key={category.name} open={index < 2} className="group rounded-sm border border-[#dfd1bd] bg-[#fffaf2] p-6 shadow-[0_18px_50px_rgba(65,45,24,0.06)]">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
              <div>
                <span className="text-xs font-black uppercase tracking-[0.18em]" style={{ color: category.accent }}>
                  Track {index + 1}
                </span>
                <h3 className="mt-2 font-serif text-2xl text-[#121826]">{category.name}</h3>
              </div>
              <span className="mt-2 text-2xl text-[#9b8a74] transition group-open:rotate-45">+</span>
            </summary>
            <ol className="mt-6 space-y-4">
              {category.prompts.map((prompt, promptIndex) => (
                <li key={prompt} className="grid grid-cols-[2rem_1fr] gap-3 text-sm leading-6 text-[#4f5968]">
                  <span className="font-serif text-xl" style={{ color: category.accent }}>
                    {promptIndex + 1}
                  </span>
                  <span>{prompt}</span>
                </li>
              ))}
            </ol>
          </details>
        ))}
      </div>
    </section>
  );
}

function Rules() {
  const rules = [
    ["Length", "1,800-2,000 words, excluding bibliography and endnotes."],
    ["Citation", "APA, MLA, or Chicago, used consistently throughout."],
    ["Format", "PDF upload, 12pt Times New Roman or Arial, 1.5 spacing, 1 inch margins."],
    ["Eligibility", "Grades 9-12 or international equivalent; under 19 as of the deadline."],
    ["AI policy", "Permitted as a research or editing aid; argument and voice must be the student's own."],
    ["File name", "FirstName-LastName-Category-QuestionNumber.pdf"],
  ];
  return (
    <section id="rules" className="bg-[#121826] py-24 text-[#fffaf2]">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <SectionIntro
          eyebrow="Rules & submission"
          title="A serious competition needs serious mechanics."
          body="The submission system is designed to feel credible to counselors, parents, and admissions readers."
          invert
        />
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {rules.map(([label, value]) => (
            <div key={label} className="border border-[#d8bd82]/20 bg-[#fffaf2]/6 p-6">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#d8bd82]">{label}</p>
              <p className="mt-4 text-sm leading-6 text-[#efe6d8]/82">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-14 overflow-hidden border border-[#d8bd82]/22">
          {timeline.map(([label, date]) => (
            <div key={label} className="grid gap-3 border-b border-[#d8bd82]/16 p-5 last:border-b-0 md:grid-cols-[1fr_1.4fr]">
              <p className="font-serif text-xl">{label}</p>
              <p className="text-[#efe6d8]/78">{date}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Judges() {
  return (
    <section className="relative overflow-hidden bg-[#ede4d6] py-24">
      <div className="absolute right-[-12rem] top-[-12rem] size-[34rem] rounded-full border border-[#c9b48d]" />
      <div className="absolute right-[-6rem] top-[-6rem] size-[22rem] rounded-full border border-[#c9b48d]" />
      <div className="relative mx-auto grid max-w-7xl gap-12 px-5 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#8f2633]">Academic panel</p>
          <h2 className="mt-5 font-serif text-5xl leading-tight text-[#121826]">Judged by people who know the fields.</h2>
        </div>
        <div className="border-l border-[#bba78a] pl-8">
          <p className="text-xl leading-9 text-[#394150]">
            Essays are assessed by a panel of graduates of top universities, including Harvard,
            Stanford, and other leading institutions, alongside entrepreneurs and industry
            professionals from across the world.
          </p>
          <p className="mt-6 text-base leading-7 text-[#687080]">
            The panel is presented as a confident institutional statement at launch, avoiding
            placeholder headshots until named judges are finalized.
          </p>
        </div>
      </div>
    </section>
  );
}

function Prizes() {
  return (
    <section id="prizes" className="mx-auto max-w-7xl px-5 py-24 lg:px-8">
      <SectionIntro
        eyebrow="Regional recognition"
        title="Every entrant leaves with a formal outcome."
        body="Regional percentile awards make the prize feel international while keeping recognition meaningful across entrant geographies."
      />
      <div className="mt-12 grid gap-4">
        {awards.map(([tier, criteria, recognition]) => (
          <div key={tier} className="grid gap-4 border-t border-[#dfd1bd] py-6 md:grid-cols-[0.8fr_0.8fr_1.4fr]">
            <p className="font-serif text-3xl text-[#121826]">{tier}</p>
            <p className="font-semibold text-[#8f2633]">{criteria}</p>
            <p className="leading-7 text-[#596170]">{recognition}</p>
          </div>
        ))}
      </div>
      <div className="mt-10 bg-[#fffaf2] p-8 shadow-[0_18px_50px_rgba(65,45,24,0.06)]">
        <p className="font-serif text-2xl text-[#121826]">Regions</p>
        <p className="mt-3 leading-7 text-[#596170]">
          North America, Europe, Oceania, Asia, Latin America, Africa, and the Middle East.
          Future anthology pages can showcase winners by year, region, and category.
        </p>
      </div>
    </section>
  );
}

function Registration() {
  return (
    <section id="register" className="bg-[#fffaf2] py-24">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#8f2633]">Registration & payment</p>
          <h2 className="mt-5 font-serif text-5xl leading-tight text-[#121826]">A registration flow that feels trustworthy before payment.</h2>
          <p className="mt-6 leading-8 text-[#596170]">
            This v1 design shows the submission flow and payment states. Production should connect
            Supabase storage, Stripe Checkout, fee-waiver codes, confirmation email, and an admin
            dashboard for judging.
          </p>
          <div className="mt-8 space-y-3 text-sm leading-6 text-[#596170]">
            <p><strong className="text-[#121826]">Professional email:</strong> admissions@praxisprize.org</p>
            <p><strong className="text-[#121826]">Website link:</strong> https://www.praxisprize.org</p>
            <p><strong className="text-[#121826]">Logo:</strong> seal-style Praxis P mark with institutional navy and brass.</p>
          </div>
        </div>
        <form className="grid gap-4 border border-[#dfd1bd] bg-[#f7f2ea] p-6 shadow-[0_24px_80px_rgba(65,45,24,0.09)]">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" placeholder="Student name" />
            <Field label="Email" placeholder="student@email.com" />
            <Field label="School" placeholder="School name" />
            <Field label="Grade level" placeholder="Grade 11" />
          </div>
          <label className="grid gap-2 text-sm font-semibold text-[#394150]">
            Category
            <select className="border border-[#d9cab5] bg-[#fffaf2] px-4 py-3 text-[#121826] outline-none focus:border-[#8f2633]">
              {categories.map((category) => (
                <option key={category.name}>{category.name}</option>
              ))}
            </select>
          </label>
          <Field label="Referee email (optional)" placeholder="teacher@school.edu" />
          <label className="grid gap-2 text-sm font-semibold text-[#394150]">
            Essay upload
            <div className="border border-dashed border-[#bba78a] bg-[#fffaf2] px-4 py-8 text-center text-sm text-[#687080]">
              PDF only, maximum 15MB. File will be validated before checkout.
            </div>
          </label>
          <div className="flex flex-col gap-3 border-t border-[#dfd1bd] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-serif text-2xl text-[#121826]">$30 USD</p>
              <p className="text-xs text-[#687080]">Per entry, per category</p>
            </div>
            <button type="button" className="rounded-full bg-[#8f2633] px-7 py-3 text-sm font-black uppercase tracking-[0.08em] text-white transition hover:bg-[#6f1e2b]">
              Continue to payment
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function Payments() {
  const rails = [
    ["US + Europe", "Stripe Checkout", "Primary card, Apple Pay, Google Pay, Link, and local Stripe-supported methods in test mode until live keys are provided."],
    ["CIS countries", "Regional fallback", "Provider choice should be finalized with counsel. Candidate rails include YooKassa, CloudPayments, bank transfer, or manual invoice where Stripe is unavailable."],
    ["China", "Alipay / WeChat Pay / UnionPay", "Use a payment aggregator or Stripe-supported local method depending on entity location and compliance review."],
    ["Fee waivers", "Waiver code", "Supabase-stored waiver codes bypass payment and preserve the submission record for auditability."],
  ];
  return (
    <section className="bg-[#121826] py-24 text-[#fffaf2]">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <SectionIntro
          eyebrow="Payment architecture"
          title="Global entry fees without making checkout feel risky."
          body="The site should launch with Stripe test mode, then add regional rails once legal entity and country coverage are confirmed."
          invert
        />
        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {rails.map(([region, provider, detail]) => (
            <div key={region} className="border border-[#d8bd82]/20 bg-[#fffaf2]/6 p-6">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#d8bd82]">{region}</p>
              <h3 className="mt-3 font-serif text-3xl">{provider}</h3>
              <p className="mt-4 text-sm leading-7 text-[#efe6d8]/78">{detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section className="mx-auto max-w-5xl px-5 py-24 lg:px-8">
      <SectionIntro
        eyebrow="FAQ"
        title="The questions parents and counselors will ask first."
        body="Short, concrete answers make the competition feel administered rather than improvised."
      />
      <div className="mt-10 divide-y divide-[#dfd1bd] border-y border-[#dfd1bd]">
        {faqs.map(([q, a]) => (
          <details key={q} className="group py-6">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-serif text-2xl text-[#121826]">
              {q}
              <span className="text-[#8f2633] transition group-open:rotate-45">+</span>
            </summary>
            <p className="mt-4 max-w-3xl leading-7 text-[#596170]">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Contact() {
  return (
    <footer id="contact" className="bg-[#ede4d6] py-20">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 lg:grid-cols-[1fr_1fr] lg:px-8">
        <div>
          <PraxisLogo />
          <h2 className="mt-6 font-serif text-5xl text-[#121826]">Why Praxis?</h2>
          <p className="mt-6 max-w-2xl leading-8 text-[#596170]">
            Praxis means action or practice: theory pressed into contact with the real world.
            That is the intellectual move this competition asks students to make.
          </p>
        </div>
        <div className="self-end border-l border-[#bba78a] pl-8">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#8f2633]">Contact</p>
          <p className="mt-4 font-serif text-3xl text-[#121826]">admissions@praxisprize.org</p>
          <p className="mt-3 text-[#596170]">www.praxisprize.org</p>
          <p className="mt-8 max-w-md text-sm leading-6 text-[#687080]">
            Production handoff: connect Supabase, Stripe, regional payment rails, Resend email,
            PDF storage, and an authenticated submissions dashboard.
          </p>
        </div>
      </div>
    </footer>
  );
}

function Field({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-[#394150]">
      {label}
      <input className="border border-[#d9cab5] bg-[#fffaf2] px-4 py-3 text-[#121826] outline-none focus:border-[#8f2633]" placeholder={placeholder} />
    </label>
  );
}

function SectionIntro({ eyebrow, title, body, invert = false }: { eyebrow: string; title: string; body: string; invert?: boolean }) {
  return (
    <div className="max-w-3xl">
      <p className={`text-xs font-black uppercase tracking-[0.2em] ${invert ? "text-[#d8bd82]" : "text-[#8f2633]"}`}>{eyebrow}</p>
      <h2 className={`mt-5 font-serif text-5xl leading-tight ${invert ? "text-[#fffaf2]" : "text-[#121826]"}`}>{title}</h2>
      <p className={`mt-5 text-lg leading-8 ${invert ? "text-[#efe6d8]/78" : "text-[#596170]"}`}>{body}</p>
    </div>
  );
}
