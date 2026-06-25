# Editor setup

Project Sidewalk has two codebases with different sweet spots: a **Scala + Play** backend and a **vanilla-JavaScript**
frontend. Use whatever editor you're productive in — the team uses both IntelliJ IDEA and VS Code, and we mandate
neither. This page covers getting each one set up well. For everything *around* the editor (Docker, the database, the
`npm start` workflow), see [`docs/dev-environment.md`](dev-environment.md).

Whichever editor you choose, configure it to **run scalafmt on the Scala files you change** (CI checks formatting),
and remember the app itself builds and runs **inside Docker** — your editor is for reading, navigating, and editing,
while compilation and the dev server happen in the web container via `npm start`.

## A note on the JDK

The project targets **Java 17** (`build.sbt` sets `-source/-target 17`) and **Scala 2.13**. The app compiles inside
the Docker container, which already has the right JDK, so you don't strictly need a local JDK to run Project Sidewalk.
You *do* want one installed locally for your editor's language tooling (indexing, navigation, inline errors) to work.
Install a **Java 17** JDK (e.g. [Temurin 17](https://adoptium.net/temurin/releases/?version=17), or
`sudo apt install openjdk-17-jdk` on Debian/Ubuntu) and point your editor at it.

## IntelliJ IDEA

IntelliJ has the most turnkey Scala/Play support, so it's the easiest path for backend work. The free
[Community edition](https://www.jetbrains.com/idea/download/) is enough; students can get
[Ultimate for free](https://www.jetbrains.com/student/).

### First run

On first launch, install the **Scala** plugin when prompted. Then add these from
`File → Settings → Plugins → Marketplace` (search, then `Install`):

- **[Scala](https://plugins.jetbrains.com/plugin/1347-scala)** — Scala/Play language support (the essential one).
- **[Play Routes](https://plugins.jetbrains.com/plugin/10053-play-routes/)** — syntax support for `conf/routes`.
- **[HOCON](https://plugins.jetbrains.com/plugin/10481-hocon)** — for the `.conf` files (`application.conf`,
  `cityparams.conf`, …).
- **[i18n support](https://plugins.jetbrains.com/plugin/12981-i18n-support/)** — helps manage the `conf/messages.*`
  translation files.

### Point IntelliJ at the JDK

If you see **"Project JDK is not defined"** or **"No Scala SDK in module"** at the top of the window, IntelliJ can't
find a JDK/Scala SDK and won't be able to analyze the code. Open
`File → Project Structure → Project` and set the **SDK** to your local **Java 17** JDK (see
[A note on the JDK](#a-note-on-the-jdk) above). The Scala SDK is supplied by the Scala plugin once it's installed.

### Format on save

Enable scalafmt as the formatter so your changes match `.scalafmt.conf`:
`Settings → Editor → Code Style → Scala → Formatter → Scalafmt`, and turn on
`Settings → Tools → Actions on Save → Reformat code`. You can also format the current file manually with
`Ctrl`+`Alt`+`L`.

### Navigating a file

`Alt`+`7` opens the **Structure** pane — the classes, methods, and fields of the current file. Handy in the larger
Scala services and the big frontend modules. ([JetBrains docs](https://www.jetbrains.com/help/idea/viewing-structure-of-a-source-file.html).)

## VS Code

VS Code is excellent for the **vanilla-JS frontend** and works well for Scala with the Metals extension.

- **Scala:** install the **[Metals](https://scalameta.org/metals/docs/editors/vscode/)** extension. On first open of
  the project it will import the build (it uses your local Java 17 JDK) and then provide navigation, inline errors,
  and formatting. Metals reads `.scalafmt.conf` directly — run **Format Document** (or enable
  `"editor.formatOnSave": true`) to keep Scala files formatted.
- **Frontend:** no build tooling is needed in the editor — files are plain ES concatenated by Grunt. Edit under
  `src/` and let the `grunt watch` from `npm start` rebuild the `build/` bundles (don't edit `build/` directly).
  An ESLint extension will pick up [`.eslintrc.json`](../.eslintrc.json) so you see our JS rules inline.

## See also

- [`docs/dev-environment.md`](dev-environment.md) — Docker, database, and the day-to-day `npm start` workflow,
  including a database-client section (Valentina Studio / Postico / pgAdmin).
- [`docs/style-guide.md`](style-guide.md) — the code conventions your editor should help you follow.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — branch/PR workflow and the scalafmt expectation.
