import { useEffect, useState } from "react";

/** Returns `value` only after it has stopped changing for `ms`, so typing does not fire a request per keystroke. */
export function useDebouncedValue<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}