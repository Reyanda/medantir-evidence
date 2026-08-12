import { useEffect, useRef } from "react";

// Close a popover/dropdown when the user clicks or touches outside its boundary.
// Pass the open state and a setter — the hook binds a document listener that fires
// only while the popover is open.
export default function useClickOutside(open, setOpen) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    // Use capture so we see the event before any other handler stops propagation.
    document.addEventListener("mousedown", handler, true);
    document.addEventListener("touchstart", handler, true);
    return () => {
      document.removeEventListener("mousedown", handler, true);
      document.removeEventListener("touchstart", handler, true);
    };
  }, [open, setOpen]);

  return ref;
}
