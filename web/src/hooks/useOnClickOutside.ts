import { useEffect } from "react";

export default function useOnClickOutside<T extends HTMLElement>(
  ref: { readonly current: T | null },
  handler: () => void,
): void {
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      const element = ref.current;
      if (!element || !(target instanceof Node) || element.contains(target)) return;
      handler();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [ref, handler]);
}
