import { journalSpace } from "./journal-space";
import { registerSpace } from "./registry";
import { zettelkastenSpace } from "./zettelkasten-space";

registerSpace(journalSpace);
registerSpace(zettelkastenSpace);

export * from "./registry";
export * from "./types";
