# Publishing

## ⚠️ Before publishing

Manually scanning via the Obsidian Community website can be done to ensure
the plugin is still passing checks.

It can be triggered on the [plugin dashboard](https://community.obsidian.md/account/plugins/obsidian-divide-and-conquer)
by specifying the branch, tag, or commit.

## Generate GitHub release notes

Generate markdown release notes from all non-merge commits since the latest tag:

```sh
npm run release:notes
```

For testing custom ranges:

```sh
node generate-release-notes.js --from 2.0.0 --to HEAD
```

To publish a new release to the Obsidian community plugins, create a git tag
and push it to this remote repository.
This will trigger the GitHub Actions release workflow, which builds the plugin and
creates a GitHub release with the required files (`main.js`, `manifest.json`, `styles.css`).

```sh
git tag 1.0.0
git push origin 1.0.0
```
