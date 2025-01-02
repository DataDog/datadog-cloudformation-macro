import { filterSensitiveInfoFromRepository, getGitTagsFromParam } from "../src/lambda/git";

describe("getGitTagsFromParam", () => {
  it("produces SCI tags with username@domain", () => {
    expect(getGitTagsFromParam("abcd1234,git@github.com:DataDog/datadog-cloudformation-macro.git")).toEqual({
      gitCommitShaTag: "git.commit.sha:abcd1234",
      gitRepoUrlTag: "git.repository_url:github.com/DataDog/datadog-cloudformation-macro.git",
    });
  });

  it("produces SCI tags with protocol", () => {
    expect(getGitTagsFromParam("abcd1234,https://github.com/datadog/test.git")).toEqual({
      gitCommitShaTag: "git.commit.sha:abcd1234",
      gitRepoUrlTag: "git.repository_url:github.com/datadog/test.git",
    });
  });

  it("produces SCI tags without protocol", () => {
    expect(getGitTagsFromParam("abcd1234,github.com/datadog/test.git")).toEqual({
      gitCommitShaTag: "git.commit.sha:abcd1234",
      gitRepoUrlTag: "git.repository_url:github.com/datadog/test.git",
    });
  });
});

describe("filterSensitiveInfoFromRepository", () => {
  it("returns undefined when URL input is undefined", () => {
    expect(filterSensitiveInfoFromRepository(undefined)).toBeUndefined();
  });

  it("returns original URL when starts with git@", () => {
    expect(filterSensitiveInfoFromRepository("git@github.com:username/repo.git")).toBe(
      "git@github.com:username/repo.git",
    );
  });

  it("returns original URL when not a valid URL", () => {
    expect(filterSensitiveInfoFromRepository("not-a-valid-url")).toBe("not-a-valid-url");
  });

  it("removes sensitive info from valid HTTP URL", () => {
    expect(filterSensitiveInfoFromRepository("http://user:pass@github.com/path/to/repo.git")).toBe(
      "http://github.com/path/to/repo.git",
    );
  });

  it("removes sensitive info from valid HTTPS URL", () => {
    expect(filterSensitiveInfoFromRepository("https://user:pass@github.com/path/to/repo.git")).toBe(
      "https://github.com/path/to/repo.git",
    );
  });

  it("returns original URL when protocol or hostname is missing", () => {
    expect(filterSensitiveInfoFromRepository("/path/to/repo.git")).toBe("/path/to/repo.git");
  });

  it("handles exception and returns original URL when invalid URL is passed", () => {
    expect(filterSensitiveInfoFromRepository("http://github.com:demo")).toBe("http://github.com:demo");
  });
});
