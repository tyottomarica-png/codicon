import { annularSectorPath, effortLabel, polarPoint } from "../lib/radial";
import type { CodexModel, ModelSlot } from "../types/codicon";
import type { CSSProperties } from "react";

type Props = {
  slots: ModelSlot[];
  models: CodexModel[];
  selectedSlot: number;
  selectedEffort: string;
  previewSlot: number | null;
  previewEffort: string | null;
  open: boolean;
  serviceTier: string | null;
  onSelectSlot(index: number): void;
  onSelectEffort(effort: string): void;
};

function modelForSlot(slot: ModelSlot, models: CodexModel[]): CodexModel | undefined {
  return models.find((model) => model.model === slot.modelId || model.id === slot.modelId);
}

export function PowerWheel({ slots, models, selectedSlot, selectedEffort, previewSlot, previewEffort, open, serviceTier, onSelectSlot, onSelectEffort }: Props) {
  const activeSlot = previewSlot ?? selectedSlot;
  const model = modelForSlot(slots[activeSlot], models);
  const efforts = model?.supportedReasoningEfforts || [];
  const activeEffort = previewEffort ?? selectedEffort;
  const modelSpan = 360 / slots.length;
  const effortSpan = efforts.length ? 360 / efforts.length : 360;

  return (
    <section className={`power-wheel-shell ${open ? "is-open" : ""}`} aria-label="Power selector">
      <div className="wheel-instruction wheel-instruction-left"><kbd>LS</kbd><span>MODEL</span></div>
      <div className="wheel-instruction wheel-instruction-right"><kbd>RS</kbd><span>EFFORT</span></div>
      <svg className="power-wheel" viewBox="-260 -260 520 520" role="group" aria-label="Model and reasoning selector">
        <circle r="250" className="wheel-halo" />
        <circle r="232" className="wheel-guide" />
        {efforts.map((option, index) => {
          const start = index * effortSpan - effortSpan / 2;
          const end = start + effortSpan;
          const labelPoint = polarPoint(205, index * effortSpan);
          const active = option.reasoningEffort === activeEffort;
          return (
            <g key={option.reasoningEffort} className={`effort-sector ${active ? "is-active" : ""}`} onClick={() => onSelectEffort(option.reasoningEffort)} role="button" tabIndex={0}>
              <path d={annularSectorPath(177, 230, start + 2, end - 2)} />
              <text x={labelPoint.x} y={labelPoint.y} textAnchor="middle" dominantBaseline="middle">{effortLabel(option.reasoningEffort)}</text>
            </g>
          );
        })}
        {slots.map((slot, index) => {
          const slotModel = modelForSlot(slot, models);
          const start = index * modelSpan - modelSpan / 2;
          const end = start + modelSpan;
          const labelPoint = polarPoint(130, index * modelSpan);
          const active = index === activeSlot;
          return (
            <g key={slot.key} className={`model-sector ${active ? "is-active" : ""}`} style={{ "--slot-color": slot.color } as CSSProperties} onClick={() => onSelectSlot(index)} role="button" tabIndex={0}>
              <path d={annularSectorPath(73, 168, start + 2, end - 2)} />
              <text x={labelPoint.x} y={labelPoint.y - 6} textAnchor="middle" dominantBaseline="middle">{slot.label}</text>
              <text className="model-sector-sub" x={labelPoint.x} y={labelPoint.y + 13} textAnchor="middle" dominantBaseline="middle">{slotModel?.model.replace("gpt-", "") || slot.modelId.replace("gpt-", "")}</text>
            </g>
          );
        })}
        <circle r="63" className="wheel-core" />
        <text y="-13" className="wheel-core-kicker" textAnchor="middle">POWER</text>
        <text y="10" className="wheel-core-value" textAnchor="middle">{effortLabel(activeEffort)}</text>
        <text y="30" className={`wheel-core-hint ${serviceTier ? "is-fast" : ""}`} textAnchor="middle">{serviceTier ? "FAST · RS TO CLEAR" : "RS FOR FAST"}</text>
      </svg>
      <div className="wheel-readout">
        <span className="readout-index">0{activeSlot + 1}</span>
        <span className="readout-model">{model?.displayName || slots[activeSlot].label}</span>
        <span className="readout-separator">/</span>
        <span className="readout-effort">{effortLabel(activeEffort)}</span>
      </div>
    </section>
  );
}
