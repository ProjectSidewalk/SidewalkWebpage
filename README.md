# Sidewalk Webpage
The Project Sidewalk webpage.

## Development Instructions

### Setting up the development environment
The development environment is set up using Docker containers. Hence, in order to set the development environment, [installation of Docker](https://www.docker.com/get-started) is necessary.

### Running the Application Locally
To run the web server locally, from the root of the SidewalkWebpage directory:

1. Run `make dev`. This will download the docker images and spin up the containers. The containers will have all the necessary packages and tools so no installation is necessary. Though, the container executes a bash shell running Ubuntu Jessie, which allows you to install whatever tool you prefer that can run on this flavor of linux (vi, etc.). This command also sets up the `sidewalk` database with the schema (just the schema, not the data - see Importing SQL dump in Additional Tools section) from the production dump, which lives in `db/schema.sql`. Successful output of this command will look like:

```
Successfully built [container-id]
Successfully tagged projectsidewalk/web:latest
WARNING: Image for service web was built because it did not already exist. To rebuild this image you must use `docker-compose build` or `docker-compose up --build`.
root@[container-id]:/opt#
```

2. Run `npm start`. The result of this command is dictated by what `start` is supposed to do as defined in `package.json` file. As per the current code, running this command will run `grunt watch` & `sbt compile "~ run"` (`~` here is triggered execution that allows for the server to run in watch mode). This should start the web server. Note that the first time compilation takes time. Successful output of this command will look like:

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

3. Head on over to your browser and navigate to `127.0.0.1:9000`. This should display the Project Sidewalk webpage. Note that the first time compilation takes time.

### Additional Tools
1. Importing SQL dump: The Postgres database schema has already been set up in the db docker container. To import production db dump, get the dump as per [instructions](https://github.com/ProjectSidewalk/Instructions), rename the file `dump`, place it in the `db` folder, and run `make import-dump` from the base folder.

2. SSH into containers: To ssh into the containers, run `make ssh target=[web|db]`. Note that `[web|db]` is not a literal syntax, it specifies which container you would want to ssh into. For example, you can do `make ssh target=web`.

### Making changes
1. If you make any changes to the `build.sbt` or the configs, you'd need to press `Ctrl+D` and then `sbt clean` and then `npm start`.

2. If you make any changes to the views or other scala files, these changes will be automatically picked up by `sbt`. You'd need to reload the browser once the compilation finishes. For example, a change to `index.scala.html` file results in:

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

3. If you make any changes to the assets (look in `Gruntfile.js` under `watch` block), these changes will be picked up by `grunt`. You'd need to reload the browser once the compilation finishes. For example, a change to `public/javascripts/FAQ/src/tableOfContents.js` file results in (output has been trimmed):

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

### Debugging Notes
1. As mentioned above, `npm start` is a shorthand to run `grunt watch` and `sbt run`. If you prefer, you can manually run these separately (and can, for this matter, choose to use `activator` instead of `sbt`). `activator run` or `sbt run` needs to be run on the top directory where `build.sbt` is located. For `grunt`, run `grunt watch` so the changes you make to SVLabel JavaScript library will be automatically built on file updates. If `grunt watch` is not responding, you can run `grunt concat` and `grunt concat_css` to build the files.

2. If you see an error like:

```
Execution exception[[NoSuchElementException: None.get]]
```

This is because the data from the database is missing and you'd need to import the sql dump. The schema import that's a part of init script only sets the schema and does not import the data.

## Running the Application Remotely
To run the application remotely,

1. Use Play's dist tool to create jar files of the project (i,e., `activator dist`): https://www.playframework.com/documentation/2.3.x/ProductionDist
2. Upload the zip file to the web server
3. SSH into the server and unarchive the zip file (e.g., `unzip filename`).
4. Run `nohup bin/sidewalk-webpage -Dhttp.port=9000 &` ([reference](http://alvinalexander.com/scala/play-framework-deploying-application-production-server)). Sometimes the application tells you that port 9000 (i.e., default port for a Play app) is taken. To kill an application that is occupying the port, first identify pid with the netstat command `netstat -tulpn | grep :9000` and then use the `kill` command.
