export const filterSensitiveInfoFromRepository = (repositoryUrl: string | undefined) => {
  try {
    if (!repositoryUrl) {
      return repositoryUrl;
    }
    if (repositoryUrl.startsWith("git@")) {
      return repositoryUrl;
    }
    const { protocol, hostname, pathname } = new URL(repositoryUrl);
    if (!protocol || !hostname) {
      return repositoryUrl;
    }

    return `${protocol}//${hostname}${pathname}`;
  } catch (e) {
    return repositoryUrl;
  }
};

/**
 * Removes sensitive information from the given git remote
 * URL and normalizes the URL prefix.
 *
 * @example
 * // returns "github.com/"
 * filterAndFormatGithubRemote("git@github.com")
 * filterAndFormatGithubRemote("https://github.com")
 *
 * @param rawRemote git remote URL
 * @returns normalized URL prefix
 */
export const filterAndFormatGithubRemote = (rawRemote: string | undefined): string | undefined => {
  rawRemote = filterSensitiveInfoFromRepository(rawRemote);
  if (!rawRemote) {
    return rawRemote;
  }
  rawRemote = rawRemote.replace(/git@github\.com:|https:\/\/github\.com\//, "github.com/");

  return rawRemote;
};

export const getGitTagsFromParam = (gitDataParam: string) => {
  const [commitSha, rawGitConfigUrlOutput] = gitDataParam.split(",", 2);
  const sanitizedRemote = filterAndFormatGithubRemote(rawGitConfigUrlOutput);
  const gitCommitShaTag = `git.commit.sha:${commitSha}`;
  const gitRepoUrlTag = `git.repository_url:${sanitizedRemote}`;
  return { gitCommitShaTag, gitRepoUrlTag };
};
