async function valueToTreeObject(octokit, owner, repo, path, value) {
    let mode = "100644";
    if (value !== null && typeof value !== "string") {
        mode = value.mode || mode;
    }
    // Text files can be changed through the .content key
    if (typeof value === "string") {
        return {
            path,
            mode: mode,
            content: value,
        };
    }
    // Binary files need to be created first using the git blob API,
    // then changed by referencing in the .sha key
    const { data } = await octokit.request("POST /repos/{owner}/{repo}/git/blobs", {
        owner,
        repo,
        ...value,
    });
    const blobSha = data.sha;
    return {
        path,
        mode: mode,
        sha: blobSha,
    };
}

async function createTree(state, changes) {
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

async function createCommit(state, treeCreated, changes) {
    const { octokit, repo, fork, latestCommitSha } = state;
    const message = treeCreated
        ? changes.commit
        : typeof changes.emptyCommit === "string"
            ? changes.emptyCommit
            : changes.commit;
    // https://developer.github.com/v3/git/commits/#create-a-commit
    const { data: latestCommit } = await octokit.request("POST /repos/{owner}/{repo}/git/commits", {
        owner: fork,
        repo,
        message,
        tree: state.latestCommitTreeSha,
        parents: [latestCommitSha],
    });
    return latestCommit.sha;
}

async function composeCreatePullRequest(octokit, { owner, repo, title, body, base, head, createWhenEmpty, changes: changesOption, draft = false, forceFork = false, }) {
    const changes = Array.isArray(changesOption)
        ? changesOption
        : [changesOption];
    if (changes.length === 0)
        throw new Error('[octokit-plugin-create-pull-request] "changes" cannot be an empty array');
    const state = { octokit, owner, repo };
    // https://developer.github.com/v3/repos/#get-a-repository
    const { data: repository, headers } = await octokit.request("GET /repos/{owner}/{repo}", {
        owner,
        repo,
    });
    const isUser = !!headers["x-oauth-scopes"];
    if (!repository.permissions) {
        throw new Error("[octokit-plugin-create-pull-request] Missing authentication");
    }
    if (!base) {
        base = repository.default_branch;
    }
    state.fork = owner;
    if (forceFork || (isUser && !repository.permissions.push)) {
        // https://developer.github.com/v3/users/#get-the-authenticated-user
        const user = await octokit.request("GET /user");
        // https://developer.github.com/v3/repos/forks/#list-forks
        const forks = await octokit.request("GET /repos/{owner}/{repo}/forks", {
            owner,
            repo,
        });
        const hasFork = forks.data.find(
        /* istanbul ignore next - fork owner can be null, but we don't test that */
        (fork) => fork.owner && fork.owner.login === user.data.login);
        if (!hasFork) {
            // https://developer.github.com/v3/repos/forks/#create-a-fork
            await octokit.request("POST /repos/{owner}/{repo}/forks", {
                owner,
                repo,
            });
        }
        state.fork = user.data.login;
    }
    // https://developer.github.com/v3/repos/commits/#list-commits-on-a-repository
    const { data: [latestCommit], } = await octokit.request("GET /repos/{owner}/{repo}/commits", {
        owner: state.fork,
        repo,
        sha: base,
        per_page: 1,
    });
    state.latestCommitSha = latestCommit.sha;
    state.latestCommitTreeSha = latestCommit.commit.tree.sha;
    const baseCommitTreeSha = latestCommit.commit.tree.sha;
    for (const change of changes) {
        let treeCreated = false;
        if (change.files && Object.keys(change.files).length) {
            const latestCommitTreeSha = await createTree(state, change);
            if (latestCommitTreeSha) {
                state.latestCommitTreeSha = latestCommitTreeSha;
                treeCreated = true;
            }
        }
        if (treeCreated || change.emptyCommit !== false) {
            state.latestCommitSha = await createCommit(state, treeCreated, change);
        }
    }
    const hasNoChanges = baseCommitTreeSha === state.latestCommitTreeSha;
    if (hasNoChanges && createWhenEmpty === false) {
        return null;
    }
    // https://developer.github.com/v3/git/refs/#create-a-reference
    await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
        owner: state.fork,
        repo,
        sha: state.latestCommitSha,
        ref: `refs/heads/${head}`,
    });
    // https://developer.github.com/v3/pulls/#create-a-pull-request
    return await octokit.request("POST /repos/{owner}/{repo}/pulls", {
        owner,
        repo,
        head: `${state.fork}:${head}`,
        base,
        title,
        body,
        draft,
    });
}

const VERSION = "0.0.0-development";

/**
 * @param octokit Octokit instance
 */
function createPullRequest(octokit) {
    return {
        createPullRequest: composeCreatePullRequest.bind(null, octokit),
    };
}
createPullRequest.VERSION = VERSION;

export { composeCreatePullRequest, createPullRequest };
//# sourceMappingURL=index.js.map
