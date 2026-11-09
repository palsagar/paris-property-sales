import { track } from "@/lib/analytics";
import { t } from "@/lib/i18n/messages";

const linkCls = "no-tap tap-area underline underline-offset-2 decoration-foreground/30 hover:text-foreground";

/** The author line at the top right. Plain links: the page makes no request to GitHub, and shows no star count. */
export function AuthorLinks() {
  const a = t().author;
  return (
    <p className="text-[12px] md:text-[13px] leading-tight text-muted-foreground whitespace-nowrap">
      {a.by}{" "}
      <a href="https://sagar-pal.dev" target="_blank" rel="noopener noreferrer" className={linkCls} data-testid="link-author-site"
        onClick={() => track("author-link", { target: "site" })}>Sagar Pal</a>
      {" · "}
      <a href="https://github.com/palsagar/paris-property-sales" target="_blank" rel="noopener noreferrer" className={linkCls} data-testid="link-author-github"
        onClick={() => track("author-link", { target: "github" })}>
        <span aria-hidden>★ </span><span className="md:hidden print:hidden">{a.starShort}</span><span className="hidden md:inline print:inline">{a.star}</span>
      </a>
    </p>
  );
}
