import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";

/** A reviewer panel is either locked, holding what is typed so far, or unlocked with the trimmed token it was opened with. */
type Access = { status: "locked"; draft: string } | { status: "unlocked"; token: string };

/**
 * The lock/unlock gate shared by reviewer panels. The token is held in memory only, and the queries named by
 * `queryKeys` (whose keys carry the token) are removed on locking and when the panel goes away.
 */
export function useReviewerAccess(queryKeys: readonly string[]) {
  const client = useQueryClient();
  const [access, setAccess] = useState<Access>({ status: "locked", draft: "" });
  const keys = useRef(queryKeys);
  keys.current = queryKeys;
  const clearQueries = () => { for (const key of keys.current) client.removeQueries({ queryKey: [key] }); };
  useEffect(() => clearQueries, [client]);
  const draft = access.status === "locked" ? access.draft : "";
  return {
    unlocked: access.status === "unlocked",
    /** Empty while locked, so queries keyed on it stay disabled. */
    token: access.status === "unlocked" ? access.token : "",
    draft,
    canUnlock: draft.trim() !== "",
    setDraft: (value: string) => setAccess({ status: "locked", draft: value }),
    unlock(event?: FormEvent) {
      event?.preventDefault();
      const token = draft.trim();
      if (token) setAccess({ status: "unlocked", token });
    },
    lock() {
      clearQueries();
      setAccess({ status: "locked", draft: "" });
    },
  };
}
