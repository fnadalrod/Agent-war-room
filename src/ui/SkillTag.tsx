import type { WarRoomStore } from "../application/warRoomStore";
import type { SkillView } from "../domain/attention";
import { copy } from "../domain/copy";
import { UserIcon, ZapIcon } from "./icons";

type Props = { skill: SkillView; store: WarRoomStore; active?: boolean };

/** Skill tag: color by source, icon by who launched it. Click: filter by it. */
export function SkillTag({ skill, store, active }: Props) {
  return (
    <button
      className="skill-tag"
      data-source={skill.source}
      data-active={active ?? false}
      onClick={(e) => {
        e.stopPropagation();
        store.toggleSkillFilter(skill.name);
      }}
      title={copy.skill.tagTitle(skill.name, copy.skillSource[skill.source], skill.by_user, skill.by_agent, skill.count)}
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
