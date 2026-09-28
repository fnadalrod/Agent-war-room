import type { WarRoomStore } from "../application/warRoomStore";
import {
  effortName,
  type Filter,
  filterOptions,
  isFiltering,
  SKILL_SOURCES,
  shortModel,
  type WarRoomView,
} from "../domain/attention";
import { copy } from "../domain/copy";
import { FilterIcon, RobotIcon, UserIcon, XIcon, ZapIcon } from "./icons";

type Props = { view: WarRoomView; shown: WarRoomView; filter: Filter; store: WarRoomStore };

const count = (v: WarRoomView) => v.rooms.reduce((n, r) => n + r.sessions.length, 0);

/** Filter the room by repo, model/effort, skill and skill source. */
export function FilterBar({ view, shown, filter, store }: Props) {
  const { repos, skills, models, efforts } = filterOptions(view);
  const active = isFiltering(filter);
  const modelsWorthIt = models.length > 1 || efforts.length > 1;
  if (repos.length < 2 && skills.length === 0 && !modelsWorthIt && !active) return null;

  return (
    <section className="filters" data-active={active} aria-label={copy.filters.label}>
      <div className="filter-row">
        <span className="filter-label">
          <FilterIcon size={13} /> {copy.filters.repos}
        </span>
        {repos.map((r) => (
          <button
            key={r.id}
            className="filter-chip"
            aria-pressed={filter.repos.includes(r.id)}
            onClick={() => store.toggleRepoFilter(r.id)}
          >
            {r.name} <span className="muted">{r.sessions}</span>
          </button>
        ))}
        <span className="spacer" />
        {active && (
          <>
            <span className="muted">
              {copy.filters.sessionsShown(count(shown), count(view))}
            </span>
            <button className="ghost" onClick={() => store.clearFilter()}>
              <XIcon size={13} /> {copy.filters.clear}
            </button>
          </>
        )}
      </div>

      {(modelsWorthIt || filter.models.length > 0 || filter.efforts.length > 0) && (
        <div className="filter-row">
          <span className="filter-label">
            <RobotIcon size={13} /> {copy.filters.model}
          </span>
          {models.map((m) => (
            <button
              key={m.value}
              className="filter-chip mono"
              aria-pressed={filter.models.includes(m.value)}
              onClick={() => store.toggleModelFilter(m.value)}
            >
              {shortModel(m.value)} <span className="muted">{m.sessions}</span>
            </button>
          ))}
          {efforts.length > 0 && <span className="filter-sep" />}
          {efforts.map((e) => (
            <button
              key={e.value}
              className="filter-chip"
              aria-pressed={filter.efforts.includes(e.value)}
              onClick={() => store.toggleEffortFilter(e.value)}
              title={copy.filters.effortTitle(e.value)}
            >
              {copy.session.effort(effortName(e.value)!)} <span className="muted">{e.sessions}</span>
            </button>
          ))}
        </div>
      )}

      {skills.length > 0 && (
        <div className="filter-row">
          <span className="filter-label">
            <ZapIcon size={13} /> {copy.filters.skills}
          </span>
          {SKILL_SOURCES.filter((src) => skills.some((k) => k.source === src)).map((src) => (
            <button
              key={src}
              className="filter-chip source"
              data-source={src}
              aria-pressed={filter.sources.includes(src)}
              onClick={() => store.toggleSourceFilter(src)}
            >
              {copy.skillSource[src]}
            </button>
          ))}
          <span className="filter-sep" />
          {skills.map((k) => (
            <button
              key={k.name}
              className="filter-chip skill"
              data-source={k.source}
              aria-pressed={filter.skills.includes(k.name)}
              onClick={() => store.toggleSkillFilter(k.name)}
              title={copy.filters.skillTitle(copy.skillSource[k.source], k.byUser, k.byAgent)}
            >
              {k.byUser && <UserIcon size={11} />}
              {k.byAgent && <ZapIcon size={11} />}
              {k.name} <span className="muted">{k.sessions}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
