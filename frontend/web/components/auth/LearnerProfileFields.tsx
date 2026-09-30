"use client";

import { useMemo, useState } from "react";
import { allCurricula, allStudyLevels, countryName, countryOptions, curriculaFor, matchCountry, studyLevelOptions, subjectOptions, type EduOption } from "@/lib/education";
import { OptionPicker, QuickChips } from "./OptionPicker";

/**
 * THE LEARNER PROFILE'S BASICS — country, study level, subjects, curriculum/exam/track — used by
 * onboarding screen 1 and by settings, so the two cannot drift apart.
 *
 * Every list is CONTEXTUAL (lib/education.ts): the country gives the local level names and puts its
 * own subjects first; the subjects shape the levels (medical school for medicine); and the country
 * + level + subjects pick which curricula are suggested (USMLE only with medicine, SAT only around
 * high school). Nothing is a hard filter: every picker searches the whole catalogue,
 * asks Aria when that runs dry, and accepts the student's own entry.
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
  const suggestedCurricula = useMemo(
    () => curriculaFor({ country: value.country, level: value.studyLevel, subjects: value.subjects }),
    [value.country, value.studyLevel, value.subjects],
  );
  const curriculumOptions = useMemo(() => {
    const seen = new Set(suggestedCurricula.map((c) => c.id));
    return [...suggestedCurricula, ...allCurricula().filter((c) => !seen.has(c.id))];
  }, [suggestedCurricula]);
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
          label="Study level"
          required
          hint="Pick the closest, or search and add your own."
          options={levelOptions}
          value={value.studyLevel ? [value.studyLevel] : []}
          onChange={(next) => set({ studyLevel: next[0] ?? null })}
          multiple={false}
          placeholder="Search levels, or type your own"
          suggestKind="level"
          suggestContext={context}
          inputId="learner-level"
        />
        <div className="mt-2">
          <QuickChips
            label="Common study levels"
            options={localLevels}
            value={value.studyLevel ? [value.studyLevel] : []}
            onToggle={(o) => set({ studyLevel: value.studyLevel?.id === o.id ? null : o })}
          />
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

      <div>
        <OptionPicker
          label="Curriculum, exam or study track"
          hint={suggestedCurricula.length ? "Suggested for your country, level and subjects — or search and add your own." : "Search, or add your own."}
          options={curriculumOptions}
          value={value.curricula}
          onChange={(curricula) => set({ curricula })}
          multiple
          placeholder="e.g. A-Level, IB, SAT, MDCAT…"
          suggestKind="curriculum"
          suggestContext={context}
          inputId="learner-curricula"
        />
        <div className="mt-2">
          <QuickChips
            label="Suggested curricula, exams and tracks"
            options={suggestedCurricula.slice(0, 8)}
            value={value.curricula}
            onToggle={(o) => set({ curricula: value.curricula.some((c) => c.id === o.id) ? value.curricula.filter((c) => c.id !== o.id) : [...value.curricula, o] })}
          />
        </div>
      </div>
    </div>
  );
}
