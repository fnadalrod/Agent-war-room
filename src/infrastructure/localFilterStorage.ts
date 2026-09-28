import type { FilterStorage } from "../application/ports";
import { type Filter, NO_FILTER } from "../domain/attention";

const KEY = "awr.filter";

/** Filtro en `localStorage`. Si no está disponible (o trae basura), se empieza sin filtro. */
export const localFilterStorage: FilterStorage = {
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const f = JSON.parse(raw) as Partial<Filter>;
      const list = (x: unknown) => (Array.isArray(x) ? x.filter((i) => typeof i === "string") : []);
      return { ...NO_FILTER, repos: list(f.repos), skills: list(f.skills), sources: list(f.sources) as Filter["sources"] };
    } catch {
      return null;
    }
  },
  save(filter) {
    try {
      localStorage.setItem(KEY, JSON.stringify(filter));
    } catch {
      // Sin almacenamiento: el filtro dura lo que la ventana.
    }
  },
};
