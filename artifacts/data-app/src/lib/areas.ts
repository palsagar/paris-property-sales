import { arrLabel } from "./fmt";

export type DepartmentId = "92" | "93" | "94";
export type RankGroup = "paris" | DepartmentId | "major";
export type Area =
  | { kind: "paris" }
  | { kind: "department"; id: DepartmentId }
  | { kind: "arr"; arr: number }
  | { kind: "q"; id: string }
  | { kind: "commune"; id: string };

export const DEPARTMENT_NAMES: Record<DepartmentId, string> = {
  "92": "Hauts-de-Seine",
  "93": "Seine-Saint-Denis",
  "94": "Val-de-Marne",
};

export function areaParams(a: Area): { department?: DepartmentId; arrondissement?: number; quartier?: string; commune?: string } {
  switch (a.kind) {
    case "department": return { department: a.id };
    case "arr": return { arrondissement: a.arr };
    case "q": return { quartier: a.id };
    case "commune": return { commune: a.id };
    default: return {};
  }
}

/**
 * The `placeholderData` option of a query that depends on the Area. While a new Period or property type loads, a panel
 * keeps its figures. While a new Area loads, it has none, so one Area's figures never appear under another Area's name.
 */
export function keepInSameArea(a: ReturnType<typeof areaParams>) {
  return <T,>(previous: T | undefined, query?: { queryKey: readonly unknown[] }): T | undefined => {
    const p = (query?.queryKey[1] ?? {}) as ReturnType<typeof areaParams>;
    return p.department === a.department && p.arrondissement === a.arrondissement && p.quartier === a.quartier && p.commune === a.commune ? previous : undefined;
  };
}

/** The group a Commune code belongs to, from its first two characters. */
const groupOfCommune = (id: string): RankGroup => {
  const d = id.slice(0, 2);
  return d === "92" || d === "93" || d === "94" ? d : "major";
};

export function groupOfArea(a: Area): RankGroup {
  if (a.kind === "department") return a.id;
  if (a.kind === "commune") return groupOfCommune(a.id);
  return "paris";
}

/**
 * The view change of a click on an Area. A click on the selected Area clicks it off, back to Paris. A dot passes
 * `clickOff` false: it only selects, so a double-click on a dot does not undo the selection.
 */
export function areaChange(current: Area, a: Area, clickOff = true): { area?: Area; rank?: RankGroup } {
  const same = JSON.stringify(a) === JSON.stringify(current);
  if (same && !clickOff) return {};
  return { area: same ? { kind: "paris" } : a, rank: groupOfArea(a) };
}

/** The Area of one Sale: its Arrondissement in Paris, its Commune elsewhere. */
export function saleArea(t: { arrondissement: number | null; commune: string | null; communeName: string | null }): { id: string; label: string; area: Area } {
  if (t.arrondissement != null) return { id: String(t.arrondissement), label: arrLabel(t.arrondissement), area: { kind: "arr", arr: t.arrondissement } };
  const id = t.commune ?? "";
  return { id, label: t.communeName ?? "", area: { kind: "commune", id } };
}

/** The Area a click on a Sale's dot selects: the one recorded on the Sale, at the chosen map level. A Commune has no Quartiers. */
export function pointArea(p: { arrondissement: number | null; commune: string | null; quartier: string | null }, level: "arr" | "quartier"): Area {
  if (level === "quartier" && p.quartier != null) return { kind: "q", id: p.quartier };
  return saleArea({ ...p, communeName: null }).area;
}

export interface MapFeature {
  arr?: number;
  id?: string;
  name: string;
  group?: RankGroup;
}

export const featureId = (p: MapFeature): string => p.id ?? String(p.arr);

export function featureArea(p: MapFeature): Area {
  if (p.id === undefined) return { kind: "arr", arr: p.arr as number };
  return p.id.length === 7 ? { kind: "q", id: p.id } : { kind: "commune", id: p.id };
}

/**
 * Whether a map feature is the selected Area, and whether it is in focus (drawn at full strength).
 * `parentArr` is the Arrondissement of the selected Quartier, so that its parent stays in focus.
 */
export function featureState(p: MapFeature, a: Area, parentArr?: number): { selected: boolean; focus: boolean } {
  switch (a.kind) {
    case "paris":
      return { selected: false, focus: true };
    case "department": {
      const on = p.id !== undefined && p.group === a.id;
      return { selected: on, focus: on };
    }
    case "arr": {
      const on = p.id === undefined && p.arr === a.arr;
      return { selected: on, focus: on || (p.id !== undefined && p.arr === a.arr) };
    }
    case "q": {
      const on = p.id === a.id;
      return { selected: on, focus: on || (p.id === undefined && parentArr !== undefined && p.arr === parentArr) };
    }
    case "commune": {
      const on = p.id === a.id;
      return { selected: on, focus: on };
    }
  }
}

/** Old town names that a Visitor may still type. */
const OLD_NAMES: Record<string, string> = { "93066": "Pierrefitte-sur-Seine" };

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** The text the search box matches against: the name, the name without accents, the id and any old name. */
export function searchValue(name: string, id: string): string {
  return [name, plain(name), id, OLD_NAMES[id] ?? ""].join(" ").toLowerCase();
}

/** The usual French short forms of a typed word. */
const SHORT_FORMS: Record<string, string> = { st: "saint", ste: "sainte" };

/**
 * The search box's filter. It scores 0 when the value misses a typed word, else 1 for a plain match, 2 when the
 * name starts with the typed text and 3 when the name is the typed text. The search component sorts by this score,
 * so "Saint-Denis" puts the Commune before the Department Seine-Saint-Denis. The component's own fuzzy match
 * lets "evry" find Ville-d'Avray first, and Enter would then select it. The value starts with the name, then
 * repeats it without accents. The comparison ignores accents, case and the difference between a hyphen and a space.
 */
export function searchScore(value: string, search: string): number {
  const typed = plain(search).replace(/’/g, "'").toLowerCase();
  const words = typed.split(/[\s-]+/).filter(Boolean).map((w) => SHORT_FORMS[w] ?? w);
  if (!words.every((w) => value.includes(w))) return 0;
  const phrase = words.join(" ");
  const text = plain(value).replace(/-/g, " ");
  if (text.startsWith(`${phrase} ${phrase} `)) return 3;
  return text.startsWith(phrase) ? 2 : 1;
}
