import { useEffect, useState, type DependencyList } from "react";

export function useResource<T>(
  load: () => Promise<T>,
  initial: T,
  deps: DependencyList = []
) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const next = await load();
        if (active) {
          setData(next);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void run();
    return () => {
      active = false;
    };
  }, deps);

  return { data, loading, error };
}
