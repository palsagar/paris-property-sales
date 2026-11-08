import { getLang } from "./language";
import { en, type Messages } from "./en";
import { fr } from "./fr";

/** The texts in the current language. Read it at render time, never at module load. */
export const t = (): Messages => (getLang() === "fr" ? fr : en);
