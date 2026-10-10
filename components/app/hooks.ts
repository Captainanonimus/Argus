"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, errorMessage, fetchJson, isAbortError, type SettingsStatus } from "@/lib/clientApi";

export const SETTINGS_CHANGED = "argus:settings-changed";

export function announceSettingsChanged() {
  window.dispatchEvent(new Event(SETTINGS_CHANGED));
}

// /api/settings/status, refreshed every 30s and whenever a key is saved.
export function useSettingsStatus() {
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await fetchJson<SettingsStatus>("/api/settings/status"));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30_000);
    window.addEventListener(SETTINGS_CHANGED, load);
    return () => {
      clearInterval(id);
      window.removeEventListener(SETTINGS_CHANGED, load);
    };
  }, [load]);

  return { status, error, reload: load };
}

// One JSON resource with loading / error / reload. Aborts on unmount or
// when the URL changes.
export function useJson<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setErrorStatus(null);
    fetchJson<T>(url, { signal: controller.signal })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setError(errorMessage(err));
        setErrorStatus(err instanceof ApiError ? err.status : null);
        setLoading(false);
      });
    return () => controller.abort();
  }, [url, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, errorStatus, loading, reload, setData };
}

// Runs `fn` every `ms` while the tab is visible; pauses when hidden and
// runs once immediately when it becomes visible again.
export function useVisiblePoll(fn: (signal: AbortSignal) => Promise<void>, ms: number, enabled = true) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let stopped = false;

    const run = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      controller = new AbortController();
      try {
        await fnRef.current(controller.signal);
      } catch {
        // fn reports its own errors.
      }
      if (!stopped && document.visibilityState === "visible") timer = setTimeout(run, ms);
    };
    const onVisibility = () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") run();
      else controller?.abort();
    };

    run();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms, enabled]);
}

export function safeStorage(kind: "local" | "session") {
  return {
    get(key: string): string | null {
      try {
        return (kind === "local" ? window.localStorage : window.sessionStorage).getItem(key);
      } catch {
        return null;
      }
    },
    set(key: string, value: string) {
      try {
        (kind === "local" ? window.localStorage : window.sessionStorage).setItem(key, value);
      } catch {
        // Storage unavailable (private mode, quota); ignore.
      }
    },
    remove(key: string) {
      try {
        (kind === "local" ? window.localStorage : window.sessionStorage).removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}

export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}
