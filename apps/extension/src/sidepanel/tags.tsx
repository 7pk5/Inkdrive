import { useCallback, useEffect, useState } from "react";
import { MAX_TAGS_PER_USER, TagColor, type FileMeta, type Tag, type TagWithCount } from "@ecd/shared";
import { Modal } from "./dialogs";
import { api, CLOSE, Icon, msg } from "./common";

export const TAG_COLORS = TagColor.options;
const COLOR_NAME: Record<(typeof TAG_COLORS)[number], string> = { gray: "Gray", red: "Red", orange: "Orange", yellow: "Yellow", green: "Green", teal: "Teal", blue: "Blue", purple: "Purple" };

/** A coloured dot; the colour comes from CSS (themed), never from the data. */
export const TagDot = ({ color }: { color: string }) => <span className="tag-dot" data-color={color} aria-hidden="true" />;

export const TagChip = ({ tag }: { tag: Tag }) => (
  <span className="tag-chip">
    <TagDot color={tag.color} />
    {tag.name}
  </span>
);

function ColorPicker({ value, onChange, label }: { value: string; onChange: (c: TagColor) => void; label: string }) {
  return (
    <span className="swatches" role="radiogroup" aria-label={label}>
      {TAG_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={COLOR_NAME[c]} title={COLOR_NAME[c]} className="swatch" data-color={c} data-on={value === c} onClick={() => onChange(c)} />
      ))}
    </span>
  );
}

/** Tag one file or folder: tick tags, or make a new one on the spot. Tags are private to you. */
export function TagsDialog({ item, onClose, onSaved }: { item: FileMeta; onClose: () => void; onSaved: () => void }) {
  const [all, setAll] = useState<TagWithCount[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(item.tags.map((t) => t.id)));
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("blue");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ tags: TagWithCount[] }>("GET", "/v1/tags").then((r) => setAll(r.status === 200 ? r.body.tags : []));
  }, []);

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setErr("");
    const r = await api("POST", "/v1/tags", { name: name.trim(), color });
    if (r.status === 201) {
      setAll([...(all ?? []), r.body].sort((a, b) => a.name.localeCompare(b.name)));
      setPicked(new Set(picked).add(r.body.id));
      setName("");
    } else setErr(r.status === 409 ? "You already have a tag with that name." : r.status === 400 ? `You can have up to ${MAX_TAGS_PER_USER} tags.` : `Could not create it (${r.status})`);
  };

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api("PUT", `/v1/files/${item.id}/tags`, { tagIds: [...picked] });
      if (r.status !== 200) throw new Error(`Could not save (${r.status})`);
      onSaved();
      onClose();
    } catch (e) {
      setErr(msg(e, "Could not save"));
      setBusy(false);
    }
  };

  return (
    <Modal title={`Tags for “${item.name}”`} onClose={onClose}>
      <div className="tag-list" role="group" aria-label="Your tags">
        {all === null && <div className="muted">Loading…</div>}
        {all?.length === 0 && <div className="muted" style={{ padding: "4px 0" }}>No tags yet. Make your first one below.</div>}
        {all?.map((t) => (
          <label key={t.id} className="tag-row">
            <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} />
            <TagDot color={t.color} />
            <span className="grow name">{t.name}</span>
          </label>
        ))}
      </div>
      <form onSubmit={create} style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        <label className="meta" htmlFor="new-tag" style={{ fontWeight: 600 }}>New tag</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input id="new-tag" className="input" maxLength={40} placeholder="For example: Client work" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" style={{ minHeight: 40 }} disabled={!name.trim()}>Add</button>
        </div>
        <ColorPicker value={color} onChange={setColor} label="Colour for the new tag" />
      </form>
      {err && <div className="error" role="alert">{err}</div>}
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>Tags are private to you.</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>Save</button>
      </div>
    </Modal>
  );
}

/** Rename, recolour and delete tags (opened from the profile menu). */
export function TagsManager({ onClose }: { onClose: () => void }) {
  const [tags, setTags] = useState<TagWithCount[] | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("blue");
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ tags: TagWithCount[] }>("GET", "/v1/tags");
    if (r.status === 200) setTags(r.body.tags);
  }, []);
  useEffect(() => void load(), [load]);

  const guarded = async (fn: () => Promise<{ status: number }>) => {
    setErr("");
    const r = await fn();
    if (r.status === 409) setErr("You already have a tag with that name.");
    else if (r.status === 400) setErr(`You can have up to ${MAX_TAGS_PER_USER} tags.`);
    else if (r.status >= 400) setErr(`That did not work (${r.status}).`);
    await load();
  };

  return (
    <Modal title="Manage tags" onClose={onClose}>
      <div className="tag-list">
        {tags === null && <div className="muted">Loading…</div>}
        {tags?.length === 0 && <div className="muted" style={{ padding: "4px 0" }}>No tags yet. Add one below, then tag files from their ⋯ menu.</div>}
        {tags?.map((t) => (
          <div key={t.id} className="tag-manage">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <TagDot color={t.color} />
              <input
                className="input"
                style={{ height: 36 }}
                aria-label={`Name of tag ${t.name}`}
                defaultValue={t.name}
                maxLength={40}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== t.name) void guarded(() => api("PATCH", `/v1/tags/${t.id}`, { name: v }));
                  else e.target.value = t.name;
                }}
              />
              <span className="meta" style={{ whiteSpace: "nowrap" }}>{t.count} {t.count === 1 ? "item" : "items"}</span>
              {confirmDel === t.id ? (
                <button className="btn small primary" onClick={() => { setConfirmDel(null); void guarded(() => api("DELETE", `/v1/tags/${t.id}`)); }}>Delete</button>
              ) : (
                <button className="icon-btn" aria-label={`Delete tag ${t.name}`} onClick={() => setConfirmDel(t.id)}><Icon d={CLOSE} size={16} /></button>
              )}
            </div>
            <ColorPicker value={t.color} onChange={(c) => void guarded(() => api("PATCH", `/v1/tags/${t.id}`, { color: c }))} label={`Colour for ${t.name}`} />
          </div>
        ))}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await guarded(() => api("POST", "/v1/tags", { name: name.trim(), color }));
          setName("");
        }}
        style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}
      >
        <label className="meta" htmlFor="manage-new-tag" style={{ fontWeight: 600 }}>New tag</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input id="manage-new-tag" className="input" maxLength={40} placeholder="Tag name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" style={{ minHeight: 40 }} disabled={!name.trim()}>Add</button>
        </div>
        <ColorPicker value={color} onChange={setColor} label="Colour for the new tag" />
      </form>
      {err && <div className="error" role="alert">{err}</div>}
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>Deleting a tag only removes the label; your drawings are not touched.</p>
      <button className="btn primary" onClick={onClose}>Done</button>
    </Modal>
  );
}
