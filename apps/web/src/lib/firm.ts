/**
 * Firm checklists on this device: the firm's templates (imported from its
 * workbooks), checks the reviewer adds as they go, and the answers per work
 * paper. Kept in local tables only: no Drive sync, not in backups, never sent
 * to the AI. Moving them to another device is a file export/import.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { matchTemplates, newId, type FirmAnswer, type FirmTemplate, type LearnedCheck, type ParsedFirmTemplate, type WorkPaper } from "@falcon/core";
import { db } from "../db";
import { toast } from "./toast";

export const useFirmTemplates = () => useLiveQuery(() => db.firmTemplates.orderBy("name").toArray(), []);
export const useFirmLearned = () => useLiveQuery(() => db.firmLearned.toArray(), []);
export const useFirmAnswers = (workpaperId: string) => useLiveQuery(() => db.firmAnswers.where("workpaperId").equals(workpaperId).toArray(), [workpaperId]);
export const useFirmLink = (workpaperId: string) => useLiveQuery(async () => (await db.firmLinks.get(workpaperId)) ?? null, [workpaperId]);

/**
 * The template a WP uses: the one picked by hand, else the best match by
 * title / area. `linked` says whether it was picked by hand; templateId null
 * means "no template" was chosen on purpose.
 */
export function templateFor(wp: WorkPaper, templates: FirmTemplate[] | undefined, link: { templateId: string | null } | null | undefined) {
  if (!templates?.length) return { template: undefined, linked: false, matches: [] as { id: string; score: number }[] };
  const matches = matchTemplates({ title: wp.title, area: wp.area }, templates);
  if (link) return { template: link.templateId ? templates.find((t) => t.id === link.templateId) : undefined, linked: true, matches };
  return { template: matches[0] ? templates.find((t) => t.id === matches[0].id) : undefined, linked: false, matches };
}

export async function linkTemplate(workpaperId: string, templateId: string | null | "auto") {
  if (templateId === "auto") await db.firmLinks.delete(workpaperId);
  else await db.firmLinks.put({ workpaperId, templateId });
}

/** Saves imported templates. A template with the same name is updated in place, so learned checks and answers stay attached. */
export async function saveTemplates(parsed: (ParsedFirmTemplate & { sourceFile: string })[]) {
  const existing = await db.firmTemplates.toArray();
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;
  await db.transaction("rw", db.firmTemplates, async () => {
    for (const p of parsed) {
      const old = existing.find((t) => t.name.toLowerCase() === p.name.toLowerCase());
      const t: FirmTemplate = { id: old?.id ?? newId(), name: p.name, sourceFile: p.sourceFile, areas: p.areas, items: p.items, importedAt: now };
      await db.firmTemplates.put(t);
      if (old) updated++;
      else added++;
    }
  });
  return { added, updated };
}

export async function deleteTemplate(t: FirmTemplate) {
  const learned = await db.firmLearned.where("templateId").equals(t.id).toArray();
  await db.transaction("rw", db.firmTemplates, db.firmLearned, async () => {
    await db.firmTemplates.delete(t.id);
    await db.firmLearned.bulkDelete(learned.map((l) => l.id));
  });
  toast({
    message: `Removed "${t.name}"`,
    action: {
      label: "Undo",
      run: async () => {
        await db.firmTemplates.put(t);
        await db.firmLearned.bulkPut(learned);
      },
    },
  });
}

/** Records (or changes) the reviewer's answer to one question on one WP. */
export async function setAnswer(workpaperId: string, key: string, patch: Partial<Pick<FirmAnswer, "answer" | "note" | "tests">>) {
  const id = `${workpaperId}|${key}`;
  const old = await db.firmAnswers.get(id);
  await db.firmAnswers.put({ id, workpaperId, key, answer: "none", ...old, ...patch, at: new Date().toISOString() });
}

/** Saves a check to ask again next time. Shows Undo. */
export async function addLearned(check: Omit<LearnedCheck, "id" | "createdAt">, where: string) {
  const l: LearnedCheck = { ...check, text: check.text.trim(), id: newId(), createdAt: new Date().toISOString() };
  await db.firmLearned.put(l);
  toast({
    message: `Check saved. You'll be asked it ${where}`,
    action: { label: "Undo", run: () => db.firmLearned.delete(l.id) },
  });
  return l;
}

export async function removeLearned(l: LearnedCheck) {
  await db.firmLearned.delete(l.id);
  toast({ message: "Check removed", action: { label: "Undo", run: async () => void (await db.firmLearned.put(l)) } });
}

// ---------- moving the library between devices ----------

const FORMAT = "falcon-firm-checklists";

export async function exportLibrary() {
  const data = { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), templates: await db.firmTemplates.toArray(), learned: await db.firmLearned.toArray() };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `firm-checklists-${new Date().toISOString().slice(0, 10)}.firm.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importLibrary(file: File): Promise<string> {
  const data = JSON.parse(await file.text()) as { format?: string; templates?: FirmTemplate[]; learned?: LearnedCheck[] };
  if (data.format !== FORMAT || !Array.isArray(data.templates)) throw new Error("That isn't a Falcon firm checklist file.");
  const existing = await db.firmTemplates.toArray();
  const learned = data.learned ?? [];
  await db.transaction("rw", db.firmTemplates, db.firmLearned, async () => {
    for (const t of data.templates!) {
      // Same name already here: keep this device's id, and point the incoming checks at it.
      const same = existing.find((e) => e.name.toLowerCase() === t.name.toLowerCase());
      if (same && same.id !== t.id) for (const l of learned) if (l.templateId === t.id) l.templateId = same.id;
      await db.firmTemplates.put({ ...t, id: same?.id ?? t.id });
    }
    const have = new Set((await db.firmLearned.toArray()).map((l) => `${l.templateId ?? l.area ?? l.workpaperId}|${l.text.toLowerCase()}`));
    await db.firmLearned.bulkPut(learned.filter((l) => !have.has(`${l.templateId ?? l.area ?? l.workpaperId}|${l.text.toLowerCase()}`)));
  });
  return `${data.templates.length} templates and ${learned.length} added checks imported`;
}
