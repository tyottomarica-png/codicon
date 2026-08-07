import type { ActivityItem } from "../hooks/useAgentSession";
import type { ThreadSummary } from "../types/codicon";

type Props = {
  activity: ActivityItem[];
  threads: ThreadSummary[];
  accountLabel: string;
  onResume(thread: ThreadSummary): void;
};

function shortTime(timestamp: number): string {
  return new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp * 1000));
}

export function ActivityRail({ activity, threads, accountLabel, onResume }: Props) {
  return (
    <aside className="activity-rail">
      <div className="rail-account"><span className="account-orb">O</span><div><small>AUTHENTICATED</small><strong title={accountLabel}>{accountLabel}</strong></div></div>
      <section className="rail-section activity-section">
        <div className="rail-title"><span>ACTIVITY</span><small>LIVE FEED</small></div>
        <div className="activity-list">
          {!activity.length && <p className="rail-empty">Tool activity will appear here.</p>}
          {activity.map((item) => (
            <div className="activity-row" key={item.id}><i className={`activity-dot status-${item.status}`} /><div><strong>{item.title}</strong><span>{item.detail}</span></div></div>
          ))}
        </div>
      </section>
      <section className="rail-section history-section">
        <div className="rail-title"><span>RECENT</span><small>{threads.length} THREADS</small></div>
        <div className="thread-list">
          {!threads.length && <p className="rail-empty">No recent sessions.</p>}
          {threads.slice(0, 8).map((thread) => (
            <button key={thread.id} onClick={() => onResume(thread)}><strong>{thread.name || thread.preview || "Untitled session"}</strong><span>{shortTime(thread.recencyAt || thread.updatedAt)}</span></button>
          ))}
        </div>
      </section>
    </aside>
  );
}
