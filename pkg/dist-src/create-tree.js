import { valueToTreeObject } from "./value-to-tree-object";
export async function createTree(state, changes) {
    const { octokit, owner, repo, fork, latestCommitSha, latestCommitTreeSha, } = state;
    const tree = (await Promise.all(Object.keys(changes.files).map(async (path) => {
        const value = changes.files[path];
        if (value === null) {
            // Deleting a non-existent file from a tree leads to an "GitRPC::BadObjectState" error,
            // so we only attempt to delete the file if it exists.
            try {
                // https://developer.github.com/v3/repos/contents/#get-contents
                await octokit.request("HEAD /repos/{owner}/{repo}/contents/:path", {
                    owner: fork,
                    repo,
                    ref: latestCommitSha,
                    path,
                });
                return {
                    path,
                    mode: "100644",
                    sha: null,
                };
            }
            catch (error) {
                return;
            }
        }
        // When passed a function, retrieve the content of the file, pass it
        // to the function, then return the result
        if (typeof value === "function") {
            let result;
            try {
                const { data: file } = await octokit.request("GET /repos/{owner}/{repo}/contents/:path", {
                    owner: fork,
                    repo,
                    ref: latestCommitSha,
                    path,
                });
                result = await value(Object.assign(file, { exists: true }));
            }
            catch (error) {
                // istanbul ignore if
                if (error.status !== 404)
                    throw error;
                // @ts-ignore
                result = await value({ exists: false });
            }
            if (result === null || typeof result === "undefined")
                return;
            return valueToTreeObject(octokit, fork, repo, path, result);
        }
        return valueToTreeObject(octokit, fork, repo, path, value);
    }))).filter(Boolean);
    if (tree.length === 0) {
        return null;
    }
    // https://developer.github.com/v3/git/trees/#create-a-tree
    const { data: { sha: newTreeSha }, } = await octokit.request("POST /repos/{owner}/{repo}/git/trees", {
        owner: fork,
        repo,
        base_tree: latestCommitTreeSha,
        tree,
    });
    return newTreeSha;
}
