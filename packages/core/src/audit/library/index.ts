import type { Procedure } from "../types";
import { assetProcedures } from "./assets";
import { liabilityProcedures } from "./liabilities";
import { pnlProcedures } from "./pnl";

/** The full procedure library: every area, kind and industry. */
export const procedureLibrary: Procedure[] = [...assetProcedures, ...liabilityProcedures, ...pnlProcedures];
