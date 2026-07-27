import { useEffect, useState } from "react";
import type { CodexModel, CodiconSettings, ControllerBindings } from "../types/codicon";

type Props = {
  open: boolean;
  settings: CodiconSettings;
  models: CodexModel[];
  onClose(): void;
  onChooseWorkspace(): void;
  onSave(settings: CodiconSettings): Promise<void>;
};

const BUTTON_NAMES = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "VIEW", "MENU", "LS", "RS", "DPAD ↑", "DPAD ↓", "DPAD ←", "DPAD →"];
const BINDING_LABELS: Array<[keyof ControllerBindings, string]> = [
  ["primary", "送信 / 承認"], ["cancel", "中断 / 拒否"], ["focusComposer", "キーボード入力"], ["newThread", "新規セッション"],
  ["powerWheel", "Power Ring（ホールド）"], ["pushToTalk", "Push to Talk（ホールド）"], ["settings", "設定パネル"],
  ["fastMode", "Fast mode 切替"],
];

export function SettingsPanel({ open, settings, models, onClose, onChooseWorkspace, onSave }: Props) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings, open]);
  if (!open) return null;

  const updateBinding = (key: keyof ControllerBindings, value: number) => setDraft({ ...draft, bindings: { ...draft.bindings, [key]: value } });
  const updateSlot = (index: number, modelId: string) => setDraft({ ...draft, modelSlots: draft.modelSlots.map((slot, slotIndex) => slotIndex === index ? { ...slot, modelId } : slot) });

  return (
    <div className="overlay-backdrop settings-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="settings-panel">
        <header><div><span>CONFIGURATION</span><h2 id="settings-title">Codicon Settings</h2></div><button className="close-button" onClick={onClose}>×</button></header>
        <div className="settings-scroll">
          <section className="settings-section">
            <div className="settings-copy"><span>01 / WORKSPACE</span><h3>Codex workspace</h3><p>新しいセッションが読み書きするルートです。</p></div>
            <button className="path-control" onClick={onChooseWorkspace}><span>{draft.workspace}</span><b>SELECT</b></button>
          </section>
          <section className="settings-section">
            <div className="settings-copy"><span>02 / POWER RING</span><h3>Model presets</h3><p>左スティックの3方向に、よく使うモデルを割り当てます。</p></div>
            <div className="slot-settings">
              {draft.modelSlots.map((slot, index) => (
                <label key={slot.key}><i style={{ background: slot.color }} /><span>{slot.label}</span><select value={slot.modelId} onChange={(event) => updateSlot(index, event.target.value)}>{models.map((model) => <option key={model.id} value={model.model}>{model.displayName} — {model.model}</option>)}</select></label>
              ))}
            </div>
          </section>
          <section className="settings-section">
            <div className="settings-copy"><span>03 / SAFETY</span><h3>Permission preset</h3><p>危険な操作の承認はPower Ringとは分離されています。</p></div>
            <div className="segmented-control">
              {(["read-only", "auto", "full"] as const).map((mode) => <button key={mode} className={draft.permissionMode === mode ? "is-active" : ""} onClick={() => setDraft({ ...draft, permissionMode: mode })}>{mode === "read-only" ? "READ ONLY" : mode === "auto" ? "AUTO" : "FULL ACCESS"}</button>)}
            </div>
            {draft.permissionMode === "full" && <p className="danger-note">Full Access はサンドボックス外の操作を許します。信頼できるリポジトリだけで使用してください。</p>}
          </section>
          <section className="settings-section">
            <div className="settings-copy"><span>04 / CONTROLLER</span><h3>Xbox mappings</h3><p>標準Gamepadマッピングに対するボタン番号です。</p></div>
            <label className="range-control"><span>Stick deadzone <b>{draft.deadzone.toFixed(2)}</b></span><input type="range" min="0.18" max="0.72" step="0.02" value={draft.deadzone} onChange={(event) => setDraft({ ...draft, deadzone: Number(event.target.value) })} /></label>
            <div className="controller-toggle"><span>Controller input</span><button className={draft.controllerEnabled ? "is-active" : ""} onClick={() => setDraft({ ...draft, controllerEnabled: !draft.controllerEnabled })}>{draft.controllerEnabled ? "ENABLED" : "DISABLED"}</button></div>
            <div className="binding-grid">
              {BINDING_LABELS.map(([key, label]) => <label key={key}><span>{label}</span><select value={draft.bindings[key]} onChange={(event) => updateBinding(key, Number(event.target.value))}>{BUTTON_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label>)}
            </div>
          </section>
          <section className="settings-section">
            <div className="settings-copy"><span>05 / RUNTIME</span><h3>Codex CLI</h3><p>空欄の場合はPATH上のcodexを使用します。変更は再起動後に反映されます。</p></div>
            <input className="text-control" value={draft.codexPath} placeholder="codex" onChange={(event) => setDraft({ ...draft, codexPath: event.target.value })} />
          </section>
        </div>
        <footer><button className="button-ghost" onClick={onClose}>キャンセル</button><button className="button-primary" onClick={async () => { await onSave(draft); onClose(); }}>設定を保存</button></footer>
      </div>
    </div>
  );
}
