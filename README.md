<p align="center">
  <video src="https://github.com/user-attachments/assets/a0181dac-4cce-4674-85b1-403f4e24c3f8" width="760" controls muted loop playsinline></video>
</p>
<p align="center"><em>▶ <a href="https://github.com/ProjectSidewalk/SidewalkWebpage/raw/develop/public/videos/ProjectSidewalk_LabelingFromSeattle_KerryPark4_optimized1.5x.mp4">Labeling sidewalk accessibility from Kerry Park, Seattle</a></em></p>

# Project Sidewalk

Project Sidewalk is an open-source web tool for mapping and assessing the accessibility of every sidewalk in the
world, using remote crowdsourcing, machine learning, and online satellite & streetscape imagery. Contributors walk
virtually through cities and label accessibility features and problems — curb ramps, obstacles, surface problems,
missing sidewalks, and more. And all collected data is fully open and downloadable in standard formats like GeoJSON and CSV, 
so it's easy to integrate into your own systems and research! See [https://projectsidewalk.org/api](https://projectsidewalk.org/api).

Project Sidewalk is deployed in **50+ cities across 10 countries** (the US, Canada, Chile, India, Mexico, Ecuador, the
Netherlands, Switzerland, and New Zealand), is natively translated into **six languages** (English, Spanish, German,
Mandarin, Portuguese, and Dutch), and has collected **3.4M+ contributor-labeled data points**. See the
[live data dashboard](https://jonfroehlich.github.io/ps-label-vis/ps-dashboard.html).

If you use or reference Project Sidewalk in your research, please cite:

> Manaswi Saha, Michael Saugstad, Hanuma Teja Maddali, Aileen Zeng, Ryan Holland, Steven Bower, Aditya Dash, Sage
> Chen, Anthony Li, Kotaro Hara, and Jon Froehlich. 2019. Project Sidewalk: A Web-based Crowdsourcing Tool for
> Collecting Sidewalk Accessibility Data At Scale. In Proceedings of the 2019 CHI Conference on Human Factors in
> Computing Systems (CHI '19). Association for Computing Machinery, New York, NY, USA, Paper 62, 1–14.
> https://doi.org/10.1145/3290605.3300292

<a href="https://projectsidewalk.org">
  <img src="https://github.com/ProjectSidewalk/SidewalkWebpage/assets/1621749/0e838038-14fe-48cf-a849-1025e688ae68" width="100" alt="Project Sidewalk">
</a>

## Tech stack

- **Backend:** Scala 2.13 + Play Framework 3.0 (Java 17), Postgres + PostGIS via Slick.
- **Frontend:** vanilla JavaScript, organized as independent apps bundled with Grunt (we're migrating off jQuery and
  Bootstrap).
- **Dev environment:** Docker.

For a full architecture overview, see [`docs/architecture.md`](docs/architecture.md).

## Quickstart for developers

Everything runs in Docker. In brief:

```bash
git clone https://github.com/ProjectSidewalk/SidewalkWebpage.git
cd SidewalkWebpage
make dev      # build + start containers, open a shell in the web container
npm start     # (inside that shell) build assets and run the app
```

Then open http://localhost:9000. You'll need a secrets file and database dump from a maintainer first — see the full
guide: **[`docs/dev-environment.md`](docs/dev-environment.md)**.

## Documentation

| Doc | What's in it |
|-----|--------------|
| [`docs/dev-environment.md`](docs/dev-environment.md) | Set up and run the app locally. |
| [`docs/editor-setup.md`](docs/editor-setup.md) | Configure IntelliJ IDEA or VS Code for the project. |
| [`docs/architecture.md`](docs/architecture.md) | How the backend, frontend, and data fit together. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branch/PR workflow, coding standards, i18n. |
| [`docs/style-guide.md`](docs/style-guide.md) | Detailed code-style conventions (JS, Scala, HTML/CSS). |
| [`docs/internationalization.md`](docs/internationalization.md) | How translations work + adding a new language. |
| [`CLAUDE.md`](CLAUDE.md) | Conventions + operational notes, used as AI-assistant context. |
| [`docs/testing-and-ci.md`](docs/testing-and-ci.md) | Testing strategy and CI rollout plan. |
| [`docs/upgrading-libraries.md`](docs/upgrading-libraries.md) | Dependency-version inventory and how to update each. |
| [`docs/logged-events.md`](docs/logged-events.md) | How user-interaction logging works + the event reference. |
| [`docs/data-notes.md`](docs/data-notes.md) | Release-specific caveats for analyzing Project Sidewalk data. |
| [`docs/ai-subsystems.md`](docs/ai-subsystems.md) | Map of all AI/CV subsystems and repos: what's in production, how the pieces connect, and the project timeline since 2018. |
| [`SECURITY.md`](SECURITY.md) | How to report a vulnerability. |
| [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) | Community standards. |

### Where documentation lives

**Developer documentation lives in this repository** — versioned with the code, reviewed in pull requests, and
searchable by tooling (and AI assistants). The
[**wiki**](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki) holds **operational runbooks** (e.g. deploying to
a live server), **city-deployment and GIS data preparation**, and **visual tutorials** — content that changes
independently of the code or is maintained by non-developers.

Rule of thumb: *if it describes the code or how to contribute, it's in the repo; if it's a runbook for operating a
server or onboarding a new city's data, it's in the wiki.* We keep one source of truth per topic and cross-link rather
than duplicate.

## AI in Project Sidewalk

Project Sidewalk increasingly combines crowdsourcing with AI. Two model families are in use
today, reflecting our research finding that *validating* an existing human label is a much
easier CV task than *finding and labeling* features from scratch:

- **AI validation & tag suggestions** (in production, ~55 cities): DINOv2-based models judge
  whether human labels are correct and suggest tags, run daily against a hosted GPU service
  ([`sidewalk-ai-api`](https://github.com/ProjectSidewalk/sidewalk-ai-api); trained in
  [`sidewalk-validator-ai`](https://github.com/ProjectSidewalk/sidewalk-validator-ai) and
  [`sidewalk-tagger-ai`](https://github.com/ProjectSidewalk/sidewalk-tagger-ai)).
- **AI labeling** (piloting): [RampNet](https://github.com/ProjectSidewalk/RampNet)
  (ICCV'25) detects curb ramps in whole GSV panoramas at human-level accuracy;
  [`sidewalk-auto-labeler`](https://github.com/ProjectSidewalk/sidewalk-auto-labeler)
  deploys it city-wide and submits labels for human validation.

See [`docs/ai-subsystems.md`](docs/ai-subsystems.md) for the full map — production data
flows, config keys, DB tables, and a timeline of every AI/CV repo since 2018.

## Contributing

We welcome bug reports, fixes, features, translations, and docs from contributors of all experience levels. Start by
picking an [open issue](https://github.com/ProjectSidewalk/SidewalkWebpage/issues), then follow the workflow and
coding standards in [`CONTRIBUTING.md`](CONTRIBUTING.md). Project Sidewalk has been built by
[160+ contributors](https://makeabilitylab.cs.washington.edu/projects/sidewalk/) — high schoolers, undergraduate and
graduate students, researchers, and partner organizations.

## Want Project Sidewalk in your city?

Want a Project Sidewalk server set up for your city or municipality? Read our
[Considerations for Deploying Project Sidewalk into a New City](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Considerations-when-Preparing-for-and-Deploying-to-New-Cities)
wiki page, then email us at **sidewalk@cs.uw.edu**.

If you're outside the team and want to set up your own server for a city we don't currently support, start with the
[Creating a database for a new city](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Creating-database-for-a-new-city)
wiki page. This is a non-trivial amount of work the first time through, especially without prior GIS experience —
email our lead engineer, Mikey (saugstad@cs.washington.edu), with questions.

## Project history & funding

Project Sidewalk began in 2012 with a Google Faculty Research Award and NSF Award
[#1302338](https://www.nsf.gov/awardsearch/showAward?AWD_ID=1302338), led by Prof. Jon E. Froehlich and then–PhD
student Kotaro Hara. The first deployment launched in Washington, DC, around 2017 (CHI 2019 Best Paper, above). The
work is currently supported by NSF Awards [#2125087](https://www.nsf.gov/awardsearch/showAward?AWD_ID=2125087)
(UI Chicago) and [#2236277](https://www.nsf.gov/awardsearch/showAward?AWD_ID=2236277) (Utah State University). See
the [wiki](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki) for the fuller history, deployments, and
mapathon materials.

## License

Project Sidewalk is released under the MIT License — see [`LICENSE.md`](LICENSE.md).
