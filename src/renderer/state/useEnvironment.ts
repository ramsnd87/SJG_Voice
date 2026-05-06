import { useEffect, useState } from "react";

declare global {
  interface Window {
    gsb?: {
      pickFile: (opts?: { filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
      env: () => Promise<{ sidecarPort: number; ramLogoPath: string; appVersion: string }>;
    };
  }
}

export interface Environment {
  sidecarPort: number;
  ramLogoPath: string;
  appVersion: string;
  ready: boolean;
}

export function useEnvironment(): Environment {
  const [env, setEnv] = useState<Environment>({ sidecarPort: 8044, ramLogoPath: "", appVersion: "", ready: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (window.gsb) {
        const e = await window.gsb.env();
        if (!cancelled) setEnv({ ...e, ready: true });
      } else {
        if (!cancelled) setEnv((s) => ({ ...s, ready: true }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return env;
}
