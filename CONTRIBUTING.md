# Contributing to the Project

Contributions are welcome!
Preferably open an issue before working on a contribution,
to make sure your work is aligned with the project goals.

## Development
- Clone the repository, run `npm install` to install dependencies
- Run `npm run dev` to start the development environment with hot reload

- `npm run lint` - run all configured lint checks.
- `npm run lint:fix` - run all configured lint checks and apply available auto-fixes.
- `npm run test` - run all tests.

### Testing your changes within a vault

> [!NOTE]
> It's recommended you use a test vault for development, to avoid accidentally
> breaking your main vault.

- To test the plugin within an Obsidian vault, you can use `npm run dev`
  to start the development environment with hot reload.
- Symlink the plugin directory into your vault's plugins directory
- Install the [hot-reload](https://github.com/pjeby/hot-reload) plugin
  in your test vault which will show your changes immediately in the vault
  without needing to restart Obsidian or toggle the plugin off and on.

## Testing
Testing is imperative for a project like this,
to ensure that the plugin works as expected and to prevent regressions.
Tests are located in the `tests` directory, and are run with `npm test`.

Your change will require tests if it adds new behavior or changes existing behavior.

- `tests/bisect.test.ts` covers the bisect user flow
  (`Start`, `Yes`, `No`, `Enable All`) for plugins and CSS snippets.
- `tests/util.test.ts` covers utility behavior and UI-adjacent helper logic.
- Prefer user-visible test names that read like user action and outcomes.

## Publishing

Refer to the [Publishing Guide](PUBLISHING.md) for instructions
on how to publish a new release of the plugin.
