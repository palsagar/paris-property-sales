import { Fragment, createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getLang, saveLang, setLang, type Lang } from "./language";
import { t } from "./messages";

type LanguageValue = { lang: Lang; change: (l: Lang) => void };
const LanguageContext = createContext<LanguageValue>({ lang: "en", change: () => {} });

function applyToDocument() {
  document.documentElement.lang = getLang();
  document.title = t().header.siteName;
}

/**
 * Holds the language. A change redraws the whole page under a new key, so every text, including those built outside
 * React, is read again. The Selection lives in the URL and the data in the query cache, so nothing is fetched again.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setState] = useState<Lang>(getLang);
  useEffect(applyToDocument, [lang]);
  const change = useCallback((l: Lang) => {
    setLang(l);
    saveLang(l);
    setState(l);
  }, []);
  return (
    <LanguageContext.Provider value={{ lang, change }}>
      <Fragment key={lang}>{children}</Fragment>
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
