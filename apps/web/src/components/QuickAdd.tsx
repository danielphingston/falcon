import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { create, createFollowUp, createInfoRequest, parseQuickAdd, relativeDay, type Ctx } from "@falcon/core";
import { act } from "../lib/act";
import { useSettings, useTable, useToday } from "../lib/hooks";
import { Icon } from "./Icon";

const kindLabel = { task: "Task", followup: "Follow-up", irl: "IRL item" } as const;

/**
 * One-line capture. Syntax: @person #engagement !date !! (high priority).
 * Starting with "chase"/"follow up" makes a follow-up; "irl" makes an IRL item.
 */
export function QuickAdd({ defaultEngagementId, autoFocus }: { defaultEngagementId?: string; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const people = useTable("people") ?? [];
  const engagements = useTable("engagements") ?? [];
  const settings = useSettings();
  const today = useToday();

  const draft = useMemo(
    () => parseQuickAdd(text, { today, now: new Date(), people, engagements, settings }),
    [text, today, people, engagements, settings],
  );
  const engagementId = draft.engagement?.id ?? (draft.engagementQuery ? undefined : defaultEngagementId);
  const engagementName = engagements.find((e) => e.id === engagementId)?.name;
  const needsEngagement = draft.kind === "irl" && !engagementId;

  const submit = async () => {
    if (!draft.text.trim() || needsEngagement) return;
    const res = await act(`${kindLabel[draft.kind]} added`, async (ctx: Ctx) => {
      // Unknown @names become new contacts, so typing stays fast.
      let personId = draft.person?.id;
      if (!personId && draft.personQuery) {
        const role = draft.kind === "irl" ? "client" : "other";
        personId = (await create(ctx, "people", { name: draft.personQuery, role })).record.id;
      }
      if (draft.kind === "followup")
        return createFollowUp(ctx, { about: draft.text, personId, engagementId, due: draft.due });
      if (draft.kind === "irl")
        return createInfoRequest(ctx, { description: draft.text, engagementId: engagementId!, requestedFromId: personId, requestedOn: today, due: draft.due });
      return create(ctx, "tasks", { title: draft.text, engagementId, due: draft.due, dueTime: draft.time, priority: draft.priority, assigneeId: personId });
    });
    if (res) setText("");
  };

  const chips: { label: string; tone: string }[] = [];
  if (text.trim()) {
    chips.push({ label: kindLabel[draft.kind], tone: "bg-brand-100 text-brand-700 dark:bg-indigo-950 dark:text-indigo-200" });
    if (draft.personQuery)
      chips.push({ label: `@${draft.person?.name ?? `${draft.personQuery} (new)`}`, tone: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" });
    if (engagementName) chips.push({ label: `#${engagementName}`, tone: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200" });
    else if (draft.engagementQuery) chips.push({ label: `#${draft.engagementQuery}?`, tone: "bg-rose-100 text-rose-700" });
    if (draft.due)
      chips.push({
        label: `${relativeDay(draft.due, today)}${draft.time && draft.kind === "task" ? ` ${draft.time} · calendar` : ""}`,
        tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
      });
    if (draft.priority === "high") chips.push({ label: "High", tone: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-200" });
  }

  return (
    <div className={`card p-2 transition-shadow ${focused ? "shadow-lg shadow-brand-500/10" : ""}`}>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-white">
          <Icon name="plus" size={18} />
        </span>
        <input
          className="min-w-0 flex-1 bg-transparent py-2 text-[15px] outline-none placeholder:text-[var(--muted)]"
          placeholder="Add… e.g. Chase @Rahul TB FY24 #Falcon !fri"
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label="Quick add"
        />
        <AnimatePresence>
          {text.trim() && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="btn btn-primary btn-sm"
              disabled={needsEngagement}
            >
              Add
            </motion.button>
          )}
        </AnimatePresence>
      </form>
      <AnimatePresence initial={false}>
        {(chips.length > 0 || (focused && !text)) && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1 pt-2">
              {chips.length > 0 ? (
                <>
                  {chips.map((c) => (
                    <motion.span layout key={c.label} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c.tone}`}>
                      {c.label}
                    </motion.span>
                  ))}
                  {needsEngagement && <span className="text-xs text-rose-600">IRL items need an #engagement</span>}
                </>
              ) : (
                <span className="text-xs muted">
                  <b>@</b>person · <b>#</b>engagement · <b>!</b>fri / !tom@3pm / !+2 · <b>at 3pm</b> adds to calendar · <b>!!</b> high · start with <b>chase</b> or <b>irl</b>
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
