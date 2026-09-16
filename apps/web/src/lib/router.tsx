import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Minimal hash router — routing lives in the front-end, no external dependency.
interface RouterCtx {
  path: string;
  navigate: (to: string) => void;
}

const Ctx = createContext<RouterCtx>({ path: "/", navigate: () => {} });

function currentPath() {
  const h = window.location.hash.replace(/^#/, "");
  return h || "/";
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(currentPath());

  useEffect(() => {
    const onHash = () => {
      setPath(currentPath());
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = (to: string) => {
    window.location.hash = to;
  };

  return <Ctx.Provider value={{ path, navigate }}>{children}</Ctx.Provider>;
}

export function useRouter() {
  return useContext(Ctx);
}

// Match "/events/:slug" style patterns.
export function matchRoute(path: string, pattern: string): Record<string, string> | null {
  const p = path.split("?")[0].split("/").filter(Boolean);
  const pat = pattern.split("/").filter(Boolean);
  if (p.length !== pat.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pat.length; i++) {
    if (pat[i].startsWith(":")) params[pat[i].slice(1)] = decodeURIComponent(p[i]);
    else if (pat[i] !== p[i]) return null;
  }
  return params;
}
