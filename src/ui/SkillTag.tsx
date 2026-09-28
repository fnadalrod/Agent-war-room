import type { WarRoomStore } from "../application/warRoomStore";
import { SKILL_SOURCE_LABEL, type SkillView } from "../domain/attention";
import { UserIcon, ZapIcon } from "./icons";

type Props = { skill: SkillView; store: WarRoomStore; active?: boolean };

/** Etiqueta de una skill: color por procedencia, icono por quién la lanzó. Clic: filtrar por ella. */
export function SkillTag({ skill, store, active }: Props) {
  const who = [skill.by_user && "tú", skill.by_agent && "el agente"].filter(Boolean).join(" y ");
  return (
    <button
      className="skill-tag"
      data-source={skill.source}
      data-active={active ?? false}
      onClick={(e) => {
        e.stopPropagation();
        store.toggleSkillFilter(skill.name);
      }}
      title={`${skill.name} · ${SKILL_SOURCE_LABEL[skill.source].toLowerCase()} · la lanzó ${who}${
        skill.count > 1 ? ` · ${skill.count} veces` : ""
      }\nClic: filtrar por esta skill`}
    >
      {skill.by_user && <UserIcon size={11} />}
      {skill.by_agent && <ZapIcon size={11} />}
      <span>{skill.name}</span>
      {skill.count > 1 && <span className="skill-count">×{skill.count}</span>}
    </button>
  );
}

export function SkillTags({ skills, store, max = 4 }: { skills: SkillView[]; store: WarRoomStore; max?: number }) {
  if (skills.length === 0) return null;
  const shown = skills.slice(0, max);
  const rest = skills.length - shown.length;
  return (
    <div className="skill-tags">
      {shown.map((k) => (
        <SkillTag key={k.name} skill={k} store={store} />
      ))}
      {rest > 0 && <span className="skill-more">+{rest}</span>}
    </div>
  );
}
