import { SHORTCUTS } from '../lib/shortcuts';
import { useEditor } from '../state/store';

export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} data-testid="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function ShortcutsDialog() {
  const open = useEditor((s) => s.showShortcuts);
  const set = useEditor((s) => s.set);
  if (!open) return null;
  return (
    <div className="modal-back" onClick={() => set({ showShortcuts: false })}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Keyboard shortcuts</h3>
        <table className="table">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys}>
                <td style={{ width: 170 }}>
                  <span className="kbd">{s.keys}</span>
                </td>
                <td>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="faint" style={{ marginBottom: 0 }}>
          Canvas: drag the white handles to resize, the green bars to change padding/margin (Alt: both sides, Alt+Shift: all), Shift snaps to 8px. Double-click text to edit it.
        </p>
      </div>
    </div>
  );
}
