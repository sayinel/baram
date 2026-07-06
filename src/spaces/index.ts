import { journalSpace } from "./journal-space";
import { registerSpace } from "./registry";

registerSpace(journalSpace);

export * from "./registry";
export * from "./types";
