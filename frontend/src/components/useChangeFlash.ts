import { useEffect, useRef, useState } from "react";

/** How long a changed value stays marked; the CSS highlight fades out over the same time. */
export const CHANGE_FLASH_MS = 1200;

/**
 * True for a moment after `value` changes while the component stays on screen, such as when a background refresh
 * brings a new rate. The first render never flashes, so loading a page or switching variety stays calm.
 */
export function useChangeFlash(value: string) {
  const previous = useRef(value);
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setFlashing(true);
    const timer = setTimeout(() => setFlashing(false), CHANGE_FLASH_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return flashing;
}
