import { useEffect, useRef, useState } from "react";
import {
  CHAT_ALWAYS_NOTE,
  DESK_TABS,
  platformGateNote,
  tabChosen,
  tabInBar,
  type DeskView,
  type TabSettings,
} from "../../shared/desk-tabs";
import type { PlatformSelection } from "../../shared/platform/selection";
import { CheckRow } from "./CheckRow";

function place(x: number, y: number): { x: number; y: number } {
  const maxX = Math.max(8, window.innerWidth - 180);
  const maxY = Math.max(8, window.innerHeight - 72);
  return {
    x: Math.min(Math.max(8, x), maxX),
    y: Math.min(Math.max(8, y), maxY),
  };
}

/** Right-click menu for a tab the user can hide. Chat has no button here. */
export function HideTabMenu({ x, y, onHide }: { x: number; y: number; onHide: () => void }) {
  return (
    <div
      className="tab-menu"
      style={{ left: x, top: y }}
      role="menu"
      data-testid="hide-tab-menu"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button type="button" role="menuitem" data-testid="hide-tab" onClick={onHide}>
        Hide tab
      </button>
    </div>
  );
}

/** Top-bar panels. Chat is the desk itself, so it is not one of these buttons. */
export function DeskTabs({
  view,
  tabs,
  platforms,
  onOpen,
  onHide,
}: {
  view: DeskView;
  tabs: TabSettings;
  platforms: PlatformSelection;
  onOpen: (view: DeskView) => void;
  onHide: (id: string) => void;
}) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    function onPointer(event: MouseEvent): void {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setMenu(null);
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setMenu(null);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const buttons = DESK_TABS.filter((tab) => !tab.locked && tabInBar(tabs, platforms, tab.id));
  return (
    <>
      {buttons.map((tab) => (
        <button
          key={tab.id}
          type="button"
          data-testid={`desk-tab-${tab.id}`}
          className={view === tab.view ? "text-button on" : "text-button"}
          title="Right-click to hide"
          onClick={() => onOpen(view === tab.view ? "desk" : tab.view)}
          onContextMenu={(event) => {
            event.preventDefault();
            const next = place(event.clientX, event.clientY);
            setMenu({ id: tab.id, x: next.x, y: next.y });
          }}
        >
          {tab.label}
        </button>
      ))}
      {menu ? (
        <div ref={menuRef} className="tab-menu-host">
          <HideTabMenu
            x={menu.x}
            y={menu.y}
            onHide={() => {
              onHide(menu.id);
              setMenu(null);
            }}
          />
        </div>
      ) : null}
    </>
  );
}

/** Settings list. Checked means the tab stays in the bar. Chat is checked and locked. */
export function TabPicker({
  tabs,
  platforms,
  onToggle,
}: {
  tabs: TabSettings;
  platforms: PlatformSelection;
  onToggle: (id: string, shown: boolean) => void;
}) {
  return (
    <div className="tab-picker" data-testid="tab-picker">
      {DESK_TABS.map((tab) => {
        const note = platformGateNote(tab, tabs, platforms);
        return (
          <CheckRow key={tab.id} id={`tab-${tab.id}`} checked={tabChosen(tabs, tab.id)} disabled={tab.locked} onChange={(checked) => onToggle(tab.id, checked)}>
            {tab.label}
            {tab.locked ? <span className="count"> {CHAT_ALWAYS_NOTE}</span> : null}
            {note ? <span className="count"> {note}</span> : null}
          </CheckRow>
        );
      })}
    </div>
  );
}
