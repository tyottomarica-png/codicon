import { useEffect, useState } from "react";
import type { AgentModel, AgentProvider, CodiconSettings, ControllerBindings } from "../types/codicon";

type Props = {
  open: boolean;
  settings: CodiconSettings;
  codexModels: AgentModel[];
  claudeModels: AgentModel[];
  onClose(): void;
  onChooseWorkspace(): Promise<string | null>;
  onSave(settings: Partial<CodiconSettings>): Promise<void>;
};

const BUTTON_NAMES = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "VIEW", "MENU", "LS", "RS", "DPAD ↑", "DPAD ↓", "DPAD ←", "DPAD →"];
const BINDING_LABELS: Array<[keyof ControllerBindings, string]> = [
  ["primary", "送信 / 承認"], ["cancel", "中断 / 拒否"], ["focusComposer", "キーボード入力"], ["newThread", "新規セッション"],
  ["powerWheel", "Power Ring（ホールド）"], ["pushToTalk", "Push to Talk（ホールド）"], ["settings", "設定パネル"],
  ["fastMode", "Fast mode 切替"], ["switchTarget", "ターゲット切替"],
];

export function SettingsPanel({ open, settings, codexModels, claudeModels, onClose, onChooseWorkspace, onSave }: Props) {
  const [draft, setDraft] = useState(settings);
  // Reset only when the panel opens: mid-edit settings changes (workspace picker, tray toggles)
  // must not silently discard everything the user has changed in the open panel.
  useEffect(() => {
    if (open) setDraft(settings);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;

  const chooseWorkspace = async () => {
    const workspace = await onChooseWorkspace();
    if (workspace) setDraft((current) => ({ ...current, workspace }));
  };

  // Save only what this panel edits. Writing the whole draft back would revert concurrent
  // main-process changes (a VIEW-button target pin, the tray HUD toggle, a dragged HUD position).
  const save = async () => {
    await onSave({
      workspace: draft.workspace,
      codexPath: draft.codexPath,
      claudePath: draft.claudePath,
      controllerEnabled: draft.controllerEnabled,
      hudEnabled: draft.hudEnabled,
      quitOnWindowClose: draft.quitOnWindowClose,
      deadzone: draft.deadzone,
      permissionMode: draft.permissionMode,
      target: draft.target,
      providers: draft.providers,
      bindings: draft.bindings,
    });
    onClose();
  };

  const updateBinding = (key: keyof ControllerBindings, value: number) => setDraft({ ...draft, bindings: { ...draft.bindings, [key]: value } });
  const updateSlot = (provider: AgentProvider, index: number, modelId: string) => setDraft({
    ...draft,
    providers: {
      ...draft.providers,
      [provider]: {
        slots: draft.providers[provider].slots.map((slot, slotIndex) => slotIndex === index ? { ...slot, modelId } : slot),
      },
    },
  });

  const slotSection = (provider: AgentProvider, models: AgentModel[]) => (
    <div className="slot-settings">
      {draft.providers[provider].slots.map((slot, index) => (
        <label key={slot.key}>
          <i style={{ background: slot.color }} />
          <span>{slot.label}</span>
          <select value={slot.modelId} onChange={(event) => updateSlot(provider, index, event.target.value)}>
            {!models.some((model) => model.model === slot.modelId) && <option value={slot.modelId}>{slot.modelId}</option>}
            {models.map((model) => <option key={model.id} value={model.model}>{model.displayName} — {model.model}</option>)}
          </select>
        </label>
      ))}
    </div>
  );

  return (
    <div className="overlay-backdrop settings-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="settings-panel">
        <header><div><span>CONFIGURATION</span><h2 id="settings-title">Codicon Settings</h2></div><button className="close-button" onClick={onClose}>×</button></header>
        <div className="settings-scroll">
          <section className="settings-section">
            <div className="settings-copy"><span>01 / WORKSPACE</span><h3>Workspace</h3><p>新しいセッションが読み書きするルートです。</p></div>
            <button className="path-control" onClick={() => void chooseWorkspace()}><span>{draft.workspace}</span><b>SELECT</b></button>
          </section>
          <section className="settings-section">
            <div className="settings-copy"><span>02 / TARGET</span><h3>Agent target</h3><p>Auto では前面のアプリ（Claude Code / Codex のタブ）を検出して操作対象を切り替えます。VIEW ボタンでいつでも手動切替できます。</p></div>
            <div className="segmented-control">
              <button className={draft.target.mode === "auto" ? "is-active" : ""} onClick={() => setDraft({ ...draft, target: { ...draft.target, mode: "auto" } })}>AUTO</button>
              <button className={draft.target.mode === "manual" && draft.target.manual === "codex" ? "is-active" : ""} onClick={() => setDraft({ ...draft, target: { mode: "manual", manual: "codex" } })}>CODEX</button>
              <button className={draft.target.mode === "manual" && draft.target.manual === "claude" ? "is-active" : ""} onClick={() => setDraft({ ...draft, target: { mode: "manual", manual: "claude" } })}>CLAUDE</button>
            </div>
          </section>
          <section className="settings-section">
            <div className="settings-copy"><span>03 / CODEX RING</span><h3>Codex model presets</h3><p>Codex ターゲット時に左スティック3方向へ割り当てるモデルです。</p></div>
            {slotSection("codex", codexModels)}
          </section>
          <section className="settings-section">
            <div className="settings-copy"><span>04 / CLAUDE RING</span><h3>Claude model presets</h3><p>Claude Code ターゲット時の3方向です。effort は low〜max を右スティックで選べます。</p></div>
            {slotSection("claude", claudeModels)}
          </section>
          <section className="settings-section">
            <div className="settings-copy"><span>05 / SAFETY</span><h3>Permission preset</h3><p>危険な操作の承認はPower Ringとは分離されています。Claude では read-only は plan モードに対応します。</p></div>
            <div className="segmented-control">
              {(["read-only", "auto", "full"] as const).map((mode) => <button key={mode} className={draft.permissionMode === mode ? "is-active" : ""} onClick={() => setDraft({ ...draft, permissionMode: mode })}>{mode === "read-only" ? "READ ONLY" : mode === "auto" ? "AUTO" : "FULL ACCESS"}</button>)}
            </div>
            {draft.permissionMode === "full" && <p className="danger-note">Full Access はサンドボックス外の操作を許します。信頼できるリポジトリだけで使用してください。</p>}
          </section>
          <section className="settings-section">
            <div className="settings-copy"><span>06 / CONTROLLER</span><h3>Controller mappings</h3><p>標準Gamepadマッピングに対するボタン番号です。</p></div>
            <label className="range-control"><span>Stick deadzone <b>{draft.deadzone.toFixed(2)}</b></span><input type="range" min="0.18" max="0.72" step="0.02" value={draft.deadzone} onChange={(event) => setDraft({ ...draft, deadzone: Number(event.target.value) })} /></label>
            <div className="controller-toggle"><span>Controller input</span><button className={draft.controllerEnabled ? "is-active" : ""} onClick={() => setDraft({ ...draft, controllerEnabled: !draft.controllerEnabled })}>{draft.controllerEnabled ? "ENABLED" : "DISABLED"}</button></div>
            <div className="binding-grid">
              {BINDING_LABELS.map(([key, label]) => <label key={key}><span>{label}</span><select value={draft.bindings[key]} onChange={(event) => updateBinding(key, Number(event.target.value))}>{BUTTON_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label>)}
            </div>
          </section>
          <section className="settings-section">
            <div className="settings-copy"><span>07 / BACKGROUND</span><h3>Background operation</h3><p>コントローラ入力はメインプロセスで読み取るため、他のアプリを前面にしていても動作します。</p></div>
            <div className="controller-toggle"><span>Status overlay</span><button className={draft.hudEnabled ? "is-active" : ""} onClick={() => setDraft({ ...draft, hudEnabled: !draft.hudEnabled })}>{draft.hudEnabled ? "ENABLED" : "DISABLED"}</button></div>
            <div className="controller-toggle"><span>Close window quits Codicon</span><button className={draft.quitOnWindowClose ? "is-active" : ""} onClick={() => setDraft({ ...draft, quitOnWindowClose: !draft.quitOnWindowClose })}>{draft.quitOnWindowClose ? "QUIT" : "STAY RESIDENT"}</button></div>
            <p className="settings-note">STAY RESIDENT ではウィンドウを閉じてもセッションは終了せず、メニューバーのアイコンから復帰できます。</p>
          </section>
          <section className="settings-section">
            <div className="settings-copy"><span>08 / RUNTIME</span><h3>CLI paths</h3><p>空欄の場合、Codex は PATH 上の codex、Claude は SDK 同梱のバイナリを使用します。変更は再起動後に反映されます。</p></div>
            <div className="runtime-paths">
              <label><span>codex</span><input className="text-control" value={draft.codexPath} placeholder="codex" onChange={(event) => setDraft({ ...draft, codexPath: event.target.value })} /></label>
              <label><span>claude</span><input className="text-control" value={draft.claudePath} placeholder="(SDK bundled)" onChange={(event) => setDraft({ ...draft, claudePath: event.target.value })} /></label>
            </div>
          </section>
        </div>
        <footer><button className="button-ghost" onClick={onClose}>キャンセル</button><button className="button-primary" onClick={() => void save()}>設定を保存</button></footer>
      </div>
    </div>
  );
}
