#!/usr/bin/env node

const { execFileSync } = require("node:child_process");

function git(args, { allowFailure = false } = {}) {
	try {
		return execFileSync("git", args, { encoding: "utf8" }).trim();
	} catch (error) {
		if (allowFailure) {
			return "";
		}
		const stderr = error?.stderr?.toString()?.trim();
		throw new Error(stderr || `git ${args.join(" ")} failed`);
	}
}

function parseArgs(argv) {
	const options = {
		from: undefined,
		to: "HEAD",
		title: "What's Changed",
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--from") {
			options.from = argv[index + 1];
			index += 1;
		} else if (arg === "--to") {
			options.to = argv[index + 1] || "HEAD";
			index += 1;
		} else if (arg === "--title") {
			options.title = argv[index + 1] || options.title;
			index += 1;
		} else if (arg === "--help" || arg === "-h") {
			options.help = true;
		}
	}

	return options;
}

function parseRepoSlug(remoteUrl) {
	if (!remoteUrl) {
		return "";
	}

	const normalized = remoteUrl.replace(/\.git$/u, "");
	const sshMatch = normalized.match(/github\.com[:/]([^/]+\/[^/]+)$/u);
	if (sshMatch) {
		return sshMatch[1];
	}

	return "";
}

function classifyCommit(subject) {
	const conventional = subject.match(/^([a-z]+)(\(.+\))?!?:\s+(.*)$/iu);
	if (!conventional) {
		return { section: "Other", text: subject };
	}

	const [, rawType, , description] = conventional;
	const type = rawType.toLowerCase();

	if (type === "feat") {
		return { section: "Features", text: description };
	}

	if (type === "fix") {
		return { section: "Fixes", text: description };
	}

	if (type === "docs") {
		return { section: "Docs", text: description };
	}

	if (type === "refactor" || type === "perf") {
		return { section: "Refactors", text: description };
	}

	if (type === "test") {
		return { section: "Tests", text: description };
	}

	if (type === "chore" || type === "build" || type === "ci") {
		return { section: "Maintenance", text: description };
	}

	return { section: "Other", text: description };
}

function extractGitHubUser(author, email) {
	const noreplyMatch = email.match(/^(?:\d+\+)?([a-z0-9-]+)@users\.noreply\.github\.com$/iu);
	if (noreplyMatch) {
		return `@${noreplyMatch[1]}`;
	}

	if (/^[a-z0-9-]{1,39}$/iu.test(author)) {
		return `@${author}`;
	}

	return author;
}

function createGitHubHeaders() {
	const headers = {
		Accept: "application/vnd.github+json",
		"User-Agent": "release-notes-generator",
	};

	if (process.env.GITHUB_TOKEN) {
		headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
	}

	return headers;
}

async function fetchGitHubUserForCommit(slug, sha, fallbackUser) {
	if (!slug) {
		return fallbackUser;
	}

	try {
		const response = await fetch(`https://api.github.com/repos/${slug}/commits/${sha}`, {
			headers: createGitHubHeaders(),
		});

		if (!response.ok) {
			return fallbackUser;
		}

		const payload = await response.json();
		const login = payload?.author?.login || payload?.committer?.login;
		return login ? `@${login}` : fallbackUser;
	} catch {
		return fallbackUser;
	}
}

async function fetchPullRequestForCommit(slug, sha) {
	if (!slug) {
		return { prNumber: undefined, prUrl: undefined };
	}

	try {
		const response = await fetch(`https://api.github.com/repos/${slug}/commits/${sha}/pulls`, {
			headers: createGitHubHeaders(),
		});

		if (!response.ok) {
			return { prNumber: undefined, prUrl: undefined };
		}

		const pulls = await response.json();
		const pr = Array.isArray(pulls) ? pulls[0] : undefined;
		if (!pr) {
			return { prNumber: undefined, prUrl: undefined };
		}

		return { prNumber: pr.number, prUrl: pr.html_url };
	} catch {
		return { prNumber: undefined, prUrl: undefined };
	}
}

async function attachGitHubUsers(commits, slug) {
	for (const commit of commits) {
		commit.githubUser = await fetchGitHubUserForCommit(slug, commit.sha, commit.githubUser);
		const { prNumber, prUrl } = await fetchPullRequestForCommit(slug, commit.sha);
		commit.prNumber = prNumber;
		commit.prUrl = prUrl;
	}
}

function toGitHubProfileUrl(githubUser) {
	if (!githubUser || !githubUser.startsWith("@")) {
		return undefined;
	}

	const login = githubUser.slice(1);
	return login ? `https://github.com/${login}` : undefined;
}

function buildReleaseNotes(commits, title, compareUrl) {
	const sections = new Map();
	const order = ["Features", "Fixes", "Refactors", "Docs", "Tests", "Maintenance", "Other"];

	for (const commit of commits) {
		const { section, text } = classifyCommit(commit.subject);
		const existing = sections.get(section) || [];
		const commitRef = commit.commitUrl
			? `[${commit.shortSha}](${commit.commitUrl})`
			: commit.shortSha;
		const authorRef = commit.githubUserUrl
			? `[${commit.githubUser}](${commit.githubUserUrl})`
			: commit.githubUser;
		const prSuffix = commit.prUrl && commit.prNumber ? ` in [#${commit.prNumber}](${commit.prUrl})` : "";
		existing.push(`- ${text} (${commitRef}) by ${authorRef}${prSuffix}`);
		sections.set(section, existing);
	}

	const lines = [`## ${title}`, ""];

	for (const section of order) {
		const entries = sections.get(section);
		if (!entries || entries.length === 0) {
			continue;
		}
		lines.push(`### ${section}`);
		lines.push(...entries);
		lines.push("");
	}

	if (compareUrl) {
		lines.push(`**Full Changelog**: ${compareUrl}`);
	}

	return lines.join("\n").trimEnd();
}

function usage() {
	return [
		"Usage: node generate-release-notes.js [options]",
		"",
		"Options:",
		"  --from <tag-or-ref>  Start ref (default: last reachable tag)",
		"  --to <ref>           End ref (default: HEAD)",
		"  --title <text>       Markdown heading title",
		"  -h, --help           Show this help message",
	].join("\n");
}

async function main() {
	const options = parseArgs(process.argv.slice(2));

	if (options.help) {
		console.log(usage());
		return;
	}

	const fromRef = options.from || git(["describe", "--tags", "--abbrev=0"]);
	if (!fromRef) {
		throw new Error("Could not determine a starting tag. Pass --from <tag-or-ref>.");
	}

	const toRef = options.to || "HEAD";
	const range = `${fromRef}..${toRef}`;
	const rawLog = git([
		"log",
		range,
		"--pretty=format:%H%x09%h%x09%s%x09%an%x09%ae",
		"--no-merges",
	]);

	if (!rawLog) {
		console.log(`## ${options.title}\n\nNo commits found in range ${range}.`);
		return;
	}

	const commits = rawLog
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [sha, shortSha, subject, author, email] = line.split("\t");
			return { sha, shortSha, subject, author, githubUser: extractGitHubUser(author, email) };
		});

	const remoteUrl = git(["config", "--get", "remote.origin.url"], { allowFailure: true });
	const slug = parseRepoSlug(remoteUrl);
	for (const commit of commits) {
		commit.commitUrl = slug ? `https://github.com/${slug}/commit/${commit.sha}` : undefined;
		commit.githubUserUrl = toGitHubProfileUrl(commit.githubUser);
	}
	await attachGitHubUsers(commits, slug);
	for (const commit of commits) {
		commit.githubUserUrl = toGitHubProfileUrl(commit.githubUser);
	}
	const compareUrl = slug ? `https://github.com/${slug}/compare/${fromRef}...${toRef}` : "";

	console.log(buildReleaseNotes(commits, options.title, compareUrl));
}

main().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});

