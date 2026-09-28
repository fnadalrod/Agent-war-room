import type { FilterStorage } from "../application/ports";
import type { Filter } from "../domain/attention";

const KEY = "awr.filter";

/** Filter in `localStorage`. If unavailable (or holding garbage), start with no filter. */
export const localFilterStorage: FilterStorage = {
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const f = JSON.parse(raw) as Partial<Filter>;
      const list = (x: unknown) => (Array.isArray(x) ? x.filter((i) => typeof i === "string") : []);
      return {
        repos: list(f.repos),
        skills: list(f.skills),
        sources: list(f.sources) as Filter["sources"],
        models: list(f.models),
        efforts: list(f.efforts),
      };
    } catch {
      return null;
    }
  },
  save(filter) {
    try {
      localStorage.setItem(KEY, JSON.stringify(filter));
    } catch {
      // No storage: the filter lasts as long as the window.
    }
  },
};
