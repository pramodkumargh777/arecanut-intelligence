import { useEffect, useState } from "react";

/** The phone breakpoint used in responsive.css. Keep the two in step. */
const PHONE_QUERY = "(max-width: 640px)";

const matches = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;

/**
 * True on phone-width screens, for layout that CSS alone cannot change, such as folding a section into a disclosure.
 * Server and test renders have no window and get the desktop layout.
 */
export function usePhone() {
  const [phone, setPhone] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}
