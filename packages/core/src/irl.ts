import { daysBetween } from "./dates";
import { labels, type Engagement, type InfoRequest, type Person } from "./schema";

export interface IrlRow {
  number: string;
  description: string;
  status: string;
  requestedOn: string;
  due: string;
  daysWaiting: number;
  chases: number;
}

const open = (r: InfoRequest) => r.status === "pending" || r.status === "partial";

export function irlRows(items: InfoRequest[], today: string, onlyOpen = true): IrlRow[] {
  return items
    .filter((r) => !r.deleted && (!onlyOpen || open(r)))
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
    .map((r) => ({
      number: r.number,
      description: r.description,
      status: labels.irlStatus[r.status],
      requestedOn: r.requestedOn,
      due: r.due ?? "",
      daysWaiting: Math.max(0, daysBetween(r.requestedOn, today)),
      chases: r.chaseLog.length,
    }));
}

const HEAD = ["#", "Item", "Status", "Requested", "Due", "Days waiting"];
const cells = (r: IrlRow) => [r.number, r.description, r.status, r.requestedOn, r.due, String(r.daysWaiting)];

/** Tab-separated; pastes cleanly into Excel and most email clients. */
export function irlText(rows: IrlRow[]): string {
  return [HEAD, ...rows.map(cells)].map((c) => c.join("\t")).join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A simple bordered table for pasting into Outlook / Gmail. */
export function irlHtml(rows: IrlRow[]): string {
  const td = 'style="border:1px solid #bbb;padding:4px 8px;font-family:Calibri,Arial,sans-serif;font-size:11pt"';
  const th = td.replace('style="', 'style="background:#f2f2f2;font-weight:bold;');
  return (
    `<table style="border-collapse:collapse">` +
    `<tr>${HEAD.map((h) => `<th ${th}>${esc(h)}</th>`).join("")}</tr>` +
    rows.map((r) => `<tr>${cells(r).map((c) => `<td ${td}>${esc(c)}</td>`).join("")}</tr>`).join("") +
    `</table>`
  );
}

/** Subject and body for a chase email; the user reviews and sends it themself. */
export function chaseEmail(engagement: Engagement, person: Person | undefined, rows: IrlRow[], myName: string) {
  const greeting = person ? `Hi ${person.name.split(" ")[0]},` : "Hi,";
  const list = rows
    .map((r) => `${r.number ? `#${r.number} ` : ""}${r.description}${r.status === "Partial" ? " (partially received)" : ""}`)
    .map((l) => `  - ${l}`)
    .join("\n");
  return {
    subject: `${engagement.name}: pending information request items (${rows.length})`,
    body: `${greeting}\n\nHope you're well. Following up on the information request list for ${engagement.name}. The items below are still pending:\n\n${list}\n\nCould you please share these, or let us know an expected date?\n\nThanks,\n${myName}`,
  };
}

export const mailtoHref = (to: string | undefined, subject: string, body: string) =>
  `mailto:${encodeURIComponent(to ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
