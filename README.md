# Sidewalk Webpage
Want a Project Sidewalk server set up for your city/municipality? We have had various discussions on Github about what we are looking for when choosing new cities to deploy in (geographic diversity, presence of local advocates, funding, etc.), which you can read through [here](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/1379), [here](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/1626), and [here](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/281). If you would like to suggest that we deploy in your city/municipality, please email us at sidewalk@cs.uw.edu!

## Development Instructions

### Setting up the development environment
The development environment is set up using Docker containers. Hence, in order to set the development environment, [installation of Docker](https://www.docker.com/get-started) is necessary. Windows PowerShell users may also need to install `make`. You will also need to clone the SidewalkWebpage Github repo by navigating to your desired location in the terminal and entering `git clone https://github.com/ProjectSidewalk/SidewalkWebpage.git`.

If you run into any problems during setup, check the [Docker troubleshooting wiki page](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Docker-Troubleshooting) and the [Github issues tagged as "Dev Environment"](https://github.com/ProjectSidewalk/SidewalkWebpage/issues?utf8=%E2%9C%93&q=is%3Aissue+label%3A%22Dev+Environment%22+). If you don't find any answers there, then post in the "newbies" channel on Slack!

### Running the application locally
To run the web server locally, from the **root** of the SidewalkWebpage directory:

1. Email Mikey (michaelssaugstad@gmail.com) and ask for the two API key files and a database dump. You will put the API key files into the root directory of the project. Rename the database dump `sidewalk-dump` and put it in the `db` directory.

1. If the database dump is for a city other than DC, modify the 2nd line of `conf/cityparams.conf` to use the appropriate ID. You can find the IDs for the cities starting at line 7 of that file.

1. From the root SidewalkWebpage dir, run `make dev`. This will take time (20-30 mins or more depending on your Internet connection) as the command downloads the docker images, spins up the containers, and opens a Docker shell into the webpage container. The containers (running Ubuntu Stretch) will have all the necessary packages and tools so no installation is necessary. This command also initializes the database, though we still need to import the data. Successful output of this command will look like:

    ```
    Successfully built [container-id]
    Successfully tagged projectsidewalk/web:latest
    WARNING: Image for service web was built because it did not already exist. 
    To rebuild this image you must use `docker-compose build` or `docker-compose up --build`.
    root@[container-id]:/opt#
    ```

1. In a separate terminal, run `make import-dump db=sidewalk` from the root project directory outside the Docker shell. This may take awhile depending on the size of the dump. If this step fails, consult the [Docker Troubleshooting wiki](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Docker-Troubleshooting) (particularly, [this entry](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Docker-Troubleshooting#running-make-import-dump-dbsidewalk-fails))

1. Run `npm start` from inside the Docker shell. The result of this command is dictated by what `start` is supposed to do as defined in `package.json` file. As per the current code, running this command will run `grunt watch` & `sbt compile "~ run"` (`~` here is triggered execution that allows for the server to run in watch mode). This should start the web server. Note that the first time compilation takes time. Successful output of this command will look like:

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

1. Head on over to your browser and navigate to `127.0.0.1:9000`. This should display the Project Sidewalk webpage.

### Setting up another database or city
1. Acquire another database dump and rename it `[db-name]-dump`. I would suggest naming it `sidewalk-seattle-dump` if it is a Seattle database, for example. Just make sure it does not conflict with the name of any databases you already have set up.

1. Run `make import-dump db=[db-name]` from the root project directory outside the Docker shell. Using the example from step 1., this would be `make import-dump db=sidewalk-seattle`.

1. Update the `DATABASE_URL` variable in the `docker-compose.yml` to be `jdbc:postgresql://db:5432/[db-name]`.

1. If the database is for a city other than DC, modify the 2nd line of the `conf/cityparams.conf` file to be `city-id = "seattle-wa"` for Seattle or `city-id = "newberg-or"` for Newberg.

1. Rerun `make dev`.

### Additional tools
1. SSH into containers: To ssh into the containers, run `make ssh target=[web|db]`. Note that `[web|db]` is not a literal syntax, it specifies which container you would want to ssh into. For example, you can do `make ssh target=web`.

### Programming environment
The IDE [IntelliJ IDEA](https://www.jetbrains.com/idea/) is highly recommended for development, particularly with Scala. You should be able to get a [student license](https://www.jetbrains.com/student/) to get the "ultimate" edition of IntelliJ IDEA. If using IntelliJ IDEA, we would recommend installing the [Play Routes](https://plugins.jetbrains.com/plugin/10053-play-routes/), [i18n support](https://plugins.jetbrains.com/plugin/12981-i18n-support/), and [HOCON](https://plugins.jetbrains.com/plugin/10481-hocon) plugins.

To look at and run queries on your database, you will want to install a database client. [Valentina Studio](https://www.valentina-db.com/en/valentina-studio-overview) is a good cross-platform database client. People also like using [Postico](https://eggerapps.at/postico/) for Mac or [PGAdmin](https://www.pgadmin.org/download/) on Windows/Mac.

You'll connect to the database using the following credentials:
```
Host: localhost:5432
User: sidewalk
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

1. If you make any changes to the assets (look in `Gruntfile.js` under `watch` block), these changes will be picked up by `grunt`. You'd need to reload the browser once the compilation finishes. For example, a change to `public/javascripts/FAQ/src/tableOfContents.js` file results in (output has been trimmed):

    ```
    >> File "public/javascripts/FAQ/src/tableOfContents.js" changed.
    Running "concat:dist_svl" (concat) task
    Running "concat:dist_progress" (concat) task
    Running "concat:dist_admin" (concat) task
    Running "concat:dist_faq" (concat) task
    Running "concat_css:all" (concat_css) task
    File "public/javascripts/SVLabel/build/SVLabel.css" created.

    Done.
    Completed in 23.905s at Thu Dec 20 2018 09:31:45 GMT+0000 (Coordinated Universal Time) - Waiting...

    [success] Compiled in 90s
    ```

## Running the application remotely
NOTE: This has not been tested in a very long time and may not work.

To run the application remotely,

1. Use Play's dist tool to create jar files of the project (i,e., `activator dist`): https://www.playframework.com/documentation/2.3.x/ProductionDist
1. Upload the zip file to the web server
1. SSH into the server and unarchive the zip file (e.g., `unzip filename`).
1. Run `nohup bin/sidewalk-webpage -Dhttp.port=9000 &` ([reference](http://alvinalexander.com/scala/play-framework-deploying-application-production-server)). Sometimes the application tells you that port 9000 (i.e., default port for a Play app) is taken. To kill an application that is occupying the port, first identify pid with the netstat command `netstat -tulpn | grep :9000` and then use the `kill` command.
