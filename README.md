<img src="https://github.com/ProjectSidewalk/SidewalkWebpage/assets/1621749/0e838038-14fe-48cf-a849-1025e688ae68" width="200">

# Project Sidewalk

<p align="center">
  <video src="https://github.com/user-attachments/assets/a0181dac-4cce-4674-85b1-403f4e24c3f8" width="760" controls muted loop playsinline></video>
</p>
<p align="center"><em>▶ <a href="https://github.com/ProjectSidewalk/SidewalkWebpage/raw/develop/public/videos/ProjectSidewalk_LabelingFromSeattle_KerryPark4_optimized1.5x.mp4">Labeling sidewalk accessibility from Kerry Park, Seattle</a></em></p>

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
| [`docs/architecture.md`](docs/architecture.md) | How the backend, frontend, and data fit together. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branch/PR workflow, coding standards, i18n. |
| [`CLAUDE.md`](CLAUDE.md) | Conventions + operational notes, used as AI-assistant context. |
| [`docs/testing-and-ci.md`](docs/testing-and-ci.md) | Testing strategy and CI rollout plan. |
| [`SECURITY.md`](SECURITY.md) | How to report a vulnerability. |
| [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) | Community standards. |

Operational runbooks, city-deployment guidance, and visual/GIS tutorials live in the
[**wiki**](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki).

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
