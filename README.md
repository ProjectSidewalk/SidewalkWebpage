
# Sidewalk Webpage
Want a Project Sidewalk server set up for your city/municipality? You can read about things we consider when choosing new deployment cities on our [Wiki](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Considerations-when-Preparing-for-and-Deploying-to-New-Cities) including geographic diversity, presence of local advocates, funding, etc. You can also read some past discussions [here](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/1379), [here](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/1626), and [here](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/281). 

If you would like to suggest that we deploy in your city/municipality, please email us at sidewalk@cs.uw.edu!

## Development Instructions

### Setting up the development environment

If you run into any problems during setup, check the [Docker troubleshooting wiki page](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Docker-Troubleshooting) and the [Github issues tagged as "Dev Environment"](https://github.com/ProjectSidewalk/SidewalkWebpage/issues?utf8=%E2%9C%93&q=is%3Aissue+label%3A%22Dev+Environment%22+). If you don't find any answers there, then post in the "core" or "intern" channels on Slack! We prefer posting to channels vs. DMs to Mikey to enable all of us to help each other.

<details><summary>Linux (Ubuntu)</summary>

1. Install Docker. You will probably want to [install rootless Docker](https://docs.docker.com/engine/security/rootless/) to make development easier in the future, though it is a bit more complicated. Talk to Mikey if you're having issues.
1. [Install docker-compose](https://docs.docker.com/compose/install/) separately (the docker daemon and docker-compose are only bundled on Mac/Windows).
1. Run `git clone https://github.com/ProjectSidewalk/SidewalkWebpage.git` in the directory where you want to put the code.
</details>

<details><summary>Mac</summary>

1. [Install  Docker Desktop](https://www.docker.com/get-started).
1. Run `git clone https://github.com/ProjectSidewalk/SidewalkWebpage.git` in the directory where you want to put the code.
</details>

<details><summary>Windows (WSL2)</summary>
    
There are two methods to setup your Docker dev environment with Windows: with WSL2 and without. We recommend and only support the *WSL2* installation process. 
    
WSL2 provides an actual Linux kernel running within a lightweight VM, unlike the older WSL which tried to emulate a linux kernel within the Windows kernel—see [Docker's official WSL2 overview](https://docs.docker.com/desktop/windows/wsl/). WSL2 offers faster compile times and is better supported by Docker.

1. [Install  Docker Desktop](https://www.docker.com/get-started). Follow the official [Docker Windows Install Guide](https://docs.docker.com/desktop/windows/install/).
1. [Install WSL2](https://docs.microsoft.com/en-us/windows/wsl/install-win10) using the default Linux distribution (Ubuntu).
1. Enter the Docker Dashboard and click the settings gear icon in the top right. From there, click the "General" tab and select the "Use the WSL 2 based engine" check box (this will be grayed out and pre-checked if you're running Windows Home).
1. Proceed by clicking **Resources &rarr; WSL Integration** and select your Linux VM of choice under "Enable integration with additional distros:". Here is some extra [documentation](https://docs.docker.com/docker-for-windows/wsl/) from Docker that may help out with this process.
1. Open your Linux VM shell and navigate to where you would like to set up your Project Sidewalk repository.
1. Run `git clone https://github.com/ProjectSidewalk/SidewalkWebpage.git`.

##### Transferring files from Windows to Linux VM
One issue you may encounter when setting up your dev environment within the Linux VM is transferring files (like the database dump) into the VM itself.

1. A simple solution is to open **File Explorer** and, inside the search box at the top, type in `\\wsl$` (this will connect you through network to the Linux VM). 
1. Locate the Linux VM within your Project Sidewalk directory (you can right click on it to pin it in your File Explorer) and find the `/mnt` folder. 
1. This folder is where your Windows drives are mounted. For example, `/mnt/c` will let you access the files in your C: drive; from here you can use commands like ```cp <source> <destination>``` to move files from your C: drive to your Linux VM's file system.
1. You could also find the `/home/<username>` folder in the Linux VM and locate your SidewalkWebpage directory where you can drag and drop files.

</details>

### Running the application locally
Here are the instructions to run Project Sidewalk locally for the first time. If you've already run through this list and gotten Project Sidewalk to run locally on your machine, but you just want to run it again (*e.g.,* after a machine restart), then type `make dev` in the root SidewalkWebpage directory. 

On Windows, we recommend [Windows Powershell](https://docs.microsoft.com/en-us/powershell/scripting/overview?view=powershell-7) (built in to Win10). On Mac, use the basic terminal or, even better, [iTerm2](https://www.iterm2.com/). On Linux (or if you're using WSL2 on Windows), the default Linux Shell (such as [Bash](https://www.gnu.org/software/bash/)) is a great choice.

1. Email Mikey (michaelssaugstad@gmail.com) and ask for a database dump and a Google Maps API key & secret (if you are not part of our team, you'll have to [create a Google Maps API key](https://developers.google.com/maps/documentation/javascript/get-api-key) yourself). Rename the database dump `sidewalk-dump` and put it in the `db/` directory (other files in this dir include `init.sh` and `schema.sql`, for example).
1. Modify the `GOOGLE_MAPS_API_KEY` and `GOOGLE_MAPS_SECRET` lines in the `docker-compose.yml` using the key and secret you've acquired.
1. Modify the `SIDEWALK_CITY_ID` line in the `docker-compose.yml` to use the ID of the appropriate city. You can find the list of IDs for the cities starting at line 7 of `conf/cityparams.conf`.
1. From the root SidewalkWebpage dir, run `make dev`. This will take time (20-30 mins or more depending on your Internet connection) as the command downloads the docker images, spins up the containers, and opens a Docker shell into the webpage container. The containers (running Ubuntu Stretch) will have all the necessary packages and tools so no installation is necessary. This command also initializes the database, though we still need to import the data. Successful output of this command will look like:

    ```
    Successfully built [container-id]
    Successfully tagged projectsidewalk/web:latest
    WARNING: Image for service web was built because it did not already exist. 
    To rebuild this image you must use `docker-compose build` or `docker-compose up --build`.
    root@[container-id]:/opt#
    ```

1. In a separate terminal, run the commands below. In the second command, replace `<city-name>` with one of `dc`, `seattle`, `newberg`, `columbus`, `cdmx`, `spgg`, `chicago`, `amsterdam`, `la-piedad`, `oradell`, or `pittsburg` (pittsburgh is missing the 'h', but it's a typo we're stuck with), depending on which city your database dump is for.

    ```
    docker exec -it projectsidewalk-db psql -c "CREATE ROLE saugstad SUPERUSER LOGIN ENCRYPTED PASSWORD 'sidewalk';" -U postgres -d postgres
    docker exec -it projectsidewalk-db psql -c "CREATE ROLE sidewalk_<city-name> SUPERUSER LOGIN ENCRYPTED PASSWORD 'sidewalk';" -U postgres -d postgres
    ```

1. Run `make import-dump db=sidewalk` from the root project directory outside the Docker shell. This may take a while depending on the size of the dump. Don't panic if this step fails :) and consult the [Docker Troubleshooting wiki](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Docker-Troubleshooting). Check the output carefully. If it looks like there are errors, do not skip to the next step, check the wiki and ask Mikey if you don't find solutions in there.
1. Run `npm start` from inside the Docker shell. If this is your first time running the command, *everything* will need to be compiled. So, it may take 5+ minutes initially, but will be orders of magnitude faster in the future (~10 secs).

    The behavior of `npm start` is dictated by what `start` is supposed to do as defined in `package.json` file. As per the current code, running this command will run `grunt watch` & `sbt compile "~ run"` (the `~` here is triggered execution that allows for the server to run in watch mode). This should start the web server. Successful output of this command will look like:

    ```
    > grunt watch & sbt clean "~ run"

    Running "watch" task
    Waiting...
    [info] Loading project definition from /opt/project
    [info] Set current project to sidewalk-webpage (in build file:/opt/)
    [success] Total time: 78 s, completed Dec 20, 2018 8:06:19 AM
    [info] Updating {file:/opt/}root...
    [info] Resolving it.geosolutions.jaiext.errordiffusion#jt-errordiffusion;1.0.8 .[info] Resolving org.fusesource.jansi#jansi;1.4 ...
    [info] Done updating.

    --- (Running the application, auto-reloading is enabled) ---

    [info] play - Listening for HTTP on /0.0.0.0:9000

    (Server started, use Ctrl+D to stop and go back to the console...)
    ```

1. Head on over to your browser and navigate to `127.0.0.1:9000`. This should display the Project Sidewalk webpage. It might take time to load initially.

### Setting up another database or city
1. Acquire another database dump and rename it `[db-name]-dump`. I would suggest naming it `sidewalk-seattle-dump` if it is a Seattle database, for example. Just make sure it does not conflict with the name of any databases you already have set up.
1. Run `make import-dump db=[db-name]` from the root project directory outside the Docker shell. Using the example from step 1., this would be `make import-dump db=sidewalk-seattle`.
1. Update the `DATABASE_URL` variable in the `docker-compose.yml` to be `jdbc:postgresql://db:5432/[db-name]`.
1. If the database is for a city other than DC, modify the `SIDEWALK_CITY_ID` line in `docker-compose.yml` to use the appropriate ID. You can find the list of IDs for the cities starting at line 7 of `conf/cityparams.conf`.
1. Rerun `make dev`.

### Additional tools
1. SSH into containers: To ssh into the containers, run `make ssh target=[web|db]`. Note that `[web|db]` is not a literal syntax, it specifies which container you would want to ssh into. For example, you can do `make ssh target=web`.

### Programming environment
We recommend the [IntelliJ IDEA](https://www.jetbrains.com/idea/) IDE for development. You should be able to get a [student license](https://www.jetbrains.com/student/) to get the "ultimate" edition of IntelliJ IDEA. 

#### IntelliJ IDEA
On the first run of IntelliJ IDEA, make sure to select the Scala plugin. In addition, we recommend installing the [Play Routes](https://plugins.jetbrains.com/plugin/10053-play-routes/), [i18n support](https://plugins.jetbrains.com/plugin/12981-i18n-support/), and [HOCON](https://plugins.jetbrains.com/plugin/10481-hocon) plugins. 

To install the plugins, open IDEA and select `File -> Settings`. In the Settings window, select the `Plugins` option on the left sidebar and then `Marketplace` (on top menubar). In the "search area" (textfield next to magnifying glass):
- Type in "play routes" and select "Play Routes" by Tomáš Milata (31.6K downloads with 3.72-star rating at the time of writing). Hit the `Install` button.
- Type in "i18n support" and install the "i18n support" plugin by i18nPlugin (10.6K downloads with 4.56-star rating)
- Type in "hocon" and install the "HOCON" plugin by Roman Janusz *et al.* (739.8K downloads with 3.54-star rating)

#### Database tools
To look at and run queries on your database, you will want to install a database client. [Valentina Studio](https://www.valentina-db.com/en/valentina-studio-overview) is a good cross-platform database client. People also like using [Postico](https://eggerapps.at/postico/) for Mac or [PGAdmin](https://www.pgadmin.org/download/) on Windows/Mac.

You'll connect to the database using the following credentials:
```
Host: localhost:5432
User: postgres
Password: sidewalk
Database: sidewalk
```

### Making changes
1. Before making changes, check out our [style guide](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Style-Guide) and [process for contributing new code](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Process-for-contributing-new-code) wiki pages.
1. If you make any changes to the `build.sbt` or the configs, you'd need to press `Ctrl+D` and then `sbt clean` and then `npm start` from inside the Docker shell.
1. If you make any changes to the views or other scala files, these changes will be automatically picked up by `sbt`. You'd need to reload the browser once the compilation finishes. For example, a change to `index.scala.html` file results in:

    ```
    [info] Compiling 1 Scala source to /opt/target/scala-2.10/classes...
    [success] Compiled in 260s

    --- (RELOAD) ---

    [info] play - Shutdown application default Akka system.
    [info] play - database [default] connected at jdbc:postgresql://db:5432/sidewalk
    [info] play - Starting application default Akka system.
    [info] play - Application started (Dev)
    [success] Compiled in 124s
    ```

1. If you make any changes to the assets (look in `Gruntfile.js` under `watch` block), these changes will be picked up by `grunt`. You'd need to reload the browser once the compilation finishes. For example, a change to `public/javascripts/HELP/src/tableOfContents.js` file results in (output has been trimmed):

    ```
    >> File "public/javascripts/Help/src/tableOfContents.js" changed.
    Running "concat:dist_audit" (concat) task
    Running "concat:dist_progress" (concat) task
    Running "concat:dist_admin" (concat) task
    Running "concat:dist_help" (concat) task
    Running "concat:dist_validate" (concat) task
    Running "concat_css:dist_audit" (concat_css) task
    File "public/javascripts/SVLabel/build/SVLabel.css" created.
    Running "concat_css:dist_validate" (concat_css) task
    File "public/javascripts/SVValidate/build/SVValidate.css" created.

    Done.
    Completed in 23.905s at Thu Dec 20 2018 09:31:45 GMT+0000 (Coordinated Universal Time) - Waiting...

    [success] Compiled in 5s
    ```

## Running the application remotely
NOTE: This has not been tested in a very long time and may not work.

To run the application remotely,

1. Use Play's dist tool to create jar files of the project (i,e., `activator dist`): https://www.playframework.com/documentation/2.3.x/ProductionDist
1. Upload the zip file to the web server
1. SSH into the server and unarchive the zip file (e.g., `unzip filename`).
1. Run `nohup bin/sidewalk-webpage -Dhttp.port=9000 &` ([reference](http://alvinalexander.com/scala/play-framework-deploying-application-production-server)). Sometimes the application tells you that port 9000 (i.e., default port for a Play app) is taken. To kill an application that is occupying the port, first identify the pid with the netstat command `netstat -tulpn | grep :9000` and then use the `kill` command.
