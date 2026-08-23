# Contributing to the Project

Contributions are welcome!
Preferably open an issue before working on a contribution,
to make sure your work is aligned with the project goals.

## Development
- Clone the repository, run `npm install` to install dependencies
- Run `npm run dev` to start the development environment with hot reload

- `npm run lint` - run all configured lint checks.
- `npm run lint:fix` - run all configured lint checks and apply available auto-fixes.
- `npm run test` - run the unit tests.
- `npm run test:e2e` - run the end-to-end tests in real Obsidian builds.
- `npm run test:e2e:verify` - prove the end-to-end tests really cover every
  pinned Obsidian version.
- `npm run test:e2e:headless` - the same end-to-end tests with no windows on
  screen. Linux only; see below.

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

### E2E tests

The current unit tests run against a mocked Obsidian, which cannot tell us
whether the plugin still works in a *real* Obsidian vault - and this plugin
lives on undocumented APIs that Obsidian changes between releases. The E2E tests
fill that gap: they launch the real desktop app via
[wdio-obsidian-service](https://jesse-r-s-hines.github.io/wdio-obsidian-service/),
install the built plugin into a throwaway vault, and drive it.

```sh
npm run test:e2e
```

That builds `dist/` first, then downloads and runs each pinned Obsidian version.
The first run downloads a few hundred MB into `.obsidian-cache/` (gitignored);
later runs reuse it.

- `tests/e2e/obsidian-versions.mjs` pins the versions under test and is the
  only place they are written down - `wdio.conf.mts`, the verification script
  below, and the CI cache key all read it. Two things decide the list: the
  oldest version the plugin claims to support, and the settings-UI rewrite
  described below. Nothing else in the suite hard-codes a version, so adding
  or dropping one is a single-line change. Versions must be exact - a bare
  minor like `"1.13"` will not resolve.
- At some point Obsidian rebuilt its settings UI: tabs began rendering from a
  list of definitions rather than through `display()`, and the CSS snippets
  moved off the Appearance page onto their own sub-page you click into. Those
  are two genuinely different paths through `addControls`, so the pins have to
  straddle the change. `SETTINGS_SUB_PAGE_VERSION` names where the line falls
  and the specs branch on it, never on literal version numbers - so if the
  line turns out to be somewhere else, that constant is the only thing to
  move. See "where the settings UI changed" below for what is actually known.
- The floor pin guards the `minAppVersion` in `manifest.json`, and it is also
  as low as this suite can go: wdio-obsidian-service hard-codes
  `minSupportedObsidianVersion` and throws before it downloads anything older.
  The plugin may well work further back - older releases claimed to - but that
  is an untested claim, so the manifest only promises what the suite can
  demonstrate. `tests/min-app-version.test.ts` keeps the two in step.

  If you move `minAppVersion`, move this pin with it, and check the new floor
  is downloadable first: roughly half of Obsidian's patch releases were
  Insiders betas published only as asar archives behind an Obsidian login, and
  obsidian-launcher cannot fetch those unattended.

  `minAppVersion` only gates installing and updating from the community
  browser; it does not stop an already-enabled plugin from loading. So it
  cannot be tested by asserting that an older Obsidian rejects the plugin -
  the pin is there to prove the version we advertise genuinely works.
- To run against something else without editing that file:
  `OBSIDIAN_VERSIONS="latest" npm run test:e2e`, or pin the Electron installer
  too with `OBSIDIAN_VERSIONS="<app>/<installer>"`.
- `tests/e2e/vaults/simpleFakeVault` is the fixture vault: four inert plugins
  and four CSS snippets for the bulk commands and bisect to act on.
- `tests/e2e/specs/helpers.ts` resets that vault between tests. It also excludes
  wdio-obsidian-service's own helper plugins from Divide and Conquer's bulk
  operations, so a "disable all" does not switch off the test harness.
- `tests/e2e/specs/undocumented-api.e2e.ts` lists every Obsidian internal the
  plugin reaches for and asserts each one exists. Almost nothing this plugin
  does is in the public API, so that list is what `minAppVersion` really rests
  on - if it fails on the oldest pin, the floor has moved and the manifest
  needs to move with it.

#### Running without windows on screen

`npm run test:e2e` puts real Obsidian windows on your screen and takes focus
while it drives them. `npm run test:e2e:headless` runs the suite on a virtual
display instead, and `npm run test:e2e:verify:headless` does the same for the
version-coverage check. CI uses the former.

Both are **Linux only**, and the script says so rather than quietly falling back
to a headful run. Obsidian is an Electron app, and Electron has no headless
mode: Chromium's `--headless` switch is a browser-process feature that Electron
ignores, and hiding the window instead makes Chromium throttle the renderer
until the plugin's own timers stall and tests fail. A virtual display is the
only approach that leaves the app behaving normally, which means `xvfb-run`
(`sudo apt-get install -y xvfb`). On macOS, run the suite headful or let CI run
it.

#### Proving every version is actually covered

A suite that boots several Obsidians but only ever exercises version-agnostic
code would pass just as happily with all but one switched off, and the
reporter's version banner would not give it away. `npm run test:e2e:verify`
checks the claim directly: it breaks a version-specific hook in `src/main.ts`,
one at a time, and asserts that exactly the versions that own it fail. Every
row has to line up:

```text
ok   <old>  pass none (baseline)
ok   <new>  pass none (baseline)
ok   <old>  pass break the sub-page hook
ok   <new>  fail break the sub-page hook
ok   <old>  fail break the display() hook
ok   <new>  pass break the display() hook
```

`openPage` follows the CSS snippets sub-page and so exists only on the newer
side; `display()` is the older side, since newer builds render their tabs
through `renderTab` instead. The script restores `src/main.ts` and rebuilds
`dist/` afterwards, failures included. If it ever reports that it cannot find
the code it patches, the hooks have moved: update `MUTATIONS` in
`scripts/verify-version-coverage.mjs`.

#### Where the settings UI changed

This is the one version fact worth writing down, because everything else in
the suite is derived from it - and it is only partly pinned down:

- **1.12.7 lists the CSS snippets on the Appearance page** and renders tabs
  through `display()`. Verified by running the suite against it.
- **1.13.7 puts the snippets on their own sub-page** and renders tabs through
  `renderTab()`. Also verified.
- **Which release in between actually changed it is not established.**
  `SETTINGS_SUB_PAGE_VERSION` says 1.13.0, which is a guess consistent with
  every observation so far, not something the suite has demonstrated. It could
  be a late 1.12 patch.

None of the plugin's behaviour depends on the guess: `addControls` feature-
detects `openPage` and `renderTab` rather than comparing version numbers, so
it takes the right path wherever the line really falls. The constant only
decides what the *tests* expect. If you want to narrow it, add the candidate
release to `DEFAULT_OBSIDIAN_VERSIONS` and run `npm run test:e2e:verify` - the
mutation matrix will say which side of the line it sits on.

### TypeScript configuration

`tsconfig.json` covers `src/` and the vitest suite.

- `resolveJsonModule` is on because `tests/min-app-version.test.ts` imports
  `manifest.json` and `versions.json` directly, to check the version the
  manifest promises against the versions the suite runs.
- `allowJs` is on because that same test imports the version pins from
  `tests/e2e/obsidian-versions.mjs`. Those pins are plain JS rather than TS so
  that `scripts/verify-version-coverage.mjs` can import them under bare node,
  with no build step in the way.
- `tests/e2e` is excluded because those specs run under WebdriverIO rather than
  vitest, and lean on globals vitest does not provide.

`tsconfig.e2e.json` picks up exactly what the first one excludes.

- `moduleResolution: "bundler"` and the `types` list are what make wdio's
  ambient globals resolve - `browser`, `$`, `expect`, `describe`/`it`.
- `allowJs` again, for `obsidian-versions.mjs`.
- `include` reaches into `src/**` as well as `tests/e2e/**`. The specs need the
  `obsidian` module augmentations in `src/obsidian-undocumented-api.ts`, and
  `helpers.ts` needs the plugin's own type to declare
  `plugins.obsidianDivideAndConquer`.

Neither config is checked by `npm test`, so type-check both directly when you
touch them:

```sh
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.e2e.json
```

## Publishing

Refer to the [Publishing Guide](PUBLISHING.md) for instructions
on how to publish a new release of the plugin.
