import { getGitTagsFromParam } from "../src/git";

describe("getGitTagsFromParam", () => {
  it("produces the expected tags from the param input", () => {
    expect(getGitTagsFromParam("abcd1234,git@github.com:DataDog/datadog-cloudformation-macro.git")).toEqual({
      gitCommitShaTag: "git.commit.sha:abcd1234",
      gitRepoUrlTag: "git.repository_url:github.com/DataDog/datadog-cloudformation-macro.git",
    });

    expect(getGitTagsFromParam("abcd1234,https://github.com/datadog/test.git")).toEqual({
      gitCommitShaTag: "git.commit.sha:abcd1234",
      gitRepoUrlTag: "git.repository_url:github.com/datadog/test.git",
    });

    expect(getGitTagsFromParam("abcd1234,github.com/datadog/test.git")).toEqual({
      gitCommitShaTag: "git.commit.sha:abcd1234",
      gitRepoUrlTag: "git.repository_url:github.com/datadog/test.git",
    });
  });
});
