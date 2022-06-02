import { composeCreatePullRequest } from "./compose-create-pull-request";
import { VERSION } from "./version";
/**
 * @param octokit Octokit instance
 */
export function createPullRequest(octokit) {
    return {
        createPullRequest: composeCreatePullRequest.bind(null, octokit),
    };
}
export { composeCreatePullRequest } from "./compose-create-pull-request";
createPullRequest.VERSION = VERSION;
