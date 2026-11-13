import clsx from "clsx";
import { FlaskConical, Globe, LogOut, Menu, NotebookText, Settings, ShieldCheck, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { track } from "../lib/track";
import { buttonClass } from "./ui";

export function Logo({ to = "/", className, size = "md" }: { to?: string; className?: string; size?: "sm" | "md" }) {
  return (
    <Link
      to={to}
      aria-label="First Five home"
      className={clsx(
        "inline-flex items-baseline rounded-md font-extrabold tracking-[-0.06em] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        size === "md" ? "text-[25px]" : "text-[20px]",
        className,
      )}
    >
      firstfive<span className="text-accent">.</span>
    </Link>
  );
}

// ───────────────────────────── Marketing ─────────────────────────────

const MARKETING_LINKS = [
  { hash: "how", label: "How it works" },
  { hash: "example", label: "Example report" },
  { hash: "pricing", label: "Pricing" },
];

function SectionLink({ hash, children, className, onClick }: { hash: string; children: ReactNode; className?: string; onClick?: () => void }) {
  const location = useLocation();
  if (location.pathname === "/") {
    return (
      <a href={`#${hash}`} className={className} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <Link to={`/#${hash}`} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

export function MarketingHeader() {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname, location.hash]);
  const navLink = "rounded-md px-1 py-2 text-[13px] font-semibold text-[#4C5F62] transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  return (
    <header className="relative z-30 border-b border-[#EDF2EE] bg-canvas">
      <div className="mx-auto flex h-[68px] max-w-[1180px] items-center justify-between gap-4 px-5 sm:h-[78px] sm:px-[34px]">
        <Logo />
        <nav className="hidden items-center gap-[30px] md:flex" aria-label="Main">
          {MARKETING_LINKS.map((l) => (
            <SectionLink key={l.hash} hash={l.hash} className={navLink}>
              {l.label}
            </SectionLink>
          ))}
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          {me ? (
            <Link to="/app" className="hidden px-3 py-3 text-[13px] font-bold text-ink hover:text-accent sm:inline-block">
              Open workspace
            </Link>
          ) : (
            <Link to="/login" className="hidden px-3 py-3 text-[13px] font-bold text-ink hover:text-accent sm:inline-block">
              Sign in
            </Link>
          )}
          <Link to="/access" onClick={() => track("paid_cta_clicked", "header")} className={buttonClass("primary", "md", "h-11 px-[18px] text-[13px]")}>
            Get access <span aria-hidden>↗</span>
          </Link>
          <button
            className="rounded-md p-2 text-ink-soft hover:bg-mint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="marketing-menu"
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="marketing-menu" aria-label="Main" className="border-t border-line bg-canvas px-5 pb-4 pt-2 md:hidden">
          {MARKETING_LINKS.map((l) => (
            <SectionLink key={l.hash} hash={l.hash} className="block rounded-md px-2 py-3 text-[15px] font-semibold text-ink hover:bg-mint">
              {l.label}
            </SectionLink>
          ))}
          <Link to={me ? "/app" : "/login"} className="block rounded-md px-2 py-3 text-[15px] font-semibold text-ink hover:bg-mint">
            {me ? "Open workspace" : "Sign in"}
          </Link>
        </nav>
      )}
    </header>
  );
}

export function MarketingFooter() {
  const link = "text-[13px] text-[#657D72] hover:text-accent";
  return (
    <footer className="border-t border-[#EAF0EC] bg-white">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-8 px-5 py-10 sm:px-[34px] md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <Logo size="sm" />
          <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
            See whether real people can use what you built — and learn what to improve.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2.5 sm:grid-cols-3">
          <SectionLink hash="how" className={link}>
            How it works
          </SectionLink>
          <SectionLink hash="pricing" className={link}>
            Pricing
          </SectionLink>
          <Link to="/privacy" className={link}>
            Privacy
          </Link>
          <Link to="/terms" className={link}>
            Terms
          </Link>
          <Link to="/login" className={link}>
            Sign in
          </Link>
          <Link to="/waitlist" className={link}>
            Waitlist
          </Link>
        </nav>
      </div>
      <div className="border-t border-[#EAF0EC] py-4 text-center text-[11px] text-ink-muted">© {new Date().getFullYear()} First Five</div>
    </footer>
  );
}

export function MarketingLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <MarketingHeader />
      <main className="flex-1">{children ?? <Outlet />}</main>
      <MarketingFooter />
    </div>
  );
}

// ───────────────────────────── App shell ─────────────────────────────

const NAV = [
  { to: "/app/websites", label: "Websites", icon: Globe },
  { to: "/app/tests", label: "Tests", icon: FlaskConical },
  { to: "/app/reports", label: "Reports", icon: NotebookText },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

export function AppLayout() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [location.pathname]);

  const links = [...NAV, ...(me?.user.role === "superadmin" ? [{ to: "/app/admin", label: "Superadmin", icon: ShieldCheck }] : [])];
  const navItems = links.map((l) => (
    <NavLink
      key={l.to}
      to={l.to}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          isActive ? "bg-accent-soft text-accent-ink" : "text-ink-soft hover:bg-slate-100 hover:text-ink",
        )
      }
    >
      <l.icon className="h-4 w-4" aria-hidden />
      {l.label}
    </NavLink>
  ));

  const signOut = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-content items-center gap-6 px-4 sm:px-6">
          <Logo to="/app" />
          <nav className="hidden items-center gap-1 md:flex" aria-label="App">
            {navItems}
          </nav>
          <div className="ml-auto hidden items-center gap-3 md:flex">
            <span className="max-w-[14rem] truncate text-sm text-ink-muted" title={me?.user.email}>
              {me?.user.name || me?.user.email}
            </span>
            <button onClick={signOut} className={buttonClass("ghost", "sm")}>
              <LogOut className="h-4 w-4" aria-hidden /> Log out
            </button>
          </div>
          <button
            className="ml-auto rounded-md p-2 text-ink-soft hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {open && (
          <nav id="mobile-nav" className="space-y-1 border-t border-line px-4 py-3 md:hidden" aria-label="App">
            {navItems}
            <button onClick={signOut} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-slate-100">
              <LogOut className="h-4 w-4" aria-hidden /> Log out
            </button>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-content px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  );
}

// ───────────────────────────── Participant ─────────────────────────────

export function ParticipantLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-2xl items-center px-4">
          <span className="inline-flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-xs font-bold text-white" aria-hidden>
              F
            </span>
            <span className="text-sm font-semibold text-ink">First Five</span>
            <span className="text-sm text-ink-muted">· Usability test</span>
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:py-12">{children}</main>
    </div>
  );
}

