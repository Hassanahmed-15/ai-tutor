"use client";

import { useMemo, useState } from "react";
import { allStudyLevels, countryName, countryOptions, matchCountry, studyLevelOptions, subjectOptions, type EduOption, type LevelOption } from "@/lib/education";
import { OptionPicker, QuickChips } from "./OptionPicker";

/**
 * THE LEARNER PROFILE'S BASICS — country, study level or exam, subjects — used by onboarding screen 1
 * and by settings, so the two cannot drift apart.
 *
 * Every list is CONTEXTUAL (lib/education.ts): the country gives the local level names, boards and
 * entry tests and puts its own subjects first; the subjects shape the levels (medical school for
 * medicine). Nothing is a hard filter: every picker searches the whole catalogue, asks Aria when that
 * runs dry, and accepts the student's own entry.
 *
 * Study level is the ONE place a student says what they are studying for (owner's direction,
 * 2026-10-15): it lists the exams themselves (MDCAT, O Level, IGCSE, AS & A Level, FSc…), and that
 * exam is the syllabus Aria teaches and searches. The old "Curriculum, exam or study track" field is
 * gone; `curricula` is only carried through so a save does not erase what an older profile holds.
 */
export type LearnerFieldsValue = {
  country: string | null;
  countrySource: "ip" | "language" | "user" | null;
  studyLevel: EduOption | null;
  subjects: EduOption[];
  curricula: EduOption[];
};

export function LearnerProfileFields({
  value,
  onChange,
  detecting,
}: {
  value: LearnerFieldsValue;
  onChange: (next: LearnerFieldsValue) => void;
  /** The country is still being detected from the IP address. */
  detecting?: boolean;
}) {
  const set = (patch: Partial<LearnerFieldsValue>) => onChange({ ...value, ...patch });
  const countries = useMemo(() => countryOptions(), []);
  const [countryProblem, setCountryProblem] = useState<string | null>(null);
  const localLevels = useMemo(() => studyLevelOptions(value.country, value.subjects), [value.country, value.subjects]);
  const subjects = useMemo(() => subjectOptions(value.country), [value.country]);
  const levelOptions = useMemo(() => {
    const seen = new Set(localLevels.map((l) => l.id));
    return [...localLevels, ...allStudyLevels().filter((l) => !seen.has(l.id))];
  }, [localLevels]);
  // The chips, in their groups ("School", "Pakistan boards", "Cambridge", "Entry tests", …), in the
  // order the country lists them.
  const levelGroups = useMemo(() => {
    const groups = new Map<string, LevelOption[]>();
    for (const level of localLevels) {
      const name = level.group ?? "Other";
      groups.set(name, [...(groups.get(name) ?? []), level]);
    }
    return [...groups.entries()];
  }, [localLevels]);
  const context = { country: value.country, level: value.studyLevel, subjects: value.subjects };

  const countryValue = value.country ? [{ id: value.country, label: countryName(value.country) }] : [];

  return (
    <div className="space-y-7">
      <div>
        <OptionPicker
          label="Country"
          hint={
            countryProblem
              ? countryProblem
              : detecting
              ? "Detecting your location…"
              : value.countrySource === "ip" || value.countrySource === "language"
                ? "Detected from your location — change it if it's not right."
                : "Used to show the levels, subjects and exams that fit where you study."
          }
          options={countries}
          value={countryValue}
          onChange={(next) => {
            const picked = next[0];
            setCountryProblem(null);
            if (!picked) return set({ country: null, countrySource: "user" });
            if (!picked.custom) return set({ country: picked.id, countrySource: "user" });
            // Typed rather than picked: "UK", "usa", "Pakistan" are matched to the country; anything
            // else is said out loud instead of being dropped without a word.
            const code = matchCountry(picked.label);
            if (code) set({ country: code, countrySource: "user" });
            else setCountryProblem(`"${picked.label}" isn't a country we recognise — pick yours from the list.`);
          }}
          multiple={false}
          placeholder={value.country ? `${countryName(value.country)} — search to change` : "Search for your country"}
          inputId="learner-country"
        />
      </div>

      <div>
        <OptionPicker
          label="Study level or exam"
          required
          hint="What you're studying for — Aria teaches and searches that syllabus. Pick one, or search and add your own."
          options={levelOptions}
          value={value.studyLevel ? [value.studyLevel] : []}
          onChange={(next) => set({ studyLevel: next[0] ?? null })}
          multiple={false}
          placeholder="e.g. O Level, MDCAT, FSc, Undergraduate…"
          suggestKind="level"
          suggestContext={context}
          inputId="learner-level"
        />
        <div className="mt-3 space-y-2">
          {levelGroups.map(([group, options]) => (
            <div key={group}>
              <div className="mb-1 text-[0.72rem] font-medium uppercase tracking-wide" style={{ color: "var(--hud-text-dim)" }}>{group}</div>
              <QuickChips
                label={group}
                options={options.map(({ id, label }) => ({ id, label }))}
                value={value.studyLevel ? [value.studyLevel] : []}
                onToggle={(o) => set({ studyLevel: value.studyLevel?.id === o.id ? null : o })}
              />
            </div>
          ))}
        </div>
      </div>

      <OptionPicker
        label="Subjects"
        required
        hint="Choose one or more — search, or type a subject that isn't listed."
        options={subjects}
        value={value.subjects}
        onChange={(subjects) => set({ subjects })}
        multiple
        placeholder="e.g. Physics, Biology, Economics…"
        suggestKind="subject"
        suggestContext={context}
        inputId="learner-subjects"
      />
    </div>
  );
}
