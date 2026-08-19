---
name: add-city-configs
description: Finishes a new city's configs after `make onboard-city` — non-English translations and a review of the derived cityparams values.
---

# Add City Configs

`make onboard-city id=<city-id>` (tools/setup_new_city.py) already registers the city in conf/cityparams.conf with
derived values, adds the English name lines to conf/messages/messages (plus the state abbreviation in messages.en
for US cities), and appends the docs/dev-environment.md City IDs row. This skill covers what that script can't:

1. Review the generated cityparams.conf entry:
   - The Google Analytics ids are `"TODO"` placeholders — create the real properties and fill the ids with
     `python3 tools/create_ga_properties.py <city-id>` (its docstring covers the one-time service-account setup),
     or flag them as a launch blocker.
   - Sanity-check the derived `landing-page-url` (the script drops the state/country qualifier from the server name),
     `launch-date`, and `status`.
2. Non-English translations in `conf/messages/`:
   - Add a translation line only where a language renders the name differently from English. zh-TW typically needs
     translations for the city, state, and country names; Latin-script languages usually only for well-known places
     (see the existing `state.name.*` entries for the pattern).
   - If the country is new to the platform, add its name keys across the message files too.

If the city was set up manually (without `make onboard-city`), first do everything that script would have: the full
cityparams.conf entry set, the English city/state name lines, and the docs/dev-environment.md City IDs row (see
tools/setup_new_city.py for the field list and derivations).
