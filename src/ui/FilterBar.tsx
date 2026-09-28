import type { WarRoomStore } from "../application/warRoomStore";
import {
  effortName,
  type Filter,
  filterOptions,
  isFiltering,
  SKILL_SOURCE_LABEL,
  SKILL_SOURCES,
  shortModel,
  type WarRoomView,
} from "../domain/attention";
import { FilterIcon, RobotIcon, UserIcon, XIcon, ZapIcon } from "./icons";

type Props = { view: WarRoomView; shown: WarRoomView; filter: Filter; store: WarRoomStore };

const count = (v: WarRoomView) => v.rooms.reduce((n, r) => n + r.sessions.length, 0);

/** Filtrar la sala por repositorio, por skill y por procedencia de las skills. */
export function FilterBar({ view, shown, filter, store }: Props) {
  const { repos, skills, models, efforts } = filterOptions(view);
  const active = isFiltering(filter);
  const modelsWorthIt = models.length > 1 || efforts.length > 1;
  if (repos.length < 2 && skills.length === 0 && !modelsWorthIt && !active) return null;

  return (
    <section className="filters" data-active={active} aria-label="Filtros">
      <div className="filter-row">
        <span className="filter-label">
          <FilterIcon size={13} /> Repos
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
              {count(shown)} de {count(view)} sesiones
            </span>
            <button className="ghost" onClick={() => store.clearFilter()}>
              <XIcon size={13} /> Quitar filtros
            </button>
          </>
        )}
      </div>

      {(modelsWorthIt || filter.models.length > 0 || filter.efforts.length > 0) && (
        <div className="filter-row">
          <span className="filter-label">
            <RobotIcon size={13} /> Modelo
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
              title={`Esfuerzo ${e.value}`}
            >
              esfuerzo {effortName(e.value)} <span className="muted">{e.sessions}</span>
            </button>
          ))}
        </div>
      )}

      {skills.length > 0 && (
        <div className="filter-row">
          <span className="filter-label">
            <ZapIcon size={13} /> Skills
          </span>
          {SKILL_SOURCES.filter((src) => skills.some((k) => k.source === src)).map((src) => (
            <button
              key={src}
              className="filter-chip source"
              data-source={src}
              aria-pressed={filter.sources.includes(src)}
              onClick={() => store.toggleSourceFilter(src)}
            >
              {SKILL_SOURCE_LABEL[src]}
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
              title={`${SKILL_SOURCE_LABEL[k.source]} · la lanzó ${[k.byUser && "tú", k.byAgent && "el agente"]
                .filter(Boolean)
                .join(" y ")}`}
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
