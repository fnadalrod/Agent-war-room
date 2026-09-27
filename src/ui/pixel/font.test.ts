import { describe, expect, it } from "vitest";
import { fit, normalize, textWidth } from "./font";

describe("fuente 3×5", () => {
  it("pasa a mayúsculas sin tildes y marca lo que no sabe pintar", () => {
    expect(normalize("Revisión ñ€")).toBe("REVISION N?");
  });

  it("mide 4 píxeles por carácter menos el último hueco", () => {
    expect(textWidth("ABC")).toBe(11);
    expect(textWidth("")).toBe(0);
  });

  it("recorta con punto final lo que no cabe", () => {
    expect(fit("Arreglar login", 23)).toBe("ARREG.");
    expect(textWidth(fit("Arreglar login", 23))).toBeLessThanOrEqual(23);
    expect(fit("OK", 23)).toBe("OK");
  });
});
