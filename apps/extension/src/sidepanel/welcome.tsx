import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BRAND } from "../brand";
import { ExcalidrawFileIcon, FOLDER_PLUS, Icon, Logo, UPLOAD } from "./common";

/**
 * The start screen, in the spirit of Excalidraw's own: a centred logo and wordmark, a short handwritten
 * line, a plain list of first actions, and handwritten captions with hand-drawn arrows pointing at
 * the real controls around it (top: search/upload/new and your spaces; bottom: encryption and autosave).
 * It fills the list area, so the controls it points at stay visible above and below it.
 * Shown whenever "My files" is empty, and on demand from the profile menu.
 */

type Dir = "up" | "down";

/** A wobbly arrow, drawn rather than ruled, like the arrows on Excalidraw's welcome screen. */
function HandArrow({ dir, mirror, style }: { dir: Dir; mirror?: boolean; style: CSSProperties }) {
  const flip = `${mirror ? "scaleX(-1) " : ""}${dir === "down" ? "scaleY(-1)" : ""}`.trim();
  return (
    <svg className="w-arrow" style={{ ...style, transform: flip || undefined }} width="40" height="58" viewBox="0 0 40 58" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 55 C 13 41, 29 29, 20 6" />
      <path d="M10 16 L20 4 L31 14" />
    </svg>
  );
}

function Hint({ children, className }: { children: ReactNode; className: string }) {
  return <div className={`w-hint hand ${className}`}>{children}</div>;
}

export interface WelcomeProps {
  canCreate: boolean;
  onUpload: () => void;
  onNewDrawing: () => void;
  onNewFolder: () => void;
  /** Present when shown on demand (profile menu): lets the person dismiss it. */
  onClose?: () => void;
}

export function WelcomeScreen({ canCreate, onUpload, onNewDrawing, onNewFolder, onClose }: WelcomeProps) {
  // Like Excalidraw, drop the hints when there is not enough room instead of letting them collide.
  const root = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(true);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const check = () => setRoom(el.clientHeight >= 430 && el.clientWidth >= 300);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const Item = ({ icon, label, hint, onClick }: { icon: ReactNode; label: string; hint?: string; onClick: () => void }) => (
    <button className="w-item" onClick={onClick} disabled={!canCreate}>
      {icon}
      <span className="grow">{label}</span>
      {hint && <span className="w-item-hint">{hint}</span>}
    </button>
  );

  return (
    <div className="welcome" ref={root} role="region" aria-label="Welcome">
      {room && (
        <>
          <HandArrow dir="up" mirror style={{ left: 12, top: 0 }} />
          <Hint className="w-hint-tl">Your spaces<br />and trash</Hint>
          <HandArrow dir="up" style={{ right: 12, top: 0 }} />
          <Hint className="w-hint-tr">Search, upload<br />or create</Hint>
          <HandArrow dir="down" mirror style={{ left: 12, bottom: 0 }} />
          <Hint className="w-hint-bl">Your drawings<br />are encrypted</Hint>
          <HandArrow dir="down" style={{ right: 12, bottom: 0 }} />
          <Hint className="w-hint-br">Autosave<br />status</Hint>
        </>
      )}

      <div className="w-center">
        <div className="w-logo">
          <Logo size={44} />
          <span className="hand w-word">{BRAND}</span>
        </div>
        <p className="hand w-heading">
          Your Excalidraw drawings,
          <br />
          saved free in the cloud.
        </p>
        <div className="w-menu">
          <Item icon={<Icon d={UPLOAD} size={18} />} label="Upload a file" hint="or drop it here" onClick={onUpload} />
          <Item icon={<ExcalidrawFileIcon size={18} />} label="New drawing" onClick={onNewDrawing} />
          <Item icon={<Icon d={FOLDER_PLUS} size={18} />} label="New folder" onClick={onNewFolder} />
        </div>
        {onClose && (
          <button className="btn small primary" onClick={onClose}>
            Got it
          </button>
        )}
      </div>
    </div>
  );
}
