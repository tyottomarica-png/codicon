import { annularSectorPath, polarPoint } from "../lib/radial";
import type { Skill } from "../types/codicon";
import type { CSSProperties } from "react";

type Props = {
  skills: Skill[];
  previewSkill: number | null;
  open: boolean;
  onLaunch(index: number): void;
};

/**
 * The Codex Micro joystick flick: hold the trigger, push the stick toward a saved workflow, let
 * go to fire it at the active chat. Same radial language as the power ring, one ring of sectors.
 */
export function SkillsRing({ skills, previewSkill, open, onLaunch }: Props) {
  if (!skills.length) return null;
  const span = 360 / skills.length;

  return (
    <section className={`skills-ring-shell ${open ? "is-open" : ""}`} aria-label="Skills selector">
      <svg className="skills-ring" viewBox="-260 -260 520 520" role="group" aria-label="Skill launcher">
        <circle r="250" className="wheel-halo" />
        {skills.map((skill, index) => {
          const start = index * span - span / 2;
          const labelPoint = polarPoint(158, index * span);
          const active = index === previewSkill;
          return (
            <g
              key={skill.id}
              className={`skill-sector ${active ? "is-active" : ""}`}
              style={{ "--slot-color": skill.color } as CSSProperties}
              onClick={() => onLaunch(index)}
              role="button"
              tabIndex={0}
            >
              <path d={annularSectorPath(84, 232, start + 2, start + span - 2)} />
              <text x={labelPoint.x} y={labelPoint.y} textAnchor="middle" dominantBaseline="middle">{skill.label}</text>
            </g>
          );
        })}
        <circle r="74" className="wheel-core" />
        <text y="-8" className="wheel-core-kicker" textAnchor="middle">SKILLS</text>
        <text y="14" className="wheel-core-value skills-core-value" textAnchor="middle">
          {previewSkill !== null && skills[previewSkill] ? skills[previewSkill].label : "LT + LS"}
        </text>
      </svg>
      {previewSkill !== null && skills[previewSkill] && (
        <p className="skills-prompt-preview">{skills[previewSkill].prompt}</p>
      )}
    </section>
  );
}
