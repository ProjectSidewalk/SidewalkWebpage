
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

1. [Install  Docker Desktop](https://www.docker.com/get-started). Make sure to select "Download for Mac—Apple Chip" if you have an Apple M1, M2, etc. or "Download for Mac—Intel Chip" if you have an Intel chip (older Mac models). 
1. Run `git clone https://github.com/ProjectSidewalk/SidewalkWebpage.git` in the directory where you want to put the code.
</details>

<details><summary>Windows (WSL2)</summary>

##### First time setup

There are two methods to set up your Docker dev environment with Windows: with WSL2 and without. We recommend and only support the *WSL2* installation process. 
    
WSL2 provides an actual Linux kernel running within a lightweight VM, unlike the older WSL which tried to emulate a linux kernel within the Windows kernel—see [Docker's official WSL2 overview](https://docs.docker.com/desktop/windows/wsl/). WSL2 offers faster compile times and is better supported by Docker.

1. [Install  Docker Desktop](https://www.docker.com/get-started). Follow the official [Docker Windows Install Guide](https://docs.docker.com/desktop/windows/install/). When prompted, ensure the **Use WSL 2** instead of Hyper-V option on the Configuration page is selected
1. [Install WSL2](https://docs.microsoft.com/en-us/windows/wsl/install-win10) using the default Linux distribution (Ubuntu). Open PowerShell in **administrator** mode by right-clicking and selecting "Run as adminstrator" then enter `wsl --install`, which will use **WSL 2** to install **Ubuntu** by default (see [Microsoft's WSL instructions](https://learn.microsoft.com/en-us/windows/wsl/install)). We recommend pinning Ubuntu to your taskbar to open up the shell easily but you can easily find it in the future by searching "Ubuntu" from the Windows Start menu.
1. Make sure you are also running the latest version of WSL. Again, in PowerShell, run `wsl --update`
1. Enter the Docker Dashboard and click the settings gear icon in the top right. From there, click the "General" tab and select the "Use the WSL 2 based engine" check box (this will be grayed out and pre-checked if you're running Windows Home).
1. Proceed by clicking **Resources &rarr; WSL Integration** and making sure that "Enable integration with my default WSL distro" and "Ubuntu" are checked.
1. Open your Linux VM shell and navigate to where you would like to set up your Project Sidewalk repository. For me, that's `/home/jonf/projects/`.
1. From your Linux VM shell, run `git clone https://github.com/ProjectSidewalk/SidewalkWebpage.git`.

##### Starting/Shutting down WSL2 and Docker when you're done working

WSL and Docker can take up lots of memory in the background. If you aren't working on Project Sidewalk, you can shut down Docker and WSL to prevent unnecessary memory consumption on your computer by following the steps below. If you shut them down, you will need to start them back up again before working on Project Sidewalk! 

###### Shut down Docker/WSL
1. **Close any apps using Docker or WSL.** Make sure to shut down Project Sidewalk and any other apps that might be using Docker or WSL. If you don't, WSL will start up again automatically.
1. **Shut down Docker.** Open the hidden icons button on the toolbar, right-click the Docker symbol, and click "Quit Docker Desktop".
1. **Shut down WSL.** Run `wsl --shutdown`.

###### Start Docker/WSL
1. **Start WSL.** From the terminal, run `wsl -d Ubuntu`. Starting an IDE using WSL will also automatically boot it up.
2. **Start Docker.** Search for Docker Desktop in the start menu and run the app. You can then freely run `make dev` to begin development.

##### Transferring files from Windows to Linux VM
One issue you may encounter when setting up your dev environment within the Linux VM is transferring files (like the database dump) into the VM itself.

1. A simple solution is to open **File Explorer**. Check the left sidebar. Open `Linux -> Ubuntu -> home -> \<username\> -> SidewalkWebpage`. This will connect you to the file system within your Linux VM. We recommend right-clicking on this folder and choosing "Pin to Quick access" to make it easy to find in the future.
1. You should now be able to drag and drop files into that folder like you normally would.
1. When you copy over files, a `:Zone.Identifier` file is typically also created. You can safely delete those, and you should!

A command-line alternative: From you Linux VM, you can find your Windows files from the `/mnt` directory. This folder is where your Windows drives are mounted. For example, `/mnt/c` will let you access the files in your C: drive; from here you can use commands like ```cp <source> <destination>``` to move files from your C: drive to your Linux VM's file system.

</details>

### Running the application locally
Here are the instructions to run Project Sidewalk locally for the first time. If you've already run through this list and gotten Project Sidewalk to run locally on your machine, but you just want to run it again (*e.g.,* after a machine restart), then type `make dev` in the root SidewalkWebpage directory.

Make sure Docker is running on your machine. You should see a Docker whale in your Mac or Windows tray. You can also configure Docker to run at startup (see Preferences).

On Windows, we recommend [Windows Powershell](https://docs.microsoft.com/en-us/powershell/scripting/overview?view=powershell-7) (built in to Win10). On Mac, use the basic terminal or, even better, [iTerm2](https://www.iterm2.com/). On Linux (or if you're using WSL2 on Windows), the default Linux Shell (such as [Bash](https://www.gnu.org/software/bash/)) is a great choice.

1. Email Mikey (michaelssaugstad@gmail.com) and ask for a database dump, a Mapbox API key, and a Google Maps API key & secret (if you are not part of our team, you'll have to [create a Google Maps API key](https://developers.google.com/maps/documentation/javascript/get-api-key) yourself).
1. If your computer has an Apple Silicon (M1 or M2) chip, then you should modify the `platform` line in the `docker-compose.yml`, changing it to `linux/arm64`.
1. Modify the `MAPBOX_API_KEY`, `GOOGLE_MAPS_API_KEY`, and `GOOGLE_MAPS_SECRET` lines in the `docker-compose.yml` using the keys and secret you've acquired.
1. Modify the `SIDEWALK_CITY_ID` line in the `docker-compose.yml` to use the ID of the appropriate city, listed [here](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Docker-Troubleshooting#first-heres-a-table-that-youll-reference-when-setting-up-your-dev-env) (it's the city that matches your database dump, so check the name of the db dump file).
1. Modify the `DATABASE_USER` line in the `docker-compose.yml`, replacing "sidewalk" with the username from the table [linked above](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Docker-Troubleshooting#first-heres-a-table-that-youll-reference-when-setting-up-your-dev-env).
1. Rename the database dump file that you got from Mikey to "\<database_user\>-dump" (using the name from the prev step) and put it in the `db/` directory (other files in this dir include `init.sh` and `schema.sql`).
1. From the root SidewalkWebpage dir, run `make dev`. This will take time (20-30 mins or more depending on your Internet connection) as the command downloads the docker images, spins up the containers, and opens a Docker shell into the webpage container in that same terminal. The containers (running Ubuntu Stretch) will have all the necessary packages and tools so no installation is necessary. This command also initializes the database, though we still need to import the data. Successful output of this command will look like:

    ```
    Successfully built [container-id]
    Successfully tagged projectsidewalk/web:latest
    WARNING: Image for service web was built because it did not already exist. 
    To rebuild this image you must use `docker-compose build` or `docker-compose up --build`.
    root@[container-id]:/home#
    ```

1. In a separate terminal, run the command below.

    ```
    docker exec -it projectsidewalk-db psql -c "CREATE ROLE saugstad SUPERUSER LOGIN ENCRYPTED PASSWORD 'sidewalk';" -U postgres -d postgres
    ```

1. Run `make import-dump db=<database_user>` (needs to be the same thing you set for `DATABASE_USER`) from the root project directory outside the Docker shell (from a new Ubuntu terminal). This may take a while depending on the size of the dump. Don't panic if this step fails :) and consult the [Docker Troubleshooting wiki](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Docker-Troubleshooting). Check the output carefully. If it looks like there are errors, do not skip to the next step, check the wiki and ask Mikey if you don't find solutions in there.
1. Run `npm start` from inside the Docker shell (the terminal where you ran `make dev`). If this is your first time running the command, *everything* will need to be compiled. So, it may take 5+ minutes initially, but will be orders of magnitude faster in the future (~10 secs).

    The behavior of `npm start` is dictated by what `start` is supposed to do as defined in `package.json` file. As per the current code, running this command will run `grunt watch` & `sbt compile "~ run"` (the `~` here is triggered execution that allows for the server to run in watch mode). This should start the web server. Successful output of this command will look like:

    ```
    > grunt watch & sbt clean "~ run"

    Running "watch" task
    Waiting...
    [info] Loading project definition from /home/project
    [info] Set current project to sidewalk-webpage (in build file:/home/)
    [success] Total time: 78 s, completed Dec 20, 2018 8:06:19 AM
    [info] Updating {file:/home/}root...
    [info] Resolving it.geosolutions.jaiext.errordiffusion#jt-errordiffusion;1.0.8 .[info] Resolving org.fusesource.jansi#jansi;1.4 ...
    [info] Done updating.

    --- (Running the application, auto-reloading is enabled) ---

    [info] play - Listening for HTTP on /0.0.0.0:9000

    (Server started, use Ctrl+D to stop and go back to the console...)
    ```

1. Head on over to your browser and navigate to `localhost:9000` (or try `127.0.0.1:9000`). This should display the Project Sidewalk webpage. It might take time to load initially.

### Setting up another database or city
1. Acquire another database dump, put it in the `db/` directory, and rename it to "\<database_user\>-dump", using the appropriate database user from [this table](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Docker-Troubleshooting#first-heres-a-table-that-youll-reference-when-setting-up-your-dev-env).
1. Run `make import-dump db=<db_user>` (using the name from the prev step) from the root project directory outside the Docker shell.
1. Update the `DATABASE_USER` variable in the `docker-compose.yml` to the same name.
1. Modify the `SIDEWALK_CITY_ID` line in `docker-compose.yml` to use the appropriate ID from [this table](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Docker-Troubleshooting#first-heres-a-table-that-youll-reference-when-setting-up-your-dev-env).
1. Rerun `make dev`.
1. To switch back and forth between databases going forward, you will need to close the Docker shell (if you ran `make dev`, that just means running `exit` in that terminal), update the `DATABASE_USER` and `SIDEWALK_CITY_ID`, and rerun `make dev`.

### Additional tools
1. SSH into containers: To ssh into the containers, run `make ssh target=[web|db]`. Note that `[web|db]` is not a literal syntax, it specifies which container you would want to ssh into. For example, you can do `make ssh target=web`.

### Programming environment
We recommend the [IntelliJ IDEA](https://www.jetbrains.com/idea/) IDE for development. You should be able to get a [student license](https://www.jetbrains.com/student/) to get the "ultimate" edition of IntelliJ IDEA. 

#### IntelliJ IDEA Setup
1. Download and install from [here]([url](https://www.jetbrains.com/idea/)), and make sure to get a [student license](https://www.jetbrains.com/student/), which you should use during the install proces!
1. On the first run of IntelliJ IDEA, you'll want to choose the 'Open' option (not the 'New Project') option, and choose the folder that holds the Project Sidewalk code (it is probably called `SidewalkWebpage`, it should be one level above the `app/` directory).
1. Now let's hide some build files so that searching through your code is easier/faster. Go to `File -> Project Structure` and click on `Modules` in the left sidebar. You should have a module there with the Project Sidewalk code; if you don't, try to make one and let me know how it goes!
    1. For each of the directories below, right click on it and click 'Sources' to mark it as source code:
        - app
        - conf
        - db
        - project
        - public
    1. Then for each of these directories, right click on it and click 'Excluded' so that it doesn't show up in search, so that you hopefully don't accidentally edit these files!
        - Any other top-level directory that you didn't mark as 'Sources'
        - project/project
        - project/target
        - public/fonts
        - public/javascripts/Admin/build
        - public/javascripts/Gallery/build
        - public/javascripts/Help/build
        - public/javascripts/Progress/build
        - public/javascripts/PSMap/build
        - public/javascripts/SVLabel/build
        - public/javascripts/SVValidate/build
1. We then recommend installing a few plugins. To do so, go to `File -> Settings`. Select the `Plugins` option on the left sidebar and then `Marketplace` (on top menubar). For each of the following plugins, enter their name in the "search area" (textfield next to magnifying glass), find the plugin, and click `Install`: [Play 2 Routes](https://plugins.jetbrains.com/plugin/10053-play-2-routes/), [i18n support](https://plugins.jetbrains.com/plugin/12981-i18n-support/), [HOCON](https://plugins.jetbrains.com/plugin/10481-hocon), and [Scala](https://plugins.jetbrains.com/plugin/1347-scala) (if you haven't already). You will then need to restart IntelliJ to install the plugins.
1. Finally, let's install a Java SDK to help with syntax highlighting in Scala/Java. Open `File -> Project Structure` and click on `Project` in the left sidebar. Under `SDK`, choose `Add SDK -> Download JDK`. Choosing version 1.8 is necessary. The default "Amazon Corretto" version works, but presumably others should as well. Click `Download`. Then set the `Language Level` to 8. It may take a bit of time to install Java.

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
    [info] Compiling 1 Scala source to /home/target/scala-2.10/classes...
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
