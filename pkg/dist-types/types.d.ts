import type { Octokit } from "@octokit/core";
import type { Endpoints } from "@octokit/types";
export declare type TreeParameter = Endpoints["POST /repos/{owner}/{repo}/git/trees"]["parameters"]["tree"];
export declare type Options = {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base?: string;
    createWhenEmpty?: boolean;
    changes: Changes | Changes[];
    draft?: boolean;
    forceFork?: boolean;
};
export declare type Changes = {
    files?: {
        [path: string]: string | File | UpdateFunction;
    };
    emptyCommit?: boolean | string;
    commit: string;
};
export declare type File = {
    content: string;
    encoding: "utf-8" | "base64";
    mode?: string;
};
export declare type UpdateFunctionFile = {
    exists: true;
    size: number;
    encoding: "base64";
    content: string;
} | {
    exists: false;
    size: never;
    encoding: never;
    content: never;
};
export declare type UpdateFunction = (file: UpdateFunctionFile) => string | File | null;
export declare type State = {
    octokit: Octokit;
    owner: string;
    repo: string;
    fork?: string;
    latestCommitSha?: string;
    latestCommitTreeSha?: string;
    treeSha?: string;
};
