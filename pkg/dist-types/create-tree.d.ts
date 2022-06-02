import type { Changes, State } from "./types";
export declare function createTree(state: Required<State>, changes: Required<Changes>): Promise<string | null>;
