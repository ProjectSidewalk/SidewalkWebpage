/** The "Download BibTeX" button in the API docs' citation box. */

const BIBTEX = `
@inproceedings{Saha_ProjectSidewalk_CHI2019,
author = {Saha, Manaswi and Saugstad, Michael and Maddali, Hanuma Teja and Zeng, Aileen and Holland, Ryan and
Bower, Steven and Dash, Aditya and Chen, Sage and Li, Anthony and Hara, Kotaro and Froehlich, Jon},
title = {Project Sidewalk: A Web-based Crowdsourcing Tool for Collecting Sidewalk Accessibility Data At Scale},
year = {2019},
isbn = {9781450359702},
publisher = {Association for Computing Machinery},
address = {New York, NY, USA},
url = {https://doi.org/10.1145/3290605.3300292},
doi = {10.1145/3290605.3300292},
abstract = {We introduce Project Sidewalk, a new web-based tool that enables online crowdworkers to remotely label
pedestrian-related accessibility problems by virtually walking through city streets in Google Street View. To
train, engage, and sustain users, we apply basic game design principles such as interactive onboarding,
mission-based tasks, and progress dashboards. In an 18-month deployment study, 797 online users contributed
205,385 labels and audited 2,941 miles of Washington DC streets. We compare behavioral and labeling quality
differences between paid crowdworkers and volunteers, investigate the effects of label type, label severity,
and majority vote on accuracy, and analyze common labeling errors. To complement these findings, we report on
an interview study with three key stakeholder groups (N=14) soliciting reactions to our tool and methods. Our
findings demonstrate the potential of virtually auditing urban accessibility and highlight tradeoffs between
scalability and quality compared to traditional approaches.},
booktitle = {Proceedings of the 2019 CHI Conference on Human Factors in Computing Systems},
pages = {1–14},
numpages = {14},
keywords = {accessibility, crowdsourcing, gis, mobility impairments, urban informatics},
location = {Glasgow, Scotland Uk},
series = {CHI '19}
}
`;

/** Wires the button to hand the visitor the citation as a .bib file. */
export function setupBibtexDownload() {
  document.getElementById('download-bibtex').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([BIBTEX], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'project_sidewalk.bib';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}
