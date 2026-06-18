---
name: add-city-configs
description: Adds configs for a new city, filling in the cityparams.conf file. Also adds any necessary translations to the messages files.
---

# Add City Configs

1. Fill in a new entry for every config in conf/cityparams.conf for the new city.
    - Set the launch date to be the Friday of the following week.
    - You can use an empty string for the Google Analytics IDs.
2. Add text translations to `conf/messages/`.
   - In `conf/messages/messages`, a city name is required. If it's in the US and the state isn't already listed, add the new state. If the country isn't listed, add that as well.
   - In `conf/messages/messages.en`, add the state abbreviation if it's in the US.
   - In the remaining messages files, add a translation line only if the given language uses text that's different from the US translation. zh-TW typically requires translations for all city, state, and country text. I typically use Google Translate for this.
